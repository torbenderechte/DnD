let activePlayerTab = 'gameplay';

let playerItemDraftAvatar = '';
let playerAttackDraftAvatar = '';
let playerSpellDraftAvatar = '';
let playerAffinityDraftAvatar = '';

const DND_SKILLS = [
    "Acrobatics (Dex)",
    "Animal Handling (Wis)",
    "Arcana (Int)",
    "Athletics (Str)",
    "Deception (Cha)",
    "History (Int)",
    "Insight (Wis)",
    "Intimidation (Cha)",
    "Investigation (Int)",
    "Medicine (Wis)",
    "Nature (Int)",
    "Perception (Wis)",
    "Performance (Cha)",
    "Persuasion (Cha)",
    "Religion (Int)",
    "Sleight of Hand (Dex)",
    "Stealth (Dex)",
    "Survival (Wis)"
];

function getMod(score) {
    const mod = Math.floor((score - 10) / 2);
    return mod >= 0 ? `+${mod}` : `${mod}`;
}

function formatMorality(points) {
    if (points === 0) return "Neutral (0 Punkte)";
    if (points > 0) return `${points} ${points === 1 ? 'Heiliger Punkt' : 'Heilige Punkte'} (+${points})`;
    const abs = Math.abs(points);
    return `${abs} ${abs === 1 ? 'Dämonischer Punkt' : 'Dämonische Punkte'} (${points})`;
}

// Seelen-Waage als Holzschnitt: Der Balken neigt sich zur schwereren Schale
// (links dämonisch, rechts heilig). Ab ±10 Punkten liegt er am Anschlag.
function buildSoulScaleSvg(morality) {
    const m = Math.max(-10, Math.min(10, Number(morality) || 0));
    const rad = (m / 10) * 13 * Math.PI / 180;
    const px = 120, py = 26, arm = 78;
    const dx = Math.cos(rad) * arm;
    const dy = Math.sin(rad) * arm;
    const n = (v) => v.toFixed(1);
    const pan = (x, y, cls) => `
        <path class="scale-line scale-cord" d="M${n(x)} ${n(y)} L${n(x - 17)} ${n(y + 36)} M${n(x)} ${n(y)} L${n(x + 17)} ${n(y + 36)}"/>
        <path class="scale-pan ${cls}" d="M${n(x - 21)} ${n(y + 36)} H${n(x + 21)} Q${n(x)} ${n(y + 56)} ${n(x - 21)} ${n(y + 36)} Z"/>`;

    return `
        <svg class="soul-scale" viewBox="0 0 240 108" role="img" aria-label="Seelen-Waage: ${esc(formatMorality(Number(morality) || 0))}">
            <path class="scale-solid" d="M98 104 L107 95 H133 L142 104 Z"/>
            <path class="scale-line" d="M120 16 V95"/>
            <path class="scale-solid" d="M120 6 L125 13 L120 20 L115 13 Z"/>
            ${pan(px - dx, py - dy, 'pan-demonic')}
            ${pan(px + dx, py + dy, 'pan-holy')}
            <path class="scale-line scale-beam" d="M${n(px - dx)} ${n(py - dy)} L${n(px + dx)} ${n(py + dy)}"/>
            <circle class="scale-pivot" cx="${px}" cy="${py}" r="4.2"/>
        </svg>`;
}

function syncMyCharacter(char, mergeLibrary = false) {
    if (hostConnection && hostConnection.open) {
        hostConnection.send({
            type: 'UPDATE_CHARACTER',
            character: char,
            mergeLibrary: mergeLibrary
        });
    }
    scheduleAccountSave();
}

function togglePlayerSkill(playerId, skillName, isChecked) {
    const char = gameState.characters[playerId];
    if (!char) return;
    if (!Array.isArray(char.skills)) char.skills = [];

    if (isChecked && !char.skills.includes(skillName)) {
        char.skills.push(skillName);
    } else if (!isChecked) {
        char.skills = char.skills.filter(s => s !== skillName);
    }

    renderPlayerView(playerId, { preserveInputs: true });
    syncMyCharacter(char);
}

function applyImportedPlayerCharacter(parsedJson) {
    const char = gameState.characters[currentPlayerId];
    if (!char) return;

    const imported = parsedJson.character || parsedJson;
    if (!imported || !imported.name || !imported.stats) {
        return alert("Ungültige Charakter-Datei! Bitte wähle eine gespeicherte Charakter-Datei (.json).");
    }

    openConfirmModal(`Möchtest du deinen Charakterbogen mit "${imported.name}" aus der Datei ausfüllen und alle gespeicherten Gegenstände, Attacken, Zauber und Merkmale zur Session-Bibliothek hinzufügen?`, () => {
        imported.id = char.id;
        normalizeCharacter(imported);

        gameState.characters[char.id] = imported;
        mergeCharacterIntoSessionLibrary(imported);
        renderPlayerView(char.id);
        syncMyCharacter(imported, true);
    });
}

function updatePlayerCombatTabVisibility() {
    const isVisible = Boolean(gameState.combat && gameState.combat.battlemapVisibleToPlayers);
    const combatTabBtn = document.getElementById('tab-btn-combat');
    if (combatTabBtn) {
        combatTabBtn.classList.toggle('hidden', !isVisible);
    }
    if (!isVisible && activePlayerTab === 'combat') {
        activePlayerTab = 'gameplay';
        document.getElementById('tab-btn-gameplay')?.classList.add('active');
        ['story', 'equipment', 'combat'].forEach(name => {
            document.getElementById(`tab-btn-${name}`)?.classList.remove('active');
        });
    }
}

