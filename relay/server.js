'use strict';

// Lokaler WebSocket-Relay für das DnD-Tool.
//
// Standardmäßig läuft alles nur auf diesem Rechner:
//   HTTP:      http://localhost:8080  (liefert die App direkt aus)
//   WebSocket: ws://localhost:8080
//
// Protokoll:
//   HOST    { roomCode, hostToken? }               -> HOST_READY { roomCode, hostToken, reconnected, playerIds }
//   JOIN    { roomCode, playerId, playerToken, accountToken? } -> JOIN_READY { roomCode, playerId, hostOnline }
//           (playerId "player_<kontoname>" eines registrierten Kontos nur mit gültigem accountToken)
//   PAYLOAD { data, to? }                          -> Host -> Spieler (optional gezielt), Spieler -> Host
//   PING                                           -> PONG
//
// HTTP-API für Spieler-Konten (global, SQLite – siehe accounts.js):
//   GET  /api/status                       -> { accounts: true|false }
//   POST /api/register { name, password }  -> { token, name, character }
//   POST /api/login    { name, password }  -> { token, name, character }
//   GET  /api/character  (Bearer-Token)    -> { character, updatedAt }
//   PUT  /api/character { character }      -> { updatedAt }
//   GET  /api/sessions                     -> { sessions: [{ sessionId, roomCode, players, updatedAt }] }
//   GET  /api/sessions/<id>                -> { roomCode, state }
//   PUT  /api/sessions/<id> { roomCode, state } / DELETE /api/sessions/<id>
//   POST /api/logout     (Bearer-Token)
//
// Relay -> Host:    PLAYERS { playerIds }            (bei jedem Beitritt / Abgang)
// Relay -> Spieler: HOST_LEFT, HOST_BACK, SESSION_CLOSED
//
// Der Relay merkt sich Räume kurzzeitig, wenn der Host die Verbindung verliert.
// So können DM und Spieler innerhalb des Gnadenfensters automatisch zurückkehren.
//
// Nutzung:
//   node server.js                    -> startet mit ENV-Konfiguration
//   require('./server').createRelay() -> für den Launcher (start.command)

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');
const { createAccountStore, AccountError } = require('./accounts');

// Eigene Close-Codes (4000–4999 sind für Anwendungen reserviert).
// Der Client wertet sie aus, um z. B. bei "replaced" NICHT erneut zu verbinden.
const CLOSE = {
    HOST_GONE: 4000,       // DM kam nicht zurück – Session beendet
    HOST_REPLACED: 4001,   // Gleiche DM-Session hat sich neu verbunden (anderer Tab / Reconnect)
    PLAYER_REPLACED: 4002, // Gleicher Spieler hat sich neu verbunden
    ROOM_EXPIRED: 4003,    // Raum zu lange inaktiv
    SLOW_CLIENT: 4004,     // Client kommt mit dem Lesen nicht hinterher
    SERVICE_RESTART: 1012  // Relay wird beendet/neu gestartet
};

const RESERVED_IDS = new Set(['__proto__', 'constructor', 'prototype']);

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.map': 'application/json; charset=utf-8'
};

// Nicht ausliefern: Server-Code, Abhängigkeiten, IDE-/Git-Ordner, Startskripte.
const BLOCKED_SEGMENTS = new Set(['node_modules', 'relay']);
const BLOCKED_FILES = new Set(['start.command', 'start.bat', 'start.sh', 'dnd.iml']);

function numberFromEnv(name, fallback) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

function defaultLog(...args) {
    const t = new Date().toLocaleTimeString('de-DE', { hour12: false });
    console.log(`[${t}]`, ...args);
}

function lanAddresses() {
    const result = [];
    for (const list of Object.values(os.networkInterfaces())) {
        for (const addr of list || []) {
            if (addr.family === 'IPv4' && !addr.internal) result.push(addr.address);
        }
    }
    return result;
}

function normalizeRoomCode(value) {
    const code = String(value == null ? '' : value).trim();
    return /^[A-Za-z0-9_-]{1,64}$/.test(code) ? code : null;
}

function normalizeToken(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value) ? value : null;
}

function isOpen(ws) {
    return Boolean(ws) && ws.readyState === WebSocket.OPEN;
}

// Echte Client-IP. Hinter einem Tunnel (cloudflared/ngrok/ssh) kommt alles von 127.0.0.1 –
// dann zählt der Header des Tunnels. Von außen direkt gesendete Header werden ignoriert.
function clientIp(req) {
    const remote = (req && req.socket && req.socket.remoteAddress) || 'unknown';
    if (remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1') {
        const forwarded = req.headers['cf-connecting-ip']
            || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
        if (forwarded) return String(forwarded).slice(0, 64);
    }
    return remote;
}

