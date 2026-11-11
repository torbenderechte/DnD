const gameState = {
    roomCode: "",          // 4-stelliger Raum-Code (wird beim DM-Export mitgespeichert)
    characters: {},        // Spieler-Charaktere
    customItems: [],       // Gegenstände: { avatar, name, categories, requirement, action }
    customAttacks: [],     // Attacken:    { avatar, name, categories, action, usesExhaustion }
    customAffinities: [],  // Merkmale:    { avatar, name, categories, effect }
    npcTemplates: [],      // Monster/NPCs:{ avatar, name, categories, description, hp, maxHp, ac, initiative, morality, copper, stats, items, attacks, affinities }
    enemies: [],           // Aktive Monster & NPCs im Spiel
    diceLog: [],           // Live-Würfel-Log
    messages: [],          // Live-Chat-Nachrichten
    combat: {
        active: false,
        round: 1,
        turnIndex: 0,
        order: [],
        teams: {
            "Helden": "#38bdf8",
            "Monster / Feinde": "#ef4444",
            "Fraktion 3": "#eab308",
            "Fraktion 4": "#a855f7"
        }
    }
};

// Für Würfel Knopf Cooldown
let lastRollTime = 0;
const ROLL_COOLDOWN_MS = 1000; // 1000 Millisekunden = 1 Sekunde Sperre


// Zwischenspeicher für Lobby-Dateien (vor dem Klick auf Start/Beitreten)
let pendingResumeSessionData = null;
let pendingPlayerCharData = null;

function createNewCharacter(id, name) {
    return {
        id: id,
        name: name,
        origin: "Unbekannte Epoche",
        alignment: "Neutral (True Neutral)",
        avatar: "",
        backstory: "",
        notes: "",
        level: 1,
        hp: 10,
        maxHp: 10,
        ac: 10,
        initiative: 0,
        proficiency: 2,
        exhaustion: 0,
        morality: 0,
        moralityVisible: false,
        bagInfinite: false,    // Nur vom DM steuerbar: Unendlicher Beutelplatz
        bagCustomMax: null,    // null = Automatisch 15 + STR, sonst DM-Wert
        stats: {
            str: 10,
            dex: 10,
            con: 10,
            int: 10,
            wis: 10,
            cha: 10
        },
        affinities: [],
        currency: { cp: 0, sp: 0, gp: 0, pp: 0 },
        items: [],
        attacks: []
    };
}

// =========================================================
// BEUTEL-KAPAZITÄT & PACKMASS (1 - 10)
// =========================================================
function clampPackmass(val) {
    const num = parseInt(val);
    if (isNaN(num)) return 1;
    return Math.min(10, Math.max(1, num));
}

// Berechnet das aktuell belegte Packmaß aller Gegenstände eines Spielers
function getPlayerBagUsed(char) {
    if (!char || !Array.isArray(char.items)) return 0;
    return char.items.reduce((sum, item) => sum + clampPackmass(item.packmass), 0);
}

// Berechnet den maximalen Beutelplatz (Standard: 15 + STR, oder DM-Wert, oder Unendlich)
function getPlayerBagMax(char) {
    if (!char) return 25;
    if (char.bagInfinite) return Infinity;
    if (char.bagCustomMax !== null && char.bagCustomMax !== undefined && char.bagCustomMax !== "") {
        return Math.max(0, parseInt(char.bagCustomMax) || 0);
    }
    const strScore = parseInt(char.stats?.str) || 10;
    return 15 + strScore;
}

// Prüft, ob ein neuer Gegenstand noch in den Beutel des Spielers passt
function canAddItemToPlayerBag(char, itemPackmass) {
    if (!char) return false;
    if (char.bagInfinite) return true;
    const used = getPlayerBagUsed(char);
    const max = getPlayerBagMax(char);
    const cost = clampPackmass(itemPackmass);
    return (used + cost) <= max;
}

// =========================================================
// ZENTRALES BESTÄTIGUNGS-MODAL ("Bist du dir sicher?")
// =========================================================
let pendingConfirmAction = null;

function openConfirmModal(message, onConfirm) {
    const modal = document.getElementById('confirm-modal');
    const msgEl = document.getElementById('confirm-modal-message');
    if (!modal || !msgEl) return;

    msgEl.textContent = message || "Möchtest du diese Aktion wirklich durchführen?";
    pendingConfirmAction = onConfirm;
    modal.classList.remove('hidden');
}

function closeConfirmModal() {
    const modal = document.getElementById('confirm-modal');
    if (modal) modal.classList.add('hidden');
    pendingConfirmAction = null;
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn-confirm-cancel')?.addEventListener('click', closeConfirmModal);
    document.getElementById('btn-confirm-yes')?.addEventListener('click', () => {
        const fn = pendingConfirmAction;
        closeConfirmModal();
        if (typeof fn === 'function') fn();
    });
});

