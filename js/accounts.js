// Konten: Name + Passwort (global, gespeichert in der Datenbank des Relay-Servers).
// - Spieler: Der eigene Charakter wird automatisch im Konto gesichert.
// - DM: Die komplette Session (wie die Session-Datei) wird automatisch im Konto gesichert;
//       im Hauptmenü lassen sich gespeicherte Sessions fortsetzen.
// Das Speichern als .json-Datei bleibt zusätzlich möglich.

const ACCOUNT_SAVE_DEBOUNCE_MS = 2500;
const ACCOUNT_SAVE_RETRY_MS = 10000;
const ACCOUNT_HOST_CHECK_MS = 15000;   // DM: regelmäßig auf Änderungen prüfen (z. B. Notizen)

// http(s)-Basis des Relays (gleicher Host wie der WebSocket).
function accountApiBase() {
    return RELAY_URL.replace(/^ws/i, 'http').replace(/\/+$/, '');
}

// { token, name, mode: 'player' | 'host', sessionId? } während einer laufenden Session
let accountSession = null;
let accountSaveTimer = null;
let accountHostInterval = null;
let accountSaveInFlight = false;
let accountSaveQueued = false;
let accountLastSavedRaw = null;
let accountLastSavedAt = null;
let accountSaveError = null;

async function accountApi(method, path, body, token) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers['Authorization'] = `Bearer ${token}`;
    let res;
    try {
        res = await fetch(accountApiBase() + path, {
            method,
            headers,
            body: body !== undefined ? JSON.stringify(body) : undefined,
            cache: 'no-store'
        });
    } catch (e) {
        const err = new Error('Server nicht erreichbar.');
        err.code = 'NETWORK';
        throw err;
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* kein JSON */ }
    if (!res.ok || !data || data.ok === false) {
        const err = new Error((data && data.message) || `Fehler ${res.status}`);
        err.code = (data && data.code) || `HTTP_${res.status}`;
        err.status = res.status;
        throw err;
    }
    return data;
}

function newAccountSessionId() {
    return 's_' + randomToken();
}

// Login; existiert das Konto noch nicht, wird nach Bestätigung eines angelegt.
// Liefert { token, name, nameKey, character } oder null (abgebrochen).
async function loginOrRegisterAccount(name, password, hint) {
    try {
        return await accountApi('POST', '/api/login', { name, password });
    } catch (err) {
        if (err.code !== 'UNKNOWN_USER') throw err;
    }
    const confirmed = await new Promise((resolve) => {
        openConfirmModal(
            `Es gibt noch kein Konto „${name}“. Neues Konto mit diesem Namen und Passwort anlegen? ${hint || ''}`.trim(),
            () => resolve(true),
            { title: 'Neues Konto anlegen?', confirmText: 'Konto anlegen', onCancel: () => resolve(false) }
        );
    });
    if (!confirmed) return null;
    return accountApi('POST', '/api/register', { name, password });
}

// --- Laufende Session ------------------------------------------------------

// account: { token, name, updatedAt? }, mode: 'player' | 'host', sessionId: nur für 'host'
function startAccountSession(account, mode = 'player', sessionId = null) {
    stopAccountSession();
    if (!account || typeof account.token !== 'string' || typeof account.name !== 'string') return;
    accountSession = {
        token: account.token,
        name: account.name,
        mode,
        sessionId: mode === 'host' ? (sessionId || account.sessionId || newAccountSessionId()) : null
    };
    accountLastSavedAt = typeof account.updatedAt === 'number' ? account.updatedAt : null;
    if (mode === 'host') {
        accountHostInterval = setInterval(() => saveAccountNow(), ACCOUNT_HOST_CHECK_MS);
    }
    renderAccountStatus();
}

function stopAccountSession() {
    clearTimeout(accountSaveTimer);
    accountSaveTimer = null;
    clearInterval(accountHostInterval);
    accountHostInterval = null;
    accountSession = null;
    accountLastSavedRaw = null;
    accountLastSavedAt = null;
    accountSaveError = null;
    accountSaveQueued = false;
    renderAccountStatus();
}