function switchPlayerTab(tabName) {
    if (tabName === 'combat' && !(gameState.combat && gameState.combat.battlemapVisibleToPlayers)) {
        return;
    }
    activePlayerTab = tabName;
    document.getElementById('tab-btn-gameplay')?.classList.toggle('active', tabName === 'gameplay');
    document.getElementById('tab-btn-story')?.classList.toggle('active', tabName === 'story');
    document.getElementById('tab-btn-equipment')?.classList.toggle('active', tabName === 'equipment');
    document.getElementById('tab-btn-combat')?.classList.toggle('active', tabName === 'combat');
    renderPlayerView(currentPlayerId);
}

function renderPlayerView(playerId, options) {
    ensureSpellsAndDmNotesState();
    const char = gameState.characters ? gameState.characters[playerId] : null;
    if (!char) return;
    normalizeCharacter(char);

    updatePlayerCombatTabVisibility();

    const container = document.getElementById('player-sheet-content');
    if (!container) return;

    const preserveInputs = Boolean(options && options.preserveInputs);
    let formSnapshot = null;
    let activeId = null;
    let selStart = null;
    let selEnd = null;
    if (preserveInputs) {
        formSnapshot = snapshotFormState(container);
    } else {
        const activeEl = document.activeElement;
        activeId = activeEl && activeEl.id ? activeEl.id : null;
        selStart = activeEl && typeof activeEl.selectionStart === 'number' ? activeEl.selectionStart : null;
        selEnd = activeEl && typeof activeEl.selectionEnd === 'number' ? activeEl.selectionEnd : null;
    }

    container.innerHTML = `<div id="tab-body"></div>`;
    const tabBody = document.getElementById('tab-body');

    if (activePlayerTab === 'gameplay') {
        renderGameplayTab(char, tabBody);
    } else if (activePlayerTab === 'story') {
        renderStoryTab(char, tabBody);
    } else if (activePlayerTab === 'equipment') {
        renderEquipmentTab(char, tabBody);
    } else if (activePlayerTab === 'combat') {
        renderPlayerCombatTab(char, tabBody);
    }

    if (preserveInputs) {
        restoreFormState(container, formSnapshot);
    } else if (activeId) {
        const restoredEl = document.getElementById(activeId);
        if (restoredEl) {
            restoredEl.focus();
            if (selStart !== null && typeof restoredEl.setSelectionRange === 'function') {
                try { restoredEl.setSelectionRange(selStart, selEnd); } catch (e) {}
            }
        }
    }
}