// =========================================================
// SCHRITT 7: LOKALES SPEICHERN & LADEN PER DATEI (.JSON)
// =========================================================
function downloadJsonFile(dataObj, filename) {
    const jsonStr = JSON.stringify(dataObj, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// 1. SPIELER: Speichert den kompletten Charakter inkl. Kopien aller Items, Attacken & Merkmale
function exportPlayerCharToFile() {
    const char = gameState.characters[currentPlayerId];
    if (!char) return alert("Kein Charakter zum Speichern gefunden!");
    const safeName = (char.name || 'charakter').toLowerCase().replace(/[^a-z0-9]/g, '_');
    const exportPayload = {
        _type: 'AFTERLIFE_CHARACTER',
        exportedAt: new Date().toISOString(),
        character: JSON.parse(JSON.stringify(char))
    };
    downloadJsonFile(exportPayload, `charakter_${safeName}.json`);
}

// 2. DM: Speichert die komplette Session (Raum-Code, alle Spieler, Monster/NPCs, Vorlagen & Bibliothek)
function exportDmSessionToFile() {
    const code = gameState.roomCode || 'session';
    const exportPayload = {
        _type: 'AFTERLIFE_SESSION',
        exportedAt: new Date().toISOString(),
        roomCode: gameState.roomCode,
        state: JSON.parse(JSON.stringify(gameState))
    };
    downloadJsonFile(exportPayload, `afterlife_session_${code}.json`);
}

// 3. BIBLIOTHEKS-ABGLEICH: Fügt Gegenstände, Attacken & Merkmale eines geladenen Charakters duplikatfrei zur Session-Bibliothek hinzu
function mergeCharacterIntoSessionLibrary(char) {
    if (!char) return;

    if (!gameState.customItems) gameState.customItems = [];
    if (!gameState.customAttacks) gameState.customAttacks = [];
    if (!gameState.customAffinities) gameState.customAffinities = [];

    (char.items || []).forEach(item => {
        if (!item || !item.name) return;
        const exists = gameState.customItems.some(i => i.name.trim().toLowerCase() === item.name.trim().toLowerCase());
        if (!exists) {
            gameState.customItems.push(JSON.parse(JSON.stringify(item)));
        }
    });

    (char.attacks || []).forEach(atk => {
        if (!atk || !atk.name) return;
        const exists = gameState.customAttacks.some(a => a.name.trim().toLowerCase() === atk.name.trim().toLowerCase());
        if (!exists) {
            gameState.customAttacks.push(JSON.parse(JSON.stringify(atk)));
        }
    });

    (char.affinities || []).forEach(aff => {
        if (!aff || !aff.name) return;
        const exists = gameState.customAffinities.some(af => af.name.trim().toLowerCase() === aff.name.trim().toLowerCase());
        if (!exists) {
            gameState.customAffinities.push(JSON.parse(JSON.stringify(aff)));
        }
    });
}

// 4. DRAG & DROP FÜR JSON-DATEIEN (Für Lobby & Spieler-Menü)
function bindJsonDropZone(dropZoneId, fileInputId, onJsonReady) {
    const zone = document.getElementById(dropZoneId);
    const input = document.getElementById(fileInputId);
    if (!zone || !input) return;

    const readJson = (file) => {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const parsed = JSON.parse(reader.result);
                onJsonReady(parsed, file.name);
            } catch (err) {
                alert("Fehler: Die Datei ist keine gültige JSON-Speicherdatei!");
            }
        };
        reader.readAsText(file);
    };

    zone.addEventListener('click', (e) => {
        if (e.target.tagName !== 'BUTTON') input.click();
    });

    input.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) readJson(e.target.files[0]);
    });

    zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        zone.classList.add('drag-over');
    });

    zone.addEventListener('dragleave', () => {
        zone.classList.remove('drag-over');
    });

    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('drag-over');
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            readJson(e.dataTransfer.files[0]);
        }
    });
}

// =========================================================
// KUPFER-UMRECHNUNG (10:1 SYSTEM FÜR MONSTER / NPCS)
// =========================================================
function convertCopperToCoins(copperValue) {
    let total = Math.max(0, parseInt(copperValue) || 0);
    const pp = Math.floor(total / 1000);
    total %= 1000;
    const gp = Math.floor(total / 100);
    total %= 100;
    const sp = Math.floor(total / 10);
    const cp = total % 10;
    return { pp, gp, sp, cp, totalCopper: Math.max(0, parseInt(copperValue) || 0) };
}

function formatCopperCoins(copperValue) {
    const c = convertCopperToCoins(copperValue);
    return `<span class="coin-pp"><strong>${c.pp}</strong> PP</span> · <span class="coin-gp"><strong>${c.gp}</strong> GP</span> · <span class="coin-sp"><strong>${c.sp}</strong> SP</span> · <span class="coin-cp"><strong>${c.cp}</strong> CP</span> <small class="muted">(${c.totalCopper} CP)</small>`;
}

// =========================================================
// UNIVERSELLER WÜRFEL-RECHNER
// =========================================================
function animateDiceButton(btnEl) {
    const target = btnEl || (typeof event !== 'undefined' && event?.currentTarget ? event.currentTarget : null);
    if (!target || !target.classList) return;
    target.classList.remove('dice-shake-anim');
    void target.offsetWidth;
    target.classList.add('dice-shake-anim');
}

