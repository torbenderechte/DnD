'use strict';

// Protokoll-Tests für den Relay. Ausführen: cd relay && npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { WebSocket } = require('ws');
const { createRelay } = require('../server');

let relay;
let base;

before(async () => {
    relay = createRelay({ log: () => {}, hostGraceMs: 400, heartbeatMs: 60000, dbPath: ':memory:' });
    const info = await relay.listen(0, '127.0.0.1');
    base = `127.0.0.1:${info.port}`;
});

after(() => relay.close());

function get(pathname) {
    return new Promise((resolve, reject) => {
        http.get(`http://${base}${pathname}`, (res) => {
            let body = '';
            res.on('data', (c) => { body += c; });
            res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
        }).on('error', reject);
    });
}

// Kleiner Client: sammelt Nachrichten und kann auf einen bestimmten Typ warten.
function client() {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://${base}`);
        const inbox = [];
        const waiters = [];
        ws.on('message', (raw) => {
            const msg = JSON.parse(raw.toString());
            const idx = waiters.findIndex(w => w.match(msg));
            if (idx >= 0) waiters.splice(idx, 1)[0].resolve(msg);
            else inbox.push(msg);
        });
        ws.closed = new Promise((res) => ws.on('close', (code) => res(code)));
        ws.sendJson = (obj) => ws.send(JSON.stringify(obj));
        ws.next = (type, timeoutMs = 2000) => new Promise((res, rej) => {
            const match = (m) => m._relay === type;
            const idx = inbox.findIndex(match);
            if (idx >= 0) return res(inbox.splice(idx, 1)[0]);
            const timer = setTimeout(() => rej(new Error(`Timeout beim Warten auf ${type}`)), timeoutMs);
            waiters.push({ match, resolve: (m) => { clearTimeout(timer); res(m); } });
        });
        ws.on('open', () => resolve(ws));
        ws.on('error', reject);
    });
}

let roomSeq = 0;
const newRoom = () => `t${Date.now().toString(36)}${roomSeq++}`;

async function hostRoom(roomCode, hostToken) {
    const host = await client();
    host.sendJson({ _relay: 'HOST', roomCode, hostToken });
    const ready = await host.next('HOST_READY');
    return { host, ready };
}

async function joinRoom(roomCode, playerId, playerToken) {
    const ws = await client();
    ws.sendJson({ _relay: 'JOIN', roomCode, playerId, playerToken });
    return ws;
}

test('liefert die App aus und sperrt interne Dateien', async () => {
    const index = await get('/');
    assert.equal(index.status, 200);
    assert.match(index.headers['content-type'], /text\/html/);

    for (const p of ['/relay/server.js', '/.git/config', '/start.command', '/../etc/passwd', '/%2e%2e/etc/passwd', '/node_modules/x', '/Relay/server.js', '/RELAY/data/afterlife.db', '/Node_Modules/ws/package.json', '/x.db', '/x.sqlite-wal']) {
        assert.equal((await get(p)).status, 404, p);
    }
});

test('/health und /info', async () => {
    const health = JSON.parse((await get('/health')).body);
    assert.equal(health.ok, true);
    assert.equal(health.app, 'afterlife-relay');

    relay.setPublicUrl('https://beispiel.trycloudflare.com');
    const info = JSON.parse((await get('/info')).body);
    assert.equal(info.publicUrl, 'https://beispiel.trycloudflare.com');
    relay.setPublicUrl(null);
});

test('Host + Spieler: Beitritt, PLAYERS-Meldung und Nachrichten-Routing', async () => {
    const room = newRoom();
    const { host, ready } = await hostRoom(room);
    assert.equal(ready.reconnected, false);
    assert.match(ready.hostToken, /^[0-9a-f]{32}$/);

    const p1 = await joinRoom(room, 'player_a', 'tokenAAAAAAAA');
    const jr = await p1.next('JOIN_READY');
    assert.equal(jr.hostOnline, true);
    assert.deepEqual((await host.next('PLAYERS')).playerIds, ['player_a']);

    // Spieler -> Host: Relay stempelt die echte ID, gefälschte wird überschrieben
    p1.sendJson({ _relay: 'PAYLOAD', data: { type: 'CHAT', _playerId: 'player_b' } });
    const fromPlayer = await host.next('PAYLOAD');
    assert.equal(fromPlayer.data._playerId, 'player_a');

    // Host -> gezielt an einen Spieler
    host.sendJson({ _relay: 'PAYLOAD', to: 'player_a', data: { type: 'SYNC_STATE' } });
    assert.equal((await p1.next('PAYLOAD')).data.type, 'SYNC_STATE');

    p1.close();
    assert.deepEqual((await host.next('PLAYERS')).playerIds, []);
    host.close();
});