// Für sessionStorage (Tab-Reload): Konto-Daten der laufenden Session.
function accountSessionRecord() {
    return accountSession ? Object.assign({}, accountSession) : null;
}

// Was gespeichert wird: { path, body, raw } oder null
function accountSavePayload() {
    const session = accountSession;
    if (!session) return null;
    if (session.mode === 'host') {
        if (!gameState.roomCode || !gameState.characters) return null;
        const raw = JSON.stringify(gameState);
        return {
            path: `/api/sessions/${encodeURIComponent(session.sessionId)}`,
            raw,
            body: () => `{"roomCode":${JSON.stringify(String(gameState.roomCode))},"state":${raw}}`
        };
    }
    if (!currentPlayerId || !gameState.characters || !hasOwn(gameState.characters, currentPlayerId)) return null;
    const raw = JSON.stringify(gameState.characters[currentPlayerId]);
    return { path: '/api/character', raw, body: () => `{"character":${raw}}` };
}

// Nach jeder Änderung aufrufen (lokal oder vom DM / von Spielern).
function scheduleAccountSave(delayMs = ACCOUNT_SAVE_DEBOUNCE_MS) {
    if (!accountSession) return;
    clearTimeout(accountSaveTimer);
    accountSaveTimer = setTimeout(() => {
        accountSaveTimer = null;
        saveAccountNow();
    }, delayMs);
}

async function saveAccountNow() {
    const session = accountSession;
    if (!session) return false;
    if (accountSaveInFlight) {
        accountSaveQueued = true;
        return false;
    }
    const payload = accountSavePayload();
    if (!payload) return false;
    if (payload.raw === accountLastSavedRaw) return true;

    accountSaveInFlight = true;
    try {
        const res = await fetch(accountApiBase() + payload.path, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.token}` },
            body: payload.body(),
            cache: 'no-store'
        }).catch(() => { throw Object.assign(new Error('Server nicht erreichbar.'), { code: 'NETWORK' }); });
        let data = null;
        try { data = await res.json(); } catch (e) { /* kein JSON */ }
        if (!res.ok || !data || data.ok === false) {
            throw Object.assign(new Error((data && data.message) || `Fehler ${res.status}`), { status: res.status });
        }
        if (accountSession !== session) return false;
        accountLastSavedRaw = payload.raw;
        accountLastSavedAt = data.updatedAt || Date.now();
        accountSaveError = null;
        return true;
    } catch (err) {
        if (accountSession !== session) return false;
        accountSaveError = err.message;
        if (err.status === 401) {
            const what = session.mode === 'host' ? 'Deine Session' : 'Dein Charakter';
            alert(`${what} konnte nicht in der Datenbank gespeichert werden: ${err.message}\nSpeichere zur Sicherheit als Datei.`);
            clearInterval(accountHostInterval);
            accountHostInterval = null;
            accountSession = null;
        } else if (err.status !== 400 && err.status !== 409 && err.status !== 413) {
            scheduleAccountSave(ACCOUNT_SAVE_RETRY_MS);
        }
        return false;
    } finally {
        accountSaveInFlight = false;
        renderAccountStatus();
        if (accountSaveQueued && accountSession) {
            accountSaveQueued = false;
            scheduleAccountSave(200);
        }
    }
}

// Beim Schließen/Verstecken des Tabs: letzter Stand per keepalive-Request
// (Browser erlauben dafür nur ~64 KB – Größeres über den normalen Weg).
function flushAccountSaveOnExit() {
    const session = accountSession;
    const payload = accountSavePayload();
    if (!session || !payload || payload.raw === accountLastSavedRaw) return;
    const body = payload.body();
    if (body.length > 60000) {
        saveAccountNow();
        return;
    }
    try {
        fetch(accountApiBase() + payload.path, {
            method: 'PUT',
            keepalive: true,
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.token}` },
            body
        }).then((res) => { if (res.ok) accountLastSavedRaw = payload.raw; }).catch(() => {});
    } catch (e) { /* egal */ }
}