function evaluateDiceFormula(formulaStr, mode = 'normal') {
    const clean = (formulaStr || '1d20').replace(/\s+/g, '').toLowerCase();
    const match = clean.match(/^(\d*)d(\d+)([+-]\d+)?$/);

    let count = 1, sides = 20, mod = 0;
    if (match) {
        count = parseInt(match[1]) || 1;
        sides = parseInt(match[2]) || 20;
        mod = match[3] ? parseInt(match[3]) : 0;
    } else {
        const partial = clean.match(/(\d*)d(\d+)/);
        if (partial) {
            count = parseInt(partial[1]) || 1;
            sides = parseInt(partial[2]) || 6;
        }
        const modMatch = clean.replace(/(\d*)d(\d+)/, '').match(/([+-]\d+)/);
        if (modMatch) mod = parseInt(modMatch[1]) || 0;
    }

    count = Math.min(Math.max(count, 1), 50);
    sides = Math.max(sides, 2);

    let rolls = [];
    let detailHtml = '';
    let isCrit = false;
    let isFumble = false;
    let diceSum = 0;

    if (count === 1 && sides === 20 && (mode === 'adv' || mode === 'dis')) {
        const r1 = Math.floor(Math.random() * 20) + 1;
        const r2 = Math.floor(Math.random() * 20) + 1;
        const pickFirst = mode === 'adv' ? (r1 >= r2) : (r1 <= r2);
        const chosen = pickFirst ? r1 : r2;

        diceSum = chosen;
        isCrit = chosen === 20;
        isFumble = chosen === 1;

        const r1Html = pickFirst ? `<strong class="roll-kept">${r1}</strong>` : `<s class="roll-dropped">${r1}</s>`;
        const r2Html = !pickFirst ? `<strong class="roll-kept">${r2}</strong>` : `<s class="roll-dropped">${r2}</s>`;
        const modeLabel = mode === 'adv' ? 'Vorteil' : 'Nachteil';
        detailHtml = `${modeLabel} [${r1Html}, ${r2Html}] ➔ ${chosen}`;
    } else {
        for (let i = 0; i < count; i++) {
            rolls.push(Math.floor(Math.random() * sides) + 1);
        }
        diceSum = rolls.reduce((a, b) => a + b, 0);
        if (count === 1 && sides === 20) {
            isCrit = rolls[0] === 20;
            isFumble = rolls[0] === 1;
        }
        detailHtml = `[${rolls.join(', ')}]`;
    }

    const total = diceSum + mod;
    const modStr = mod > 0 ? `+${mod}` : mod < 0 ? `${mod}` : '';
    if (modStr) detailHtml += ` ${modStr}`;

    return {
        formula: `${count}d${sides}${modStr}`,
        detailHtml: detailHtml,
        total: total,
        crit: isCrit,
        fumble: isFumble
    };
}

function triggerUniversalRoll(formula, label = 'Wurf', rollerOverride = null, btnEl = null) {

    // 1. Ausnahme: Beim Sammel-Wurf für die Kampf-Initiative würfelt der DM für alle gleichzeitig
    if (label !== 'Initiative') {
        const now = Date.now();
        if (now - lastRollTime < ROLL_COOLDOWN_MS) {
            return null; // Cooldown noch aktiv -> Wurf sofort abbrechen!
        }
        lastRollTime = now;
    }

    // 2. Verhindert das Gedrückthalten von Enter / Leertaste auf einem Button
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
    }

    // 3. Optional: Den geklickten Button für die Dauer des Cooldowns kurz deaktivieren
    if (btnEl) {
        btnEl.disabled = true;
        setTimeout(() => {
            btnEl.disabled = false;
        }, ROLL_COOLDOWN_MS);
    }

    animateDiceButton(btnEl);

    const modeSelect = document.getElementById('dice-roll-mode');
    const secretCheck = document.getElementById('dice-secret-check');
    const mode = modeSelect ? modeSelect.value : 'normal';
    const isSecret = secretCheck ? secretCheck.checked : false;

    const result = evaluateDiceFormula(formula, mode);
    let rollerName = rollerOverride;
    if (!rollerName) {
        if (currentPlayerId && gameState.characters[currentPlayerId]) {
            rollerName = gameState.characters[currentPlayerId].name;
        } else {
            rollerName = "DM";
        }
    }

    const entry = {
        id: Date.now() + Math.random(),
        roller: rollerName,
        label: label,
        formula: result.formula,
        detailHtml: result.detailHtml,
        total: result.total,
        crit: result.crit,
        fumble: result.fumble,
        secret: isSecret && !currentPlayerId
    };

    if (typeof submitRollEntry === 'function') {
        submitRollEntry(entry);
    }
    return entry;
}

function quickRollDie(sides, btnEl) {
    triggerUniversalRoll(`1d${sides}`, `Würfel d${sides}`, null, btnEl);
}

function rollFromFormulaInput(btnEl) {
    const input = document.getElementById('dice-formula-input');
    const formula = input.value.trim() || '1d20';
    triggerUniversalRoll(formula, 'Freier Wurf', null, btnEl);
}