test('gleicher Name, andere Person -> PLAYER_TAKEN statt gegenseitigem Rauswurf', async () => {
    const room = newRoom();
    const { host } = await hostRoom(room);
    const first = await joinRoom(room, 'player_max', 'tokenFirst1111');
    await first.next('JOIN_READY');

    const second = await joinRoom(room, 'player_max', 'tokenOther2222');
    const err = await second.next('ERROR');
    assert.equal(err.code, 'PLAYER_TAKEN');
    assert.equal(first.readyState, WebSocket.OPEN);

    // Derselbe Spieler (gleicher Token) darf die alte Verbindung ablösen
    const again = await joinRoom(room, 'player_max', 'tokenFirst1111');
    await again.next('JOIN_READY');
    assert.equal(await first.closed, 4002);

    second.close(); again.close(); host.close();
});

test('DM-Reconnect im Gnadenfenster: Spieler bleiben verbunden', async () => {
    const room = newRoom();
    const { host, ready } = await hostRoom(room);
    const player = await joinRoom(room, 'player_c', 'tokenCCCCCCCC');
    await player.next('JOIN_READY');

    host.close();
    await player.next('HOST_LEFT');

    // Ohne Token lässt sich der Raum auch im Gnadenfenster nicht übernehmen …
    const sneaky = await client();
    sneaky.sendJson({ _relay: 'HOST', roomCode: room });
    assert.equal((await sneaky.next('ERROR')).code, 'ROOM_TAKEN');
    sneaky.close();

    // … der echte DM mit Token aber schon.
    const { host: host2, ready: ready2 } = await hostRoom(room, ready.hostToken);
    assert.equal(ready2.reconnected, true);
    assert.equal(ready2.hostToken, ready.hostToken);
    assert.deepEqual(ready2.playerIds, ['player_c']);
    await player.next('HOST_BACK');

    const intruder = await client();
    intruder.sendJson({ _relay: 'HOST', roomCode: room });
    assert.equal((await intruder.next('ERROR')).code, 'ROOM_TAKEN');

    // … und die zweite Instanz mit gleichem Token löst die erste sauber ab (4001).
    const { host: host3 } = await hostRoom(room, ready.hostToken);
    assert.equal(await host2.closed, 4001);

    intruder.close(); player.close(); host3.close();
});

test('DM kommt nicht zurück -> SESSION_CLOSED nach dem Gnadenfenster', async () => {
    const room = newRoom();
    const { host } = await hostRoom(room);
    const player = await joinRoom(room, 'player_d', 'tokenDDDDDDDD');
    await player.next('JOIN_READY');

    host.close();
    await player.next('HOST_LEFT');
    await player.next('SESSION_CLOSED', 3000);
    assert.equal(await player.closed, 4000);

    const late = await joinRoom(room, 'player_d', 'tokenDDDDDDDD');
    assert.equal((await late.next('ERROR')).code, 'ROOM_NOT_FOUND');
    late.close();
});

test('Spieler-Nachricht ohne DM bekommt HOST_LEFT als Rückmeldung', async () => {
    const room = newRoom();
    const { host } = await hostRoom(room);
    const player = await joinRoom(room, 'player_e', 'tokenEEEEEEEE');
    await player.next('JOIN_READY');
    host.close();
    await player.next('HOST_LEFT');

    player.sendJson({ _relay: 'PAYLOAD', data: { type: 'CHAT' } });
    await player.next('HOST_LEFT');
    player.close();
});

test('nach Relay-Neustart darf der DM seinen alten Token weiterverwenden', async () => {
    const room = newRoom();
    const token = 'abcdef0123456789abcdef0123456789';
    const { host, ready } = await hostRoom(room, token);
    assert.equal(ready.hostToken, token);
    host.close();
});