window.addEventListener('pagehide', flushAccountSaveOnExit);
document.addEventListener('visibilitychange', () => {
    if (document.hidden) flushAccountSaveOnExit();
});

// Abmelden beim Verlassen der Session: vorher noch speichern.
// (Der Spielstand wird synchron gelesen, bevor der Aufrufer ihn zurücksetzt.)
async function endAccountSession() {
    const session = accountSession;
    if (!session) return;
    clearTimeout(accountSaveTimer);
    await saveAccountNow().catch(() => {});
    accountApi('POST', '/api/logout', undefined, session.token).catch(() => {});
    stopAccountSession();
}

function renderAccountStatus() {
    const el = document.getElementById('account-status');
    if (!el) return;
    if (!accountSession) {
        el.classList.add('hidden');
        el.textContent = '';
        return;
    }
    const what = accountSession.mode === 'host' ? 'Deine Session' : 'Dein Charakter';
    el.classList.remove('hidden');
    let text;
    if (accountSaveError) {
        text = `⚠ ${accountSession.name}: nicht gespeichert`;
        el.title = `Speichern in der Datenbank fehlgeschlagen: ${accountSaveError}`;
    } else if (accountLastSavedAt) {
        const t = new Date(accountLastSavedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
        text = `${accountSession.name} · gespeichert ${t}`;
        el.title = `${what} wird automatisch in der Datenbank gespeichert.`;
    } else {
        text = `${accountSession.name} · angemeldet`;
        el.title = `${what} wird automatisch in der Datenbank gespeichert.`;
    }
    el.classList.toggle('account-status-error', Boolean(accountSaveError));
    el.textContent = text;
}

// --- Hauptmenü: DM-Konto ---------------------------------------------------

let dmLobbyAccount = null;   // { token, name } nach dem Login im Hauptmenü
let dmLobbySessions = [];

function formatAccountDate(ms) {
    if (!ms) return '';
    return new Date(ms).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function renderDmLobbyAccount() {
    const form = document.getElementById('lobby-dm-login');
    const panel = document.getElementById('lobby-dm-account');
    if (!form || !panel) return;
    if (!dmLobbyAccount) {
        form.classList.remove('hidden');
        panel.classList.add('hidden');
        panel.innerHTML = '';
        return;
    }
    form.classList.add('hidden');
    panel.classList.remove('hidden');
    const rows = dmLobbySessions.length
        ? dmLobbySessions.map(s => `
            <li class="dm-session-row">
                <div class="dm-session-meta">
                    <strong>Raum ${esc(s.roomCode || '?')}</strong>
                    <span class="muted">${esc(s.players)} Spieler · ${esc(formatAccountDate(s.updatedAt))}</span>
                </div>
                <button type="button" class="btn-primary" data-dm-resume="${esc(s.sessionId)}">Fortsetzen</button>
                <button type="button" class="btn-secondary btn-icon" data-dm-delete="${esc(s.sessionId)}" title="Session löschen" aria-label="Session Raum ${esc(s.roomCode || '?')} löschen">${icon('trash')}</button>
            </li>`).join('')
        : '<li class="muted dm-session-empty">Noch keine gespeicherten Sessions.</li>';
    panel.innerHTML = `
        <div class="dm-account-head">
            <span>Angemeldet als <strong>${esc(dmLobbyAccount.name)}</strong></span>
            <button type="button" class="btn-secondary" id="btn-dm-logout">Abmelden</button>
        </div>
        <small class="muted">Neue Sessions und hineingezogene Session-Dateien werden ab jetzt automatisch in deinem Konto gespeichert.</small>
        <ul class="dm-session-list">${rows}</ul>
    `;
    document.getElementById('btn-dm-logout').addEventListener('click', dmLobbyLogout);
    panel.querySelectorAll('[data-dm-resume]').forEach(btn => btn.addEventListener('click', () => dmLobbyResume(btn.dataset.dmResume, btn)));
    panel.querySelectorAll('[data-dm-delete]').forEach(btn => btn.addEventListener('click', () => {
        const s = dmLobbySessions.find(x => x.sessionId === btn.dataset.dmDelete);
        openConfirmModal(`Session „Raum ${s ? s.roomCode : '?'}“ endgültig aus der Datenbank löschen?`, () => dmLobbyDelete(btn.dataset.dmDelete));
    }));
}

async function dmLobbyLogin() {
    const nameEl = document.getElementById('input-dm-name');
    const pwEl = document.getElementById('input-dm-password');
    const btn = document.getElementById('btn-dm-login');
    const name = nameEl.value.trim();
    const password = pwEl.value;
    if (!name || !password) return alert('Bitte Name und Passwort eingeben!');
    btn.disabled = true;
    try {
        const account = await loginOrRegisterAccount(name, password, 'Deine Sessions werden dann automatisch darin gespeichert.');
        if (!account) return;
        pwEl.value = '';
        dmLobbyAccount = { token: account.token, name: account.name };
        await dmLobbyRefresh();
    } catch (err) {
        alert(`Anmeldung fehlgeschlagen: ${err.message}`);
    } finally {
        btn.disabled = false;
    }
}

async function dmLobbyRefresh() {
    if (!dmLobbyAccount) return renderDmLobbyAccount();
    try {
        const data = await accountApi('GET', '/api/sessions', undefined, dmLobbyAccount.token);
        dmLobbySessions = Array.isArray(data.sessions) ? data.sessions : [];
    } catch (err) {
        if (err.status === 401) dmLobbyAccount = null;
        alert(`Sessions konnten nicht geladen werden: ${err.message}`);
    }
    renderDmLobbyAccount();
}

async function dmLobbyResume(sessionId, btn) {
    if (!dmLobbyAccount) return;
    if (btn) btn.disabled = true;
    try {
        const data = await accountApi('GET', `/api/sessions/${encodeURIComponent(sessionId)}`, undefined, dmLobbyAccount.token);
        hostGame({ roomCode: data.roomCode || data.state.roomCode, state: data.state },
            null, Object.assign({}, dmLobbyAccount, { sessionId, updatedAt: data.updatedAt }));
    } catch (err) {
        alert(`Session konnte nicht geladen werden: ${err.message}`);
        if (btn) btn.disabled = false;
    }
}

async function dmLobbyDelete(sessionId) {
    if (!dmLobbyAccount) return;
    try {
        await accountApi('DELETE', `/api/sessions/${encodeURIComponent(sessionId)}`, undefined, dmLobbyAccount.token);
    } catch (err) {
        alert(`Löschen fehlgeschlagen: ${err.message}`);
    }
    await dmLobbyRefresh();
}

function dmLobbyLogout() {
    if (dmLobbyAccount) accountApi('POST', '/api/logout', undefined, dmLobbyAccount.token).catch(() => {});
    dmLobbyAccount = null;
    dmLobbySessions = [];
    renderDmLobbyAccount();
}

// Hauptmenü: Konto-Felder deaktivieren, falls der Server keine Konten anbietet
// (z. B. zu alte Node-Version oder Seite per file:// geöffnet).
async function checkAccountAvailability() {
    try {
        const status = await accountApi('GET', '/api/status');
        if (status.accounts) return;
        const reason = status.reason ? `Konten nicht verfügbar: ${status.reason}` : 'Konten nicht verfügbar.';
        for (const id of ['input-player-password', 'input-dm-name', 'input-dm-password', 'btn-dm-login']) {
            const el = document.getElementById(id);
            if (el) el.disabled = true;
        }
        const pw = document.getElementById('input-player-password');
        if (pw) pw.placeholder = 'Konten auf diesem Server nicht verfügbar';
        for (const id of ['lobby-account-hint', 'lobby-dm-account-hint']) {
            const el = document.getElementById(id);
            if (el) el.textContent = reason;
        }
    } catch (e) {
        // Server (noch) nicht erreichbar – Fehler zeigt sich ggf. beim Beitreten.
    }
}