// ==========================================
// TAB 1: GAMEPLAY
// ==========================================
function renderGameplayTab(char, tabBody) {
    const statKeys = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
    const moralClass = char.morality < 0 ? 'moral-is-demonic' : char.morality > 0 ? 'moral-is-holy' : 'moral-is-neutral';

    // Lebensader: Füllstand & Zustandsklasse (nicht nur Farbe — Klassen tragen Bedeutung)
    const hpValue = Number(char.hp) || 0;
    const hpMax = Math.max(1, Number(char.maxHp) || 1);
    const hpPct = Math.max(0, Math.min(100, Math.round((hpValue / hpMax) * 100)));
    const veinState = hpValue <= 0 ? 'is-down' : (hpPct < 25 ? 'is-low' : '');

    tabBody.innerHTML = `
        ${char.moralityVisible ? `
            <div class="morality-banner ${moralClass}">
                <button id="btn-p-moral-minus" class="btn-demonic">−1 Dämonisch</button>
                <div class="morality-emblem">
                    ${buildSoulScaleSvg(char.morality)}
                    <div class="morality-readout">
                        <span class="morality-subtitle">Seelen-Waage · Moral</span>
                        <div class="morality-score-big">${esc(char.morality > 0 ? '+' + char.morality : char.morality)}</div>
                        <span class="morality-state-text">${esc(formatMorality(char.morality))}</span>
                    </div>
                </div>
                <button id="btn-p-moral-plus" class="btn-holy">+1 Heilig</button>
            </div>
        ` : ''}

        <div class="abilities-row-grid">
            ${statKeys.map(key => {
        const val = char.stats[key];
        const label = key.toUpperCase();
        const mod = getMod(val);
        return `
                <div class="ability-shield">
                    <span class="ability-label">${label}</span>
                    <button type="button" class="ability-mod-big" title="Klicken für 1d20 ${label}-Check"
                            aria-label="${label}-Check würfeln (1d20${esc(mod)})"
                            onclick="triggerUniversalRoll(${jsArg('1d20' + mod)}, ${jsArg(label + '-Check')}, null, this)">
                        ${esc(mod)} ${icon('dice')}
                    </button>
                    <input type="number" id="p-stat-${key}" class="p-stat-input ability-score-oval" data-stat="${key}" value="${esc(val)}" aria-label="${label}-Wert">
                </div>
            `;
    }).join('')}
        </div>

        <div class="combat-dashboard-row">
            <div class="card vitals-card">
                <span class="stat-box-title">LEBENSPUNKTE (HIT POINTS)</span>
                <div class="hp-fraction-row">
                    <input type="number" id="p-hp" class="hp-big-input" value="${esc(char.hp)}" aria-label="Aktuelle Lebenspunkte">
                    <span class="hp-slash">/</span>
                    <input type="number" id="p-maxhp" class="hp-big-input" value="${esc(char.maxHp)}" aria-label="Maximale Lebenspunkte">
                    <span class="muted">Max HP</span>
                </div>
                <div class="life-vein" title="Lebensader: ${esc(hpValue)} von ${esc(hpMax)}">
                    <div class="life-vein-fill ${veinState}" style="width: ${esc(hpPct)}%;"></div>
                </div>
                <div class="hp-quick-btns">
                    <button type="button" onclick="quickChangeMyHp(-5)">-5 HP</button>
                    <button type="button" onclick="quickChangeMyHp(-1)">-1 HP</button>
                    <button type="button" onclick="quickChangeMyHp(1)">+1 HP</button>
                    <button type="button" onclick="quickChangeMyHp(5)">+5 HP</button>
                </div>
            </div>

            <div class="compact-stats-row">
                <div class="stat-shield-box">
                    <span class="stat-box-title">ARMOR CLASS</span>
                    <input type="number" id="p-ac" class="compact-num-input" value="${esc(char.ac)}">
                </div>
                <div class="stat-shield-box">
                    <span class="stat-box-title">INITIATIVE</span>
                    <input type="number" id="p-init" class="compact-num-input" value="${esc(char.initiative)}">
                </div>
                <div class="stat-shield-box">
                    <span class="stat-box-title">LEVEL</span>
                    <input type="number" id="p-level" class="compact-num-input" value="${esc(char.level)}" min="1">
                </div>
                <div class="stat-shield-box">
                    <span class="stat-box-title">PROFICIENCY</span>
                    <input type="number" id="p-prof" class="compact-num-input" value="${esc(char.proficiency)}">
                </div>
                <div class="stat-shield-box">
                    <span class="stat-box-title">EXHAUSTION</span>
                    <input type="number" id="p-exh" class="compact-num-input" value="${esc(char.exhaustion)}" min="0" max="6">
                </div>
            </div>
        </div>

        <!-- Skills als Gravur-Chips -->
        <div class="card">
            <h3>${icon('target')} Skills (Fertigkeiten)</h3>
            <div class="skill-grid">
                ${DND_SKILLS.map(skill => {
        const hasSkill = Array.isArray(char.skills) && char.skills.includes(skill);
        return `
                        <label class="skill-chip ${hasSkill ? 'is-known' : ''}">
                            <input type="checkbox"
                                   ${hasSkill ? 'checked' : ''}
                                   onchange="togglePlayerSkill(${jsArg(char.id)}, ${jsArg(skill)}, this.checked)">
                            <span>${esc(skill)}</span>
                        </label>
                    `;
    }).join('')}
            </div>
        </div>

        <!-- Merkmale & Charakter-Datei nebeneinander -->
        <div class="bottom-grid">
            <div class="card card-fill">
                <h3>${icon('flask')} Merkmale (Affinitäten, Mutationen & Psychosen)</h3>
                <div class="item-list">
                    ${char.affinities.length === 0 ? '<p class="muted">Keine Merkmale aktiv.</p>' : ''}
                    ${char.affinities.map((a, idx) => `
                        <div class="item-badge">
                            <div class="item-badge-left">
                                ${a.avatar ? `<img src="${esc(a.avatar)}" class="item-icon">` : `<div class="mini-avatar-placeholder" aria-hidden="true">M</div>`}
                                <div>
                                    <strong>${esc(a.name)}</strong>
                                    <div class="cat-badge-row">
                                        ${(Array.isArray(a.categories) ? a.categories : []).map(c => `<span class="cat-tag">${esc(c)}</span>`).join('')}
                                    </div>
                                    <small><strong>Effekt:</strong> ${esc(a.effect || a.desc || '-')}</small>
                                </div>
                            </div>
                            <button type="button" class="btn-del" title="Entfernen" aria-label="Entfernen" onclick="removePlayerItem('affinities', ${idx})">${icon('x')}</button>
                        </div>
                    `).join('')}
                </div>

                <div class="player-creator-box">
                    <small class="muted">Eigenes Merkmal hinzufügen:</small>
                    <div id="p-aff-dropzone" class="drop-zone drop-zone-mini">
                        ${playerAffinityDraftAvatar
        ? `<img src="${esc(playerAffinityDraftAvatar)}" class="drop-preview-img">`
        : `<div class="drop-zone-prompt"><strong>Bild</strong><span>Drag & Drop oder Klick</span></div>`
    }
                        <input type="file" id="p-aff-file" accept="image/*" class="hidden">
                    </div>
                    <div class="form-row">
                        <input type="text" id="p-new-a-name" placeholder="Name">
                        <input type="text" id="p-new-a-cats" placeholder="Kategorien (Komma)">
                    </div>
                    <input type="text" id="p-new-a-effect" placeholder="Effekt">
                    <button id="btn-p-add-aff" class="btn-primary">+ Merkmal</button>
                </div>
            </div>

            <div class="card card-fill card-spread">
                <div class="creator-header-row">
                    <div>
                        <h3>Charakter-Datei (.json) speichern & laden</h3>
                        <small class="muted">Speichere deinen kompletten Charakter auf deinem Gerät oder ziehe eine gespeicherte Datei hier hinein.</small>
                    </div>
                    <button type="button" class="btn-secondary" onclick="exportPlayerCharToFile()">${icon('save')} Charakter als Datei speichern</button>
                </div>
                <div id="p-gameplay-json-dropzone" class="drop-zone drop-zone-grow">
                    <div class="drop-zone-prompt">
                        <strong>Gespeicherte Charakter-Datei (.json) hierher ziehen (Drag & Drop)</strong>
                        <span>Füllt alle Werte, Bilder & Notizen aus und fügt deine Items, Attacken & Zauber zur Session-Bibliothek hinzu</span>
                    </div>
                    <input type="file" id="p-gameplay-json-file" accept=".json,application/json" class="hidden">
                </div>
            </div>
        </div>
    `;

    bindImageDropZone('p-aff-dropzone', 'p-aff-file', (b64) => {
        playerAffinityDraftAvatar = b64;
        renderPlayerView(char.id, { preserveInputs: true });
    });

    bindJsonDropZone('p-gameplay-json-dropzone', 'p-gameplay-json-file', (parsed) => {
        applyImportedPlayerCharacter(parsed);
    });

    if (char.moralityVisible) {
        document.getElementById('btn-p-moral-minus').addEventListener('click', () => {
            char.morality -= 1;
            renderPlayerView(char.id, { preserveInputs: true });
            syncMyCharacter(char);
        });
        document.getElementById('btn-p-moral-plus').addEventListener('click', () => {
            char.morality += 1;
            renderPlayerView(char.id, { preserveInputs: true });
            syncMyCharacter(char);
        });
    }

    const bindNum = (id, prop) => {
        document.getElementById(id).addEventListener('change', (e) => {
            char[prop] = parseInt(e.target.value) || 0;
            renderPlayerView(char.id, { preserveInputs: true });
            const el = document.getElementById(id);
            if (el) el.value = char[prop];
            syncMyCharacter(char);
        });
    };

    bindNum('p-hp', 'hp');
    bindNum('p-maxhp', 'maxHp');
    bindNum('p-ac', 'ac');
    bindNum('p-init', 'initiative');
    bindNum('p-exh', 'exhaustion');
    bindNum('p-level', 'level');
    bindNum('p-prof', 'proficiency');

    document.querySelectorAll('.p-stat-input').forEach(input => {
        input.addEventListener('change', (e) => {
            const statKey = e.target.getAttribute('data-stat');
            if (!statKeys.includes(statKey)) return;
            char.stats[statKey] = parseInt(e.target.value) || 10;
            renderPlayerView(char.id, { preserveInputs: true });
            const el = document.getElementById(`p-stat-${statKey}`);
            if (el) el.value = char.stats[statKey];
            syncMyCharacter(char);
        });
    });

    document.getElementById('btn-p-add-aff').addEventListener('click', () => {
        const name = document.getElementById('p-new-a-name').value.trim();
        const cats = parseCategories(document.getElementById('p-new-a-cats').value);
        const effect = document.getElementById('p-new-a-effect').value.trim();
        if (!name) return;
        char.affinities.push({
            avatar: playerAffinityDraftAvatar,
            name: name,
            categories: cats,
            effect: effect
        });
        playerAffinityDraftAvatar = '';
        renderPlayerView(char.id);
        syncMyCharacter(char);
    });
}

