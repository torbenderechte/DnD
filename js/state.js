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
