// =========================================================
// SICHERHEITS-HELFER (HTML-/Attribut-/Farb-Escaping)
// =========================================================
const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

// Escaped Text für innerHTML und Attributwerte (src, value, title, data-*)
function esc(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[&<>"']/g, ch => ESC_MAP[ch]);
}

// Lässt nur harmlose CSS-Farben für style="..."-Attribute durch
function safeColor(value, fallback = '#3f3f46') {
    if (typeof value !== 'string') return fallback;
    const v = value.trim();
    if (/^#[0-9a-fA-F]{3,8}$/.test(v)) return value;
    if (/^[a-zA-Z]+$/.test(v)) return value;
    if (/^(?:rgba?|hsla?)\(\s*[\d\s.,%/]+\)$/i.test(v)) return value;
    return fallback;
}

// Tönt eine beliebige sichere Farbe mit Ziel-Alpha ein (für dezente Team-Akzente
// statt knalliger Vollton-Balken). Nicht-Hex-Farben fallen auf neutrales Grau zurück.
function withAlpha(color, alpha) {
    let hex = null;
    if (typeof color === 'string') {
        const m = color.trim().match(/^#([0-9a-f]{3,8})$/i);
        if (m) hex = m[1];
    }
    if (hex) {
        if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
        if (hex.length === 8) hex = hex.slice(0, 6);
        if (hex.length === 6) {
            const n = parseInt(hex, 16);
            return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
        }
    }
    return `rgba(120, 110, 105, ${alpha})`;
}

// Für Strings als Argument in Inline-Handlern: onclick="fn(${jsArg(id)})" (ohne Anführungszeichen)
function jsArg(value) {
    return esc(JSON.stringify(String(value ?? '')));
}

// Würfel-Detail kommt von anderen Spielern: alles escapen, nur die zwei bekannten Muster zurück in Markup wandeln
function sanitizeRollDetailHtml(str) {
    return esc(str)
        .replace(/&lt;strong class=&quot;roll-kept&quot;&gt;(\d+)&lt;\/strong&gt;/g, '<strong class="roll-kept">$1</strong>')
        .replace(/&lt;s class=&quot;roll-dropped&quot;&gt;(\d+)&lt;\/s&gt;/g, '<s class="roll-dropped">$1</s>');
}

// Kommagetrennte Kategorien -> bereinigtes Array (von DM- und Spieler-Ansicht genutzt)
function parseCategories(inputStr) {
    if (!inputStr) return [];
    return String(inputStr).split(',').map(c => c.trim()).filter(c => c.length > 0);
}

// =========================================================
// FORMULAR-ZUSTAND ÜBER RE-RENDER HINWEG ERHALTEN
// =========================================================
function isTextLikeField(el) {
    if (el.tagName === 'TEXTAREA') return true;
    const t = (el.type || 'text').toLowerCase();
    return !['checkbox', 'radio', 'file', 'button', 'submit', 'reset', 'image'].includes(t);
}

function getSelectDefaultIndex(sel) {
    for (let i = 0; i < sel.options.length; i++) {
        if (sel.options[i].defaultSelected) return i;
    }
    return 0;
}

// Merkt sich nur Felder, die der Nutzer seit dem Rendern verändert hat
function snapshotFormState(container) {
    const snap = { fields: {}, focus: null };
    if (!container) return snap;

    container.querySelectorAll('input, textarea, select').forEach(el => {
        if (!el.id) return;
        if (el.tagName === 'SELECT') {
            if (el.selectedIndex !== getSelectDefaultIndex(el) && el.selectedIndex >= 0) {
                snap.fields[el.id] = { tag: 'SELECT', value: el.value };
            }
            return;
        }
        const type = (el.type || '').toLowerCase();
        if (type === 'file') return;
        if (type === 'checkbox' || type === 'radio') {
            if (el.checked !== el.defaultChecked) {
                snap.fields[el.id] = { tag: 'INPUT', checked: el.checked };
            }
            return;
        }
        if (isTextLikeField(el) && el.value !== el.defaultValue) {
            snap.fields[el.id] = { tag: el.tagName, value: el.value };
        }
    });

    const active = document.activeElement;
    if (active && active.id && container.contains(active)) {
        let start = null, end = null;
        try {
            start = active.selectionStart;
            end = active.selectionEnd;
        } catch (err) { /* z.B. number-Inputs */ }
        snap.focus = { id: active.id, start, end };
    }
    return snap;
}

function restoreFormState(container, snapshot) {
    if (!container || !snapshot) return;

    const byId = new Map();
    container.querySelectorAll('input, textarea, select').forEach(el => {
        if (el.id) byId.set(el.id, el);
    });

    Object.keys(snapshot.fields || {}).forEach(id => {
        const el = byId.get(id);
        const rec = snapshot.fields[id];
        if (!el || el.tagName !== rec.tag) return;
        if (el.tagName === 'SELECT') {
            if (Array.from(el.options).some(o => o.value === rec.value)) el.value = rec.value;
        } else if ('checked' in rec) {
            el.checked = rec.checked;
        } else {
            el.value = rec.value;
        }
    });

    const f = snapshot.focus;
    if (f) {
        const el = byId.get(f.id);
        if (el) {
            el.focus();
            if (f.start !== null && f.start !== undefined) {
                try { el.setSelectionRange(f.start, f.end); } catch (err) { /* number-Inputs */ }
            }
        }
    }
}

// =========================================================
// SPIELSTAND
// =========================================================
function createInitialGameState() {
    return {
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
                "Helden": "#5e8ea6",
                "Monster / Feinde": "#b03a26",
                "Fraktion 3": "#b98f3e",
                "Fraktion 4": "#8a6fae"
            }
        }
    };
}

const gameState = createInitialGameState();

// Kampffeld-Geometrie — EIN Quelle im JS; CSS liest dieselben Werte als --cell-px/--cell-gap
const BATTLEMAP_CELL_PX = 74;
const BATTLEMAP_CELL_GAP = 5;

// Setzt gameState in-place auf die Startwerte zurück (gameState ist eine const)
function resetGameState() {
    Object.keys(gameState).forEach(k => delete gameState[k]);
    Object.assign(gameState, createInitialGameState());
}

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
        attacks: [],
        spells: [],
        skills: []
    };
}