function renderDiceLogStrip() {
    const strip = document.getElementById('dice-log-strip');
    if (!strip) return;

    const isPlayer = Boolean(currentPlayerId);
    const visibleLogs = (gameState.diceLog || []).filter(entry => !(isPlayer && entry.secret));

    if (visibleLogs.length === 0) {
        strip.innerHTML = `<span class="muted">Noch keine Würfe. Klicke oben auf d20 oder auf ein Attribut/Attacke!</span>`;
        return;
    }

    strip.innerHTML = visibleLogs.slice(0, 6).map((entry, idx) => {
        let badgeClass = idx === 0 ? 'roll-pill-latest ' : '';
        if (entry.crit) badgeClass += 'roll-crit';
        else if (entry.fumble) badgeClass += 'roll-fumble';
        else if (entry.secret) badgeClass += 'roll-secret';

        return `
            <div class="roll-pill ${badgeClass}">
                <span class="roll-who">${entry.secret ? '🔒 ' : ''}${entry.roller}</span>
                <span class="roll-what">${entry.label}:</span>
                <strong class="roll-total">${entry.total}</strong>
                <small class="roll-detail">${entry.detailHtml || entry.detail || ''}</small>
            </div>
        `;
    }).join('');
}

function bindImageDropZone(dropZoneId, fileInputId, onImageReady) {
    const zone = document.getElementById(dropZoneId);
    const input = document.getElementById(fileInputId);
    if (!zone || !input) return;

    const readFile = (file) => {
        if (!file || !file.type.startsWith('image/')) return;
        const reader = new FileReader();
        reader.onload = () => onImageReady(reader.result);
        reader.readAsDataURL(file);
    };

    zone.addEventListener('click', (e) => {
        if (e.target.tagName !== 'BUTTON') input.click();
    });

    input.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) readFile(e.target.files[0]);
    });

    zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        zone.classList.add('drag-over');
    });

    zone.addEventListener('dragleave', () => {
        zone.classList.remove('drag-over');
    });

    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('drag-over');
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            readFile(e.dataTransfer.files[0]);
        }
    });
}
// =========================================================
// BATTLEMAP: 2 ZEIGER-MODI (BEWEGEN & BAUEN), PAN & CURSOR-ZOOM
// =========================================================
let battlemapZoom = 1.0;
let battlemapPanX = 0;
let battlemapPanY = 0;
let battlemapViewInitialized = false;

let isPanningBattlemap = false;
let panStartMouseX = 0;
let panStartMouseY = 0;
let panStartOffsetX = 0;
let panStartOffsetY = 0;

let isPaintingBattlemap = false;
let didPaintChange = false;

function ensureBattlemapState() {
    if (!gameState.combat) {
        gameState.combat = { active: false, round: 1, turnIndex: 0, order: [], teams: {}, battlemapVisibleToPlayers: false };
    }
    if (gameState.combat.battlemapVisibleToPlayers === undefined) {
        gameState.combat.battlemapVisibleToPlayers = false;
    }
    if (!gameState.combat.teams || Object.keys(gameState.combat.teams).length === 0) {
        gameState.combat.teams = { "Helden": "#38bdf8", "Monster / Feinde": "#ef4444" };
    }
    if (!Array.isArray(gameState.mapTemplates)) {
        gameState.mapTemplates = [];
    }
    if (!gameState.combat.map) {
        gameState.combat.map = {
            rows: 6,
            cols: 6,
            cells: {},
            palette: [
                { id: 'block_gray', name: 'Pures Grau', color: '#3f3f46', isDefault: true }
            ],
            selectedBlockId: null // Startet im Bewegungsmodus (kein Block aktiv)
        };
    }
    const map = gameState.combat.map;
    if (!Array.isArray(map.palette) || map.palette.length === 0) {
        map.palette = [{ id: 'block_gray', name: 'Pures Grau', color: '#3f3f46', isDefault: true }];
    }
    if (!map.palette.some(b => b.id === 'block_gray')) {
        map.palette.unshift({ id: 'block_gray', name: 'Pures Grau', color: '#3f3f46', isDefault: true });
    }
    // Falls ein gelöschter Block noch ausgewählt war -> zurück in Bewegungsmodus (null)
    if (map.selectedBlockId && !map.palette.some(b => b.id === map.selectedBlockId)) {
        map.selectedBlockId = null;
    }
    if (!map.cells || typeof map.cells !== 'object') {
        map.cells = {};
    }

    (gameState.combat.order || []).forEach(entry => {
        const outOfBounds =
            typeof entry.row !== 'number' ||
            typeof entry.col !== 'number' ||
            entry.row < 0 || entry.row >= map.rows ||
            entry.col < 0 || entry.col >= map.cols;

        if (outOfBounds) {
            const free = findFirstFreeGridCell(entry.key);
            entry.row = free.row;
            entry.col = free.col;
        }
    });
}

function isDmInBuildMode() {
    ensureBattlemapState();
    return Boolean(!currentPlayerId && gameState.combat.map.selectedBlockId);
}

function findFirstFreeGridCell(ignoreKey = null) {
    const map = gameState.combat?.map || { rows: 6, cols: 6 };
    const occupied = new Set();
    (gameState.combat?.order || []).forEach(e => {
        if (e.key !== ignoreKey && typeof e.row === 'number' && typeof e.col === 'number') {
            occupied.add(`${e.row}_${e.col}`);
        }
    });

    for (let r = 0; r < map.rows; r++) {
        for (let c = 0; c < map.cols; c++) {
            if (!occupied.has(`${r}_${c}`)) {
                return { row: r, col: c };
            }
        }
    }
    return { row: 0, col: 0 };
}

function getBlockForCell(r, c) {
    ensureBattlemapState();
    const map = gameState.combat.map;
    const blockId = map.cells[`${r}_${c}`] || 'block_gray';
    return map.palette.find(b => b.id === blockId) || map.palette[0];
}

