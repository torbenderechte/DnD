'use strict';

// Spieler-Konten + Charakter-Speicher (SQLite, eingebaut in Node ≥ 22.13).
//
// - Konten gelten global (über alle Räume/Sessions hinweg): Name + Passwort.
// - Pro Konto wird genau ein Charakter gespeichert (als JSON-Blob).
// - DMs können beliebig viele Sessions (kompletter Spielstand) im Konto speichern.
// - Passwörter werden mit scrypt + Salt gehasht, Login-Tokens nur als SHA-256 gespeichert.
//
// Die Datenbank liegt standardmäßig in relay/data/afterlife.db (wird nicht ausgeliefert,
// da der Static-Server den Ordner "relay" sperrt). Pfad änderbar per DB_PATH.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TOKEN_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000; // 60 Tage ohne Nutzung -> abgelaufen
const MAX_FAILED_LOGINS = 8;
const FAILED_LOGIN_WINDOW_MS = 10 * 60 * 1000;
const SCRYPT_KEYLEN = 64;
const MAX_SESSIONS_PER_USER = 50;
const SESSION_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

let DatabaseSync = null;
let loadError = null;
try {
    ({ DatabaseSync } = require('node:sqlite'));
} catch (e) {
    loadError = e;
}

class AccountError extends Error {
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

// Aus dem Namen wird auch die Spieler-ID im Raum abgeleitet ("player_<key>"),
// deshalb muss dieser Schlüssel eindeutig sein.
function nameKey(name) {
    return String(name).toLowerCase().replace(/[^a-z0-9]/g, '_');
}

function normalizeName(value) {
    const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
    if (name.length < 2 || name.length > 40) {
        throw new AccountError(400, 'INVALID_NAME', 'Der Name muss 2–40 Zeichen lang sein.');
    }
    if (!/[A-Za-z0-9]/.test(name)) {
        throw new AccountError(400, 'INVALID_NAME', 'Der Name muss mindestens einen Buchstaben (A–Z) oder eine Ziffer enthalten.');
    }
    return name;
}

function checkPassword(value, forRegister) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new AccountError(400, 'INVALID_PASSWORD', 'Bitte ein Passwort eingeben.');
    }
    if (value.length > 200) {
        throw new AccountError(400, 'INVALID_PASSWORD', 'Das Passwort ist zu lang.');
    }
    if (forRegister && value.length < 4) {
        throw new AccountError(400, 'INVALID_PASSWORD', 'Das Passwort muss mindestens 4 Zeichen lang sein.');
    }
    return value;
}