function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Zahl ist gültig, wenn sie nach Number() endlich ist (leere Strings, null, Objekte zählen nicht)
function toFiniteNumber(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string' && v.trim() !== '') {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    }
    return null;
}

// Füllt fehlende / falsch typisierte Felder mit den Standardwerten (überschreibt nie gültige Werte)
function normalizeCharacter(char) {
    if (!char || typeof char !== 'object') return char;
    const def = createNewCharacter(char.id, typeof char.name === 'string' ? char.name : 'Unbenannt');

    ['name', 'origin', 'alignment', 'avatar', 'backstory', 'notes'].forEach(k => {
        if (typeof char[k] !== 'string') char[k] = def[k];
    });

    ['level', 'hp', 'maxHp', 'ac', 'initiative', 'proficiency', 'exhaustion', 'morality'].forEach(k => {
        if (typeof char[k] === 'number' && Number.isFinite(char[k])) return;
        const n = toFiniteNumber(char[k]);
        char[k] = n === null ? def[k] : n;
    });

    ['moralityVisible', 'bagInfinite'].forEach(k => {
        if (typeof char[k] !== 'boolean') char[k] = def[k];
    });

    if (char.bagCustomMax !== null) {
        const n = toFiniteNumber(char.bagCustomMax);
        char.bagCustomMax = n === null ? null : n;
    }

    if (!isPlainObject(char.stats)) char.stats = {};
    Object.keys(def.stats).forEach(k => {
        const n = toFiniteNumber(char.stats[k]);
        char.stats[k] = n === null ? def.stats[k] : n;
    });

    if (!isPlainObject(char.currency)) char.currency = {};
    Object.keys(def.currency).forEach(k => {
        const n = toFiniteNumber(char.currency[k]);
        char.currency[k] = n === null ? def.currency[k] : n;
    });

    ['items', 'attacks', 'spells', 'affinities', 'skills'].forEach(k => {
        if (!Array.isArray(char[k])) char[k] = [];
    });
    char.items.forEach(item => {
        if (item && typeof item === 'object') item.packmass = clampPackmass(item.packmass);
    });

    return char;
}