function quickChangeMyHp(delta) {
    const char = gameState.characters[currentPlayerId];
    if (!char) return;
    char.hp += delta;
    renderPlayerView(char.id, { preserveInputs: true });
    syncMyCharacter(char);
}

// ==========================================
// TAB 2: STORY, NOTIZEN & CHARAKTER-DATEI
// ==========================================
function renderStoryTab(char, tabBody) {
    tabBody.innerHTML = `
        <div class="story-grid">
            <div class="dm-stack">
                <div class="card">
                    <h3>Charakterbild</h3>
                    <div id="p-avatar-dropzone" class="drop-zone avatar-drop-large">
                        ${char.avatar
        ? `<img src="${esc(char.avatar)}" class="avatar-large">
                               <button type="button" class="btn-del drop-remove-btn" onclick="removePlayerAvatar(event)">${icon('x')} Bild entfernen</button>`
        : `<div class="drop-zone-prompt">
                                   <strong>Bild hierher ziehen (Drag & Drop)</strong>
                                   <span>oder klicken zum Auswählen</span>
                               </div>`
    }
                        <input type="file" id="p-avatar-file" accept="image/*" class="hidden">
                    </div>
                </div>

                <div class="card">
                    <h3>Charakter-Datei (.json)</h3>
                    <button type="button" class="btn-secondary" onclick="exportPlayerCharToFile()">${icon('save')} Charakter auf Gerät speichern</button>
                    <div id="p-char-json-dropzone" class="drop-zone drop-zone-small">
                        <div class="drop-zone-prompt">
                            <strong>Gespeicherten Charakter (.json) laden</strong>
                            <span>Hierher ziehen, um Werte & Items zu importieren</span>
                        </div>
                        <input type="file" id="p-char-json-file" accept=".json,application/json" class="hidden">
                    </div>
                </div>
            </div>

            <div class="card story-details">
                <h3>Identität & Gesinnung</h3>
                <div class="form-row">
                    <label>Charaktername
                        <input type="text" id="p-name" value="${esc(char.name)}">
                    </label>
                    <label>Epoche / Herkunft
                        <input type="text" id="p-origin" value="${esc(char.origin)}">
                    </label>
                </div>

                <label>Alignment (Gesinnung)
                    <select id="p-alignment">
                        ${[
        "Rechtschaffen Gut (Lawful Good)", "Neutral Gut (Neutral Good)", "Chaotisch Gut (Chaotic Good)",
        "Rechtschaffen Neutral (Lawful Neutral)", "Neutral (True Neutral)", "Chaotisch Neutral (Chaotic Neutral)",
        "Rechtschaffen Böse (Lawful Evil)", "Neutral Böse (Neutral Evil)", "Chaotisch Böse (Chaotic Evil)"
    ].map(al => `<option value="${esc(al)}" ${char.alignment === al ? 'selected' : ''}>${esc(al)}</option>`).join('')}
                    </select>
                </label>

                <h3>Hintergrundgeschichte (Leben & Tod)</h3>
                <textarea id="p-backstory" rows="6" placeholder="Wer warst du vor deinem Tod? Wie bist du gestorben?">${esc(char.backstory)}</textarea>

                <h3>Persönliche Session-Notizen</h3>
                <textarea id="p-notes" rows="6" placeholder="Hinweise, Namen von NPCs, Quests, verdächtige Beobachtungen...">${esc(char.notes)}</textarea>
            </div>
        </div>
    `;

    bindImageDropZone('p-avatar-dropzone', 'p-avatar-file', (base64) => {
        char.avatar = base64;
        renderPlayerView(char.id, { preserveInputs: true });
        syncMyCharacter(char);
    });

    bindJsonDropZone('p-char-json-dropzone', 'p-char-json-file', (parsed) => {
        applyImportedPlayerCharacter(parsed);
    });

    document.getElementById('p-name').addEventListener('change', (e) => {
        char.name = e.target.value.trim() || char.name;
        renderPlayerView(char.id, { preserveInputs: true });
        const nameEl = document.getElementById('p-name');
        if (nameEl) nameEl.value = char.name;
        syncMyCharacter(char);
    });

    document.getElementById('p-origin').addEventListener('change', (e) => {
        char.origin = e.target.value;
        renderPlayerView(char.id, { preserveInputs: true });
        syncMyCharacter(char);
    });

    document.getElementById('p-alignment').addEventListener('change', (e) => {
        char.alignment = e.target.value;
        renderPlayerView(char.id, { preserveInputs: true });
        syncMyCharacter(char);
    });

    document.getElementById('p-backstory').addEventListener('change', (e) => {
        char.backstory = e.target.value;
        syncMyCharacter(char);
    });

    document.getElementById('p-notes').addEventListener('change', (e) => {
        char.notes = e.target.value;
        syncMyCharacter(char);
    });
}