function resolveCombatantShared(entry) {
    if (!entry) return null;
    if (entry.kind === 'player') {
        return gameState.characters[entry.id] || null;
    } else {
        const byUid = (gameState.enemies || []).findIndex(e => e._uid === entry.key);
        if (byUid !== -1) {
            entry.idx = byUid;
            return gameState.enemies[byUid];
        }
        return null;
    }
}

// =========================================================
// KAMERA-PAN & ZOOM ZUM MAUSZEIGER
// =========================================================
function applyBattlemapTransformToDom() {
    const planeEl = document.getElementById('battlemap-pan-zoom-plane');
    const gridEl = document.getElementById('active-battlemap-grid');
    const labelEl = document.getElementById('battlemap-zoom-label');

    if (planeEl) {
        planeEl.style.transform = `translate(${battlemapPanX}px, ${battlemapPanY}px) scale(${battlemapZoom})`;
    }
    if (gridEl && gameState.combat && gameState.combat.map) {
        gridEl.style.gridTemplateColumns = `repeat(${gameState.combat.map.cols}, 74px)`;
        gridEl.style.gridTemplateRows = `repeat(${gameState.combat.map.rows}, 74px)`;
    }
    if (labelEl) {
        labelEl.textContent = `🔍 ${Math.round(battlemapZoom * 100)}%`;
    }
}


function centerBattlemapInViewport() {
    const wrapper = document.getElementById('battlemap-stage-wrapper');
    const map = gameState.combat?.map || { rows: 6, cols: 6 };
    if (!wrapper) return;

    const rect = wrapper.getBoundingClientRect();
    const gridW = map.cols * 74 + (map.cols - 1) * 5;
    const gridH = map.rows * 74 + (map.rows - 1) * 5;

    battlemapPanX = Math.round((rect.width - gridW * battlemapZoom) / 2);
    battlemapPanY = Math.round((rect.height - gridH * battlemapZoom) / 2);
    battlemapViewInitialized = true;
    applyBattlemapTransformToDom();
}

function initBattlemapViewport() {
    if (!battlemapViewInitialized) {
        requestAnimationFrame(() => centerBattlemapInViewport());
    } else {
        applyBattlemapTransformToDom();
    }
}

function zoomBattlemapAtPoint(newZoom, focalX, focalY) {
    const clampedZoom = Math.max(0.35, Math.min(2.6, Math.round(newZoom * 100) / 100));
    if (clampedZoom === battlemapZoom) return;

    // Punkt im unskalierten Spielfeld unter dem Mauszeiger festhalten
    const worldX = (focalX - battlemapPanX) / battlemapZoom;
    const worldY = (focalY - battlemapPanY) / battlemapZoom;

    battlemapZoom = clampedZoom;
    battlemapPanX = Math.round(focalX - worldX * battlemapZoom);
    battlemapPanY = Math.round(focalY - worldY * battlemapZoom);
    battlemapViewInitialized = true;

    applyBattlemapTransformToDom();
}

function changeBattlemapZoom(delta) {
    const wrapper = document.getElementById('battlemap-stage-wrapper');
    if (wrapper) {
        const rect = wrapper.getBoundingClientRect();
        zoomBattlemapAtPoint(battlemapZoom + delta, rect.width / 2, rect.height / 2);
    } else {
        zoomBattlemapAtPoint(battlemapZoom + delta, 300, 300);
    }
}

function resetBattlemapZoom() {
    battlemapZoom = 1.0;
    centerBattlemapInViewport();
}

function handleBattlemapWheel(e) {
    e.preventDefault();
    const wrapper = e.currentTarget;
    const rect = wrapper.getBoundingClientRect();

    // Position des Mauszeigers innerhalb des Spielfeld-Fensters
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    zoomBattlemapAtPoint(battlemapZoom * factor, mouseX, mouseY);
}

// =========================================================
// MODUS 1: VERSCHIEBEN (PANNING) & MODUS 2: BAUMODUS (MALEN)
// =========================================================
function handleBattlemapStagePointerDown(e, isDmView) {
    if (e.button !== 0) return;

    // Wenn ein Token angeklickt wurde, übernimmt das Token-Drag-System
    if (e.target && e.target.closest('.battlemap-token')) return;

    const buildMode = isDmView && Boolean(gameState.combat?.map?.selectedBlockId);
    const clickedCell = e.target ? e.target.closest('.battlemap-cell') : null;

    // DM im Baumodus + Klick auf eine Zelle -> Malen!
    if (buildMode && clickedCell) {
        e.preventDefault();
        isPaintingBattlemap = true;
        didPaintChange = false;
        paintCellFromElement(clickedCell);

        window.addEventListener('pointermove', onBattlemapPaintMove);
        window.addEventListener('pointerup', onBattlemapPaintEnd);
        return;
    }

    // Sonst: Verschieben- & Bewegungsmodus (Kamera frei in jede Richtung ziehen)
    e.preventDefault();
    isPanningBattlemap = true;
    battlemapViewInitialized = true;
    panStartMouseX = e.clientX;
    panStartMouseY = e.clientY;
    panStartOffsetX = battlemapPanX;
    panStartOffsetY = battlemapPanY;

    const wrapper = document.getElementById('battlemap-stage-wrapper');
    if (wrapper) wrapper.classList.add('is-panning');

    window.addEventListener('pointermove', onBattlemapPanMove);
    window.addEventListener('pointerup', onBattlemapPanEnd);
}