function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
    return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
    const [scheme, saltHex, hashHex] = String(stored).split('$');
    if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
    return crypto.timingSafeEqual(expected, actual);
}

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function createAccountStore(options = {}) {
    if (!DatabaseSync) {
        return {
            available: false,
            reason: `SQLite nicht verfügbar (Node ${process.versions.node}; benötigt Node 22.13 oder neuer).`,
            error: loadError,
            close() {}
        };
    }

    const dbPath = options.dbPath || process.env.DB_PATH || path.join(__dirname, 'data', 'afterlife.db');
    if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });

    const db = new DatabaseSync(dbPath);
    // Passwort-Hashes & Charaktere: nur für den eigenen Benutzer lesbar (SQLite übernimmt
    // die Rechte der Hauptdatei auch für -wal/-shm).
    if (dbPath !== ':memory:') {
        try { fs.chmodSync(dbPath, 0o600); } catch (e) { /* z. B. Windows – egal */ }
    }
    db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS users (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT NOT NULL,
            name_key   TEXT NOT NULL UNIQUE,
            pw_hash    TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS characters (
            user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            data       TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS dm_sessions (
            user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            session_id TEXT NOT NULL,
            room_code  TEXT,
            players    INTEGER NOT NULL DEFAULT 0,
            data       TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (user_id, session_id)
        );
        CREATE TABLE IF NOT EXISTS auth_tokens (
            token_hash TEXT PRIMARY KEY,
            user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at INTEGER NOT NULL,
            last_used  INTEGER NOT NULL
        );
    `);

    const q = {
        userByKey: db.prepare('SELECT id, name, pw_hash FROM users WHERE name_key = ?'),
        insertUser: db.prepare('INSERT INTO users (name, name_key, pw_hash, created_at) VALUES (?, ?, ?, ?)'),
        insertToken: db.prepare('INSERT INTO auth_tokens (token_hash, user_id, created_at, last_used) VALUES (?, ?, ?, ?)'),
        userByToken: db.prepare(`
            SELECT u.id, u.name, t.last_used FROM auth_tokens t
            JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?`),
        touchToken: db.prepare('UPDATE auth_tokens SET last_used = ? WHERE token_hash = ?'),
        deleteToken: db.prepare('DELETE FROM auth_tokens WHERE token_hash = ?'),
        purgeTokens: db.prepare('DELETE FROM auth_tokens WHERE last_used < ?'),
        getChar: db.prepare('SELECT data, updated_at FROM characters WHERE user_id = ?'),
        putChar: db.prepare(`
            INSERT INTO characters (user_id, data, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`),
        listSessions: db.prepare(`
            SELECT session_id, room_code, players, created_at, updated_at FROM dm_sessions
            WHERE user_id = ? ORDER BY updated_at DESC`),
        countSessions: db.prepare('SELECT COUNT(*) AS n FROM dm_sessions WHERE user_id = ?'),
        getSession: db.prepare('SELECT session_id, room_code, data, updated_at FROM dm_sessions WHERE user_id = ? AND session_id = ?'),
        sessionExists: db.prepare('SELECT 1 FROM dm_sessions WHERE user_id = ? AND session_id = ?'),
        putSession: db.prepare(`
            INSERT INTO dm_sessions (user_id, session_id, room_code, players, data, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, session_id) DO UPDATE SET
                room_code = excluded.room_code, players = excluded.players,
                data = excluded.data, updated_at = excluded.updated_at`),
        deleteSession: db.prepare('DELETE FROM dm_sessions WHERE user_id = ? AND session_id = ?')
    };

    q.purgeTokens.run(Date.now() - TOKEN_MAX_AGE_MS);

    const failedLogins = new Map(); // name_key -> { count, since }

    function guardBruteForce(key) {
        const entry = failedLogins.get(key);
        if (entry && Date.now() - entry.since < FAILED_LOGIN_WINDOW_MS && entry.count >= MAX_FAILED_LOGINS) {
            throw new AccountError(429, 'TOO_MANY_ATTEMPTS', 'Zu viele Fehlversuche. Bitte in ein paar Minuten erneut versuchen.');
        }
    }

    function noteFailure(key) {
        const entry = failedLogins.get(key);
        if (!entry || Date.now() - entry.since >= FAILED_LOGIN_WINDOW_MS) {
            failedLogins.set(key, { count: 1, since: Date.now() });
        } else {
            entry.count += 1;
        }
    }

    function issueToken(userId) {
        const token = crypto.randomBytes(32).toString('base64url');
        const now = Date.now();
        q.insertToken.run(sha256(token), userId, now, now);
        return token;
    }

    function loadCharacter(userId) {
        const row = q.getChar.get(userId);
        if (!row) return { character: null, updatedAt: null };
        try {
            return { character: JSON.parse(row.data), updatedAt: row.updated_at };
        } catch (e) {
            return { character: null, updatedAt: null };
        }
    }

    function register(rawName, rawPassword) {
        const name = normalizeName(rawName);
        const password = checkPassword(rawPassword, true);
        const key = nameKey(name);
        if (q.userByKey.get(key)) {
            throw new AccountError(409, 'NAME_TAKEN', `Der Name „${name}“ ist bereits vergeben.`);
        }
        const result = q.insertUser.run(name, key, hashPassword(password), Date.now());
        const userId = Number(result.lastInsertRowid);
        return { token: issueToken(userId), name, nameKey: key, character: null, updatedAt: null };
    }

    function login(rawName, rawPassword) {
        const name = normalizeName(rawName);
        const password = checkPassword(rawPassword, false);
        const key = nameKey(name);
        guardBruteForce(key);
        const user = q.userByKey.get(key);
        if (!user) {
            throw new AccountError(404, 'UNKNOWN_USER', `Es gibt noch kein Konto „${name}“.`);
        }
        if (!verifyPassword(password, user.pw_hash)) {
            noteFailure(key);
            throw new AccountError(401, 'WRONG_PASSWORD', 'Falsches Passwort.');
        }
        failedLogins.delete(key);
        return Object.assign({ token: issueToken(user.id), name: user.name, nameKey: key }, loadCharacter(user.id));
    }

    function authenticate(token) {
        if (typeof token !== 'string' || token.length < 20 || token.length > 200) {
            throw new AccountError(401, 'NOT_LOGGED_IN', 'Nicht angemeldet.');
        }
        const hash = sha256(token);
        const row = q.userByToken.get(hash);
        if (!row || Date.now() - row.last_used > TOKEN_MAX_AGE_MS) {
            if (row) q.deleteToken.run(hash);
            throw new AccountError(401, 'NOT_LOGGED_IN', 'Anmeldung abgelaufen. Bitte erneut anmelden.');
        }
        // Nicht bei jedem Speichern schreiben – einmal pro Stunde reicht.
        if (Date.now() - row.last_used > 60 * 60 * 1000) q.touchToken.run(Date.now(), hash);
        return { id: row.id, name: row.name, nameKey: nameKey(row.name) };
    }

    function getCharacter(token) {
        const user = authenticate(token);
        return Object.assign({ name: user.name, nameKey: user.nameKey }, loadCharacter(user.id));
    }

    function saveCharacter(token, character) {
        const user = authenticate(token);
        if (!character || typeof character !== 'object' || Array.isArray(character) || typeof character.name !== 'string') {
            throw new AccountError(400, 'INVALID_CHARACTER', 'Ungültiger Charakter.');
        }
        const now = Date.now();
        q.putChar.run(user.id, JSON.stringify(character), now);
        return { updatedAt: now };
    }

    // --- DM-Sessions ------------------------------------------------------

    function checkSessionId(sessionId) {
        if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) {
            throw new AccountError(400, 'INVALID_SESSION_ID', 'Ungültige Session-ID.');
        }
        return sessionId;
    }

    function listSessions(token) {
        const user = authenticate(token);
        const sessions = q.listSessions.all(user.id).map(row => ({
            sessionId: row.session_id,
            roomCode: row.room_code,
            players: row.players,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        }));
        return { name: user.name, sessions };
    }

    function getSession(token, sessionId) {
        const user = authenticate(token);
        const row = q.getSession.get(user.id, checkSessionId(sessionId));
        if (!row) throw new AccountError(404, 'SESSION_NOT_FOUND', 'Diese Session gibt es nicht (mehr).');
        let state;
        try { state = JSON.parse(row.data); } catch (e) {
            throw new AccountError(500, 'SESSION_CORRUPT', 'Die gespeicherte Session ist beschädigt.');
        }
        return { sessionId: row.session_id, roomCode: row.room_code, state, updatedAt: row.updated_at };
    }

    function saveSession(token, sessionId, roomCode, state) {
        const user = authenticate(token);
        checkSessionId(sessionId);
        if (!state || typeof state !== 'object' || Array.isArray(state)
            || !state.characters || typeof state.characters !== 'object' || !Array.isArray(state.npcTemplates)) {
            throw new AccountError(400, 'INVALID_SESSION', 'Ungültiger Spielstand.');
        }
        const code = typeof roomCode === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(roomCode) ? roomCode : null;
        if (!q.sessionExists.get(user.id, sessionId) && q.countSessions.get(user.id).n >= MAX_SESSIONS_PER_USER) {
            throw new AccountError(409, 'TOO_MANY_SESSIONS', `Maximal ${MAX_SESSIONS_PER_USER} Sessions pro Konto. Lösche zuerst eine alte Session.`);
        }
        const now = Date.now();
        const players = Object.keys(state.characters).length;
        q.putSession.run(user.id, sessionId, code, players, JSON.stringify(state), now, now);
        return { updatedAt: now };
    }

    function deleteSession(token, sessionId) {
        const user = authenticate(token);
        q.deleteSession.run(user.id, checkSessionId(sessionId));
        return {};
    }

    // Für den Relay: Gehört diese Spieler-ID ("player_<key>") zu einem Konto?
    function isRegisteredKey(key) {
        return typeof key === 'string' && Boolean(q.userByKey.get(key));
    }

    function logout(token) {
        if (typeof token === 'string') q.deleteToken.run(sha256(token));
    }

    return {
        available: true,
        dbPath,
        register,
        login,
        getCharacter,
        saveCharacter,
        listSessions,
        getSession,
        saveSession,
        deleteSession,
        authenticate,
        isRegisteredKey,
        logout,
        close() { try { db.close(); } catch (e) { /* schon zu */ } }
    };
}

module.exports = { createAccountStore, AccountError, nameKey };