function removePlayerAvatar(e) {
    e.stopPropagation();
    openConfirmModal("Möchtest du dein Charakterbild wirklich entfernen?", () => {
        const char = gameState.characters[currentPlayerId];
        if (!char) return;
        char.avatar = "";
        renderPlayerView(char.id, { preserveInputs: true });
        syncMyCharacter(char);
    });
}

// ==========================================
// TAB 3: AUSRÜSTUNG (Gegenstände, Attacken & eigene Zauber-Kategorie)
// ==========================================
function renderEquipmentTab(char, tabBody) {
    const totalInCopper =
        (char.currency.cp || 0) +
        (char.currency.sp || 0) * 10 +
        (char.currency.gp || 0) * 100 +
        (char.currency.pp || 0) * 1000;

    const bagUsed = getPlayerBagUsed(char);
    const bagMax = getPlayerBagMax(char);
    const isInf = Boolean(char.bagInfinite);
    const fillPercent = isInf ? 25 : Math.min(100, Math.round((bagUsed / Math.max(1, bagMax)) * 100));
    const isFull = !isInf && bagUsed >= bagMax;

    tabBody.innerHTML = `
        <div class="card">
            <div class="currency-header">
                <div>
                    <h3>Geldbeutel (Umrechnung 10 : 1)</h3>
                    <small class="muted">10 Kupfer = 1 Silber | 10 Silber = 1 Gold | 10 Gold = 1 Platin (Gesamt: ${esc(totalInCopper)} Kupfer)</small>
                </div>
                <button id="btn-convert-coins" class="btn-secondary">Münzen optimal umrechnen (10:1)</button>
            </div>
            <div class="currency-four-grid">
                <div class="coin-box coin-cp">
                    <span>Kupfer (CP)</span>
                    <input type="number" id="coin-cp" value="${esc(char.currency.cp)}" min="0">
                </div>
                <div class="coin-box coin-sp">
                    <span>Silber (SP)</span>
                    <input type="number" id="coin-sp" value="${esc(char.currency.sp)}" min="0">
                </div>
                <div class="coin-box coin-gp">
                    <span>Gold (GP)</span>
                    <input type="number" id="coin-gp" value="${esc(char.currency.gp)}" min="0">
                </div>
                <div class="coin-box coin-pp">
                    <span>Platin (PP)</span>
                    <input type="number" id="coin-pp" value="${esc(char.currency.pp)}" min="0">
                </div>
            </div>
        </div>

        <!-- 1. GEGENSTÄNDE & BEUTEL -->
        <div class="card">
            <div class="creator-header-row">
                <h3>${icon('bag')} Gegenstände & Beutel</h3>
                <span class="packmass-badge ${isFull ? 'packmass-full' : ''}">
                    Beutelplatz: <strong>${esc(bagUsed)} / ${isInf ? '∞ (Unendlich)' : esc(bagMax)}</strong> Packmaß
                </span>
            </div>

            <div class="bag-capacity-box">
                <div class="bag-progress-track">
                    <div class="bag-progress-fill ${isFull ? 'fill-full' : ''}" style="width: ${esc(fillPercent)}%;"></div>
                </div>
                <small class="muted">
                    ${isInf
        ? 'Dein Beutel hat unendliche Kapazität (vom DM freigeschaltet).'
        : `Freier Platz: ${esc(Math.max(0, bagMax - bagUsed))} Packmaß (Standard: 15 + STR = ${esc(15 + (parseInt(char.stats?.str) || 10))} · Nur vom DM änderbar)`
    }
                </small>
            </div>

            <div class="item-list">
                ${char.items.length === 0 ? '<p class="muted">Keine Gegenstände im Beutel.</p>' : ''}
                ${char.items.map((item, idx) => `
                    <div class="item-badge">
                        <div class="item-badge-left">
                            ${item.avatar ? `<img src="${esc(item.avatar)}" class="item-icon">` : `<div class="mini-avatar-placeholder" aria-hidden="true">I</div>`}
                            <div>
                                <div class="combat-name-line">
                                    <strong>${esc(item.name)}</strong>
                                    <span class="packmass-pill">${icon('box')} Packmaß: ${esc(clampPackmass(item.packmass))}</span>
                                </div>
                                <div class="cat-badge-row">
                                    ${(Array.isArray(item.categories) ? item.categories : []).map(c => `<span class="cat-tag">${esc(c)}</span>`).join('')}
                                </div>
                                <small><strong>Anforderung:</strong> ${esc(item.requirement || 'Keine')}</small>
                                <small><strong>Aktion:</strong> ${esc(item.action || '-')}</small>
                            </div>
                        </div>
                        <button type="button" class="btn-del" title="Entfernen" aria-label="Entfernen" onclick="removePlayerItem('items', ${idx})">${icon('x')}</button>
                    </div>
                `).join('')}
            </div>

            <div class="player-creator-box">
                <small class="muted">Gegenstand hinzufügen (Bild, Name, Packmaß 1–10, Kategorien, Anforderung, Aktion):</small>
                <div id="p-item-dropzone" class="drop-zone drop-zone-mini">
                    ${playerItemDraftAvatar
        ? `<img src="${esc(playerItemDraftAvatar)}" class="drop-preview-img">`
        : `<div class="drop-zone-prompt"><strong>Gegenstands-Bild</strong><span>Drag & Drop oder Klick</span></div>`
    }
                    <input type="file" id="p-item-file" accept="image/*" class="hidden">
                </div>
                <div class="form-row">
                    <label class="field-label">NAME
                        <input type="text" id="p-new-item-name" placeholder="z.B. Katana">
                    </label>
                    <label class="field-label">PACKMASS (1–10)
                        <input type="number" id="p-new-item-packmass" min="1" max="10" value="1">
                    </label>
                </div>
                <input type="text" id="p-new-item-cats" placeholder="Kategorien (mit Komma trennen)">
                <div class="form-row">
                    <input type="text" id="p-new-item-req" placeholder="Anforderung (z.B. STR 14)">
                    <input type="text" id="p-new-item-action" placeholder="Aktion (z.B. +2 AC / 1d8 Schnitt)">
                </div>
                <button id="btn-p-add-item" class="btn-primary">+ Gegenstand in Beutel legen</button>
            </div>
        </div>

        <!-- 2. ATTACKEN & 3. ZAUBER NEBENEINANDER -->
        <div class="bottom-grid">
            
            <!-- ATTACKEN -->
            <div class="card">
                <h3>${icon('blade')} Attacken</h3>
                <div class="item-list">
                    ${char.attacks.length === 0 ? '<p class="muted">Noch keine Attacken.</p>' : ''}
                    ${char.attacks.map((atk, idx) => `
                        <div class="item-badge">
                            <div class="item-badge-left">
                                ${atk.avatar ? `<img src="${esc(atk.avatar)}" class="item-icon">` : `<div class="mini-avatar-placeholder" aria-hidden="true">A</div>`}
                                <div>
                                    <strong>${esc(atk.name)}</strong>
                                    ${atk.usesExhaustion ? `<span class="exh-badge">${icon('bolt')} Verbraucht 1 Exhaustion</span>` : ''}
                                    <div class="cat-badge-row">
                                        ${(Array.isArray(atk.categories) ? atk.categories : []).map(c => `<span class="cat-tag">${esc(c)}</span>`).join('')}
                                    </div>
                                    <small><strong>Aktion:</strong> ${esc(atk.action || 'Wartet auf DM...')}</small>
                                </div>
                            </div>
                            <div class="dm-badges">
                                <button type="button" onclick="usePlayerAttack(${idx}, this)">${icon('dice')} Nutzen</button>
                                <button type="button" class="btn-del" title="Entfernen" aria-label="Entfernen" onclick="removePlayerItem('attacks', ${idx})">${icon('x')}</button>
                            </div>
                        </div>
                    `).join('')}
                </div>

                <div class="player-creator-box">
                    <small class="muted">Attacke hinzufügen (Bild, Name, Kategorien, Aktion, Exhaustion-Box):</small>
                    <div id="p-atk-dropzone" class="drop-zone drop-zone-mini">
                        ${playerAttackDraftAvatar
        ? `<img src="${esc(playerAttackDraftAvatar)}" class="drop-preview-img">`
        : `<div class="drop-zone-prompt"><strong>Attacken-Bild</strong><span>Drag & Drop oder Klick</span></div>`
    }
                        <input type="file" id="p-atk-file" accept="image/*" class="hidden">
                    </div>
                    <div class="form-row">
                        <input type="text" id="p-new-atk-name" placeholder="Name">
                        <input type="text" id="p-new-atk-cats" placeholder="Kategorien (Komma)">
                    </div>
                    <input type="text" id="p-new-atk-action" placeholder="Aktion (z.B. 2d6+3 Schaden / Effekt)">
                    <label class="checkbox-inline-row">
                        <input type="checkbox" id="p-new-atk-exh">
                        Verbraucht Exhaustion Point
                    </label>
                    <button id="btn-p-add-atk" class="btn-primary">+ Attacke hinzufügen</button>
                </div>
            </div>

            <!-- ZAUBER -->
            <div class="card">
                <h3>${icon('spark')} Zauber</h3>
                <div class="item-list">
                    ${char.spells.length === 0 ? '<p class="muted">Noch keine Zauber gelernt.</p>' : ''}
                    ${char.spells.map((sp, idx) => `
                        <div class="item-badge">
                            <div class="item-badge-left">
                                ${sp.avatar ? `<img src="${esc(sp.avatar)}" class="item-icon">` : `<div class="mini-avatar-placeholder">${icon('spark')}</div>`}
                                <div>
                                    <strong>${esc(sp.name)}</strong>
                                    ${sp.usesExhaustion ? `<span class="exh-badge">${icon('bolt')} Verbraucht 1 Exhaustion</span>` : ''}
                                    <div class="cat-badge-row">
                                        ${(Array.isArray(sp.categories) ? sp.categories : []).map(c => `<span class="cat-tag">${esc(c)}</span>`).join('')}
                                    </div>
                                    <small><strong>Anforderung:</strong> ${esc(sp.requirement || 'Keine')}</small>
                                    <small><strong>Aktion:</strong> ${esc(sp.action || 'Wartet auf DM...')}</small>
                                </div>
                            </div>
                            <div class="dm-badges">
                                <button type="button" onclick="usePlayerSpell(${idx}, this)">${icon('dice')} Wirken</button>
                                <button type="button" class="btn-del" title="Entfernen" aria-label="Entfernen" onclick="removePlayerItem('spells', ${idx})">${icon('x')}</button>
                            </div>
                        </div>
                    `).join('')}
                </div>

                <div class="player-creator-box">
                    <small class="muted">Zauber hinzufügen (Bild, Name, Kategorien, Anforderung, Aktion, Exhaustion-Box):</small>
                    <div id="p-spell-dropzone" class="drop-zone drop-zone-mini">
                        ${playerSpellDraftAvatar
        ? `<img src="${esc(playerSpellDraftAvatar)}" class="drop-preview-img">`
        : `<div class="drop-zone-prompt"><strong>Zauber-Bild</strong><span>Drag & Drop oder Klick</span></div>`
    }
                        <input type="file" id="p-spell-file" accept="image/*" class="hidden">
                    </div>
                    <div class="form-row">
                        <input type="text" id="p-new-spell-name" placeholder="Name (z.B. Seelenfeuer)">
                        <input type="text" id="p-new-spell-cats" placeholder="Kategorien (Komma)">
                    </div>
                    <div class="form-row">
                        <input type="text" id="p-new-spell-req" placeholder="Anforderung (z.B. INT 14 / Moral +2)">
                        <input type="text" id="p-new-spell-action" placeholder="Aktion (z.B. 3d6 Feuerschaden)">
                    </div>
                    <label class="checkbox-inline-row">
                        <input type="checkbox" id="p-new-spell-exh">
                        Verbraucht Exhaustion Point
                    </label>
                    <button id="btn-p-add-spell" class="btn-primary">+ Zauber hinzufügen</button>
                </div>
            </div>

        </div>
    `;

    bindImageDropZone('p-item-dropzone', 'p-item-file', (b64) => {
        playerItemDraftAvatar = b64;
        renderPlayerView(char.id, { preserveInputs: true });
    });

    bindImageDropZone('p-atk-dropzone', 'p-atk-file', (b64) => {
        playerAttackDraftAvatar = b64;
        renderPlayerView(char.id, { preserveInputs: true });
    });

    bindImageDropZone('p-spell-dropzone', 'p-spell-file', (b64) => {
        playerSpellDraftAvatar = b64;
        renderPlayerView(char.id, { preserveInputs: true });
    });

    ['cp', 'sp', 'gp', 'pp'].forEach(coin => {
        document.getElementById(`coin-${coin}`).addEventListener('change', (e) => {
            char.currency[coin] = Math.max(0, parseInt(e.target.value) || 0);
            renderPlayerView(char.id, { preserveInputs: true });
            const coinEl = document.getElementById(`coin-${coin}`);
            if (coinEl) coinEl.value = char.currency[coin];
            syncMyCharacter(char);
        });
    });

    document.getElementById('btn-convert-coins').addEventListener('click', () => {
        let total =
            (char.currency.cp || 0) +
            (char.currency.sp || 0) * 10 +
            (char.currency.gp || 0) * 100 +
            (char.currency.pp || 0) * 1000;

        char.currency.pp = Math.floor(total / 1000);
        total %= 1000;
        char.currency.gp = Math.floor(total / 100);
        total %= 100;
        char.currency.sp = Math.floor(total / 10);
        char.currency.cp = total % 10;

        renderPlayerView(char.id, { preserveInputs: true });
        ['cp', 'sp', 'gp', 'pp'].forEach(coin => {
            const coinEl = document.getElementById(`coin-${coin}`);
            if (coinEl) coinEl.value = char.currency[coin];
        });
        syncMyCharacter(char);
    });

    document.getElementById('btn-p-add-item').addEventListener('click', () => {
        const name = document.getElementById('p-new-item-name').value.trim();
        const rawPackmass = parseInt(document.getElementById('p-new-item-packmass').value);
        if (!name) return alert("Bitte einen Namen für den Gegenstand eingeben!");
        if (isNaN(rawPackmass) || rawPackmass < 1 || rawPackmass > 10) {
            return alert("Das Packmaß muss zwischen 1 und 10 liegen!");
        }

        const packmass = clampPackmass(rawPackmass);
        if (!canAddItemToPlayerBag(char, packmass)) {
            const used = getPlayerBagUsed(char);
            const max = getPlayerBagMax(char);
            return alert(`Nicht genug Platz im Beutel! "${name}" hat ein Packmaß von ${packmass}, aber dein Beutel ist bei ${used} / ${max} Packmaß.`);
        }

        const cats = parseCategories(document.getElementById('p-new-item-cats').value);
        const requirement = document.getElementById('p-new-item-req').value.trim();
        const action = document.getElementById('p-new-item-action').value.trim();

        char.items.push({
            avatar: playerItemDraftAvatar,
            name: name,
            packmass: packmass,
            categories: cats,
            requirement: requirement,
            action: action
        });
        playerItemDraftAvatar = '';
        renderPlayerView(char.id);
        syncMyCharacter(char);
    });

    document.getElementById('btn-p-add-atk').addEventListener('click', () => {
        const name = document.getElementById('p-new-atk-name').value.trim();
        const cats = parseCategories(document.getElementById('p-new-atk-cats').value);
        const action = document.getElementById('p-new-atk-action').value.trim();
        const usesExhaustion = document.getElementById('p-new-atk-exh').checked;
        if (!name) return;
        char.attacks.push({
            avatar: playerAttackDraftAvatar,
            name: name,
            categories: cats,
            action: action || 'Wartet auf DM',
            usesExhaustion: usesExhaustion
        });
        playerAttackDraftAvatar = '';
        renderPlayerView(char.id);
        syncMyCharacter(char);
    });

    document.getElementById('btn-p-add-spell').addEventListener('click', () => {
        const name = document.getElementById('p-new-spell-name').value.trim();
        const cats = parseCategories(document.getElementById('p-new-spell-cats').value);
        const requirement = document.getElementById('p-new-spell-req').value.trim();
        const action = document.getElementById('p-new-spell-action').value.trim();
        const usesExhaustion = document.getElementById('p-new-spell-exh').checked;
        if (!name) return alert("Bitte einen Namen für den Zauber eingeben!");
        char.spells.push({
            avatar: playerSpellDraftAvatar,
            name: name,
            categories: cats,
            requirement: requirement,
            action: action || 'Wartet auf DM',
            usesExhaustion: usesExhaustion
        });
        playerSpellDraftAvatar = '';
        renderPlayerView(char.id);
        syncMyCharacter(char);
    });
}