// Repariert gameState in-place, nachdem ein gespeicherter Stand hineingemischt wurde
function normalizeLoadedState() {
    ['customItems', 'customAttacks', 'customAffinities', 'customSpells', 'npcTemplates',
        'enemies', 'diceLog', 'messages', 'mapTemplates'].forEach(k => {
        gameState[k] = Array.isArray(gameState[k]) ? gameState[k].filter(isPlainObject) : [];
    });

    if (!isPlainObject(gameState.characters)) gameState.characters = {};
    Object.keys(gameState.characters).forEach(id => {
        const c = gameState.characters[id];
        if (!isPlainObject(c)) delete gameState.characters[id];
        else normalizeCharacter(c);
    });

    if (!isPlainObject(gameState.combat)) gameState.combat = createInitialGameState().combat;
    const combat = gameState.combat;
    if (!Array.isArray(combat.order)) combat.order = [];
    combat.order = combat.order.filter(isPlainObject);
    combat.order.forEach(entry => {
        if (!Array.isArray(entry.conditions)) entry.conditions = [];
    });
    if (typeof combat.round !== 'number' || !Number.isFinite(combat.round)) combat.round = 1;
    if (typeof combat.turnIndex !== 'number' || !Number.isFinite(combat.turnIndex)) combat.turnIndex = 0;
    if (!isPlainObject(combat.teams)) delete combat.teams;
    if (combat.map !== undefined && !isPlainObject(combat.map)) delete combat.map;
    if (combat.map) {
        if (typeof combat.map.rows !== 'number' || !(combat.map.rows > 0)) combat.map.rows = 6;
        if (typeof combat.map.cols !== 'number' || !(combat.map.cols > 0)) combat.map.cols = 6;
        if (Array.isArray(combat.map.palette)) combat.map.palette = combat.map.palette.filter(isPlainObject);
    }

    ensureBattlemapState();
    ensureSpellsAndDmNotesState();
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
let pendingCancelAction = null;

// options (optional): { title, confirmText, onCancel }
function openConfirmModal(message, onConfirm, options = {}) {
    const modal = document.getElementById('confirm-modal');
    const msgEl = document.getElementById('confirm-modal-message');
    if (!modal || !msgEl) return;

    const titleEl = document.getElementById('confirm-modal-title');
    const yesBtn = document.getElementById('btn-confirm-yes');
    if (titleEl) titleEl.textContent = options.title || "Bist du dir sicher?";
    if (yesBtn) {
        yesBtn.textContent = options.confirmText || "Ja, bestätigen";
        // Neutrale Aktionen (z. B. Konto anlegen) nicht rot einfärben
        yesBtn.className = options.confirmText ? 'btn-primary' : 'btn-del';
    }
    msgEl.textContent = message || "Möchtest du diese Aktion wirklich durchführen?";
    pendingConfirmAction = onConfirm;
    pendingCancelAction = typeof options.onCancel === 'function' ? options.onCancel : null;
    modal.classList.remove('hidden');
}

function closeConfirmModal() {
    const modal = document.getElementById('confirm-modal');
    if (modal) modal.classList.add('hidden');
    pendingConfirmAction = null;
    const cancel = pendingCancelAction;
    pendingCancelAction = null;
    if (typeof cancel === 'function') cancel();
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn-confirm-cancel')?.addEventListener('click', closeConfirmModal);
    document.getElementById('btn-confirm-yes')?.addEventListener('click', () => {
        const fn = pendingConfirmAction;
        pendingCancelAction = null;
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
        character: char
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
        state: gameState
    };
    downloadJsonFile(exportPayload, `afterlife_session_${code}.json`);
}

// 3. BIBLIOTHEKS-ABGLEICH: Fügt Gegenstände, Attacken, Merkmale & Zauber eines geladenen Charakters duplikatfrei zur Session-Bibliothek hinzu
function libraryNameKey(entry) {
    return String(entry?.name ?? '').trim().toLowerCase();
}

function mergeNamedEntries(targetList, sourceList) {
    if (!Array.isArray(sourceList)) return;
    const known = new Set();
    targetList.forEach(e => {
        const key = libraryNameKey(e);
        if (key) known.add(key);
    });
    sourceList.forEach(entry => {
        if (!entry || !entry.name) return;
        const key = libraryNameKey(entry);
        if (!key || known.has(key)) return;
        known.add(key);
        targetList.push(JSON.parse(JSON.stringify(entry)));
    });
}

function mergeCharacterIntoSessionLibrary(char) {
    if (!char) return;
    ensureSpellsAndDmNotesState();

    if (!Array.isArray(gameState.customItems)) gameState.customItems = [];
    if (!Array.isArray(gameState.customAttacks)) gameState.customAttacks = [];
    if (!Array.isArray(gameState.customAffinities)) gameState.customAffinities = [];

    mergeNamedEntries(gameState.customItems, char.items);
    mergeNamedEntries(gameState.customAttacks, char.attacks);
    mergeNamedEntries(gameState.customAffinities, char.affinities);
    mergeNamedEntries(gameState.customSpells, char.spells);
}

// 4. DRAG & DROP FÜR DATEIEN (gemeinsame Verdrahtung für JSON- und Bild-Zonen)
function bindFileDropZone(zone, input, handleFile) {
    zone.addEventListener('click', (e) => {
        if (e.target.tagName !== 'BUTTON') input.click();
    });

    input.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) handleFile(file);
        input.value = ''; // gleiche Datei darf erneut gewählt werden
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
            handleFile(e.dataTransfer.files[0]);
        }
    });
}