function onBattlemapPanMove(e) {
    if (!isPanningBattlemap) return;
    battlemapPanX = Math.round(panStartOffsetX + (e.clientX - panStartMouseX));
    battlemapPanY = Math.round(panStartOffsetY + (e.clientY - panStartMouseY));
    applyBattlemapTransformToDom();
}

function onBattlemapPanEnd() {
    if (!isPanningBattlemap) return;
    isPanningBattlemap = false;
    const wrapper = document.getElementById('battlemap-stage-wrapper');
    if (wrapper) wrapper.classList.remove('is-panning');

    window.removeEventListener('pointermove', onBattlemapPanMove);
    window.removeEventListener('pointerup', onBattlemapPanEnd);
}

function paintCellFromElement(cellEl) {
    if (!cellEl) return;
    const r = parseInt(cellEl.getAttribute('data-row'));
    const c = parseInt(cellEl.getAttribute('data-col'));
    if (isNaN(r) || isNaN(c)) return;

    ensureBattlemapState();
    const map = gameState.combat.map;
    const selectedId = map.selectedBlockId;
    if (!selectedId) return;

    const currentId = map.cells[`${r}_${c}`] || 'block_gray';
    if (currentId !== selectedId) {
        map.cells[`${r}_${c}`] = selectedId;
        didPaintChange = true;
    }

    const block = map.palette.find(b => b.id === selectedId) || map.palette[0];
    if (block) {
        cellEl.style.backgroundColor = block.color;
        cellEl.title = `${block.name} (${r + 1}, ${c + 1})`;
    }
}

function onBattlemapPaintMove(e) {
    if (!isPaintingBattlemap) return;
    const elUnder = document.elementFromPoint(e.clientX, e.clientY);
    const cellEl = elUnder ? elUnder.closest('.battlemap-cell') : null;
    if (cellEl) {
        paintCellFromElement(cellEl);
    }
}

function onBattlemapPaintEnd() {
    if (!isPaintingBattlemap) return;
    isPaintingBattlemap = false;
    window.removeEventListener('pointermove', onBattlemapPaintMove);
    window.removeEventListener('pointerup', onBattlemapPaintEnd);

    if (didPaintChange) {
        didPaintChange = false;
        broadcastState();
    }
}

// =========================================================
// GEMEINSAME OBERE ZUG-LEISTE & GRID-RENDERER
// =========================================================
function buildTopTurnBarHtml(isDmView) {
    ensureBattlemapState();
    const order = gameState.combat.order || [];
    const turnIdx = gameState.combat.turnIndex || 0;
    const activeEntry = order[turnIdx] || null;
    const activeActor = resolveCombatantShared(activeEntry);
    const activeTeamColor = activeEntry ? (gameState.combat.teams[activeEntry.teamName] || '#38bdf8') : '#3f3f46';

    const upcoming = [];
    if (order.length > 1) {
        const count = Math.min(3, order.length - 1);
        for (let step = 1; step <= count; step++) {
            const idx = (turnIdx + step) % order.length;
            const entry = order[idx];
            const actor = resolveCombatantShared(entry);
            if (actor) {
                upcoming.push({
                    entry,
                    actor,
                    color: gameState.combat.teams[entry.teamName] || '#3f3f46'
                });
            }
        }
    }
    const hasMoreEllipsis = order.length > 4;
    const visibleToPlayers = Boolean(gameState.combat.battlemapVisibleToPlayers);

    return `
        <div class="card combat-top-strip">
            <div class="turn-strip-sequence">
                ${activeActor ? `
                    <div class="turn-active-card" style="border-color: ${activeTeamColor}; box-shadow: 0 0 14px ${activeTeamColor}40;">
                        ${activeActor.avatar
        ? `<img src="${activeActor.avatar}" class="turn-active-avatar" style="border-color: ${activeTeamColor};">`
        : `<div class="turn-active-avatar turn-avatar-placeholder" style="border-color: ${activeTeamColor};">${activeActor.name[0]}</div>`
    }
                        <div class="turn-active-info">
                            <span class="turn-indicator-pill">▶ AM ZUG</span>
                            <strong>${activeActor.name}</strong>
                            <small class="muted">${activeEntry.teamName} · Init ${activeEntry.initiative}</small>
                        </div>
                    </div>
                ` : `
                    <div class="turn-empty-pill">Noch kein aktiver Kämpfer im Zug</div>
                `}

                ${upcoming.length > 0 ? `<span class="turn-arrow-sep">➔</span>` : ''}

                <div class="turn-upcoming-list">
                    ${upcoming.map(u => `
                        <div class="turn-next-card" style="border-left: 4px solid ${u.color};">
                            ${u.actor.avatar
        ? `<img src="${u.actor.avatar}" class="turn-next-avatar" style="border-color: ${u.color};">`
        : `<div class="turn-next-avatar turn-avatar-placeholder" style="border-color: ${u.color};">${u.actor.name[0]}</div>`
    }
                            <div class="turn-next-meta">
                                <strong>${u.actor.name}</strong>
                                <small>Init ${u.entry.initiative}</small>
                            </div>
                        </div>
                    `).join('')}
                    ${hasMoreEllipsis ? `<div class="turn-ellipsis-badge" title="Weitere Kämpfer in der Reihenfolge">…</div>` : ''}
                </div>
            </div>

            <div class="turn-strip-controls">
                <div class="round-badge">
                    <span>RUNDE</span>
                    <strong>${gameState.combat.round || 1}</strong>
                </div>
                ${isDmView ? `
                    <label class="dm-checkbox-label battlemap-vis-toggle ${visibleToPlayers ? 'vis-on' : 'vis-off'}" title="Schaltet den 4. Tab (Kampffeld) für alle Spieler ein oder aus">
                        <input type="checkbox" ${visibleToPlayers ? 'checked' : ''} onchange="dmToggleBattlemapVisibility(this.checked)">
                        👁️ Für Spieler ${visibleToPlayers ? 'sichtbar' : 'ausgeblendet'}
                    </label>
                    <button type="button" onclick="changeCombatTurn(-1)">◀ Vorheriger</button>
                    <button type="button" class="btn-primary btn-next-turn" onclick="changeCombatTurn(1)">Nächster Zug ▶</button>
                    <button type="button" class="btn-secondary" onclick="syncPlayersOnlyIntoCombat()" title="Alle verbundenen Spieler in den Kampf holen">🔄 Spieler-Sync</button>
                    <button type="button" onclick="rollInitiativeFor('enemies', this)">🎲 Monster-Init</button>
                    <button type="button" onclick="rollInitiativeFor('all', this)">🎲 Alle Init</button>
                    ${order.length > 0 || gameState.combat.active ? `<button type="button" class="btn-del" onclick="endCombatSession()">Kampf beenden</button>` : ''}
                ` : `
                    <span class="mode-status-pill mode-pill-move">🖐️ Verschieben- & Bewegungsmodus</span>
                `}
            </div>
        </div>
    `;
}

