// Relay-Adresse bestimmen:
//   1. Override per URL-Parameter (?relay=wss://host) – nur für Sonderfälle
//   2. Seite wird per http(s) ausgeliefert – also vom Relay selbst (localhost,
//      WLAN-IP oder Cloudflare-Tunnel) -> gleicher Host/Port, passt immer
//   3. Sonst (file://): ws://localhost:8080
function resolveRelayUrl() {
    let override = null;
    try { override = new URLSearchParams(window.location.search).get('relay'); } catch (e) { /* file:// */ }
    if (override && /^wss?:\/\//i.test(override)) return override;

    const loc = window.location;
    if (loc.protocol === 'http:' || loc.protocol === 'https:') {
        return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}`;
    }
    return 'ws://localhost:8080';
}
const RELAY_URL = resolveRelayUrl();
const RELAY_RECONNECT_MIN_MS = 500;
const RELAY_RECONNECT_MAX_MS = 8000;
const RELAY_RECONNECT_ALERT_AFTER = 4;
const RELAY_CONNECT_TIMEOUT_MS = 10000;    // so lange darf ein Verbindungsaufbau hängen
const RELAY_HEARTBEAT_MS = 15000;          // PING-Intervall
const RELAY_PONG_TIMEOUT_MS = 10000;       // ohne Antwort danach gilt die Leitung als tot
const RELAY_ROOM_WAIT_MS = 3 * 60 * 1000;  // Spieler warten nach Relay-Neustart so lange auf den Raum
const SESSION_STORE_KEY = 'afterlife.activeSession';
const SESSION_STORE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
// Close-Codes des Relays (siehe relay/server.js)
const RELAY_CLOSE = {
    HOST_GONE: 4000,
    HOST_REPLACED: 4001,
    PLAYER_REPLACED: 4002,
    ROOM_EXPIRED: 4003,
    SERVICE_RESTART: 1012
};

let relaySocket = null;
let heartbeatInterval = null;
let pongCheckTimer = null;
let connectTimeoutTimer = null;
let lastRelayMessageAt = 0;
let lastPingSentAt = 0;
let reconnectTimer = null;
let reconnectAttempts = 0;
let manualDisconnect = true;
let relaySession = null;      // { mode, roomCode, ... } – überlebt einzelne Reconnects
let hostSocketOpen = false;   // Host: Verbindung zum Relay steht (HOST_READY erhalten, nicht geschlossen)
let hostSendFn = null;        // Host: sendet ein App-Payload an alle Spieler
let broadcastScheduled = false;
let hostConnection = null;
let currentPlayerId = "";
let chatCollapsed = false;
let unreadChatCount = 0;
let chatSeenInit = false;
let lastSeenMsgId = null;
let lastSyncRaw = null;
let onlinePlayerIds = [];     // Host: vom Relay gemeldete, gerade verbundene Spieler
let inviteInfo = null;        // Host: { publicUrl, lanUrls } aus /info
let inviteInfoTimer = null;
let persistTimer = null;
let persistInterval = null;

const HOST_ONLY_STATE_KEYS = [
    'dmNotes', 'npcTemplates', 'mapTemplates',
    'customItems', 'customAttacks', 'customAffinities', 'customSpells'
];

// --- HEARTBEAT -------------------------------------------------------------
// Tot ist die Leitung nur, wenn seit dem letzten PING gar nichts mehr kam.
// Das bleibt korrekt, auch wenn Chrome die Timer eines Hintergrund-Tabs drosselt.
function sendPing(ws) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    lastPingSentAt = Date.now();
    try { ws.send(JSON.stringify({ _relay: 'PING' })); } catch (e) { /* egal */ }
    clearTimeout(pongCheckTimer);
    pongCheckTimer = setTimeout(() => checkPong(ws), RELAY_PONG_TIMEOUT_MS);
}

function checkPong(ws) {
    if (!isCurrentSocket(ws) || ws.readyState !== WebSocket.OPEN || !lastPingSentAt) return;
    if (lastRelayMessageAt >= lastPingSentAt) return;
    if (Date.now() - lastPingSentAt < RELAY_PONG_TIMEOUT_MS) return;
    relayConnectionLost(ws, null);
}

function startHeartbeat(ws) {
    stopHeartbeat();
    lastRelayMessageAt = Date.now();
    lastPingSentAt = 0;
    heartbeatInterval = setInterval(() => {
        checkPong(ws);
        if (isCurrentSocket(ws)) sendPing(ws);
    }, RELAY_HEARTBEAT_MS);
}

function stopHeartbeat() {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
    clearTimeout(pongCheckTimer);
    pongCheckTimer = null;
    clearTimeout(connectTimeoutTimer);
    connectTimeoutTimer = null;
}

function clearReconnectTimer() {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
}

// Lokalen Verbindungszustand auf "getrennt" setzen – die Session selbst bleibt bestehen.
function markRelayLinkDown() {
    relaySocket = null;
    stopHeartbeat();
    hostSocketOpen = false;
    hostSendFn = null;
    if (hostConnection) hostConnection.open = false;
}

// Beendet die aktuelle Verbindung bewusst (kein Auto-Reconnect).
function resetRelayConnection() {
    manualDisconnect = true;
    clearReconnectTimer();
    reconnectAttempts = 0;

    const sock = relaySocket;
    markRelayLinkDown();
    stopInvitePolling();
    stopSessionPersistence();
    hostConnection = null;
    if (sock) {
        try { sock.close(); } catch (e) { /* egal */ }
    }
    relaySession = null;
    onlinePlayerIds = [];
}

function isCurrentSocket(ws) {
    return relaySocket === ws && !!relaySession && !manualDisconnect;
}

function scheduleRelayReconnect(label) {
    if (manualDisconnect || !relaySession) return;
    const attempt = reconnectAttempts++;
    const base = Math.min(RELAY_RECONNECT_MAX_MS, RELAY_RECONNECT_MIN_MS * Math.pow(2, attempt));
    // Etwas Zufall, damit nach einem Relay-Neustart nicht alle gleichzeitig anklopfen.
    const delay = Math.round(base * (0.8 + Math.random() * 0.4));
    setSessionInfo(`⚠ ${label} – neuer Versuch in ${(delay / 1000).toFixed(1)} s`);
    clearReconnectTimer();
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectRelay();
    }, delay);
}

function isLocalPage() {
    const h = window.location.hostname;
    return window.location.protocol === 'file:' || h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';
}

function alertRelayUnreachableOnce() {
    const s = relaySession;
    if (!s || s.alerted || s.everReady || s.resumed) return;
    if (reconnectAttempts < RELAY_RECONNECT_ALERT_AFTER) return;
    s.alerted = true;
    alert(isLocalPage()
        ? `Der Relay-Server ist unter ${RELAY_URL} nicht erreichbar.\n\n` +
          `Starte Afterlife per Doppelklick auf „start.command" (Mac) bzw. „start.bat" (Windows) im Projektordner.\n\n` +
          `Die App versucht die Verbindung weiterhin automatisch.`
        : `Der Server des DM ist gerade nicht erreichbar.\n\n` +
          `Prüfe, ob Afterlife beim DM noch läuft und ob der Link noch aktuell ist.\n\n` +
          `Die App versucht die Verbindung weiterhin automatisch.`);
}

// Verbindung verloren (Close-Event, Heartbeat-Timeout oder hängender Aufbau).
function relayConnectionLost(ws, closeEvent) {
    if (!isCurrentSocket(ws)) return;
    const session = relaySession;
    markRelayLinkDown();
    try { ws.close(); } catch (e) { /* egal */ }

    const code = closeEvent ? closeEvent.code : 0;
    if (code === RELAY_CLOSE.HOST_REPLACED || code === RELAY_CLOSE.PLAYER_REPLACED) {
        // Ein anderer Tab/ein anderes Fenster hat diese Session übernommen.
        // Nicht zurückverbinden – sonst werfen sich beide Tabs endlos gegenseitig raus.
        return endRelaySession(session, 'Diese Session wurde in einem anderen Tab oder Fenster übernommen. Hier wurde die Verbindung getrennt.');
    }
    if (session.mode === 'player' && code === RELAY_CLOSE.HOST_GONE) {
        return endRelaySession(session, 'Der DM ist nicht zurückgekehrt. Die Session wurde beendet.');
    }
    if (session.mode === 'player' && code === RELAY_CLOSE.ROOM_EXPIRED) {
        return endRelaySession(session, 'Der Raum war zu lange inaktiv und wurde geschlossen.');
    }
    if (code === RELAY_CLOSE.SERVICE_RESTART) reconnectAttempts = 0;

    if (session.everReady || session.resumed) {
        if (!session.lostAt) session.lostAt = Date.now();
        scheduleRelayReconnect(`Verbindung verloren (Raum ${session.roomCode})`);
    } else {
        scheduleRelayReconnect(`Relay ${RELAY_URL} nicht erreichbar`);
        alertRelayUnreachableOnce();
    }
}

// Session endgültig beenden (Fehler, übernommen, DM weg).
function endRelaySession(session, message) {
    const mode = session ? session.mode : null;
    manualDisconnect = true;
    clearReconnectTimer();
    const sock = relaySocket;
    markRelayLinkDown();
    if (sock) {
        try { sock.close(); } catch (e) { /* egal */ }
    }
    stopSessionPersistence();
    clearStoredSession();

    if (mode === 'player') {
        returnPlayerToMainMenu();
    } else {
        // Der DM behält seinen Stand in diesem Tab und kann ihn noch speichern.
        stopInvitePolling();
        setSessionInfo('⚠ Getrennt – Session speichern & neu starten');
    }
    alert(message);
}

function connectRelay() {
    const session = relaySession;
    if (!session || manualDisconnect) return;
    clearReconnectTimer();

    let ws;
    try {
        ws = new WebSocket(RELAY_URL);
    } catch (e) {
        scheduleRelayReconnect('Relay-Adresse ungültig');
        alertRelayUnreachableOnce();
        return;
    }
    relaySocket = ws;

    // Hängt der Aufbau (z. B. Tunnel antwortet nicht), selbst abbrechen und neu versuchen.
    clearTimeout(connectTimeoutTimer);
    connectTimeoutTimer = setTimeout(() => {
        if (isCurrentSocket(ws) && ws.readyState === WebSocket.CONNECTING) relayConnectionLost(ws, null);
    }, RELAY_CONNECT_TIMEOUT_MS);

    ws.onopen = () => {
        if (!isCurrentSocket(ws)) return;
        startHeartbeat(ws);
        const hello = session.mode === 'host'
            ? { _relay: 'HOST', roomCode: session.roomCode, hostToken: session.hostToken || undefined }
            : {
                _relay: 'JOIN', roomCode: session.roomCode, playerId: session.playerId, playerToken: session.playerToken,
                // Angemeldete Spieler weisen sich aus – der Relay reserviert ihre ID für das Konto.
                accountToken: accountSession && accountSession.mode === 'player' ? accountSession.token : undefined
            };
        try { ws.send(JSON.stringify(hello)); } catch (e) { /* onclose folgt */ }
    };

    ws.onerror = () => { /* onclose folgt immer */ };
    ws.onclose = (event) => relayConnectionLost(ws, event);

    ws.onmessage = (event) => {
        if (!isCurrentSocket(ws)) return;
        lastRelayMessageAt = Date.now();

        let msg;
        try {
            msg = JSON.parse(event.data);
        } catch (e) {
            return;
        }
        if (!msg || typeof msg !== 'object' || msg._relay === 'PONG') return;

        if (session.mode === 'host') handleHostRelayMessage(ws, session, msg);
        else handlePlayerRelayMessage(ws, session, msg, event.data);
    };
}

// Nach Standby, Netzwerkwechsel oder Tab-Rückkehr sofort neu verbinden –
// bzw. bei offener Leitung kurz prüfen, ob sie wirklich noch lebt.
function reconnectNowIfNeeded() {
    if (manualDisconnect || !relaySession) return;
    if (!relaySocket) {
        clearReconnectTimer();
        reconnectAttempts = 0;
        connectRelay();
    } else if (relaySocket.readyState === WebSocket.OPEN) {
        sendPing(relaySocket);
    }
}

window.addEventListener('online', reconnectNowIfNeeded);
window.addEventListener('pageshow', reconnectNowIfNeeded);
document.addEventListener('visibilitychange', () => {
    if (document.hidden) persistSessionNow();
    else reconnectNowIfNeeded();
});
window.addEventListener('pagehide', () => persistSessionNow());

// --- SESSION ÜBER RELOADS RETTEN ------------------------------------------
// Pro Tab (sessionStorage): Ein Neuladen (F5, Absturz des Tabs) setzt die Session
// automatisch fort. Ein neuer Tab startet bewusst frisch im Hauptmenü.
function clearStoredSession() {
    try { sessionStorage.removeItem(SESSION_STORE_KEY); } catch (e) { /* egal */ }
}

function persistSessionNow() {
    const s = relaySession;
    if (!s || manualDisconnect || !(s.everReady || s.resumed)) return;
    try {
        let record;
        if (s.mode === 'host') {
            record = {
                v: 1, mode: 'host', savedAt: Date.now(),
                roomCode: s.roomCode, hostToken: s.hostToken,
                state: gameState,
                account: accountSessionRecord()
            };
        } else {
            const own = gameState.characters && hasOwn(gameState.characters, s.playerId)
                ? gameState.characters[s.playerId] : null;
            record = {
                v: 1, mode: 'player', savedAt: Date.now(),
                roomCode: s.roomCode, playerId: s.playerId, baseName: s.baseName,
                playerToken: s.playerToken,
                character: own || s.importedCharacter || null,
                account: accountSessionRecord()
            };
        }
        sessionStorage.setItem(SESSION_STORE_KEY, JSON.stringify(record));
    } catch (e) {
        // Speicher voll (große Bilder?) – lieber gar nichts als einen halben Stand.
        clearStoredSession();
        if (!s.persistWarned) {
            s.persistWarned = true;
            console.warn('Session konnte nicht für Reloads zwischengespeichert werden:', e);
        }
    }
}

function scheduleSessionPersist() {
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
        persistTimer = null;
        persistSessionNow();
    }, 2000);
}

function startSessionPersistence() {
    if (!persistInterval) persistInterval = setInterval(persistSessionNow, 20000);
}

function stopSessionPersistence() {
    clearInterval(persistInterval);
    persistInterval = null;
    clearTimeout(persistTimer);
    persistTimer = null;
}

// Beim Laden der Seite aufgerufen (app.js). Gibt true zurück, wenn fortgesetzt wird.
function resumeStoredSession() {
    let saved = null;
    try {
        saved = JSON.parse(sessionStorage.getItem(SESSION_STORE_KEY) || 'null');
    } catch (e) {
        clearStoredSession();
        return false;
    }
    if (!isPlainObject(saved)) return false;
    if (Date.now() - (Number(saved.savedAt) || 0) > SESSION_STORE_MAX_AGE_MS) {
        clearStoredSession();
        return false;
    }

    if (saved.mode === 'host' && isPlainObject(saved.state) && saved.roomCode) {
        hostGame(
            { roomCode: String(saved.roomCode), state: saved.state },
            { resumed: true, hostToken: typeof saved.hostToken === 'string' ? saved.hostToken : null },
            isPlainObject(saved.account) && saved.account.mode === 'host' ? saved.account : null
        );
        return true;
    }
    if (saved.mode === 'player' && typeof saved.roomCode === 'string' && typeof saved.baseName === 'string' && typeof saved.playerId === 'string') {
        joinGame(saved.roomCode, saved.baseName, isPlainObject(saved.character) ? saved.character : null, {
            resumed: true,
            playerId: saved.playerId,
            playerToken: saved.playerToken
        }, isPlainObject(saved.account) ? saved.account : null);
        return true;
    }
    clearStoredSession();
    return false;
}

// Tokens pro Raum im localStorage merken: Derselbe Browser bleibt derselbe DM/Spieler,
// auch wenn der Tab geschlossen und die Session später neu geöffnet wird.
const TOKEN_STORE_KEY = 'afterlife.tokens';
const TOKEN_STORE_MAX = 30;

function readTokenStore() {
    try {
        const data = JSON.parse(localStorage.getItem(TOKEN_STORE_KEY) || '{}');
        return isPlainObject(data) ? data : {};
    } catch (e) {
        return {};
    }
}

function loadRememberedToken(key) {
    const entry = readTokenStore()[key];
    return entry && typeof entry.token === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(entry.token) ? entry.token : null;
}

function rememberToken(key, token) {
    if (typeof token !== 'string') return;
    try {
        const store = readTokenStore();
        store[key] = { token, at: Date.now() };
        const keys = Object.keys(store).sort((a, b) => (store[b].at || 0) - (store[a].at || 0));
        for (const old of keys.slice(TOKEN_STORE_MAX)) delete store[old];
        localStorage.setItem(TOKEN_STORE_KEY, JSON.stringify(store));
    } catch (e) { /* privater Modus o. ä. – dann eben nur für diesen Tab */ }
}

function hostTokenKey(roomCode) { return `host:${roomCode}`; }
function playerTokenKey(roomCode, playerId) { return `player:${roomCode}:${playerId}`; }

function randomToken() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

// 6 Ziffern (100000–999999): leicht vorzulesen, aber nicht in Minuten durchzuprobieren.
function randomRoomCode() {
    const n = new Uint32Array(1);
    crypto.getRandomValues(n);
    return String(100000 + (n[0] % 900000));
}

function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
}

function submitRollEntry(entry) {
    if (!currentPlayerId) {
        gameState.diceLog.unshift(entry);
        if (gameState.diceLog.length > 15) gameState.diceLog.pop();
        renderDiceLogStrip();
        broadcastState();
    } else if (hostConnection && hostConnection.open) {
        hostConnection.send({
            type: 'ROLL_DICE',
            entry: entry
        });
    }
}

// --- CHAT SYSTEM ---
function toggleChatWidget() {
    chatCollapsed = !chatCollapsed;
    const body = document.getElementById('chat-body');
    const icon = document.getElementById('chat-toggle-icon');
    const badge = document.getElementById('chat-unread-badge');

    if (chatCollapsed) {
        body.classList.add('hidden');
        icon.textContent = '▲';
    } else {
        body.classList.remove('hidden');
        icon.textContent = '▼';
        unreadChatCount = 0;
        badge.classList.add('hidden');
        renderChatWidget();
        const list = document.getElementById('chat-messages-list');
        if (list) list.scrollTop = list.scrollHeight;
    }
}

function isMessageVisible(m, myId) {
    return m.target === 'ALL' || myId === 'DM' || m.senderId === myId || m.target === myId;
}

function getVisibleMessages() {
    const myId = currentPlayerId || 'DM';
    return (gameState.messages || []).filter(m => m && typeof m === 'object' && isMessageVisible(m, myId));
}

// Zählt neu eingetroffene, für diesen Client sichtbare und nicht selbst gesendete Nachrichten
function updateUnreadBadge() {
    const myId = currentPlayerId || 'DM';
    const messages = (gameState.messages || []).filter(m => m && typeof m === 'object');
    const lastId = messages.length ? messages[messages.length - 1].id : null;

    if (!chatSeenInit) {
        chatSeenInit = true;
        lastSeenMsgId = lastId;
        return;
    }

    let fresh = messages;
    if (lastSeenMsgId !== null) {
        const idx = messages.findIndex(m => m.id === lastSeenMsgId);
        if (idx >= 0) fresh = messages.slice(idx + 1);
    }
    lastSeenMsgId = lastId !== null ? lastId : lastSeenMsgId;

    const count = fresh.filter(m => isMessageVisible(m, myId) && m.senderId !== myId).length;
    if (chatCollapsed && count > 0) {
        unreadChatCount += count;
        const badge = document.getElementById('chat-unread-badge');
        if (badge) {
            badge.textContent = unreadChatCount;
            badge.classList.remove('hidden');
        }
    }
}

function updateChatTargetOptions() {
    const select = document.getElementById('chat-target-select');
    if (!select) return;

    let sig;
    if (!currentPlayerId) {
        sig = 'D:' + Object.values(gameState.characters).map(c => `${c.id}\u0000${c.name}`).join('\u0001');
    } else {
        sig = 'P';
    }
    if (select.dataset.sig === sig) return;
    select.dataset.sig = sig;

    const prev = select.value || 'ALL';

    if (!currentPlayerId) {
        const playerOpts = Object.values(gameState.characters).map(c =>
            `<option value="${esc(c.id)}">Privat an: ${esc(c.name)}</option>`
        ).join('');
        select.innerHTML = `<option value="ALL">An: Alle</option>${playerOpts}`;
    } else {
        select.innerHTML = `
            <option value="ALL">An: Alle</option>
            <option value="DM">Privat an: DM</option>
        `;
    }

    if ([...select.options].some(o => o.value === prev)) {
        select.value = prev;
    }
}

function sendChatMessage() {
    const input = document.getElementById('chat-message-input');
    const select = document.getElementById('chat-target-select');
    if (!input || !select) return;

    const text = input.value.trim();
    if (!text) return;

    const target = select.value;
    let targetLabel = 'Alle';
    if (target === 'DM') targetLabel = 'DM';
    else if (target !== 'ALL' && gameState.characters[target]) {
        targetLabel = gameState.characters[target].name;
    }

    const senderId = currentPlayerId || 'DM';
    const senderName = currentPlayerId && gameState.characters[currentPlayerId]
        ? gameState.characters[currentPlayerId].name
        : 'Dungeon Master';

    const msg = {
        id: Date.now() + Math.random(),
        senderId: senderId,
        senderName: senderName,
        target: target,
        targetLabel: targetLabel,
        text: text,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    if (!currentPlayerId) {
        input.value = '';
        gameState.messages.push(msg);
        if (gameState.messages.length > 60) gameState.messages.shift();
        updateUnreadBadge();
        renderChatWidget();
        broadcastState();
    } else if (hostConnection && hostConnection.open) {
        const sent = hostConnection.send({
            type: 'CHAT_MESSAGE',
            message: msg
        });
        if (sent) input.value = '';
    }
}

function renderChatWidget() {
    updateChatTargetOptions();
    const list = document.getElementById('chat-messages-list');
    if (!list) return;

    const myId = currentPlayerId || 'DM';
    const visible = getVisibleMessages();
    const last = visible.length ? visible[visible.length - 1] : null;
    const sig = `${myId}|${visible.length}|${last ? last.id : ''}`;
    if (list.dataset.sig === sig) return;

    const firstRender = list.dataset.sig === undefined;
    const wasNearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    const prevSig = list.dataset.sig;
    list.dataset.sig = sig;

    if (visible.length === 0) {
        list.innerHTML = `<p class="muted">Noch keine Nachrichten.</p>`;
        return;
    }

    list.innerHTML = visible.map(m => {
        const isWhisper = m.target !== 'ALL';
        return `
            <div class="chat-msg ${isWhisper ? 'chat-whisper' : ''}">
                <div class="chat-msg-meta">
                    <span class="chat-msg-sender">${esc(m.senderName)} → ${esc(m.targetLabel)}</span>
                    <span>${esc(m.time)}</span>
                </div>
                <div>${esc(m.text)}</div>
            </div>
        `;
    }).join('');

    const newestIsMine = last && last.senderId === myId && prevSig !== undefined;
    if (firstRender || wasNearBottom || newestIsMine) {
        list.scrollTop = list.scrollHeight;
    }
}

function setSessionInfo(text) {
    const el = document.getElementById('session-info');
    if (el) el.textContent = text;
}

function updateHostSessionInfo(suffix = '') {
    const s = relaySession;
    if (!s || s.mode !== 'host' || !hostSocketOpen) return;
    const n = onlinePlayerIds.length;
    const online = n === 1 ? '1 Spieler online' : `${n} Spieler online`;
    setSessionInfo(`DM | Raum-Code: ${s.roomCode} | ${online}${suffix ? ` ${suffix}` : ''}`);
}

// --- EINLADUNGSLINK (Cloudflare-Tunnel / WLAN) ------------------------------
// Der Launcher meldet dem Relay die öffentliche Tunnel-Adresse; der DM fragt sie über /info ab.
function currentInviteUrl() {
    const s = relaySession;
    if (!s || s.mode !== 'host' || !inviteInfo) return null;
    const base = inviteInfo.publicUrl || inviteInfo.lanUrls[0];
    if (!base) return null;
    return `${base.replace(/\/+$/, '')}/?room=${encodeURIComponent(s.roomCode)}`;
}

function updateInviteButton() {
    const btn = document.getElementById('btn-copy-invite');
    if (!btn) return;
    const url = currentInviteUrl();
    btn.classList.toggle('hidden', !url);
    btn.title = url ? `Einladungslink für Spieler kopieren:\n${url}` : '';
}

async function refreshInviteInfo() {
    if (window.location.protocol !== 'http:' && window.location.protocol !== 'https:') return;
    try {
        const res = await fetch('/info', { cache: 'no-store' });
        if (!res.ok) return;
        const info = await res.json();
        if (!isPlainObject(info)) return;
        inviteInfo = {
            publicUrl: typeof info.publicUrl === 'string' && /^https?:\/\//.test(info.publicUrl) ? info.publicUrl : null,
            lanUrls: Array.isArray(info.lanUrls) ? info.lanUrls.filter(u => typeof u === 'string' && /^https?:\/\//.test(u)) : []
        };
    } catch (e) {
        return; // Relay ohne /info oder gerade weg – nächster Versuch beim nächsten Intervall
    }
    updateInviteButton();
}

function startInvitePolling() {
    if (inviteInfoTimer) return;
    refreshInviteInfo();
    inviteInfoTimer = setInterval(refreshInviteInfo, 15000);
}

function stopInvitePolling() {
    clearInterval(inviteInfoTimer);
    inviteInfoTimer = null;
    inviteInfo = null;
    updateInviteButton();
}

function copyTextFallback(text) {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    area.remove();
    return ok;
}

function copyInviteLink() {
    const url = currentInviteUrl();
    const btn = document.getElementById('btn-copy-invite');
    if (!url || !btn) return;

    const feedback = (ok) => {
        if (!btn.dataset.label) btn.dataset.label = btn.innerHTML;
        btn.innerHTML = ok ? `${icon('check')} Link kopiert!` : `${icon('x')} Kopieren fehlgeschlagen`;
        clearTimeout(btn._resetTimer);
        btn._resetTimer = setTimeout(() => { btn.innerHTML = btn.dataset.label; }, 1800);
        if (!ok) console.info('Einladungslink:', url);
    };

    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(url).then(() => feedback(true), () => feedback(copyTextFallback(url)));
    } else {
        feedback(copyTextFallback(url));
    }
}

// --- 1. ALS DM HOSTEN ---
// account: { token, name, sessionId? } – angemeldeter DM; die Session wird automatisch im Konto gespeichert.
function hostGame(savedSessionPayload = null, resumeOptions = null, account = null) {
    let roomCode = randomRoomCode();

    if (savedSessionPayload && savedSessionPayload.state) {
        Object.assign(gameState, savedSessionPayload.state);
        normalizeLoadedState();
        roomCode = savedSessionPayload.roomCode || gameState.roomCode || roomCode;
    }
    gameState.roomCode = roomCode;

    resetRelayConnection();
    manualDisconnect = false;
    if (account) startAccountSession(account, 'host', account.sessionId || null);
    else stopAccountSession();
    relaySession = {
        mode: 'host',
        roomCode: String(roomCode),
        // Nur fortgesetzte Sessions (Reload, Session-Datei) beanspruchen einen alten Raum.
        hostToken: (resumeOptions && resumeOptions.hostToken)
            || (savedSessionPayload ? loadRememberedToken(hostTokenKey(roomCode)) : null),
        fresh: !savedSessionPayload,          // neue Session -> Raum-Code darf bei Kollision wechseln
        resumed: Boolean(resumeOptions && resumeOptions.resumed),
        everReady: false,
        alerted: false,
        lostAt: null,
        takenRetries: 0
    };

    chatSeenInit = false;
    updateUnreadBadge();
    setSessionInfo(relaySession.resumed ? 'Stelle Session wieder her…' : 'Verbinde mit Relay…');
    connectRelay();
}

function handleHostRelayMessage(ws, session, msg) {
    if (msg._relay === 'ERROR') {
        if (msg.code === 'ROOM_TAKEN' && !session.everReady) {
            markRelayLinkDown();
            try { ws.close(); } catch (e) { /* egal */ }

            if (session.fresh && session.takenRetries < 5) {
                // Neue Session: einfach einen anderen, freien Raum-Code nehmen.
                session.takenRetries += 1;
                session.roomCode = randomRoomCode();
                gameState.roomCode = session.roomCode;
                connectRelay();
                return;
            }
            // Ein alter, noch nicht ganz geschlossener Socket kann den Raum kurz blockieren.
            if (reconnectAttempts < 4) {
                scheduleRelayReconnect(msg.message || 'Raum belegt');
                return;
            }
        }
        endRelaySession(session, msg.message || 'Der Relay-Server hat einen Fehler gemeldet.');
        return;
    }

    if (msg._relay === 'HOST_READY') {
        if (typeof msg.hostToken === 'string') {
            session.hostToken = msg.hostToken;
            rememberToken(hostTokenKey(session.roomCode), msg.hostToken);
        }
        const wasReady = session.everReady;
        const reconnected = wasReady || session.resumed;
        session.everReady = true;
        session.alerted = false;
        session.lostAt = null;
        reconnectAttempts = 0;
        clearReconnectTimer();
        hostSocketOpen = true;
        hostSendFn = (payload) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ _relay: 'PAYLOAD', data: payload }));
            }
        };
        onlinePlayerIds = Array.isArray(msg.playerIds) ? msg.playerIds.filter(id => typeof id === 'string') : [];

        document.getElementById('lobby-view').classList.add('hidden');
        document.getElementById('dm-view').classList.remove('hidden');
        document.getElementById('dm-header-tabs').classList.remove('hidden');
        document.getElementById('btn-dm-save-session').classList.remove('hidden');
        document.getElementById('universal-dice-bar').classList.remove('hidden');
        document.getElementById('dm-secret-roll-wrap').classList.remove('hidden');
        document.getElementById('chat-widget').classList.remove('hidden');
        renderDiceLogStrip();
        renderChatWidget();

        updateHostSessionInfo(reconnected ? '(wieder verbunden)' : '');
        renderDmView(wasReady ? { preserveInputs: true } : undefined);
        // Alle (noch oder wieder) verbundenen Spieler mit dem aktuellen Stand versorgen.
        broadcastState();

        startInvitePolling();
        startSessionPersistence();
        persistSessionNow();
        return;
    }

    if (msg._relay === 'PLAYERS') {
        onlinePlayerIds = Array.isArray(msg.playerIds) ? msg.playerIds.filter(id => typeof id === 'string') : [];
        updateHostSessionInfo();
        return;
    }

    if (msg._relay === 'PAYLOAD' && msg.data) {
        handleHostPayload(msg.data);
    }
}

function safeMessageId(v) {
    if ((typeof v === 'number' && isFinite(v)) || (typeof v === 'string' && v.length > 0 && v.length <= 40)) {
        return v;
    }
    return Date.now() + Math.random();
}

function handleHostPayload(data) {
    try {
        if (!isPlainObject(data)) return;

        switch (data.type) {
            case 'JOIN': {
                if (typeof data.id !== 'string' || typeof data.name !== 'string') return;
                // Der Relay setzt _playerId aus der JOIN-Nachricht; prüfen, dass beides übereinstimmt
                if (data._playerId !== data.id) return;
                const id = data.id;
                const name = data.name.trim().slice(0, 60);
                if (!id || id.length > 100 || !name) return;
                if (id === '__proto__' || id === 'constructor' || id === 'prototype') return;

                const alreadyKnown = hasOwn(gameState.characters, id);
                const isReconnect = Boolean(data.reconnect);

                if (isPlainObject(data.importedCharacter)) {
                    // Beim Reconnect bleibt der aktuelle Stand des Hosts erhalten –
                    // nur wenn der Charakter (z. B. nach Host-Neustart) fehlt, wird importiert.
                    if (!isReconnect || !alreadyKnown) {
                        const imported = normalizeCharacter(data.importedCharacter);
                        imported.id = id;
                        const existing = alreadyKnown ? gameState.characters[id] : null;
                        if (existing) {
                            imported.bagInfinite = existing.bagInfinite;
                            imported.bagCustomMax = existing.bagCustomMax;
                            imported.moralityVisible = existing.moralityVisible;
                            if (!existing.moralityVisible) imported.morality = existing.morality;
                        }
                        gameState.characters[id] = imported;
                        mergeCharacterIntoSessionLibrary(imported);
                    }
                } else if (!alreadyKnown) {
                    gameState.characters[id] = createNewCharacter(id, name);
                }
                broadcastState();
                renderChatWidget();
                renderDmView({ preserveInputs: true });
                break;
            }

            case 'UPDATE_CHARACTER': {
                const incoming = data.character;
                if (!isPlainObject(incoming) || typeof incoming.id !== 'string') return;
                // Das Relay stempelt die verbindliche Absender-ID (_playerId):
                // eine Verbindung darf nur den eigenen Charakter ändern
                if (data._playerId !== incoming.id) return;
                if (!hasOwn(gameState.characters, incoming.id)) return;
                const existing = gameState.characters[incoming.id];

                const char = normalizeCharacter(incoming);
                char.id = existing.id;
                char.bagInfinite = existing.bagInfinite;
                char.bagCustomMax = existing.bagCustomMax;
                char.moralityVisible = existing.moralityVisible;
                if (!existing.moralityVisible) char.morality = existing.morality;

                gameState.characters[incoming.id] = char;
                if (data.mergeLibrary) {
                    mergeCharacterIntoSessionLibrary(char);
                }
                broadcastState();
                renderChatWidget();
                renderDmView({ preserveInputs: true });
                break;
            }

            case 'ROLL_DICE': {
                const e = data.entry;
                if (!isPlainObject(e)) return;
                if (typeof data._playerId !== 'string') return;
                const sender = gameState.characters[data._playerId];
                if (!sender) return;
                const total = Number(e.total);
                if (!isFinite(total)) return;
                const entry = {
                    id: safeMessageId(e.id),
                    // Roller-Name kommt vom Host-Bestand, nicht vom Client (kein Namens-Spoofing)
                    roller: sender.name,
                    label: String(e.label == null ? '' : e.label).slice(0, 80),
                    formula: String(e.formula == null ? '' : e.formula).slice(0, 60),
                    detailHtml: String(e.detailHtml == null ? '' : e.detailHtml).slice(0, 600),
                    total: total,
                    crit: Boolean(e.crit),
                    fumble: Boolean(e.fumble),
                    secret: false
                };
                gameState.diceLog.unshift(entry);
                if (gameState.diceLog.length > 15) gameState.diceLog.pop();
                renderDiceLogStrip();
                broadcastState();
                break;
            }

            case 'CHAT_MESSAGE': {
                const m = data.message;
                if (!isPlainObject(m) || typeof m.text !== 'string') return;
                const text = m.text.trim().slice(0, 1000);
                if (!text) return;
                if (typeof m.senderId !== 'string' || m.senderId !== data._playerId) return;
                if (!hasOwn(gameState.characters, m.senderId)) return;
                const sender = gameState.characters[m.senderId];

                let target = m.target;
                let targetLabel;
                if (target === 'ALL') targetLabel = 'Alle';
                else if (target === 'DM') targetLabel = 'DM';
                else if (typeof target === 'string' && hasOwn(gameState.characters, target)) {
                    targetLabel = gameState.characters[target].name;
                } else return;

                const time = (typeof m.time === 'string' && m.time.length > 0 && m.time.length <= 20)
                    ? m.time
                    : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                gameState.messages.push({
                    id: safeMessageId(m.id),
                    senderId: m.senderId,
                    senderName: sender.name,
                    target: target,
                    targetLabel: targetLabel,
                    text: text,
                    time: time
                });
                if (gameState.messages.length > 60) gameState.messages.shift();
                updateUnreadBadge();
                renderChatWidget();
                broadcastState();
                break;
            }

            case 'MOVE_TOKEN': {
                ensureBattlemapState();
                // Nur der eigene Token darf von einer Verbindung bewegt werden
                if (typeof data.playerId !== 'string' || data.playerId !== data._playerId) return;
                const entry = (gameState.combat.order || []).find(e => e.key === data.key);
                if (entry && entry.kind === 'player' && entry.id === data.playerId) {
                    const map = gameState.combat.map;
                    entry.row = Math.max(0, Math.min(map.rows - 1, parseInt(data.row) || 0));
                    entry.col = Math.max(0, Math.min(map.cols - 1, parseInt(data.col) || 0));
                    broadcastState();
                    renderDmView({ preserveInputs: true });
                }
                break;
            }
        }
    } catch (err) {
        console.warn('Ungültige Nachricht ignoriert:', err);
    }
}

// Öffentlicher Snapshot PRO EMPFÄNGER: ohne DM-Interna, ohne geheime Würfe.
// - Chat: nur die Nachrichten, die der Empfänger sehen darf (Whispers werden nicht mehr an alle gefunkt)
// - Charaktere: der eigene vollständig, fremde nur als Anzeige-Teilmenge
//   (persönliche Notizen/Hintergrund anderer Spieler verlassen den Host nicht mehr)
function buildPublicStateFor(viewerId) {
    const snap = {};
    for (const key of Object.keys(gameState)) {
        if (HOST_ONLY_STATE_KEYS.includes(key)) continue;
        snap[key] = gameState[key];
    }
    snap.diceLog = (gameState.diceLog || []).filter(e => e && !e.secret);
    snap.enemies = (gameState.enemies || []).map(e => ({
        _uid: e._uid,
        name: e.name,
        avatar: e.avatar,
        hp: e.hp,
        maxHp: e.maxHp
    }));
    snap.messages = (gameState.messages || []).filter(m => m && isMessageVisible(m, viewerId));

    const chars = {};
    for (const id of Object.keys(gameState.characters)) {
        const c = gameState.characters[id];
        if (id === viewerId) {
            chars[id] = c;
        } else {
            // Für Token, Zugleiste & Chat reicht die Anzeige-Teilmenge
            chars[id] = {
                id: c.id,
                name: c.name,
                avatar: c.avatar || '',
                hp: c.hp,
                maxHp: c.maxHp
            };
        }
    }
    snap.characters = chars;
    return snap;
}

// Zustand an EINEN bestimmten Spieler senden (Relay liefert an alle Sockets mit dieser ID)
function hostSendToPlayer(playerId, payload) {
    if (hostSocketOpen && relaySocket && relaySocket.readyState === WebSocket.OPEN) {
        relaySocket.send(JSON.stringify({ _relay: 'PAYLOAD', to: playerId, data: payload }));
    }
}

function flushBroadcast() {
    broadcastScheduled = false;
    if (!hostSocketOpen || !hostSendFn) return;
    // Pro Spieler ein eigener Snapshot: Whispers & fremde Charakterdaten bleiben privat
    for (const playerId of Object.keys(gameState.characters)) {
        hostSendToPlayer(playerId, {
            type: 'SYNC_STATE',
            state: buildPublicStateFor(playerId)
        });
    }
    scheduleSessionPersist();
    scheduleAccountSave();
}

function broadcastState() {
    if (!hostSocketOpen || broadcastScheduled) return;
    broadcastScheduled = true;
    queueMicrotask(flushBroadcast);
}

function broadcastPlayerDeath(playerId) {
    // Nur an den betroffenen Spieler – der Tod anderer geht niemanden etwas an
    hostSendToPlayer(playerId, {
        type: 'PLAYER_DIED',
        targetId: playerId
    });
}

function returnPlayerToMainMenu() {
    // Letzten Stand noch in die Datenbank schreiben (liest den Charakter synchron, vor dem Reset).
    endAccountSession();
    resetRelayConnection();
    clearStoredSession();
    currentPlayerId = "";
    pendingPlayerCharData = null;
    lastSyncRaw = null;

    resetGameState();

    unreadChatCount = 0;
    chatSeenInit = false;
    lastSeenMsgId = null;
    const badge = document.getElementById('chat-unread-badge');
    if (badge) badge.classList.add('hidden');
    const chatList = document.getElementById('chat-messages-list');
    if (chatList) delete chatList.dataset.sig;
    const chatSelect = document.getElementById('chat-target-select');
    if (chatSelect) delete chatSelect.dataset.sig;
    renderDiceLogStrip();
    renderChatWidget();

    document.getElementById('player-view').classList.add('hidden');
    document.getElementById('player-header-tabs').classList.add('hidden');
    document.getElementById('btn-player-save-char').classList.add('hidden');
    document.getElementById('universal-dice-bar').classList.add('hidden');
    document.getElementById('chat-widget').classList.add('hidden');
    document.getElementById('lobby-view').classList.remove('hidden');
    setSessionInfo('Nicht verbunden');
}

// --- 2. ALS SPIELER BEITRETEN ---
// resumeOptions: { resumed, playerId, playerToken } – nur beim automatischen Fortsetzen nach einem Reload
// account: { token, name } – angemeldeter Spieler; sein Charakter wird automatisch in der Datenbank gespeichert.
//          Die Spieler-ID leitet sich dann vom (global eindeutigen) Kontonamen ab, nicht vom Charakternamen.
function joinGame(roomCode, playerName, importedCharacter = null, resumeOptions = null, account = null) {
    const resumed = Boolean(resumeOptions && resumeOptions.resumed);
    const baseName = account && account.name
        ? account.name
        : (!resumed && importedCharacter && importedCharacter.name ? importedCharacter.name : playerName);
    const resumedId = resumed && typeof resumeOptions.playerId === 'string' ? resumeOptions.playerId : '';
    currentPlayerId = resumedId || "player_" + baseName.toLowerCase().replace(/[^a-z0-9]/g, '_');
    lastSyncRaw = null;
    chatSeenInit = false;
    lastSeenMsgId = null;

    resetRelayConnection();
    manualDisconnect = false;
    if (account) startAccountSession(account, 'player');
    else stopAccountSession();
    const savedToken = resumeOptions && typeof resumeOptions.playerToken === 'string'
        && /^[A-Za-z0-9_-]{8,128}$/.test(resumeOptions.playerToken) ? resumeOptions.playerToken : null;
    relaySession = {
        mode: 'player',
        roomCode: String(roomCode).trim(),
        playerId: currentPlayerId,
        baseName: baseName,
        importedCharacter: importedCharacter,
        // Unterscheidet "ich verbinde mich neu" von "jemand anderes heißt genauso".
        playerToken: savedToken
            || loadRememberedToken(playerTokenKey(String(roomCode).trim(), currentPlayerId))
            || randomToken(),
        resumed: resumed,
        everReady: false,
        alerted: false,
        lostAt: null
    };

    hostConnection = {
        open: false,
        send: (payload) => {
            if (hostConnection && hostConnection.open && relaySocket && relaySocket.readyState === WebSocket.OPEN) {
                relaySocket.send(JSON.stringify({ _relay: 'PAYLOAD', data: payload }));
                return true;
            }
            return false;
        },
        close: () => {
            if (relaySocket) {
                try { relaySocket.close(); } catch (e) { /* egal */ }
            }
        }
    };

    setSessionInfo(resumed ? `Verbinde wieder mit Raum ${relaySession.roomCode}…` : 'Verbinde mit Relay…');
    connectRelay();
}

function sendPlayerJoin(session, reconnect) {
    if (!hostConnection) return;
    hostConnection.send({
        type: 'JOIN',
        id: session.playerId,
        name: session.baseName,
        importedCharacter: session.importedCharacter,
        reconnect: reconnect
    });
}

function handlePlayerRelayMessage(ws, session, msg, raw) {
    if (msg._relay === 'ERROR' || msg._relay === 'SESSION_CLOSED') {
        // Nach einem Relay-Neustart hat der DM den Raum evtl. noch nicht wieder geöffnet.
        // Wer schon drin war, wartet daher eine Weile automatisch auf den Raum.
        const wasConnected = session.everReady || session.resumed;
        const waitingSince = session.lostAt || Date.now();
        const retryable = msg._relay === 'ERROR'
            && (msg.code === 'ROOM_NOT_FOUND' || msg.code === 'RATE_LIMITED')
            && wasConnected
            && Date.now() - waitingSince < RELAY_ROOM_WAIT_MS;

        if (retryable) {
            session.lostAt = waitingSince;
            markRelayLinkDown();
            try { ws.close(); } catch (e) { /* egal */ }
            scheduleRelayReconnect(`Warte, bis der DM Raum ${session.roomCode} wieder öffnet`);
            return;
        }

        endRelaySession(session, msg.message || 'Der Relay-Server hat einen Fehler gemeldet.');
        return;
    }

    if (msg._relay === 'JOIN_READY') {
        rememberToken(playerTokenKey(session.roomCode, session.playerId), session.playerToken);
        const reconnected = session.everReady || session.resumed;
        session.everReady = true;
        session.alerted = false;
        session.lostAt = null;
        reconnectAttempts = 0;
        clearReconnectTimer();

        document.getElementById('lobby-view').classList.add('hidden');
        document.getElementById('player-view').classList.remove('hidden');
        document.getElementById('player-header-tabs').classList.remove('hidden');
        document.getElementById('btn-player-save-char').classList.remove('hidden');
        document.getElementById('universal-dice-bar').classList.remove('hidden');
        document.getElementById('chat-widget').classList.remove('hidden');

        if (msg.hostOnline === false) {
            if (hostConnection) hostConnection.open = false;
            setSessionInfo(`Verbunden (Raum ${session.roomCode}) – warte auf DM…`);
        } else {
            if (hostConnection) hostConnection.open = true;
            setSessionInfo(reconnected
                ? `Wieder verbunden (Raum ${session.roomCode})`
                : `Verbunden (Raum ${session.roomCode})`);
            sendPlayerJoin(session, reconnected);
        }
        startSessionPersistence();
        persistSessionNow();
        return;
    }

    if (msg._relay === 'HOST_LEFT') {
        // Der Relay hält den Raum noch offen – auf den DM warten.
        if (hostConnection) hostConnection.open = false;
        setSessionInfo(`⚠ DM getrennt (Raum ${session.roomCode}) – warte auf Wiederverbindung…`);
        return;
    }

    if (msg._relay === 'HOST_BACK') {
        if (hostConnection) hostConnection.open = true;
        setSessionInfo(`Verbunden (Raum ${session.roomCode})`);
        // Beitritt erneut melden, damit der Host den Spieler sicher kennt.
        sendPlayerJoin(session, true);
        return;
    }

    if (msg._relay === 'PAYLOAD' && msg.data) {
        try {
            const data = msg.data;

            if (data.type === 'PLAYER_DIED' && data.targetId === currentPlayerId) {
                returnPlayerToMainMenu();
                alert("Dein Charakter ist gestorben und wurde vom Dungeon Master aus der Session entfernt.");
                return;
            }

            if (data.type === 'SYNC_STATE') {
                if (!isPlainObject(data.state)) return;
                if (raw === lastSyncRaw) return;
                lastSyncRaw = raw;

                Object.assign(gameState, data.state);
                updateUnreadBadge();
                renderDiceLogStrip();
                renderChatWidget();
                renderPlayerView(currentPlayerId, { preserveInputs: true });
                scheduleSessionPersist();
                scheduleAccountSave();
            }
        } catch (err) {
            console.warn('Ungültige Nachricht ignoriert:', err);
        }
    }
}