// Einfaches Fenster-Limit: höchstens `max` Treffer pro `windowMs` und Schlüssel.
function createLimiter(max, windowMs) {
    const hits = new Map(); // key -> { count, since }
    return {
        limited(key) {
            const e = hits.get(key);
            return Boolean(e && Date.now() - e.since < windowMs && e.count >= max);
        },
        hit(key) {
            const now = Date.now();
            const e = hits.get(key);
            if (!e || now - e.since >= windowMs) hits.set(key, { count: 1, since: now });
            else e.count += 1;
        },
        prune() {
            const now = Date.now();
            for (const [key, e] of hits) if (now - e.since >= windowMs) hits.delete(key);
        }
    };
}

function createRelay(options = {}) {
    const config = {
        staticRoot: path.resolve(options.staticRoot || process.env.STATIC_ROOT || path.join(__dirname, '..')),
        serveStatic: options.serveStatic !== undefined ? options.serveStatic : process.env.SERVE_STATIC !== '0',
        heartbeatMs: options.heartbeatMs || numberFromEnv('HEARTBEAT_MS', 30000),
        hostGraceMs: options.hostGraceMs || numberFromEnv('HOST_GRACE_MS', 120000),
        maxPayload: options.maxPayload || 10 * 1024 * 1024,
        maxBufferedBytes: options.maxBufferedBytes || 32 * 1024 * 1024,
        maxPlayersPerRoom: options.maxPlayersPerRoom || 16,
        roomSweepMs: 5 * 60 * 1000,
        roomMaxIdleMs: 12 * 60 * 60 * 1000
    };
    const log = options.log || defaultLog;

    // Spieler-Konten (global, SQLite). Fällt still auf "nicht verfügbar" zurück,
    // z. B. bei zu alter Node-Version – dann bleibt das Speichern per .json-Datei.
    let accounts;
    try {
        accounts = options.accountStore || createAccountStore({ dbPath: options.dbPath });
    } catch (err) {
        accounts = { available: false, reason: `Datenbank konnte nicht geöffnet werden: ${err.message}`, close() {} };
    }
    if (!accounts.available) log(`[!] Spieler-Konten deaktiviert – ${accounts.reason}`);

    const rooms = new Map(); // roomCode -> Room
    const MAX_ROOMS = 500;

    // Gegen Durchprobieren von Raum-Codes / Massen-Anlegen (relevant, sobald ein Tunnel läuft).
    // Pro IP + global, weil Tunnel-Header nicht immer vertrauenswürdig sind.
    const limits = {
        failedJoinIp: createLimiter(60, 60 * 1000),
        failedJoinAll: createLimiter(300, 60 * 1000),
        hostIp: createLimiter(30, 10 * 60 * 1000),
        registerIp: createLimiter(10, 60 * 60 * 1000),
        registerAll: createLimiter(40, 60 * 60 * 1000)
    };
    const startedAt = Date.now();
    let connectionCounter = 0;
    let publicUrl = null;
    let listenInfo = null; // { host, port }

    // --- Hilfsfunktionen ---------------------------------------------------

    function send(ws, obj) {
        if (!isOpen(ws)) return false;
        // Ein Client, der Megabytes an ungelesenen Daten vor sich herschiebt, hängt.
        // Lieber hart trennen – sein Auto-Reconnect holt sich danach den aktuellen Stand.
        if (ws.bufferedAmount > config.maxBufferedBytes) {
            log(`[!] Client #${ws.connectionId} kommt nicht hinterher – Verbindung wird neu aufgebaut.`);
            try { ws.close(CLOSE.SLOW_CLIENT, 'slow client'); } catch (e) { /* egal */ }
            setTimeout(() => { try { ws.terminate(); } catch (e) { /* egal */ } }, 2000).unref();
            return false;
        }
        try {
            ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
            return true;
        } catch (e) {
            return false;
        }
    }

    function sendError(ws, code, message) {
        send(ws, { _relay: 'ERROR', code, message });
    }

    function broadcastPlayers(room, obj) {
        const raw = JSON.stringify(obj);
        for (const player of room.players.values()) send(player, raw);
    }

    function notifyHostPlayers(room) {
        if (isOpen(room.host)) {
            send(room.host, { _relay: 'PLAYERS', playerIds: [...room.players.keys()] });
        }
    }

    function touch(room) {
        if (room) room.lastActivity = Date.now();
    }

    function closeRoom(room, closeCode, reason) {
        clearHostGrace(room);
        for (const player of room.players.values()) {
            try { player.close(closeCode, reason); } catch (e) { /* egal */ }
        }
        room.players.clear();
        rooms.delete(room.code);
    }

    function scheduleHostGrace(room) {
        clearTimeout(room.graceTimer);
        room.graceTimer = setTimeout(() => {
            room.graceTimer = null;
            if (room.host) return;
            if (room.players.size === 0) {
                rooms.delete(room.code);
                log(`[-] Raum ${room.code} verwaist, entfernt.`);
                return;
            }
            broadcastPlayers(room, {
                _relay: 'SESSION_CLOSED',
                message: 'Der DM ist nicht zurückgekehrt. Die Session wurde beendet.'
            });
            closeRoom(room, CLOSE.HOST_GONE, 'host offline');
            log(`[-] Raum ${room.code}: DM nicht zurück, Raum geschlossen.`);
        }, config.hostGraceMs);
    }

    function clearHostGrace(room) {
        if (room.graceTimer) {
            clearTimeout(room.graceTimer);
            room.graceTimer = null;
        }
    }

    function detachFromRoom(ws) {
        const room = rooms.get(ws.room);
        if (room) {
            if (ws.role === 'host' && room.host === ws) {
                room.host = null;
                touch(room);
                broadcastPlayers(room, { _relay: 'HOST_LEFT', graceMs: config.hostGraceMs });
                log(`[-] Host von Raum ${room.code} getrennt – warte ${Math.round(config.hostGraceMs / 1000)} s.`);
                scheduleHostGrace(room);
            } else if (ws.role === 'player' && ws.playerId && room.players.get(ws.playerId) === ws) {
                room.players.delete(ws.playerId);
                touch(room);
                notifyHostPlayers(room);
                log(`[-] Spieler ${ws.playerId} aus Raum ${room.code} (${room.players.size} übrig)`);
            }
        }
        ws.room = null;
        ws.role = null;
        ws.playerId = null;
    }

    // --- Nachrichten -------------------------------------------------------

    function handleHost(ws, msg) {
        const code = normalizeRoomCode(msg.roomCode);
        if (!code) return sendError(ws, 'INVALID_ROOM', 'Ungültiger Raum-Code.');
        const token = normalizeToken(msg.hostToken);

        let room = rooms.get(code);
        const sameHost = Boolean(room && token && room.hostToken && token === room.hostToken);

        // Ein bestehender Raum gehört dem DM mit dem passenden Token – auch während des
        // Gnadenfensters, in dem der DM kurz weg ist. Ohne Token erst nach Ablauf.
        if (!room) {
            if (limits.hostIp.limited(ws.ip) || rooms.size >= MAX_ROOMS) {
                return sendError(ws, 'RATE_LIMITED', 'Zu viele neue Räume. Bitte kurz warten.');
            }
            limits.hostIp.hit(ws.ip);
        }

        if (room && room.host !== ws && !sameHost) {
            return sendError(ws, 'ROOM_TAKEN', isOpen(room.host)
                ? 'Dieser Raum wird bereits gehostet.'
                : 'Dieser Raum wird noch für den DM freigehalten. Versuche es in ein paar Minuten erneut oder starte eine neue Session.');
        }

        if (ws.room && !(ws.room === code && ws.role === 'host')) detachFromRoom(ws);

        if (room) {
            if (room.host && room.host !== ws) {
                // Gleiche DM-Session (z. B. Reconnect nach Netzwechsel): alte Verbindung ablösen.
                const oldHost = room.host;
                room.host = null;
                oldHost.role = null;
                oldHost.room = null;
                try { oldHost.close(CLOSE.HOST_REPLACED, 'replaced'); } catch (e) { /* egal */ }
            }
            clearHostGrace(room);
            touch(room);
        } else {
            room = {
                code,
                host: null,
                // Nach einem Relay-Neustart darf der DM seinen bisherigen Token weiterverwenden.
                hostToken: token || crypto.randomBytes(16).toString('hex'),
                players: new Map(),
                playerTokens: new Map(),
                createdAt: Date.now(),
                lastActivity: Date.now(),
                everHosted: false,
                graceTimer: null
            };
            rooms.set(code, room);
        }

        const reconnected = room.everHosted;
        room.everHosted = true;
        room.host = ws;
        ws.room = code;
        ws.role = 'host';
        ws.playerId = null;

        send(ws, {
            _relay: 'HOST_READY',
            roomCode: code,
            hostToken: room.hostToken,
            reconnected,
            players: room.players.size,
            playerIds: [...room.players.keys()]
        });
        // Spieler, die die Trennung überlebt haben, dürfen sofort wieder senden.
        broadcastPlayers(room, { _relay: 'HOST_BACK' });
        log(`${reconnected ? '[~]' : '[+]'} Host für Raum ${code} (${room.players.size} Spieler${reconnected ? ', wieder verbunden' : ''})`);
    }

    function handleJoin(ws, msg) {
        const code = normalizeRoomCode(msg.roomCode);
        if (!code) return sendError(ws, 'INVALID_ROOM', 'Ungültiger Raum-Code.');

        if (limits.failedJoinIp.limited(ws.ip) || limits.failedJoinAll.limited('all')) {
            return sendError(ws, 'RATE_LIMITED', 'Zu viele Fehlversuche. Bitte kurz warten und erneut versuchen.');
        }
        const room = rooms.get(code);
        if (!room) {
            limits.failedJoinIp.hit(ws.ip);
            limits.failedJoinAll.hit('all');
            return sendError(ws, 'ROOM_NOT_FOUND', 'Raum nicht gefunden. Prüfe den Raum-Code.');
        }

        let playerId = typeof msg.playerId === 'string' ? msg.playerId.trim() : '';
        if (!playerId || playerId.length > 100) playerId = `anon_${ws.connectionId}_${Date.now().toString(36)}`;
        if (RESERVED_IDS.has(playerId)) return sendError(ws, 'INVALID_PLAYER', 'Ungültige Spieler-ID.');

        const token = normalizeToken(msg.playerToken);
        if (!token) return sendError(ws, 'INVALID_PLAYER', 'Spieler-Token fehlt. Bitte Seite neu laden.');

        // Konto-Spieler: Die ID "player_<kontoname>" gehört dem Konto. Wer sie benutzen will,
        // muss sich mit dem Konto-Token ausweisen – sonst könnte jeder mit gleichem Namen
        // den gespeicherten Charakter (inkl. Notizen) übernehmen.
        let accountVerified = false;
        if (accounts.available) {
            if (msg.accountToken !== undefined) {
                let user;
                try { user = accounts.authenticate(msg.accountToken); } catch (e) {
                    return sendError(ws, 'ACCOUNT_INVALID', 'Deine Anmeldung ist abgelaufen. Bitte im Hauptmenü erneut anmelden.');
                }
                if (playerId !== `player_${user.nameKey}`) {
                    return sendError(ws, 'INVALID_PLAYER', 'Spieler-ID passt nicht zum Konto. Bitte Seite neu laden.');
                }
                accountVerified = true;
            } else if (playerId.startsWith('player_') && accounts.isRegisteredKey(playerId.slice(7))) {
                return sendError(ws, 'ACCOUNT_REQUIRED', 'Dieser Name gehört zu einem Konto. Gib das Passwort ein oder wähle einen anderen Namen.');
            }
        }

        const knownToken = room.playerTokens.get(playerId);
        const previous = room.players.get(playerId);

        // Die ID gehört in diesem Raum dem ersten Token – auch wenn dieser Spieler gerade
        // offline ist. Sonst könnte jemand mit gleichem Namen seinen Platz (und Charakter) übernehmen.
        // Ausnahme: per Konto ausgewiesen (z. B. gleicher Spieler auf anderem Gerät).
        if (knownToken && token !== knownToken && !accountVerified) {
            return sendError(ws, 'PLAYER_TAKEN', previous && previous !== ws && isOpen(previous)
                ? 'Ein Spieler mit diesem Charakternamen ist bereits verbunden. Wähle einen anderen Namen.'
                : 'Dieser Name wird in dieser Session schon von einem anderen Gerät benutzt. Melde dich mit deinem Konto an oder wähle einen anderen Namen.');
        }
        if (!previous && room.players.size >= config.maxPlayersPerRoom) {
            return sendError(ws, 'ROOM_FULL', 'Der Raum ist voll.');
        }

        if (ws.room && !(ws.room === code && ws.playerId === playerId)) detachFromRoom(ws);

        if (previous && previous !== ws) {
            // Reconnect: alte (meist schon tote) Verbindung desselben Spielers ersetzen.
            room.players.delete(playerId);
            previous.role = null;
            previous.room = null;
            try { previous.close(CLOSE.PLAYER_REPLACED, 'replaced'); } catch (e) { /* egal */ }
        }

        room.playerTokens.set(playerId, token);
        room.players.set(playerId, ws);
        ws.room = code;
        ws.role = 'player';
        ws.playerId = playerId;
        touch(room);

        send(ws, {
            _relay: 'JOIN_READY',
            roomCode: code,
            playerId,
            hostOnline: isOpen(room.host)
        });
        notifyHostPlayers(room);
        log(`[+] Spieler ${playerId} in Raum ${code} (${room.players.size} Spieler)`);
    }

    function handlePayload(ws, msg) {
        const room = rooms.get(ws.room);
        if (!room || msg.data === undefined) return;
        touch(room);

        if (ws.role === 'host' && room.host === ws) {
            const out = JSON.stringify({ _relay: 'PAYLOAD', data: msg.data });
            if (typeof msg.to === 'string' && msg.to) {
                const target = room.players.get(msg.to);
                if (target) send(target, out);
            } else {
                for (const player of room.players.values()) send(player, out);
            }
            return;
        }

        if (ws.role === 'player' && room.players.get(ws.playerId) === ws) {
            if (!isOpen(room.host)) {
                // DM gerade weg: Spieler wissen lassen, dass die Nachricht nicht ankam.
                return send(ws, { _relay: 'HOST_LEFT', graceMs: config.hostGraceMs });
            }
            // Der Relay stempelt die verbindliche Absender-ID, damit der Host
            // keine fremde Identität vortäuschen kann.
            let data = msg.data;
            if (data && typeof data === 'object' && !Array.isArray(data)) {
                const clean = {};
                for (const key of Object.keys(data)) {
                    if (RESERVED_IDS.has(key)) continue;
                    clean[key] = data[key];
                }
                clean._playerId = ws.playerId;
                data = clean;
            }
            send(room.host, { _relay: 'PAYLOAD', data });
        }
    }

    // --- HTTP: statische App, /health, /info ------------------------------

    function resolveStaticFile(urlPath) {
        let decoded;
        try {
            decoded = decodeURIComponent(String(urlPath || '/').split('?')[0].split('#')[0]);
        } catch (e) {
            return null;
        }
        if (decoded.includes('\0')) return null;
        if (decoded === '/' || decoded === '') decoded = '/index.html';

        const root = config.staticRoot;
        const resolved = path.resolve(root, '.' + decoded);
        if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;

        const segments = path.relative(root, resolved).split(path.sep);
        // Groß-/Kleinschreibung ignorieren: macOS/Windows liefern /Relay/... sonst trotzdem aus.
        if (segments.some(s => s.startsWith('.') || BLOCKED_SEGMENTS.has(s.toLowerCase()))) return null;
        // Datenbank-Dateien nie ausliefern, egal wo sie liegen.
        if (/\.(db|sqlite3?)(-wal|-shm|-journal)?$/i.test(segments[segments.length - 1])) return null;
        if (BLOCKED_FILES.has(segments[segments.length - 1].toLowerCase())) return null;
        return resolved;
    }

    function sendText(res, status, text, extraHeaders) {
        res.writeHead(status, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, extraHeaders));
        res.end(text);
    }

    function sendJson(res, obj) {
        res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store'
        });
        res.end(JSON.stringify(obj));
    }

    function serveStatic(req, res) {
        if (!config.serveStatic) return sendText(res, 404, 'Static file serving is disabled.');
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            return sendText(res, 405, 'Method not allowed.', { Allow: 'GET, HEAD' });
        }

        const filePath = resolveStaticFile(req.url);
        if (!filePath) return sendText(res, 404, 'Not found.');

        fs.stat(filePath, (err, stats) => {
            if (err || !stats.isFile()) return sendText(res, 404, 'Not found.');

            const ext = path.extname(filePath).toLowerCase();
            const etag = `W/"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`;
            const headers = {
                'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
                'Cache-Control': 'no-cache',
                'ETag': etag,
                'X-Content-Type-Options': 'nosniff',
                'Referrer-Policy': 'no-referrer',
                // Kein Einbetten in fremde Seiten (Clickjacking), keine Plugins, kein <base>-Trick.
                'X-Frame-Options': 'DENY',
                'Content-Security-Policy': "frame-ancestors 'none'; object-src 'none'; base-uri 'none'"
            };
            if (req.headers['if-none-match'] === etag) {
                res.writeHead(304, headers);
                return res.end();
            }
            headers['Content-Length'] = stats.size;
            res.writeHead(200, headers);
            if (req.method === 'HEAD') return res.end();

            const stream = fs.createReadStream(filePath);
            stream.on('error', () => res.destroy());
            stream.pipe(res);
        });
    }

    function localUrl() {
        if (!listenInfo) return null;
        const h = listenInfo.host === '0.0.0.0' || listenInfo.host === '::' ? 'localhost' : listenInfo.host;
        return `http://${h}:${listenInfo.port}`;
    }

    function lanUrls() {
        if (!listenInfo || (listenInfo.host !== '0.0.0.0' && listenInfo.host !== '::')) return [];
        return lanAddresses().map(ip => `http://${ip}:${listenInfo.port}`);
    }

    function stats() {
        let players = 0;
        for (const room of rooms.values()) players += room.players.size;
        return {
            rooms: rooms.size,
            players,
            clients: wss.clients.size,
            uptimeSeconds: Math.round((Date.now() - startedAt) / 1000)
        };
    }

    // --- HTTP: Konten-API (/api/...) ---------------------------------------

    // Charaktere/Sessions enthalten evtl. Bilder (Base64) – eine ganze DM-Session kann groß werden.
    const MAX_API_BODY = 50 * 1024 * 1024;
    const MAX_AUTH_BODY = 16 * 1024;              // Login/Registrierung: nur Name + Passwort
    const MAX_CHARACTER_BODY = 10 * 1024 * 1024;  // ein Charakter (Avatar max. ~1 MB)

    function sendApi(res, status, obj) {
        res.writeHead(status, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff'
        });
        res.end(JSON.stringify(obj));
    }

    function readJsonBody(req, res, maxBytes = MAX_API_BODY) {
        return new Promise((resolve, reject) => {
            let size = 0;
            let tooBig = false;
            const chunks = [];
            const fail = () => {
                tooBig = true;
                chunks.length = 0;
                // Erst die 413-Antwort schicken, dann die Verbindung schließen.
                res.on('finish', () => req.destroy());
                reject(new AccountError(413, 'TOO_LARGE', `Die Daten sind zu groß (max. ${Math.max(1, Math.round(maxBytes / 1024 / 1024))} MB).`));
            };
            if (Number(req.headers['content-length']) > maxBytes) return fail();
            req.on('data', (chunk) => {
                if (tooBig) return;
                size += chunk.length;
                if (size > maxBytes) return fail();
                chunks.push(chunk);
            });
            req.on('end', () => {
                if (tooBig) return;
                if (size === 0) return resolve({});
                try {
                    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                    resolve(parsed && typeof parsed === 'object' ? parsed : {});
                } catch (e) {
                    reject(new AccountError(400, 'BAD_JSON', 'Ungültige Anfrage.'));
                }
            });
            req.on('error', reject);
        });
    }

    function bearerToken(req) {
        const header = String(req.headers.authorization || '');
        return header.startsWith('Bearer ') ? header.slice(7).trim() : null;
    }

    async function handleApi(req, res, route) {
        if (route === '/api/status') {
            return sendApi(res, 200, { ok: true, accounts: accounts.available, reason: accounts.available ? null : accounts.reason });
        }
        if (!accounts.available) {
            return sendApi(res, 503, { ok: false, code: 'ACCOUNTS_DISABLED', message: `Spieler-Konten sind auf diesem Server nicht verfügbar. ${accounts.reason}` });
        }
        const key = `${req.method} ${route}`;
        try {
            // /api/sessions/<id> – einzelne DM-Session
            const sessionMatch = /^\/api\/sessions\/([^/]+)$/.exec(route);
            if (sessionMatch) {
                let sessionId;
                try { sessionId = decodeURIComponent(sessionMatch[1]); } catch (e) { sessionId = ''; }
                const token = bearerToken(req);
                if (req.method === 'GET') {
                    return sendApi(res, 200, Object.assign({ ok: true }, accounts.getSession(token, sessionId)));
                }
                if (req.method === 'PUT' || req.method === 'POST') {
                    const body = await readJsonBody(req, res);
                    return sendApi(res, 200, Object.assign({ ok: true }, accounts.saveSession(token, sessionId, body.roomCode, body.state)));
                }
                if (req.method === 'DELETE') {
                    return sendApi(res, 200, Object.assign({ ok: true }, accounts.deleteSession(token, sessionId)));
                }
                return sendApi(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Methode nicht erlaubt.' });
            }
            switch (key) {
                case 'GET /api/sessions': {
                    return sendApi(res, 200, Object.assign({ ok: true }, accounts.listSessions(bearerToken(req))));
                }
                case 'POST /api/register': {
                    const ip = clientIp(req);
                    if (limits.registerIp.limited(ip) || limits.registerAll.limited('all')) {
                        throw new AccountError(429, 'TOO_MANY_ATTEMPTS', 'Zu viele neue Konten in kurzer Zeit. Bitte später erneut versuchen.');
                    }
                    const body = await readJsonBody(req, res, MAX_AUTH_BODY);
                    limits.registerIp.hit(ip);
                    limits.registerAll.hit('all');
                    const result = accounts.register(body.name, body.password);
                    log(`[+] Neues Spieler-Konto: ${result.name}`);
                    return sendApi(res, 200, Object.assign({ ok: true }, result));
                }
                case 'POST /api/login': {
                    const body = await readJsonBody(req, res, MAX_AUTH_BODY);
                    const result = accounts.login(body.name, body.password);
                    log(`[+] Login: ${result.name}`);
                    return sendApi(res, 200, Object.assign({ ok: true }, result));
                }
                case 'POST /api/logout': {
                    accounts.logout(bearerToken(req));
                    return sendApi(res, 200, { ok: true });
                }
                case 'GET /api/character': {
                    return sendApi(res, 200, Object.assign({ ok: true }, accounts.getCharacter(bearerToken(req))));
                }
                case 'PUT /api/character':
                case 'POST /api/character': {
                    const token = bearerToken(req);
                    const body = await readJsonBody(req, res, MAX_CHARACTER_BODY);
                    return sendApi(res, 200, Object.assign({ ok: true }, accounts.saveCharacter(token, body.character)));
                }
                default:
                    return sendApi(res, 404, { ok: false, code: 'NOT_FOUND', message: 'Unbekannter API-Endpunkt.' });
            }
        } catch (err) {
            if (err instanceof AccountError) {
                return sendApi(res, err.status, { ok: false, code: err.code, message: err.message });
            }
            log(`[!] API-Fehler bei ${key}: ${err && err.stack || err}`);
            return sendApi(res, 500, { ok: false, code: 'SERVER_ERROR', message: 'Interner Serverfehler.' });
        }
    }

    const httpServer = http.createServer((req, res) => {
        const route = String(req.url || '/').split('?')[0];
        if (route.startsWith('/api/')) {
            handleApi(req, res, route).catch(() => { try { res.destroy(); } catch (e) { /* egal */ } });
            return;
        }
        if (route === '/health') {
            return sendJson(res, Object.assign({ ok: true, app: 'afterlife-relay', url: localUrl() }, stats()));
        }
        if (route === '/info') {
            // Wird vom DM-Client gelesen, um den Einladungslink anzuzeigen.
            return sendJson(res, { ok: true, publicUrl, localUrl: localUrl(), lanUrls: lanUrls() });
        }
        serveStatic(req, res);
    });

    const wss = new WebSocketServer({ server: httpServer, maxPayload: config.maxPayload });

    wss.on('connection', (ws, req) => {
        connectionCounter += 1;
        ws.connectionId = connectionCounter;
        ws.isAlive = true;
        ws.room = null;
        ws.role = null;
        ws.playerId = null;
        ws.ip = clientIp(req);

        const forwarded = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'];
        const remote = forwarded ? `${forwarded} via Tunnel` : (req.socket.remoteAddress || 'unbekannt');
        log(`[+] Client #${ws.connectionId} verbunden (${remote})`);

        ws.on('pong', () => { ws.isAlive = true; });

        ws.on('message', (raw, isBinary) => {
            ws.isAlive = true;
            if (isBinary) return sendError(ws, 'BAD_MESSAGE', 'Binärnachrichten werden nicht unterstützt.');
            let msg;
            try {
                msg = JSON.parse(raw.toString());
            } catch (e) {
                return sendError(ws, 'BAD_MESSAGE', 'Ungültige Nachricht.');
            }
            if (!msg || typeof msg !== 'object') return;

            try {
                switch (msg._relay) {
                    case 'PING': {
                        touch(rooms.get(ws.room));
                        return send(ws, { _relay: 'PONG', t: Date.now() });
                    }
                    case 'HOST': return handleHost(ws, msg);
                    case 'JOIN': return handleJoin(ws, msg);
                    case 'PAYLOAD': return handlePayload(ws, msg);
                    default: return;
                }
            } catch (err) {
                log(`[!] Fehler bei Nachricht von #${ws.connectionId}: ${err && err.stack || err}`);
            }
        });

        ws.on('close', (code) => {
            detachFromRoom(ws);
            log(`[-] Client #${ws.connectionId} getrennt${code ? ` (${code})` : ''}`);
        });

        ws.on('error', (err) => {
            log(`[!] Socket-Fehler #${ws.connectionId}: ${err.message}`);
        });
    });

    // Server-seitiger Heartbeat: entfernt tote Sockets (Browser antworten automatisch auf Pings).
    const heartbeatTimer = setInterval(() => {
        for (const ws of wss.clients) {
            if (ws.isAlive === false) {
                try { ws.terminate(); } catch (e) { /* egal */ }
                continue;
            }
            ws.isAlive = false;
            try { ws.ping(); } catch (e) { /* egal */ }
        }
    }, config.heartbeatMs);
    heartbeatTimer.unref();

    // Räume aufräumen, die niemand mehr braucht.
    const sweepTimer = setInterval(() => {
        const now = Date.now();
        for (const limiter of Object.values(limits)) limiter.prune();
        for (const room of [...rooms.values()]) {
            const empty = !room.host && room.players.size === 0;
            if (empty && !room.graceTimer && now - room.lastActivity > config.hostGraceMs) {
                rooms.delete(room.code);
                log(`[-] Leerer Raum ${room.code} aufgeräumt.`);
            } else if (now - room.lastActivity > config.roomMaxIdleMs) {
                if (room.host) {
                    try { room.host.close(CLOSE.ROOM_EXPIRED, 'room expired'); } catch (e) { /* egal */ }
                }
                closeRoom(room, CLOSE.ROOM_EXPIRED, 'room expired');
                log(`[-] Raum ${room.code} nach Inaktivität entfernt.`);
            }
        }
    }, config.roomSweepMs);
    sweepTimer.unref();

    // --- Öffentliche API ---------------------------------------------------

    function listen(port, host) {
        return new Promise((resolve, reject) => {
            const onError = (err) => {
                httpServer.removeListener('listening', onListening);
                reject(err);
            };
            const onListening = () => {
                httpServer.removeListener('error', onError);
                listenInfo = { host, port: httpServer.address().port };
                resolve(listenInfo);
            };
            httpServer.once('error', onError);
            httpServer.once('listening', onListening);
            httpServer.listen(port, host);
        });
    }

    function close() {
        clearInterval(heartbeatTimer);
        clearInterval(sweepTimer);
        for (const room of rooms.values()) clearHostGrace(room);
        for (const ws of wss.clients) {
            // 1012 = "Service Restart": Clients verbinden sich automatisch neu.
            try { ws.close(CLOSE.SERVICE_RESTART, 'server restart'); } catch (e) { /* egal */ }
        }
        return new Promise((resolve) => {
            const force = setTimeout(() => {
                for (const ws of wss.clients) { try { ws.terminate(); } catch (e) { /* egal */ } }
                accounts.close();
                resolve();
            }, 1500);
            force.unref();
            wss.close(() => {
                httpServer.close(() => { clearTimeout(force); accounts.close(); resolve(); });
                if (httpServer.closeAllConnections) httpServer.closeAllConnections();
            });
        });
    }

    return {
        config,
        httpServer,
        wss,
        listen,
        close,
        stats,
        accounts,
        localUrl,
        lanUrls,
        setPublicUrl(url) { publicUrl = url || null; },
        getPublicUrl() { return publicUrl; }
    };
}

