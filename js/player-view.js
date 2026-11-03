let activePlayerTab = 'gameplay';

let playerItemDraftAvatar = '';
let playerAttackDraftAvatar = '';
let playerSpellDraftAvatar = '';
let playerAffinityDraftAvatar = '';

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

function parsePlayerCategories(str) {
    if (!str) return [];
    return str.split(',').map(s => s.trim()).filter(Boolean);
}

function syncMyCharacter(char, mergeLibrary = false) {
    if (hostConnection && hostConnection.open) {
        hostConnection.send({
            type: 'UPDATE_CHARACTER',
            character: char,
            mergeLibrary: mergeLibrary
        });
    }
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
        if (imported.bagInfinite === undefined) imported.bagInfinite = false;
        if (imported.bagCustomMax === undefined) imported.bagCustomMax = null;
        if (!Array.isArray(imported.spells)) imported.spells = [];
        (imported.items || []).forEach(it => {
            it.packmass = clampPackmass(it.packmass);
        });

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
        document.getElementById('tab-btn-combat')?.classList.remove('active');
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

function renderPlayerView(playerId) {
    ensureSpellsAndDmNotesState();
    const char = gameState.characters[playerId];
    if (!char) return;
    if (!char.items) char.items = [];
    if (!char.attacks) char.attacks = [];
    if (!char.spells) char.spells = [];
    if (!char.affinities) char.affinities = [];
    if (char.notes === undefined) char.notes = "";

    updatePlayerCombatTabVisibility();

    const activeEl = document.activeElement;
    const activeId = activeEl && activeEl.id ? activeEl.id : null;
    const selStart = activeEl && typeof activeEl.selectionStart === 'number' ? activeEl.selectionStart : null;
    const selEnd = activeEl && typeof activeEl.selectionEnd === 'number' ? activeEl.selectionEnd : null;

    const container = document.getElementById('player-sheet-content');
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

    if (activeId) {
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
    const moralClass = char.morality < 0 ? 'moral-is-demonic' : char.morality > 0 ? 'moral-is-holy' : 'moral-is-neutral';

    tabBody.innerHTML = `
        ${char.moralityVisible ? `
            <div class="morality-banner ${moralClass}">
                <button id="btn-p-moral-minus" class="btn-demonic">−1 Dämonisch</button>
                <div class="morality-emblem">
                    <span class="morality-subtitle">SEELEN-WAAGE / MORAL</span>
                    <div class="morality-score-big">${char.morality > 0 ? '+' + char.morality : char.morality}</div>
                    <span class="morality-state-text">${formatMorality(char.morality)}</span>
                </div>
                <button id="btn-p-moral-plus" class="btn-holy">+1 Heilig</button>
            </div>
        ` : ''}

        <div class="abilities-row-grid">
            ${Object.entries(char.stats).map(([key, val]) => `
                <div class="ability-shield">
                    <span class="ability-label">${key.toUpperCase()}</span>
                    <div class="ability-mod-big" title="Klicken für 1d20 ${key.toUpperCase()}-Check"
                         onclick="triggerUniversalRoll('1d20${getMod(val)}', '${key.toUpperCase()}-Check', null, this)">
                        ${getMod(val)} 🎲
                    </div>
                    <input type="number" class="p-stat-input ability-score-oval" data-stat="${key}" value="${val}">
                </div>
            `).join('')}
        </div>

        <div class="combat-dashboard-row">
            <div class="card vitals-card">
                <span class="stat-box-title">LEBENSPUNKTE (HIT POINTS)</span>
                <div class="hp-fraction-row">
                    <input type="number" id="p-hp" class="hp-big-input" value="${char.hp}">
                    <span class="hp-slash">/</span>
                    <input type="number" id="p-maxhp" class="hp-big-input" value="${char.maxHp}">
                    <span class="muted">Max HP</span>
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
                    <input type="number" id="p-ac" class="compact-num-input" value="${char.ac}">
                </div>
                <div class="stat-shield-box">
                    <span class="stat-box-title">INITIATIVE</span>
                    <input type="number" id="p-init" class="compact-num-input" value="${char.initiative}">
                </div>
                <div class="stat-shield-box">
                    <span class="stat-box-title">LEVEL</span>
                    <input type="number" id="p-level" class="compact-num-input" value="${char.level}" min="1">
                </div>
                <div class="stat-shield-box">
                    <span class="stat-box-title">PROFICIENCY</span>
                    <input type="number" id="p-prof" class="compact-num-input" value="${char.proficiency}">
                </div>
                <div class="stat-shield-box">
                    <span class="stat-box-title">EXHAUSTION</span>
                    <input type="number" id="p-exh" class="compact-num-input" value="${char.exhaustion}" min="0" max="6">
                </div>
            </div>
        </div>

        <!-- Merkmale & Charakter-Datei nebeneinander -->
        <div class="bottom-grid">
            <div class="card" style="margin-bottom: 0;">
                <h3>Merkmale (Affinitäten, Mutationen & Psychosen)</h3>
                <div class="item-list">
                    ${char.affinities.length === 0 ? '<p class="muted">Keine Merkmale aktiv.</p>' : ''}
                    ${char.affinities.map((a, idx) => `
                        <div class="item-badge">
                            <div class="item-badge-left">
                                ${a.avatar ? `<img src="${a.avatar}" class="item-icon">` : `<div class="mini-avatar-placeholder">M</div>`}
                                <div>
                                    <strong>${a.name}</strong>
                                    <div class="cat-badge-row">
                                        ${(a.categories || []).map(c => `<span class="cat-tag">${c}</span>`).join('')}
                                    </div>
                                    <small><strong>Effekt:</strong> ${a.effect || a.desc || '-'}</small>
                                </div>
                            </div>
                            <button class="btn-del" onclick="removePlayerItem('affinities', ${idx})">X</button>
                        </div>
                    `).join('')}
                </div>

                <div class="player-creator-box">
                    <small class="muted">Eigenes Merkmal hinzufügen:</small>
                    <div id="p-aff-dropzone" class="drop-zone drop-zone-mini">
                        ${playerAffinityDraftAvatar
        ? `<img src="${playerAffinityDraftAvatar}" class="drop-preview-img">`
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

            <div class="card" style="margin-bottom: 0; justify-content: space-between;">
                <div class="creator-header-row" style="flex-wrap: wrap;">
                    <div>
                        <h3>Charakter-Datei (.json) speichern & laden</h3>
                        <small class="muted">Speichere deinen kompletten Charakter auf deinem Gerät oder ziehe eine gespeicherte Datei hier hinein.</small>
                    </div>
                    <button type="button" class="btn-secondary" onclick="exportPlayerCharToFile()">💾 Charakter als Datei speichern</button>
                </div>
                <div id="p-gameplay-json-dropzone" class="drop-zone" style="flex: 1; min-height: 150px;">
                    <div class="drop-zone-prompt">
                        <strong>📂 Gespeicherte Charakter-Datei (.json) hierher ziehen (Drag & Drop)</strong>
                        <span>Füllt alle Werte, Bilder & Notizen aus und fügt deine Items, Attacken & Zauber zur Session-Bibliothek hinzu</span>
                    </div>
                    <input type="file" id="p-gameplay-json-file" accept=".json,application/json" class="hidden">
                </div>
            </div>
        </div>
    `;

    bindImageDropZone('p-aff-dropzone', 'p-aff-file', (b64) => {
        playerAffinityDraftAvatar = b64;
        renderPlayerView(char.id);
    });

    bindJsonDropZone('p-gameplay-json-dropzone', 'p-gameplay-json-file', (parsed) => {
        applyImportedPlayerCharacter(parsed);
    });

    if (char.moralityVisible) {
        document.getElementById('btn-p-moral-minus').addEventListener('click', () => {
            char.morality -= 1;
            renderPlayerView(char.id);
            syncMyCharacter(char);
        });
        document.getElementById('btn-p-moral-plus').addEventListener('click', () => {
            char.morality += 1;
            renderPlayerView(char.id);
            syncMyCharacter(char);
        });
    }

    const bindNum = (id, prop) => {
        document.getElementById(id).addEventListener('change', (e) => {
            char[prop] = parseInt(e.target.value) || 0;
            renderPlayerView(char.id);
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
            char.stats[statKey] = parseInt(e.target.value) || 10;
            renderPlayerView(char.id);
            syncMyCharacter(char);
        });
    });

    document.getElementById('btn-p-add-aff').addEventListener('click', () => {
        const name = document.getElementById('p-new-a-name').value.trim();
        const cats = parsePlayerCategories(document.getElementById('p-new-a-cats').value);
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
    renderPlayerView(char.id);
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
        ? `<img src="${char.avatar}" class="avatar-large">
                               <button type="button" class="btn-del drop-remove-btn" onclick="removePlayerAvatar(event)">Bild entfernen</button>`
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
                    <button type="button" class="btn-secondary" onclick="exportPlayerCharToFile()">💾 Charakter auf Gerät speichern</button>
                    <div id="p-char-json-dropzone" class="drop-zone drop-zone-small">
                        <div class="drop-zone-prompt">
                            <strong>📂 Gespeicherten Charakter (.json) laden</strong>
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
                        <input type="text" id="p-name" value="${char.name}">
                    </label>
                    <label>Epoche / Herkunft
                        <input type="text" id="p-origin" value="${char.origin}">
                    </label>
                </div>

                <label>Alignment (Gesinnung)
                    <select id="p-alignment">
                        ${[
        "Rechtschaffen Gut (Lawful Good)", "Neutral Gut (Neutral Good)", "Chaotisch Gut (Chaotic Good)",
        "Rechtschaffen Neutral (Lawful Neutral)", "Neutral (True Neutral)", "Chaotisch Neutral (Chaotic Neutral)",
        "Rechtschaffen Böse (Lawful Evil)", "Neutral Böse (Neutral Evil)", "Chaotisch Böse (Chaotic Evil)"
    ].map(al => `<option value="${al}" ${char.alignment === al ? 'selected' : ''}>${al}</option>`).join('')}
                    </select>
                </label>

                <h3>Hintergrundgeschichte (Leben & Tod)</h3>
                <textarea id="p-backstory" rows="6" placeholder="Wer warst du vor deinem Tod? Wie bist du gestorben?">${char.backstory || ''}</textarea>

                <h3>Persönliche Session-Notizen</h3>
                <textarea id="p-notes" rows="6" placeholder="Hinweise, Namen von NPCs, Quests, verdächtige Beobachtungen...">${char.notes || ''}</textarea>
            </div>
        </div>
    `;

    bindImageDropZone('p-avatar-dropzone', 'p-avatar-file', (base64) => {
        char.avatar = base64;
        renderPlayerView(char.id);
        syncMyCharacter(char);
    });

    bindJsonDropZone('p-char-json-dropzone', 'p-char-json-file', (parsed) => {
        applyImportedPlayerCharacter(parsed);
    });

    document.getElementById('p-name').addEventListener('change', (e) => {
        char.name = e.target.value.trim() || char.name;
        renderPlayerView(char.id);
        syncMyCharacter(char);
    });

    document.getElementById('p-origin').addEventListener('change', (e) => {
        char.origin = e.target.value;
        renderPlayerView(char.id);
        syncMyCharacter(char);
    });

    document.getElementById('p-alignment').addEventListener('change', (e) => {
        char.alignment = e.target.value;
        renderPlayerView(char.id);
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
        char.avatar = "";
        renderPlayerView(char.id);
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
                    <small class="muted">10 Kupfer = 1 Silber | 10 Silber = 1 Gold | 10 Gold = 1 Platin (Gesamt: ${totalInCopper} Kupfer)</small>
                </div>
                <button id="btn-convert-coins" class="btn-secondary">Münzen optimal umrechnen (10:1)</button>
            </div>
            <div class="currency-four-grid">
                <div class="coin-box coin-cp">
                    <span>Kupfer (CP)</span>
                    <input type="number" id="coin-cp" value="${char.currency.cp}" min="0">
                </div>
                <div class="coin-box coin-sp">
                    <span>Silber (SP)</span>
                    <input type="number" id="coin-sp" value="${char.currency.sp}" min="0">
                </div>
                <div class="coin-box coin-gp">
                    <span>Gold (GP)</span>
                    <input type="number" id="coin-gp" value="${char.currency.gp}" min="0">
                </div>
                <div class="coin-box coin-pp">
                    <span>Platin (PP)</span>
                    <input type="number" id="coin-pp" value="${char.currency.pp}" min="0">
                </div>
            </div>
        </div>

        <!-- 1. GEGENSTÄNDE & BEUTEL -->
        <div class="card">
            <div class="creator-header-row">
                <h3>🎒 Gegenstände & Beutel</h3>
                <span class="packmass-badge ${isFull ? 'packmass-full' : ''}">
                    🎒 Beutelplatz: <strong>${bagUsed} / ${isInf ? '∞ (Unendlich)' : bagMax}</strong> Packmaß
                </span>
            </div>

            <div class="bag-capacity-box">
                <div class="bag-progress-track">
                    <div class="bag-progress-fill ${isFull ? 'fill-full' : ''}" style="width: ${fillPercent}%;"></div>
                </div>
                <small class="muted">
                    ${isInf
        ? 'Dein Beutel hat unendliche Kapazität (vom DM freigeschaltet).'
        : `Freier Platz: ${Math.max(0, bagMax - bagUsed)} Packmaß (Standard: 15 + STR = ${15 + (parseInt(char.stats?.str) || 10)} · Nur vom DM änderbar)`
    }
                </small>
            </div>

            <div class="item-list">
                ${char.items.length === 0 ? '<p class="muted">Keine Gegenstände im Beutel.</p>' : ''}
                ${char.items.map((item, idx) => `
                    <div class="item-badge">
                        <div class="item-badge-left">
                            ${item.avatar ? `<img src="${item.avatar}" class="item-icon">` : `<div class="mini-avatar-placeholder">I</div>`}
                            <div>
                                <div class="combat-name-line">
                                    <strong>${item.name}</strong>
                                    <span class="packmass-pill">📦 Packmaß: ${clampPackmass(item.packmass)}</span>
                                </div>
                                <div class="cat-badge-row">
                                    ${(item.categories || []).map(c => `<span class="cat-tag">${c}</span>`).join('')}
                                </div>
                                <small><strong>Anforderung:</strong> ${item.requirement || 'Keine'}</small>
                                <small><strong>Aktion:</strong> ${item.action || '-'}</small>
                            </div>
                        </div>
                        <button class="btn-del" onclick="removePlayerItem('items', ${idx})">X</button>
                    </div>
                `).join('')}
            </div>

            <div class="player-creator-box">
                <small class="muted">Gegenstand hinzufügen (Bild, Name, Packmaß 1–10, Kategorien, Anforderung, Aktion):</small>
                <div id="p-item-dropzone" class="drop-zone drop-zone-mini">
                    ${playerItemDraftAvatar
        ? `<img src="${playerItemDraftAvatar}" class="drop-preview-img">`
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
                <h3>⚔️ Attacken</h3>
                <div class="item-list">
                    ${char.attacks.length === 0 ? '<p class="muted">Noch keine Attacken.</p>' : ''}
                    ${char.attacks.map((atk, idx) => `
                        <div class="item-badge">
                            <div class="item-badge-left">
                                ${atk.avatar ? `<img src="${atk.avatar}" class="item-icon">` : `<div class="mini-avatar-placeholder">A</div>`}
                                <div>
                                    <strong>${atk.name}</strong>
                                    ${atk.usesExhaustion ? `<span class="exh-badge">⚡ Verbraucht 1 Exhaustion</span>` : ''}
                                    <div class="cat-badge-row">
                                        ${(atk.categories || []).map(c => `<span class="cat-tag">${c}</span>`).join('')}
                                    </div>
                                    <small><strong>Aktion:</strong> ${atk.action || 'Wartet auf DM...'}</small>
                                </div>
                            </div>
                            <div class="dm-badges">
                                <button type="button" onclick="usePlayerAttack(${idx}, this)">🎲 Nutzen</button>
                                <button class="btn-del" onclick="removePlayerItem('attacks', ${idx})">X</button>
                            </div>
                        </div>
                    `).join('')}
                </div>

                <div class="player-creator-box">
                    <small class="muted">Attacke hinzufügen (Bild, Name, Kategorien, Aktion, Exhaustion-Box):</small>
                    <div id="p-atk-dropzone" class="drop-zone drop-zone-mini">
                        ${playerAttackDraftAvatar
        ? `<img src="${playerAttackDraftAvatar}" class="drop-preview-img">`
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

            <!-- ZAUBER (NEU) -->
            <div class="card">
                <h3>✨ Zauber</h3>
                <div class="item-list">
                    ${char.spells.length === 0 ? '<p class="muted">Noch keine Zauber gelernt.</p>' : ''}
                    ${char.spells.map((sp, idx) => `
                        <div class="item-badge">
                            <div class="item-badge-left">
                                ${sp.avatar ? `<img src="${sp.avatar}" class="item-icon">` : `<div class="mini-avatar-placeholder">✨</div>`}
                                <div>
                                    <strong>${sp.name}</strong>
                                    ${sp.usesExhaustion ? `<span class="exh-badge">⚡ Verbraucht 1 Exhaustion</span>` : ''}
                                    <div class="cat-badge-row">
                                        ${(sp.categories || []).map(c => `<span class="cat-tag">${c}</span>`).join('')}
                                    </div>
                                    <small><strong>Anforderung:</strong> ${sp.requirement || 'Keine'}</small>
                                    <small><strong>Aktion:</strong> ${sp.action || 'Wartet auf DM...'}</small>
                                </div>
                            </div>
                            <div class="dm-badges">
                                <button type="button" onclick="usePlayerSpell(${idx}, this)">🎲 Wirken</button>
                                <button class="btn-del" onclick="removePlayerItem('spells', ${idx})">X</button>
                            </div>
                        </div>
                    `).join('')}
                </div>

                <div class="player-creator-box">
                    <small class="muted">Zauber hinzufügen (Bild, Name, Kategorien, Anforderung, Aktion, Exhaustion-Box):</small>
                    <div id="p-spell-dropzone" class="drop-zone drop-zone-mini">
                        ${playerSpellDraftAvatar
        ? `<img src="${playerSpellDraftAvatar}" class="drop-preview-img">`
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
        renderPlayerView(char.id);
    });

    bindImageDropZone('p-atk-dropzone', 'p-atk-file', (b64) => {
        playerAttackDraftAvatar = b64;
        renderPlayerView(char.id);
    });

    bindImageDropZone('p-spell-dropzone', 'p-spell-file', (b64) => {
        playerSpellDraftAvatar = b64;
        renderPlayerView(char.id);
    });

    ['cp', 'sp', 'gp', 'pp'].forEach(coin => {
        document.getElementById(`coin-${coin}`).addEventListener('change', (e) => {
            char.currency[coin] = Math.max(0, parseInt(e.target.value) || 0);
            renderPlayerView(char.id);
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

        renderPlayerView(char.id);
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

        const cats = parsePlayerCategories(document.getElementById('p-new-item-cats').value);
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
        const cats = parsePlayerCategories(document.getElementById('p-new-atk-cats').value);
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
        const cats = parsePlayerCategories(document.getElementById('p-new-spell-cats').value);
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
// TAB 4: SPIELER-KAMPFFELD (Nur Bewegungsmodus: Freies Schieben & Cursor-Zoom)
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
                        <h3>🗺️ Taktisches Kampffeld (${map.rows} × ${map.cols})</h3>
                        <small class="muted">
                            ${isMyCharInCombat
        ? 'Gedrückt halten zum freien Verschieben der Karte · Mausrad zoomt zum Mauszeiger · Ziehe deinen eigenen Token.'
        : 'Gedrückt halten zum freien Verschieben der Karte · Mausrad zoomt zum Mauszeiger.'
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

    if (atk.usesExhaustion) {
        char.exhaustion = Math.min(6, (char.exhaustion || 0) + 1);
        syncMyCharacter(char);
    }

    const formulaMatch = (atk.action || '').match(/(\d*d\d+(?:\s*[+-]\s*\d+)?)/i);
    const formula = formulaMatch ? formulaMatch[1] : '1d20';
    triggerUniversalRoll(formula, `${atk.name}`, char.name, btnEl);
    renderPlayerView(char.id);
}

function usePlayerSpell(idx, btnEl) {
    const char = gameState.characters[currentPlayerId];
    if (!char || !char.spells || !char.spells[idx]) return;
    const sp = char.spells[idx];

    if (sp.usesExhaustion) {
        char.exhaustion = Math.min(6, (char.exhaustion || 0) + 1);
        syncMyCharacter(char);
    }

    const formulaMatch = (sp.action || '').match(/(\d*d\d+(?:\s*[+-]\s*\d+)?)/i);
    const formula = formulaMatch ? formulaMatch[1] : '1d20';
    triggerUniversalRoll(formula, `✨ ${sp.name}`, char.name, btnEl);
    renderPlayerView(char.id);
}

function removePlayerItem(listKey, idx) {
    const char = gameState.characters[currentPlayerId];
    const item = char[listKey][idx];
    const label = item && item.name ? `"${item.name}"` : 'diesen Eintrag';

    openConfirmModal(`Möchtest du ${label} wirklich von deinem Charakterbogen entfernen?`, () => {
        char[listKey].splice(idx, 1);
        renderPlayerView(currentPlayerId);
        syncMyCharacter(char);
    });
}
