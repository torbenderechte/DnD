const PEER_PREFIX = "afterlife-rpg-";
let peer = null;
let playerConnections = [];
let hostConnection = null;
let currentPlayerId = "";
let chatCollapsed = false;
let unreadChatCount = 0;

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
    }
}

function updateChatTargetOptions() {
    const select = document.getElementById('chat-target-select');
    if (!select) return;
    const prev = select.value || 'ALL';

    if (!currentPlayerId) {
        const playerOpts = Object.values(gameState.characters).map(c =>
            `<option value="${c.id}">🔒 Privat an: ${c.name}</option>`
        ).join('');
        select.innerHTML = `<option value="ALL">An: Alle</option>${playerOpts}`;
    } else {
        select.innerHTML = `
            <option value="ALL">An: Alle</option>
            <option value="DM">🔒 Privat an: DM</option>
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

    input.value = '';

    if (!currentPlayerId) {
        gameState.messages.push(msg);
        if (gameState.messages.length > 60) gameState.messages.shift();
        renderChatWidget();
        broadcastState();
    } else if (hostConnection && hostConnection.open) {
        hostConnection.send({
            type: 'CHAT_MESSAGE',
            message: msg
        });
    }
}

function renderChatWidget() {
    updateChatTargetOptions();
    const list = document.getElementById('chat-messages-list');
    if (!list) return;

    const myId = currentPlayerId || 'DM';
    const visible = (gameState.messages || []).filter(m =>
        m.target === 'ALL' || myId === 'DM' || m.senderId === myId || m.target === myId
    );

    if (visible.length === 0) {
        list.innerHTML = `<p class="muted">Noch keine Nachrichten.</p>`;
        return;
    }

    list.innerHTML = visible.map(m => {
        const isWhisper = m.target !== 'ALL';
        return `
            <div class="chat-msg ${isWhisper ? 'chat-whisper' : ''}">
                <div class="chat-msg-meta">
                    <span class="chat-msg-sender">${m.senderName} ➔ ${m.targetLabel}</span>
                    <span>${m.time}</span>
                </div>
                <div>${m.text}</div>
            </div>
        `;
    }).join('');

    list.scrollTop = list.scrollHeight;
}

// --- 1. ALS DM HOSTEN (Neu starten ODER gespeicherte Session mit altem Raum-Code fortsetzen) ---
function hostGame(savedSessionPayload = null) {
    let roomCode = Math.floor(1000 + Math.random() * 9000).toString();

    if (savedSessionPayload && savedSessionPayload.state) {
        Object.assign(gameState, savedSessionPayload.state);
        roomCode = savedSessionPayload.roomCode || gameState.roomCode || roomCode;
    }
    gameState.roomCode = roomCode;

    peer = new Peer(PEER_PREFIX + roomCode);

    peer.on('open', () => {
        document.getElementById('session-info').textContent = `DM | Raum-Code: ${roomCode}`;
        document.getElementById('lobby-view').classList.add('hidden');
        document.getElementById('dm-view').classList.remove('hidden');
        document.getElementById('dm-header-tabs').classList.remove('hidden');
        document.getElementById('btn-dm-save-session').classList.remove('hidden');
        document.getElementById('universal-dice-bar').classList.remove('hidden');
        document.getElementById('dm-secret-roll-wrap').classList.remove('hidden');
        document.getElementById('chat-widget').classList.remove('hidden');
        renderDiceLogStrip();
        renderChatWidget();
        renderDmView();
    });

    peer.on('connection', (conn) => {
        playerConnections.push(conn);

        conn.on('data', (data) => {
            if (data.type === 'JOIN') {
                if (data.importedCharacter) {
                    const imported = data.importedCharacter;
                    imported.id = data.id;
                    gameState.characters[data.id] = imported;
                    mergeCharacterIntoSessionLibrary(imported);
                } else if (!gameState.characters[data.id]) {
                    gameState.characters[data.id] = createNewCharacter(data.id, data.name);
                }
                broadcastState();
                renderChatWidget();
                renderDmView();
            }

            if (data.type === 'UPDATE_CHARACTER') {
                gameState.characters[data.character.id] = data.character;
                if (data.mergeLibrary) {
                    mergeCharacterIntoSessionLibrary(data.character);
                }
                broadcastState();
                renderChatWidget();
                renderDmView();
            }

            if (data.type === 'ROLL_DICE') {
                gameState.diceLog.unshift(data.entry);
                if (gameState.diceLog.length > 15) gameState.diceLog.pop();
                renderDiceLogStrip();
                broadcastState();
            }

            if (data.type === 'CHAT_MESSAGE') {
                gameState.messages.push(data.message);
                if (gameState.messages.length > 60) gameState.messages.shift();
                if (chatCollapsed) {
                    unreadChatCount++;
                    const badge = document.getElementById('chat-unread-badge');
                    badge.textContent = unreadChatCount;
                    badge.classList.remove('hidden');
                }
                renderChatWidget();
                broadcastState();
            }

            // NEU: Spieler bewegt seinen eigenen Token auf dem Kampffeld
            if (data.type === 'MOVE_TOKEN') {
                ensureBattlemapState();
                const expectedKey = `player_${data.playerId}`;
                const entry = (gameState.combat.order || []).find(e => e.key === expectedKey || e.key === data.key);
                if (entry && entry.kind === 'player' && entry.id === data.playerId) {
                    const map = gameState.combat.map;
                    entry.row = Math.max(0, Math.min(map.rows - 1, parseInt(data.row) || 0));
                    entry.col = Math.max(0, Math.min(map.cols - 1, parseInt(data.col) || 0));
                    broadcastState();
                    renderDmView();
                }
            }
        });
    });
}

function broadcastState() {
    playerConnections.forEach(conn => {
        if (conn.open) {
            conn.send({
                type: 'SYNC_STATE',
                state: gameState
            });
        }
    });
}

function broadcastPlayerDeath(playerId) {
    playerConnections.forEach(conn => {
        if (conn.open) {
            conn.send({
                type: 'PLAYER_DIED',
                targetId: playerId
            });
        }
    });
}

function returnPlayerToMainMenu() {
    if (hostConnection) {
        try { hostConnection.close(); } catch (e) {}
        hostConnection = null;
    }
    if (peer) {
        try { peer.destroy(); } catch (e) {}
        peer = null;
    }
    currentPlayerId = "";
    pendingPlayerCharData = null;

    document.getElementById('player-view').classList.add('hidden');
    document.getElementById('player-header-tabs').classList.add('hidden');
    document.getElementById('btn-player-save-char').classList.add('hidden');
    document.getElementById('universal-dice-bar').classList.add('hidden');
    document.getElementById('chat-widget').classList.add('hidden');
    document.getElementById('lobby-view').classList.remove('hidden');
    document.getElementById('session-info').textContent = 'Nicht verbunden';
}

// --- 2. ALS SPIELER BEITRETEN (Mit oder ohne geladene Charakter-Datei) ---
function joinGame(roomCode, playerName, importedCharacter = null) {
    const baseName = importedCharacter && importedCharacter.name ? importedCharacter.name : playerName;
    currentPlayerId = "player_" + baseName.toLowerCase().replace(/[^a-z0-9]/g, '_');
    peer = new Peer();

    peer.on('open', () => {
        hostConnection = peer.connect(PEER_PREFIX + roomCode.trim());

        hostConnection.on('open', () => {
            document.getElementById('session-info').textContent = `Verbunden (Raum ${roomCode})`;
            document.getElementById('lobby-view').classList.add('hidden');
            document.getElementById('player-view').classList.remove('hidden');
            document.getElementById('player-header-tabs').classList.remove('hidden');
            document.getElementById('btn-player-save-char').classList.remove('hidden');
            document.getElementById('universal-dice-bar').classList.remove('hidden');
            document.getElementById('chat-widget').classList.remove('hidden');

            hostConnection.send({
                type: 'JOIN',
                id: currentPlayerId,
                name: baseName,
                importedCharacter: importedCharacter
            });
        });

        hostConnection.on('data', (data) => {
            if (data.type === 'PLAYER_DIED' && data.targetId === currentPlayerId) {
                returnPlayerToMainMenu();
                alert("💀 Dein Charakter ist gestorben und wurde vom Dungeon Master aus der Session entfernt.");
                return;
            }

            if (data.type === 'SYNC_STATE') {
                const prevMsgCount = (gameState.messages || []).length;
                Object.assign(gameState, data.state);
                if (chatCollapsed && (gameState.messages || []).length > prevMsgCount) {
                    unreadChatCount++;
                    const badge = document.getElementById('chat-unread-badge');
                    badge.textContent = unreadChatCount;
                    badge.classList.remove('hidden');
                }
                renderDiceLogStrip();
                renderChatWidget();
                renderPlayerView(currentPlayerId);
            }
        });
    });
}