function buildBattlemapZoomControlsHtml() {
    const pct = Math.round(battlemapZoom * 100);
    return `
        <div class="battlemap-zoom-bar">
            <button type="button" onclick="changeBattlemapZoom(-0.15)" title="Rauszoomen">🔍 −</button>
            <button type="button" id="battlemap-zoom-label" onclick="resetBattlemapZoom()" title="Auf 100% & Mitte zentrieren">🔍 ${pct}%</button>
            <button type="button" onclick="changeBattlemapZoom(0.15)" title="Reinzoomen">🔍 +</button>
        </div>
    `;
}

function buildBattlemapGridCellsHtml(isDmView) {
    ensureBattlemapState();
    const map = gameState.combat.map;
    const order = gameState.combat.order || [];
    const activeKey = order[gameState.combat.turnIndex]?.key || null;
    const buildMode = isDmView && Boolean(map.selectedBlockId);

    let html = '';
    for (let r = 0; r < map.rows; r++) {
        for (let c = 0; c < map.cols; c++) {
            const block = getBlockForCell(r, c);
            const tokensHere = order.filter(e => e.row === r && e.col === c);

            html += `
                <div class="battlemap-cell"
                     data-row="${r}"
                     data-col="${c}"
                     style="background-color: ${block.color};"
                     title="${block.name} (${r + 1}, ${c + 1})"
                     ${isDmView ? `
                         ondragover="dmHandleCellDragOver(event)"
                         ondragleave="dmHandleCellDragLeave(event)"
                         ondrop="dmHandleCellDrop(event, ${r}, ${c})"
                     ` : ''}>
                    <span class="cell-coord-hint">${r + 1},${c + 1}</span>
                    ${tokensHere.map(entry => {
                const actor = resolveCombatantShared(entry);
                if (!actor) return '';
                const teamColor = gameState.combat.teams[entry.teamName] || '#38bdf8';
                const isActiveTurn = entry.key === activeKey;
                // Im Baumodus lassen Tokens den Pinsel durch; im Bewegungsmodus sind sie ziehbar
                const canDrag = !buildMode && (isDmView || (entry.kind === 'player' && entry.id === currentPlayerId));
                const isDown = actor.hp <= 0;
                
                const myCombatEntry = (gameState.combat.order || []).find(e => e.kind === 'player' && e.id === currentPlayerId);
                const myTeam = myCombatEntry ? myCombatEntry.teamName : 'Helden';
                
                const canSeeHp = isDmView || (entry.teamName === myTeam);
                
                return `
                            <div class="battlemap-token ${isActiveTurn ? 'token-active-turn' : ''} ${canDrag ? 'token-can-drag' : 'token-locked'} ${buildMode ? 'token-passthrough' : ''} ${isDown ? 'token-down' : ''}"
                                 data-token-key="${entry.key}"
                                 style="border-color: ${teamColor};"
                                 ${canDrag ? `onpointerdown="startTokenCarryDrag(event, '${entry.key}', ${isDmView})"` : ''}
                                 title="${actor.name} (${entry.teamName})${canSeeHp ? ` • HP: ${actor.hp}/${actor.maxHp}` : ''}">
                                ${actor.avatar
                    ? `<img src="${actor.avatar}" class="token-avatar-img" draggable="false">`
                    : `<div class="token-initials">${actor.name.substring(0, 2).toUpperCase()}</div>`
                }
                                <div class="token-label-bar">
                                    <span class="token-name-text">${actor.name}</span>
                                    ${canSeeHp ? `<span class="token-hp-text">${actor.hp}/${actor.maxHp}</span>` : ''}
                                </div>
                            </div>
                        `;
            }).join('')}
                </div>
            `;
        }
    }
    return html;
}