// ==========================================
// TAB 4: SPIELER-KAMPFFELD
// ==========================================
function renderPlayerCombatTab(char, tabBody) {
    ensureBattlemapState();
    const map = gameState.combat.map;
    const isMyCharInCombat = (gameState.combat.order || []).some(e => e.kind === 'player' && e.id === char.id);

    tabBody.innerHTML = `
        <div class="player-combat-layout">
            ${buildTopTurnBarHtml(false)}

            <div class="card battlemap-board-card player-battlemap-card">
                <div class="battlemap-board-header">
                    <div>
                        <h3>${icon('map')} Taktisches Kampffeld (${esc(map.rows)} × ${esc(map.cols)})</h3>
                        <small class="muted">
                            ${isMyCharInCombat
        ? 'Gedrückt halten zum freien Verschieben der Karte · Mausrad zoomt zum Mauszeiger · +/− zoomt, 0 zentriert · Ziehe deinen eigenen Token.'
        : 'Gedrückt halten zum freien Verschieben der Karte · Mausrad zoomt zum Mauszeiger · +/− zoomt, 0 zentriert.'
    }
                        </small>
                    </div>
                    ${buildBattlemapZoomControlsHtml()}
                </div>

                <div id="battlemap-stage-wrapper"
                     class="battlemap-stage-wrapper stage-mode-move"
                     onpointerdown="handleBattlemapStagePointerDown(event, false)"
                     onwheel="handleBattlemapWheel(event)">
                    <div id="battlemap-pan-zoom-plane" class="battlemap-pan-zoom-plane">
                        <div id="active-battlemap-grid" class="battlemap-grid">
                            ${buildBattlemapGridCellsHtml(false)}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    initBattlemapViewport();
}

function usePlayerAttack(idx, btnEl) {
    const char = gameState.characters[currentPlayerId];
    if (!char || !char.attacks[idx]) return;
    const atk = char.attacks[idx];

    // 1. Würfelformel ermitteln
    const formulaMatch = (atk.action || '').match(/(\d*d\d+(?:\s*[+-]\s*\d+)?)/i);
    const formula = formulaMatch ? formulaMatch[1] : '1d20';

    // 2. ERST würfeln und das Ergebnis in "roll" abfangen
    const roll = triggerUniversalRoll(formula, `${atk.name}`, char.name, btnEl);

    // 3. Wenn "roll" null ist (Cooldown noch aktiv), sofort abbrechen!
    if (!roll) return;

    // 4. Erst wenn der Wurf wirklich gezählt hat, Exhaustion abziehen
    if (atk.usesExhaustion) {
        char.exhaustion = Math.min(6, (char.exhaustion || 0) + 1);
        syncMyCharacter(char);
    }

    renderPlayerView(char.id, { preserveInputs: true });
}


function usePlayerSpell(idx, btnEl) {
    const char = gameState.characters[currentPlayerId];
    if (!char || !char.spells || !char.spells[idx]) return;
    const sp = char.spells[idx];

    const formulaMatch = (sp.action || '').match(/(\d*d\d+(?:\s*[+-]\s*\d+)?)/i);
    const formula = formulaMatch ? formulaMatch[1] : '1d20';
    const roll = triggerUniversalRoll(formula, `${sp.name}`, char.name, btnEl);

    // Cooldown aktiv: kein Wurf, also auch keine Exhaustion
    if (!roll) return;

    if (sp.usesExhaustion) {
        char.exhaustion = Math.min(6, (char.exhaustion || 0) + 1);
        syncMyCharacter(char);
    }

    renderPlayerView(char.id, { preserveInputs: true });
}

function removePlayerItem(listKey, idx) {
    const char = gameState.characters[currentPlayerId];
    if (!char || !Array.isArray(char[listKey])) return;
    const entry = char[listKey][idx];
    const entryName = entry ? entry.name : undefined;
    const label = entry && entry.name ? `"${entry.name}"` : 'diesen Eintrag';

    openConfirmModal(`Möchtest du ${label} wirklich von deinem Charakterbogen entfernen?`, () => {
        // Charakter neu lesen: ein Sync kann das Objekt inzwischen ersetzt haben
        const current = gameState.characters[currentPlayerId];
        if (!current || !Array.isArray(current[listKey])) return;
        const target = current[listKey][idx];
        if (!target || target.name !== entryName) return;
        current[listKey].splice(idx, 1);
        renderPlayerView(currentPlayerId, { preserveInputs: true });
        syncMyCharacter(current);
    });
}