module.exports = { createRelay, CLOSE, lanAddresses };

// --- Direktstart: `node server.js` / `npm start` ---------------------------
if (require.main === module) {
    const HOST = process.env.HOST || '127.0.0.1';
    const PORT = Number(process.env.PORT) || 8080;
    const relay = createRelay();

    relay.listen(PORT, HOST).then(() => {
        defaultLog('Relay läuft.');
        defaultLog(`  App:       ${relay.localUrl()}`);
        for (const url of relay.lanUrls()) defaultLog(`  LAN:       ${url}`);
        defaultLog(`  Statisch:  ${relay.config.serveStatic ? relay.config.staticRoot : 'deaktiviert'}`);
        defaultLog(`  Bindung:   ${HOST}:${PORT}${HOST === '127.0.0.1' ? ' (nur dieser Rechner)' : ''}`);
        if (process.env.PUBLIC_URL) relay.setPublicUrl(process.env.PUBLIC_URL);
    }).catch((err) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`\nPort ${PORT} ist bereits belegt.`);
            console.error('Beende den anderen Prozess oder starte mit einem anderen Port:');
            console.error('    PORT=8081 npm start\n');
        } else {
            console.error('Server-Fehler:', err);
        }
        process.exit(1);
    });

    let shuttingDown = false;
    const shutdown = (signal) => {
        if (shuttingDown) return process.exit(0);
        shuttingDown = true;
        defaultLog(`${signal} empfangen, Relay wird beendet …`);
        relay.close().then(() => process.exit(0));
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}