// Live Pointer-Trage-System für Tokens mit Links-Rechts-Schwank-Animation
let activeTokenDrag = null;

function startTokenCarryDrag(e, tokenKey, isDmView) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();

    const tokenEl = e.currentTarget;
    const rect = tokenEl.getBoundingClientRect();

    const ghost = tokenEl.cloneNode(true);
    ghost.classList.add('token-drag-floating-ghost');
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    ghost.style.left = `${e.clientX - rect.width / 2}px`;
    ghost.style.top = `${e.clientY - rect.height / 2}px`;
    document.body.appendChild(ghost);

    tokenEl.classList.add('token-source-picked-up');

    activeTokenDrag = {
        tokenKey,
        isDmView,
        ghost,
        sourceEl: tokenEl,
        width: rect.width,
        height: rect.height,
        lastHoverCell: null
    };

    window.addEventListener('pointermove', onTokenCarryMove);
    window.addEventListener('pointerup', onTokenCarryEnd);
}

function onTokenCarryMove(e) {
    if (!activeTokenDrag) return;
    const { ghost, width, height } = activeTokenDrag;
    ghost.style.left = `${e.clientX - width / 2}px`;
    ghost.style.top = `${e.clientY - height / 2}px`;

    const elUnder = document.elementFromPoint(e.clientX, e.clientY);
    const cell = elUnder ? elUnder.closest('.battlemap-cell') : null;

    if (activeTokenDrag.lastHoverCell && activeTokenDrag.lastHoverCell !== cell) {
        activeTokenDrag.lastHoverCell.classList.remove('cell-drop-hover');
    }
    if (cell) {
        cell.classList.add('cell-drop-hover');
        activeTokenDrag.lastHoverCell = cell;
    }
}

function onTokenCarryEnd(e) {
    if (!activeTokenDrag) return;
    const { tokenKey, isDmView, ghost, sourceEl, lastHoverCell } = activeTokenDrag;

    window.removeEventListener('pointermove', onTokenCarryMove);
    window.removeEventListener('pointerup', onTokenCarryEnd);

    if (lastHoverCell) lastHoverCell.classList.remove('cell-drop-hover');
    if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
    if (sourceEl) sourceEl.classList.remove('token-source-picked-up');

    const elUnder = document.elementFromPoint(e.clientX, e.clientY);
    const targetCell = elUnder ? elUnder.closest('.battlemap-cell') : null;

    activeTokenDrag = null;

    if (!targetCell) return;
    const newRow = parseInt(targetCell.getAttribute('data-row'));
    const newCol = parseInt(targetCell.getAttribute('data-col'));
    if (isNaN(newRow) || isNaN(newCol)) return;

    const entry = (gameState.combat?.order || []).find(en => en.key === tokenKey);
    if (!entry) return;

    entry.row = newRow;
    entry.col = newCol;

    if (isDmView) {
        broadcastState();
        renderDmView();
    } else {
        renderPlayerView(currentPlayerId);
        if (hostConnection && hostConnection.open) {
            hostConnection.send({
                type: 'MOVE_TOKEN',
                key: tokenKey,
                playerId: currentPlayerId,
                row: newRow,
                col: newCol
            });
        }
    }
}
// =========================================================
// ZAUBER (SPELLS) & DM-NOTIZEN INITIALISIERUNG
// =========================================================
function ensureSpellsAndDmNotesState() {
    if (!Array.isArray(gameState.customSpells)) {
        gameState.customSpells = [];
    }
    if (!gameState.dmNotes || typeof gameState.dmNotes !== 'object') {
        gameState.dmNotes = {
            quick: "",
            story: "",
            secrets: "",
            world: "",
            entries: []
        };
    }
    if (!Array.isArray(gameState.dmNotes.entries)) {
        gameState.dmNotes.entries = [];
    }

    // Sicherstellen, dass alle Spieler & Monster ein spells-Array besitzen
    Object.values(gameState.characters || {}).forEach(c => {
        if (!Array.isArray(c.spells)) c.spells = [];
    });
    (gameState.enemies || []).forEach(e => {
        if (!Array.isArray(e.spells)) e.spells = [];
    });
    (gameState.npcTemplates || []).forEach(t => {
        if (!Array.isArray(t.spells)) t.spells = [];
    });
}

// Erweitert den Bibliotheks-Abgleich beim Charakter-Import automatisch um Zauber
const _origMergeCharLib = typeof mergeCharacterIntoSessionLibrary === 'function' ? mergeCharacterIntoSessionLibrary : null;
mergeCharacterIntoSessionLibrary = function(char) {
    ensureSpellsAndDmNotesState();
    if (_origMergeCharLib) {
        _origMergeCharLib(char);
    }
    (char.spells || []).forEach(sp => {
        if (!sp || !sp.name) return;
        const exists = gameState.customSpells.some(existing => existing.name.toLowerCase() === sp.name.toLowerCase());
        if (!exists) {
            gameState.customSpells.push(JSON.parse(JSON.stringify(sp)));
        }
    });
};