test('ungültige Eingaben werden abgelehnt', async () => {
    const ws = await client();
    ws.sendJson({ _relay: 'HOST', roomCode: '../../x' });
    assert.equal((await ws.next('ERROR')).code, 'INVALID_ROOM');
    ws.send('kein json');
    assert.equal((await ws.next('ERROR')).code, 'BAD_MESSAGE');
    ws.sendJson({ _relay: 'JOIN', roomCode: 'egal', playerId: 'x' });
    assert.equal((await ws.next('ERROR')).code, 'ROOM_NOT_FOUND');
    ws.sendJson({ _relay: 'PING' });
    await ws.next('PONG');
    ws.close();
});

test('JOIN ohne Spieler-Token wird abgelehnt', async () => {
    const room = newRoom();
    const { host } = await hostRoom(room);
    const ws = await client();
    ws.sendJson({ _relay: 'JOIN', roomCode: room, playerId: 'player_x' });
    assert.equal((await ws.next('ERROR')).code, 'INVALID_PLAYER');
    ws.close(); host.close();
});

// --- Spieler-Konten (Datenbank) ---------------------------------------------

function api(method, pathname, body, token) {
    return new Promise((resolve, reject) => {
        const payload = body === undefined ? null : JSON.stringify(body);
        const headers = {};
        if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
        if (token) headers.Authorization = `Bearer ${token}`;
        const [host, port] = base.split(':');
        const req = http.request({ host, port, path: pathname, method, headers }, (res) => {
            let data = '';
            res.on('data', (c) => { data += c; });
            res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
        });
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

test('Konten: registrieren, anmelden, Charakter speichern & laden', async () => {
    assert.equal((await api('GET', '/api/status')).body.accounts, true);

    const reg = await api('POST', '/api/register', { name: 'Musashi', password: 'geheim1' });
    assert.equal(reg.status, 200);
    assert.equal(reg.body.name, 'Musashi');
    assert.equal(reg.body.character, null);

    // Name gilt global und ohne Rücksicht auf Groß-/Kleinschreibung
    assert.equal((await api('POST', '/api/register', { name: 'musashi', password: 'x1234' })).body.code, 'NAME_TAKEN');

    const char = { name: 'Miyamoto', level: 3, stats: { str: 14 } };
    assert.equal((await api('PUT', '/api/character', { character: char }, reg.body.token)).status, 200);

    assert.equal((await api('POST', '/api/login', { name: 'MUSASHI', password: 'falsch' })).body.code, 'WRONG_PASSWORD');
    assert.equal((await api('POST', '/api/login', { name: 'Niemand', password: 'egal' })).body.code, 'UNKNOWN_USER');

    const login = await api('POST', '/api/login', { name: 'musashi', password: 'geheim1' });
    assert.equal(login.status, 200);
    assert.deepEqual(login.body.character, char);
    assert.equal((await api('GET', '/api/character', undefined, login.body.token)).body.character.level, 3);

    // Ohne / mit ungültigem Token kein Zugriff
    assert.equal((await api('PUT', '/api/character', { character: char })).status, 401);
    await api('POST', '/api/logout', undefined, login.body.token);
    assert.equal((await api('GET', '/api/character', undefined, login.body.token)).status, 401);
});

test('Konten: Brute-Force-Schutz', async () => {
    await api('POST', '/api/register', { name: 'Bruteziel', password: 'richtig' });
    let last;
    for (let i = 0; i < 9; i++) last = await api('POST', '/api/login', { name: 'Bruteziel', password: 'falsch' });
    assert.equal(last.status, 429);
});

test('Konten: DM-Sessions speichern, auflisten, laden, löschen', async () => {
    const { body: acc } = await api('POST', '/api/register', { name: 'Spielleiter', password: 'dmpass' });
    const state = { roomCode: '4711', characters: { player_a: { name: 'A' }, player_b: { name: 'B' } }, npcTemplates: [] };

    assert.equal((await api('PUT', '/api/sessions/s_abcdef12', { roomCode: '4711', state }, acc.token)).status, 200);
    assert.equal((await api('PUT', '/api/sessions/s_abcdef12', { roomCode: '4711', state: { foo: 1 } }, acc.token)).body.code, 'INVALID_SESSION');
    assert.equal((await api('PUT', '/api/sessions/kurz', { roomCode: '1', state }, acc.token)).body.code, 'INVALID_SESSION_ID');

    const list = await api('GET', '/api/sessions', undefined, acc.token);
    assert.equal(list.body.sessions.length, 1);
    assert.equal(list.body.sessions[0].roomCode, '4711');
    assert.equal(list.body.sessions[0].players, 2);

    const loaded = await api('GET', '/api/sessions/s_abcdef12', undefined, acc.token);
    assert.deepEqual(loaded.body.state, state);

    // Fremde Konten sehen die Session nicht
    const { body: other } = await api('POST', '/api/register', { name: 'Fremder', password: 'xxxx' });
    assert.equal((await api('GET', '/api/sessions/s_abcdef12', undefined, other.token)).status, 404);
    assert.equal((await api('GET', '/api/sessions', undefined)).status, 401);

    await api('DELETE', '/api/sessions/s_abcdef12', undefined, acc.token);
    assert.equal((await api('GET', '/api/sessions', undefined, acc.token)).body.sessions.length, 0);
});

// --- Sicherheit: Identität im Raum -----------------------------------------

test('offline Spieler: fremder Token darf seinen Platz nicht übernehmen', async () => {
    const room = newRoom();
    const { host } = await hostRoom(room);
    const owner = await joinRoom(room, 'player_lea', 'tokenLeaOwner1');
    await owner.next('JOIN_READY');
    owner.close();
    await owner.closed;

    const thief = await joinRoom(room, 'player_lea', 'tokenThief9999');
    assert.equal((await thief.next('ERROR')).code, 'PLAYER_TAKEN');

    // Der echte Spieler kommt mit seinem Token wieder rein
    const back = await joinRoom(room, 'player_lea', 'tokenLeaOwner1');
    await back.next('JOIN_READY');
    thief.close(); back.close(); host.close();
});

test('Konto-Name ist reserviert: ohne gültigen Konto-Token kein Beitritt', async () => {
    const { body: acc } = await api('POST', '/api/register', { name: 'Kontoheld', password: 'geheim1' });
    const room = newRoom();
    const { host } = await hostRoom(room);

    const noAccount = await joinRoom(room, 'player_kontoheld', 'tokenFremd1234');
    assert.equal((await noAccount.next('ERROR')).code, 'ACCOUNT_REQUIRED');

    const badToken = await client();
    badToken.sendJson({ _relay: 'JOIN', roomCode: room, playerId: 'player_kontoheld', playerToken: 'tokenFremd1234', accountToken: 'x'.repeat(40) });
    assert.equal((await badToken.next('ERROR')).code, 'ACCOUNT_INVALID');

    // Fremde ID mit eigenem Konto-Token geht auch nicht
    const wrongId = await client();
    wrongId.sendJson({ _relay: 'JOIN', roomCode: room, playerId: 'player_jemand', playerToken: 'tokenFremd1234', accountToken: acc.token });
    assert.equal((await wrongId.next('ERROR')).code, 'INVALID_PLAYER');

    const ok = await client();
    ok.sendJson({ _relay: 'JOIN', roomCode: room, playerId: 'player_kontoheld', playerToken: 'tokenGeraetA111', accountToken: acc.token });
    await ok.next('JOIN_READY');

    // Gleiches Konto auf anderem Gerät (anderer Raum-Token) darf ablösen
    const other = await client();
    other.sendJson({ _relay: 'JOIN', roomCode: room, playerId: 'player_kontoheld', playerToken: 'tokenGeraetB222', accountToken: acc.token });
    await other.next('JOIN_READY');
    assert.equal(await ok.closed, 4002);

    for (const ws of [noAccount, badToken, wrongId, other, host]) ws.close();
});

test('Login/Registrierung: übergroße Anfragen werden abgelehnt', async () => {
    const res = await api('POST', '/api/login', { name: 'x', password: 'y'.repeat(20000) });
    assert.equal(res.status, 413);
});

test('Raum-Codes durchprobieren wird gebremst', async () => {
    const ws = await client();
    let last;
    for (let i = 0; i < 61; i++) {
        ws.sendJson({ _relay: 'JOIN', roomCode: `nope${i}`, playerId: 'player_p', playerToken: 'tokenProbe1234' });
        last = await ws.next('ERROR');
    }
    assert.equal(last.code, 'RATE_LIMITED');
    ws.close();
});