function bindJsonDropZone(dropZoneId, fileInputId, onJsonReady) {
    const zone = document.getElementById(dropZoneId);
    const input = document.getElementById(fileInputId);
    if (!zone || !input) return;

    bindFileDropZone(zone, input, (file) => {
        const reader = new FileReader();
        reader.onload = () => {
            let parsed;
            try {
                parsed = JSON.parse(reader.result);
            } catch (err) {
                alert("Fehler: Die Datei ist keine gültige JSON-Speicherdatei!");
                return;
            }
            onJsonReady(parsed, file.name);
        };
        reader.onerror = () => {
            alert("Fehler: Die Datei konnte nicht gelesen werden!");
        };
        reader.readAsText(file);
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

    // Tokenizer: jeder Würfelterm (NdM) und jede Konstante, jeweils mit Vorzeichen
    const diceTerms = [];
    let mod = 0;
    let unsignedConst = 0;
    const tokenRe = /([+-]?)(?:(\d*)d(\d+)|(\d+))/g;
    let tok;
    let tokenCount = 0;
    while ((tok = tokenRe.exec(clean)) !== null && tokenCount < 30) {
        tokenCount++;
        const sign = tok[1] === '-' ? -1 : 1;
        if (tok[3] !== undefined) {
            const count = Math.min(Math.max(parseInt(tok[2]) || 1, 1), 50);
            const sides = Math.min(Math.max(parseInt(tok[3]) || 20, 2), 1000);
            diceTerms.push({ sign, count, sides });
        } else if (tok[1] !== '') {
            mod += sign * (parseInt(tok[4]) || 0);
        } else {
            unsignedConst += parseInt(tok[4]) || 0;
        }
    }
    if (diceTerms.length === 0) {
        // Ohne Würfelterm: 1d20 plus nur explizit vorzeichenbehaftete Konstanten (wie bisher)
        diceTerms.push({ sign: 1, count: 1, sides: 20 });
    } else {
        mod += unsignedConst;
    }

    const modStr = mod > 0 ? `+${mod}` : mod < 0 ? `${mod}` : '';
    const single = diceTerms.length === 1 && diceTerms[0].sign === 1 ? diceTerms[0] : null;

    let detailHtml = '';
    let isCrit = false;
    let isFumble = false;
    let diceSum = 0;
    let formula;

    if (single && single.count === 1 && single.sides === 20 && (mode === 'adv' || mode === 'dis')) {
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
        detailHtml = `${modeLabel} [${r1Html}, ${r2Html}] → ${chosen}`;
        formula = `1d20${modStr}`;
    } else {
        const formulaParts = [];
        const detailParts = [];
        diceTerms.forEach((term, i) => {
            const rolls = [];
            for (let n = 0; n < term.count; n++) {
                rolls.push(Math.floor(Math.random() * term.sides) + 1);
            }
            const sum = rolls.reduce((a, b) => a + b, 0);
            diceSum += term.sign * sum;

            if (single && term.count === 1 && term.sides === 20) {
                isCrit = rolls[0] === 20;
                isFumble = rolls[0] === 1;
            }

            const prefixF = term.sign < 0 ? '-' : (i > 0 ? '+' : '');
            formulaParts.push(`${prefixF}${term.count}d${term.sides}`);
            const prefixD = i === 0 ? (term.sign < 0 ? '- ' : '') : (term.sign < 0 ? ' - ' : ' + ');
            detailParts.push(`${prefixD}[${rolls.join(', ')}]`);
        });
        formula = formulaParts.join('') + modStr;
        detailHtml = detailParts.join('');
    }

    const total = diceSum + mod;
    if (modStr) detailHtml += ` ${modStr}`;

    return {
        formula: formula,
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
    //    (Fokus in Eingabefeldern bleibt erhalten)
    if (document.activeElement && document.activeElement.tagName === 'BUTTON') {
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

    submitRollEntry(entry);
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
    const visibleLogs = (gameState.diceLog || []).filter(entry => entry && typeof entry === 'object' && !(isPlayer && entry.secret));

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
                <span class="roll-who">${entry.secret ? `${icon('lock')} ` : ''}${esc(entry.roller)}</span>
                <span class="roll-what">${esc(entry.label)}:</span>
                <strong class="roll-total">${esc(entry.total)}</strong>
                <small class="roll-detail">${sanitizeRollDetailHtml(entry.detailHtml)}</small>
            </div>
        `;
    }).join('');
}

// Bilder werden vor dem Speichern verkleinert (max. 512x512), damit der Spielstand-Broadcast klein bleibt
const IMAGE_MAX_SIDE = 512;
const IMAGE_MAX_BYTES = 150 * 1024;
// Hartes Limit für die Dateigröße – gilt auch für GIF/SVG, die unverändert durchgereicht werden,
// damit keine riesigen Data-URLs in den Session-Broadcast gelangen
const IMAGE_HARD_MAX_BYTES = 1024 * 1024; // 1 MB

function downscaleImageFile(file, dataUrl, callback) {
    // GIF (evtl. animiert) und SVG unverändert durchreichen
    if (file.type === 'image/gif' || file.type === 'image/svg+xml') {
        callback(dataUrl);
        return;
    }

    const img = new Image();
    img.onload = () => {
        try {
            const w = img.naturalWidth, h = img.naturalHeight;
            if (!w || !h || (w <= IMAGE_MAX_SIDE && h <= IMAGE_MAX_SIDE && file.size <= IMAGE_MAX_BYTES)) {
                callback(dataUrl);
                return;
            }
            const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(w, h));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(w * scale));
            canvas.height = Math.max(1, Math.round(h * scale));
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);

            let out = canvas.toDataURL('image/webp', 0.85);
            if (!out.startsWith('data:image/webp')) {
                out = file.type === 'image/jpeg'
                    ? canvas.toDataURL('image/jpeg', 0.85)
                    : canvas.toDataURL('image/png');
            }
            callback(out && out.startsWith('data:image/') ? out : dataUrl);
        } catch (err) {
            callback(dataUrl);
        }
    };
    img.onerror = () => callback(dataUrl);
    img.src = dataUrl;
}

function bindImageDropZone(dropZoneId, fileInputId, onImageReady) {
    const zone = document.getElementById(dropZoneId);
    const input = document.getElementById(fileInputId);
    if (!zone || !input) return;

    bindFileDropZone(zone, input, (file) => {
        if (!file || !file.type.startsWith('image/')) return;
        if (file.size > IMAGE_HARD_MAX_BYTES) {
            alert(`Bild ist zu groß (max. ${Math.round(IMAGE_HARD_MAX_BYTES / 1024)} KB). Bitte verkleinere es zuerst.`);
            return;
        }
        const reader = new FileReader();
        reader.onload = () => downscaleImageFile(file, reader.result, onImageReady);
        reader.readAsDataURL(file);
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
let battlemapPanRaf = 0;

let isPaintingBattlemap = false;
let didPaintChange = false;
let lastPaintedCellEl = null;

function ensureBattlemapState() {
    if (!gameState.combat) {
        gameState.combat = { active: false, round: 1, turnIndex: 0, order: [], teams: {}, battlemapVisibleToPlayers: false };
    }
    if (gameState.combat.battlemapVisibleToPlayers === undefined) {
        gameState.combat.battlemapVisibleToPlayers = false;
    }
    if (!gameState.combat.teams || Object.keys(gameState.combat.teams).length === 0) {
        gameState.combat.teams = { "Helden": "#5e8ea6", "Monster / Feinde": "#b03a26" };
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

function resolveCombatantShared(entry) {
    if (!entry) return null;
    if (entry.kind === 'player') {
        return gameState.characters[entry.id] || null;
    } else {
        return (gameState.enemies || []).find(e => e._uid === entry.key) || null;
    }
}

// =========================================================
// KAMERA-PAN & ZOOM ZUM MAUSZEIGER
// =========================================================
// Nur die Pan/Zoom-Transformation der Ebene (läuft bei jedem Pan-Schritt)
function applyBattlemapPlaneTransform() {
    const planeEl = document.getElementById('battlemap-pan-zoom-plane');
    if (planeEl) {
        planeEl.style.transform = `translate(${battlemapPanX}px, ${battlemapPanY}px) scale(${battlemapZoom})`;
    }
}

// Grid-Spalten/-Zeilen: nur nötig, wenn die Karte neu gerendert wurde
function applyBattlemapGridTemplate() {
    const gridEl = document.getElementById('active-battlemap-grid');
    if (gridEl && gameState.combat && gameState.combat.map) {
        gridEl.style.gridTemplateColumns = `repeat(${gameState.combat.map.cols}, var(--cell-px))`;
        gridEl.style.gridTemplateRows = `repeat(${gameState.combat.map.rows}, var(--cell-px))`;
    }
}

// Zoom-Anzeige: nur wenn sich der Zoom ändert
function updateBattlemapZoomLabel() {
    const labelEl = document.getElementById('battlemap-zoom-label');
    if (labelEl) {
        labelEl.textContent = `${Math.round(battlemapZoom * 100)}%`;
    }
}

// Vollständiges Update (nach Render / Zentrieren)
function applyBattlemapTransformToDom() {
    applyBattlemapPlaneTransform();
    applyBattlemapGridTemplate();
    updateBattlemapZoomLabel();
}


function centerBattlemapInViewport() {
    const wrapper = document.getElementById('battlemap-stage-wrapper');
    const map = gameState.combat?.map || { rows: 6, cols: 6 };
    if (!wrapper) return;

    const rect = wrapper.getBoundingClientRect();
    const gridW = map.cols * BATTLEMAP_CELL_PX + (map.cols - 1) * BATTLEMAP_CELL_GAP;
    const gridH = map.rows * BATTLEMAP_CELL_PX + (map.rows - 1) * BATTLEMAP_CELL_GAP;

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

    applyBattlemapPlaneTransform();
    updateBattlemapZoomLabel();
}

// Stufenweises Zoomen für die Buttons: multiplikativ, damit sich das
// Zoomen bei jeder Zoom-Stufe gleich anfühlt.
function stepBattlemapZoom(direction) {
    const factor = direction > 0 ? 1.18 : 1 / 1.18;
    const wrapper = document.getElementById('battlemap-stage-wrapper');
    if (wrapper) {
        const rect = wrapper.getBoundingClientRect();
        zoomBattlemapAtPoint(battlemapZoom * factor, rect.width / 2, rect.height / 2);
    } else {
        zoomBattlemapAtPoint(battlemapZoom * factor, 300, 300);
    }
}

// Kompatibilität für ältere Aufrufer
function changeBattlemapZoom(delta) {
    stepBattlemapZoom(delta > 0 ? 1 : -1);
}

function resetBattlemapZoom() {
    // Eventuell noch ausstehenden Wheel-Zoom verwerfen
    if (battlemapWheelRaf) {
        cancelAnimationFrame(battlemapWheelRaf);
        battlemapWheelRaf = 0;
    }
    battlemapWheelDelta = 0;
    battlemapZoom = 1.0;
    centerBattlemapInViewport();
}

// --- Mausrad-/Trackpad-Zoom ---------------------------------------------
// Trackpads feuern sehr viele kleine wheel-Events. Früher wurde jedes Event
// fest mit ×1.12 / ×0.89 multipliziert -> ein leichter Wisch sprang durch den
// kompletten Zoombereich. Jetzt wird das Delta normalisiert, gedämpft und
// maximal einmal pro Frame angewendet.
const BATTLEMAP_ZOOM_SENSITIVITY = 0.0010; // Zoom pro normalisiertem Pixel-Delta
const BATTLEMAP_ZOOM_MAX_STEP = 1.4;       // max. Faktor pro Frame (nach oben)
const BATTLEMAP_ZOOM_MIN_STEP = 1 / 1.4;   // max. Faktor pro Frame (nach unten)

let battlemapWheelRaf = 0;
let battlemapWheelDelta = 0;
let battlemapWheelX = 0;
let battlemapWheelY = 0;

function handleBattlemapWheel(e) {
    e.preventDefault();
    const wrapper = e.currentTarget;
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();

    // deltaMode normalisieren: 0 = Pixel, 1 = Zeilen, 2 = Seiten
    let delta = e.deltaY;
    if (e.deltaMode === 1) {
        delta *= 16;
    } else if (e.deltaMode === 2) {
        delta *= rect.height;
    }
    // Einzelne Ausreißer (z. B. sehr schnelles Mausrad) begrenzen
    delta = Math.max(-200, Math.min(200, delta));
    if (delta === 0) return;

    battlemapWheelDelta += delta;
    // Fokuspunkt innerhalb des Spielfeld-Fensters
    battlemapWheelX = e.clientX - rect.left;
    battlemapWheelY = e.clientY - rect.top;

    if (!battlemapWheelRaf) {
        battlemapWheelRaf = requestAnimationFrame(() => {
            battlemapWheelRaf = 0;
            const accDelta = battlemapWheelDelta;
            battlemapWheelDelta = 0;
            if (!accDelta) return;

            let factor = Math.exp(-accDelta * BATTLEMAP_ZOOM_SENSITIVITY);
            factor = Math.max(BATTLEMAP_ZOOM_MIN_STEP, Math.min(BATTLEMAP_ZOOM_MAX_STEP, factor));
            zoomBattlemapAtPoint(battlemapZoom * factor, battlemapWheelX, battlemapWheelY);
        });
    }
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
        ensureBattlemapState(); // einmal pro Strich statt pro Zelle
        isPaintingBattlemap = true;
        didPaintChange = false;
        lastPaintedCellEl = null;
        paintCellFromElement(clickedCell);

        window.addEventListener('pointermove', onBattlemapPaintMove);
        window.addEventListener('pointerup', onBattlemapPaintEnd);
        window.addEventListener('pointercancel', onBattlemapPaintEnd);
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
    window.addEventListener('pointercancel', onBattlemapPanEnd);
}

function onBattlemapPanMove(e) {
    if (!isPanningBattlemap) return;
    battlemapPanX = Math.round(panStartOffsetX + (e.clientX - panStartMouseX));
    battlemapPanY = Math.round(panStartOffsetY + (e.clientY - panStartMouseY));
    // Höchstens ein Transform-Write pro Frame
    if (!battlemapPanRaf) {
        battlemapPanRaf = requestAnimationFrame(() => {
            battlemapPanRaf = 0;
            applyBattlemapPlaneTransform();
        });
    }
}

function onBattlemapPanEnd() {
    if (!isPanningBattlemap) return;
    isPanningBattlemap = false;
    const wrapper = document.getElementById('battlemap-stage-wrapper');
    if (wrapper) wrapper.classList.remove('is-panning');

    window.removeEventListener('pointermove', onBattlemapPanMove);
    window.removeEventListener('pointerup', onBattlemapPanEnd);
    window.removeEventListener('pointercancel', onBattlemapPanEnd);

    if (battlemapPanRaf) {
        cancelAnimationFrame(battlemapPanRaf);
        battlemapPanRaf = 0;
    }
    applyBattlemapPlaneTransform(); // Endposition sicher anwenden
}

function paintCellFromElement(cellEl) {
    if (!cellEl || cellEl === lastPaintedCellEl) return;
    const r = parseInt(cellEl.getAttribute('data-row'));
    const c = parseInt(cellEl.getAttribute('data-col'));
    if (isNaN(r) || isNaN(c)) return;

    const map = gameState.combat?.map;
    if (!map || !map.cells || !Array.isArray(map.palette)) return;
    const selectedId = map.selectedBlockId;
    if (!selectedId) return;
    lastPaintedCellEl = cellEl;

    const key = `${r}_${c}`;
    if (selectedId === 'block_gray') {
        // Standardblock wird nicht gespeichert (Lesen fällt auf block_gray zurück)
        if (key in map.cells) {
            delete map.cells[key];
            didPaintChange = true;
        }
    } else if ((map.cells[key] || 'block_gray') !== selectedId) {
        map.cells[key] = selectedId;
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
    if (cellEl && cellEl !== lastPaintedCellEl) {
        paintCellFromElement(cellEl);
    }
}

function onBattlemapPaintEnd() {
    if (!isPaintingBattlemap) return;
    isPaintingBattlemap = false;
    lastPaintedCellEl = null;
    window.removeEventListener('pointermove', onBattlemapPaintMove);
    window.removeEventListener('pointerup', onBattlemapPaintEnd);
    window.removeEventListener('pointercancel', onBattlemapPaintEnd);

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
    const activeTeamColor = activeEntry ? safeColor(gameState.combat.teams[activeEntry.teamName], '#5e8ea6') : '#3f3f46';

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
                    color: safeColor(gameState.combat.teams[entry.teamName], '#3f3f46')
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
                    <div class="turn-active-card" style="--team-c: ${activeTeamColor};">
                        ${activeActor.avatar
        ? `<img src="${esc(activeActor.avatar)}" class="turn-active-avatar" alt="">`
        : `<div class="turn-active-avatar turn-avatar-placeholder" aria-hidden="true">${esc(String(activeActor.name || '?')[0])}</div>`
    }
                        <div class="turn-active-info">
                            <span class="turn-indicator-pill">${icon('turn')} AM ZUG</span>
                            <strong>${esc(activeActor.name)}</strong>
                            <small class="muted">${esc(activeEntry.teamName)} · Init ${esc(activeEntry.initiative)}</small>
                        </div>
                    </div>
                ` : `
                    <div class="turn-empty-pill">Noch kein aktiver Kämpfer im Zug</div>
                `}

                ${upcoming.length > 0 ? `<span class="turn-arrow-sep">→</span>` : ''}

                <div class="turn-upcoming-list">
                    ${upcoming.map(u => `
                        <div class="turn-next-card" style="--team-c: ${u.color};">
                            ${u.actor.avatar
        ? `<img src="${esc(u.actor.avatar)}" class="turn-next-avatar" alt="">`
        : `<div class="turn-next-avatar turn-avatar-placeholder" aria-hidden="true">${esc(String(u.actor.name || '?')[0])}</div>`
    }
                            <div class="turn-next-meta">
                                <strong>${esc(u.actor.name)}</strong>
                                <small>Init ${esc(u.entry.initiative)}</small>
                            </div>
                        </div>
                    `).join('')}
                    ${hasMoreEllipsis ? `<div class="turn-ellipsis-badge" title="Weitere Kämpfer in der Reihenfolge">…</div>` : ''}
                </div>
            </div>

            <div class="turn-strip-controls">
                <div class="round-badge">
                    <span>RUNDE</span>
                    <strong>${esc(gameState.combat.round || 1)}</strong>
                </div>
                ${isDmView ? `
                    <label class="dm-checkbox-label battlemap-vis-toggle ${visibleToPlayers ? 'vis-on' : 'vis-off'}" title="Schaltet den 4. Tab (Kampffeld) für alle Spieler ein oder aus">
                        <input type="checkbox" ${visibleToPlayers ? 'checked' : ''} onchange="dmToggleBattlemapVisibility(this.checked)">
                        ${icon('eye')} Für Spieler ${visibleToPlayers ? 'sichtbar' : 'ausgeblendet'}
                    </label>
                    <button type="button" onclick="changeCombatTurn(-1)">Vorheriger Zug</button>
                    <button type="button" class="btn-primary btn-next-turn" onclick="changeCombatTurn(1)">Nächster Zug ${icon('turn')}</button>
                    <button type="button" class="btn-secondary" onclick="syncPlayersOnlyIntoCombat()" title="Alle verbundenen Spieler in den Kampf holen">${icon('refresh')} Spieler-Sync</button>
                    <button type="button" onclick="rollInitiativeFor('enemies', this)">${icon('dice')} Monster-Init</button>
                    <button type="button" onclick="rollInitiativeFor('all', this)">${icon('dice')} Alle Init</button>
                    ${order.length > 0 || gameState.combat.active ? `<button type="button" class="btn-del" onclick="endCombatSession()">Kampf beenden</button>` : ''}
                ` : `
                    <span class="mode-status-pill mode-pill-move">${icon('move')} Verschieben- & Bewegungsmodus</span>
                `}
            </div>
        </div>
    `;
}

function buildBattlemapZoomControlsHtml() {
    const pct = Math.round(battlemapZoom * 100);
    return `
        <div class="battlemap-zoom-bar">
            <button type="button" onclick="stepBattlemapZoom(-1)" title="Rauszoomen (Taste −)">${icon('zoomOut')}</button>
            <button type="button" id="battlemap-zoom-label" onclick="resetBattlemapZoom()" title="Auf 100% & Mitte zentrieren (Taste 0)">${pct}%</button>
            <button type="button" onclick="stepBattlemapZoom(1)" title="Reinzoomen (Taste +)">${icon('zoomIn')}</button>
        </div>
    `;
}

function buildBattlemapGridCellsHtml(isDmView) {
    ensureBattlemapState();
    const map = gameState.combat.map;
    const order = gameState.combat.order || [];
    const activeKey = order[gameState.combat.turnIndex]?.key || null;
    const buildMode = isDmView && Boolean(map.selectedBlockId);

    // Einmal vorab aufbauen statt pro Zelle / pro Token zu suchen
    const tokensByCell = new Map();
    order.forEach(e => {
        const k = `${e.row}_${e.col}`;
        if (!tokensByCell.has(k)) tokensByCell.set(k, []);
        tokensByCell.get(k).push(e);
    });
    const blocksById = new Map(map.palette.map(b => [b.id, b]));
    const myCombatEntry = order.find(e => e.kind === 'player' && e.id === currentPlayerId);
    const myTeam = myCombatEntry ? myCombatEntry.teamName : 'Helden';

    let html = '';
    for (let r = 0; r < map.rows; r++) {
        for (let c = 0; c < map.cols; c++) {
            const key = `${r}_${c}`;
            const block = blocksById.get(map.cells[key] || 'block_gray') || map.palette[0];
            const tokensHere = tokensByCell.get(key) || [];

            html += `
                <div class="battlemap-cell"
                     data-row="${r}"
                     data-col="${c}"
                     style="background-color: ${safeColor(block.color)};"
                     title="${esc(block.name)} (${r + 1}, ${c + 1})"
                     ${isDmView ? `
                         ondragover="dmHandleCellDragOver(event)"
                         ondragleave="dmHandleCellDragLeave(event)"
                         ondrop="dmHandleCellDrop(event, ${r}, ${c})"
                     ` : ''}>
                    <span class="cell-coord-hint">${r + 1},${c + 1}</span>
                    ${tokensHere.map(entry => {
                const actor = resolveCombatantShared(entry);
                if (!actor) return '';
                const teamColor = safeColor(gameState.combat.teams[entry.teamName], '#5e8ea6');
                const isActiveTurn = entry.key === activeKey;
                // Im Baumodus lassen Tokens den Pinsel durch; im Bewegungsmodus sind sie ziehbar
                const canDrag = !buildMode && (isDmView || (entry.kind === 'player' && entry.id === currentPlayerId));
                const isDown = actor.hp <= 0;
                const canSeeHp = isDmView || (entry.teamName === myTeam);
                const actorName = String(actor.name || '?');

                return `
                            <div class="battlemap-token ${isActiveTurn ? 'token-active-turn' : ''} ${canDrag ? 'token-can-drag' : 'token-locked'} ${buildMode ? 'token-passthrough' : ''} ${isDown ? 'token-down' : ''}"
                                 data-token-key="${esc(entry.key)}"
                                 style="--team-c: ${teamColor};"
                                 ${canDrag ? `onpointerdown="startTokenCarryDrag(event, ${jsArg(entry.key)}, ${isDmView})"` : ''}
                                 title="${esc(actorName)} (${esc(entry.teamName)})${canSeeHp ? ` • HP: ${esc(actor.hp)}/${esc(actor.maxHp)}` : ''}">
                                ${actor.avatar
                    ? `<img src="${esc(actor.avatar)}" class="token-avatar-img" draggable="false">`
                    : `<div class="token-initials">${esc(actorName.substring(0, 2).toUpperCase())}</div>`
                }
                                <div class="token-label-bar">
                                    <span class="token-name-text">${esc(actorName)}</span>
                                    ${canSeeHp ? `<span class="token-hp-text">${esc(actor.hp)}/${esc(actor.maxHp)}</span>` : ''}
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
    if (activeTokenDrag) return;

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
    window.addEventListener('pointercancel', onTokenCarryCancel);
}

function onTokenCarryMove(e) {
    if (!activeTokenDrag) return;
    const { ghost, width, height } = activeTokenDrag;
    ghost.style.left = `${e.clientX - width / 2}px`;
    ghost.style.top = `${e.clientY - height / 2}px`;

    const elUnder = document.elementFromPoint(e.clientX, e.clientY);
    const cell = elUnder ? elUnder.closest('.battlemap-cell') : null;

    if (cell === activeTokenDrag.lastHoverCell) return;
    if (activeTokenDrag.lastHoverCell) {
        activeTokenDrag.lastHoverCell.classList.remove('cell-drop-hover');
    }
    if (cell) {
        cell.classList.add('cell-drop-hover');
    }
    activeTokenDrag.lastHoverCell = cell;
}

// Räumt Listener, Ghost und Hover-Markierung auf und gibt den Drag-Zustand zurück
function cleanupTokenDrag() {
    const drag = activeTokenDrag;
    window.removeEventListener('pointermove', onTokenCarryMove);
    window.removeEventListener('pointerup', onTokenCarryEnd);
    window.removeEventListener('pointercancel', onTokenCarryCancel);
    activeTokenDrag = null;
    if (!drag) return null;

    if (drag.lastHoverCell) drag.lastHoverCell.classList.remove('cell-drop-hover');
    if (drag.ghost && drag.ghost.parentNode) drag.ghost.parentNode.removeChild(drag.ghost);
    if (drag.sourceEl) drag.sourceEl.classList.remove('token-source-picked-up');
    return drag;
}

// Abbruch (Touch-Übernahme, Fenster-Blur): aufräumen, Token bleibt wo er ist
function onTokenCarryCancel() {
    cleanupTokenDrag();
}

function onTokenCarryEnd(e) {
    if (!activeTokenDrag) return;
    const drag = cleanupTokenDrag();
    const { tokenKey, isDmView } = drag;

    const elUnder = document.elementFromPoint(e.clientX, e.clientY);
    const targetCell = elUnder ? elUnder.closest('.battlemap-cell') : null;

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
        renderDmView({ preserveInputs: true });
    } else {
        renderPlayerView(currentPlayerId, { preserveInputs: true });
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
