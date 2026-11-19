// 1. DM: Neue Session starten
//    Ist der DM im Hauptmenü angemeldet, wird die Session automatisch im Konto gespeichert.
document.getElementById('btn-host').addEventListener('click', () => {
    hostGame(null, null, dmLobbyAccount);
});

// 2. DM: Gespeicherte Session-Datei (.json) per Drag & Drop im Hauptmenü einfügen
bindJsonDropZone('lobby-dm-dropzone', 'lobby-dm-file', (parsed, filename) => {
    const stateObj = parsed.state || parsed;
    if (!stateObj || typeof stateObj.characters !== 'object' || stateObj.characters === null || !Array.isArray(stateObj.npcTemplates)) {
        return alert("Ungültige Session-Datei! Bitte wähle eine vom DM gespeicherte Session-Datei (.json).");
    }

    pendingResumeSessionData = {
        roomCode: parsed.roomCode || stateObj.roomCode,
        state: stateObj
    };

    const dropZone = document.getElementById('lobby-dm-dropzone');
    const dropText = document.getElementById('lobby-dm-drop-text');
    const resumeBtn = document.getElementById('btn-resume-session');

    dropZone.classList.add('file-loaded');
    dropText.innerHTML = `
        <strong class="drop-ok-line">${icon('check')} Session geladen: ${esc(filename)}</strong>
        <span>Raum-Code: ${esc(pendingResumeSessionData.roomCode || 'Automatisch')} | Spieler: ${Object.keys(stateObj.characters).length} | Vorlagen: ${stateObj.npcTemplates.length}</span>
    `;
    resumeBtn.disabled = false;
    resumeBtn.textContent = `Session fortsetzen (Raum ${pendingResumeSessionData.roomCode || 'Neu'})`;
});

// DM klickt auf "Session fortsetzen" (erst aktiv, nachdem eine Datei geladen wurde)
document.getElementById('btn-resume-session').addEventListener('click', () => {
    if (!pendingResumeSessionData) return;
    // Angemeldet: Die Datei wird als neue Session ins Konto übernommen.
    hostGame(pendingResumeSessionData, null, dmLobbyAccount);
});

// 3. SPIELER: Gespeicherte Charakter-Datei (.json) im Hauptmenü per Drag & Drop einfügen
bindJsonDropZone('lobby-player-dropzone', 'lobby-player-file', (parsed, filename) => {
    const charObj = parsed.character || parsed;
    if (!charObj || !charObj.name || !charObj.stats) {
        return alert("Ungültige Charakter-Datei! Bitte wähle eine gespeicherte Charakter-Datei (.json).");
    }

    pendingPlayerCharData = charObj;
    // Bei Konten ist der Name der Login – nicht mit dem Charakternamen überschreiben.
    const nameInput = document.getElementById('input-player-name');
    const passwordInput = document.getElementById('input-player-password');
    if (!nameInput.value.trim() || !(passwordInput && passwordInput.value)) nameInput.value = charObj.name;

    const dropZone = document.getElementById('lobby-player-dropzone');
    const dropText = document.getElementById('lobby-player-drop-text');
    dropZone.classList.add('file-loaded');
    dropText.innerHTML = `
        <strong class="drop-ok-line">${icon('check')} Charakter bereit: ${esc(charObj.name)} (Lvl ${esc(charObj.level || 1)})</strong>
        <span>Datei: ${esc(filename)} — Werte, Bilder & Items werden beim Beitritt geladen!</span>
    `;
});

// 4. SPIELER: Session beitreten (überträgt automatisch den geladenen Charakter an den DM)
//    Mit Passwort: Anmelden bzw. Konto anlegen, Charakter aus der Datenbank laden & automatisch speichern.
let joinInProgress = false;
document.getElementById('btn-join').addEventListener('click', async () => {
    if (joinInProgress) return;
    const name = document.getElementById('input-player-name').value.trim();
    const code = document.getElementById('input-room-code').value.trim();
    const passwordInput = document.getElementById('input-player-password');
    const password = passwordInput && !passwordInput.disabled ? passwordInput.value : '';

    if (!name || !code) {
        alert("Bitte Namen und Raum-Code eingeben!");
        return;
    }

    if (!password) {
        if (pendingPlayerCharData) {
            pendingPlayerCharData.name = name;
        }
        joinGame(code, name, pendingPlayerCharData);
        return;
    }

    const joinBtn = document.getElementById('btn-join');
    joinInProgress = true;
    joinBtn.disabled = true;
    try {
        const account = await loginOrRegisterAccount(name, password);
        if (!account) return;
        // Eine bewusst hineingezogene Datei hat Vorrang vor dem gespeicherten Stand.
        const character = pendingPlayerCharData || (isPlainObject(account.character) ? account.character : null);
        passwordInput.value = '';
        joinGame(code, account.name, character, null, account);
    } catch (err) {
        alert(`Anmeldung fehlgeschlagen: ${err.message}`);
    } finally {
        joinInProgress = false;
        joinBtn.disabled = false;
    }
});

