// 1. DM: Neue Session starten
document.getElementById('btn-host').addEventListener('click', () => {
    hostGame(null);
});

// 2. DM: Gespeicherte Session-Datei (.json) per Drag & Drop im Hauptmenü einfügen
bindJsonDropZone('lobby-dm-dropzone', 'lobby-dm-file', (parsed, filename) => {
    const stateObj = parsed.state || parsed;
    if (!stateObj || !stateObj.characters || !stateObj.npcTemplates) {
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
        <strong style="color:#4ade80">✔ Session geladen: ${filename}</strong>
        <span>Raum-Code: ${pendingResumeSessionData.roomCode || 'Automatisch'} | Spieler: ${Object.keys(stateObj.characters).length} | Vorlagen: ${stateObj.npcTemplates.length}</span>
    `;
    resumeBtn.disabled = false;
    resumeBtn.textContent = `Session fortsetzen (Raum ${pendingResumeSessionData.roomCode || 'Neu'})`;
});

// DM klickt auf "Session fortsetzen" (erst aktiv, nachdem eine Datei geladen wurde)
document.getElementById('btn-resume-session').addEventListener('click', () => {
    if (!pendingResumeSessionData) return;
    hostGame(pendingResumeSessionData);
});

// 3. SPIELER: Gespeicherte Charakter-Datei (.json) im Hauptmenü per Drag & Drop einfügen
bindJsonDropZone('lobby-player-dropzone', 'lobby-player-file', (parsed, filename) => {
    const charObj = parsed.character || parsed;
    if (!charObj || !charObj.name || !charObj.stats) {
        return alert("Ungültige Charakter-Datei! Bitte wähle eine gespeicherte Charakter-Datei (.json).");
    }

    pendingPlayerCharData = charObj;
    document.getElementById('input-player-name').value = charObj.name;

    const dropZone = document.getElementById('lobby-player-dropzone');
    const dropText = document.getElementById('lobby-player-drop-text');
    dropZone.classList.add('file-loaded');
    dropText.innerHTML = `
        <strong style="color:#4ade80">✔ Charakter bereit: ${charObj.name} (Lvl ${charObj.level || 1})</strong>
        <span>Datei: ${filename} — Werte, Bilder & Items werden beim Beitritt geladen!</span>
    `;
});

// 4. SPIELER: Session beitreten (überträgt automatisch den geladenen Charakter an den DM)
document.getElementById('btn-join').addEventListener('click', () => {
    const name = document.getElementById('input-player-name').value.trim();
    const code = document.getElementById('input-room-code').value.trim();

    if (!name || !code) {
        alert("Bitte Charakternamen und Raum-Code eingeben!");
        return;
    }

    if (pendingPlayerCharData) {
        pendingPlayerCharData.name = name;
    }
    joinGame(code, name, pendingPlayerCharData);
});

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

// Globale Tastatur-Shortcuts (1, 2, 3) für Tab-Wechsel & Escape für Modal
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeConfirmModal();
        return;
    }

    const tag = document.activeElement ? document.activeElement.tagName : '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable) {
        return;
    }

    const isDmVisible = !document.getElementById('dm-view').classList.contains('hidden');
    const isPlayerVisible = !document.getElementById('player-view').classList.contains('hidden');

    if (isPlayerVisible) {
        if (e.key === '1') switchPlayerTab('gameplay');
        if (e.key === '2') switchPlayerTab('story');
        if (e.key === '3') switchPlayerTab('equipment');
    } else if (isDmVisible) {
        if (e.key === '1') switchDmTab('gameplay');
        if (e.key === '2') switchDmTab('templates');
        if (e.key === '3') switchDmTab('combat');
    }
});