// Enter im Passwortfeld = Beitreten
document.getElementById('input-player-password')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('btn-join').click();
    }
});

document.getElementById('btn-dm-login')?.addEventListener('click', dmLobbyLogin);
document.getElementById('input-dm-password')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        dmLobbyLogin();
    }
});

checkAccountAvailability();

// Enter-Taste im Chat-Eingabefeld sendet die Nachricht
document.getElementById('chat-message-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        sendChatMessage();
    }
});

// Enter-Taste im Würfel-Formelfeld führt den Wurf aus
document.getElementById('dice-formula-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        rollFromFormulaInput();
    }
});

// Tastatur-Shortcuts: 1–4, A/D und Pfeiltasten (Links/Rechts) für Spieler & DM
window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const confirmModal = document.getElementById('confirm-modal');
    if (confirmModal && !confirmModal.classList.contains('hidden')) return;
    // Ignorieren, wenn gerade in einem Textfeld, einer Notiz oder einem Dropdown getippt wird
    const activeTag = document.activeElement ? document.activeElement.tagName : '';
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(activeTag) || document.activeElement?.isContentEditable) {
        return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    // Nur ausführen, wenn man nicht mehr in der Start-Lobby ist
    const lobbyEl = document.getElementById('lobby-view');
    if (lobbyEl && !lobbyEl.classList.contains('hidden')) return;

    const key = e.key.toLowerCase();
    const isPrev = key === 'a' || e.key === 'ArrowLeft';
    const isNext = key === 'd' || e.key === 'ArrowRight';

    // Kampffeld-Zoom per Tastatur, solange das Spielfeld sichtbar ist
    const battlemapStage = document.getElementById('battlemap-stage-wrapper');
    if (battlemapStage && battlemapStage.offsetParent !== null) {
        if (e.key === '+' || e.key === '=') {
            e.preventDefault();
            stepBattlemapZoom(1);
            return;
        }
        if (e.key === '-' || e.key === '_') {
            e.preventDefault();
            stepBattlemapZoom(-1);
            return;
        }
        if (e.key === '0') {
            e.preventDefault();
            resetBattlemapZoom();
            return;
        }
    }

    if (!currentPlayerId) {
        // --- DM TABS ---
        const dmTabs = ['gameplay', 'templates', 'combat', 'notes'];

        if (e.key === '1') switchDmTab('gameplay');
        else if (e.key === '2') switchDmTab('templates');
        else if (e.key === '3') switchDmTab('combat');
        else if (e.key === '4') switchDmTab('notes');
        else if (isPrev || isNext) {
            e.preventDefault();
            const currentIdx = Math.max(0, dmTabs.indexOf(activeDmTab));
            const delta = isNext ? 1 : -1;
            const nextIdx = (currentIdx + delta + dmTabs.length) % dmTabs.length;
            switchDmTab(dmTabs[nextIdx]);
        }
    } else {
        // --- SPIELER TABS (Tab 4 nur, wenn vom DM sichtbar geschaltet) ---
        const canSeeCombat = Boolean(gameState.combat && gameState.combat.battlemapVisibleToPlayers);
        const playerTabs = canSeeCombat
            ? ['gameplay', 'story', 'equipment', 'combat']
            : ['gameplay', 'story', 'equipment'];

        if (e.key === '1') switchPlayerTab('gameplay');
        else if (e.key === '2') switchPlayerTab('story');
        else if (e.key === '3') switchPlayerTab('equipment');
        else if (e.key === '4' && canSeeCombat) switchPlayerTab('combat');
        else if (isPrev || isNext) {
            e.preventDefault();
            const currentIdx = Math.max(0, playerTabs.indexOf(activePlayerTab));
            const delta = isNext ? 1 : -1;
            const nextIdx = (currentIdx + delta + playerTabs.length) % playerTabs.length;
            switchPlayerTab(playerTabs[nextIdx]);
        }
    }
});

// Einladungslink (…/?room=1234) füllt den Raum-Code im Hauptmenü vor.
(function prefillRoomCodeFromUrl() {
    let room = null;
    try { room = new URLSearchParams(window.location.search).get('room'); } catch (e) { return; }
    if (!room || !/^[A-Za-z0-9_-]{1,64}$/.test(room)) return;
    const input = document.getElementById('input-room-code');
    if (input && !input.value) input.value = room;
    document.getElementById('input-player-name')?.focus();
})();

// Tab neu geladen? Dann die laufende Session (DM oder Spieler) automatisch fortsetzen.
resumeStoredSession();
