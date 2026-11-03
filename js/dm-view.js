let activeDmTab = 'gameplay';

let libSearchQuery = '';
let libSelectedCategory = 'ALL';
let libSelectedType = 'ALL';
let libSortBy = 'name';

let editingState = {
    npc: null,
    item: null,
    attack: null,
    affinity: null
};

let npcDraft = { avatar: '', items: [], attacks: [], affinities: [] };
let itemDraftAvatar = '';
let attackDraftAvatar = '';
let affinityDraftAvatar = '';

// Temporärer State für den "+ Neuer Block"-Dialog rechts in der Palette
let showNewBlockCreator = false;
let newBlockDraftColor = '#ef4444';
let newBlockDraftName = '';

function parseCategories(inputStr) {
    if (!inputStr) return [];
    return inputStr.split(',').map(c => c.trim()).filter(c => c.length > 0);
}

function getAllCustomCategories() {
    const set = new Set();
    const collect = (list) => {
        (list || []).forEach(entry => {
            (entry.categories || []).forEach(cat => set.add(cat));
        });
    };
    collect(gameState.npcTemplates);
    collect(gameState.customItems);
    collect(gameState.customAttacks);
    collect(gameState.customAffinities);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function ensureEnemyUids() {
    gameState.enemies.forEach((e, idx) => {
        if (!e._uid) {
            e._uid = 'npc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7) + '_' + idx;
        }
    });
}

function switchDmTab(tabName) {
    activeDmTab = tabName;
    document.getElementById('dm-tab-btn-gameplay').classList.toggle('active', tabName === 'gameplay');
    document.getElementById('dm-tab-btn-templates').classList.toggle('active', tabName === 'templates');
    document.getElementById('dm-tab-btn-combat').classList.toggle('active', tabName === 'combat');
    renderDmView();
}

function renderDmView() {
    const container = document.getElementById('dm-view-content');
    if (!container) return;
    ensureEnemyUids();
    ensureBattlemapState();

    if (activeDmTab === 'gameplay') {
        renderDmGameplayTab(container);
    } else if (activeDmTab === 'templates') {
        renderDmTemplatesTab(container);
    } else if (activeDmTab === 'combat') {
        renderDmCombatTab(container);
    }
}

// ============================================================================
// DM TAB 1: GAMEPLAY
// ============================================================================
function renderDmGameplayTab(container) {
    container.innerHTML = `
        <div class="dm-layout">
            <section class="dm-column dm-stack">
                <h2>Spieler im Spiel (Live)</h2>
                <div id="dm-player-list" class="dm-stack"></div>
            </section>

            <section class="dm-column dm-stack">
                <div class="dm-stack">
                    <h2>Monster & NPCs im Spiel</h2>
                    <div class="dm-assign-row">
                        <select id="dm-quick-spawn-select">
                            <option value="">-- Vorlage zum Spawnen wählen (${gameState.npcTemplates.length}) --</option>
                            ${gameState.npcTemplates.map((t, i) => `<option value="${i}">${t.name} (HP ${t.maxHp} | AC ${t.ac})</option>`).join('')}
                        </select>
                        <button class="btn-primary" onclick="dmSpawnFromTemplateSelect()">+ Spawnen</button>
                    </div>
                </div>
                <div id="dm-enemy-list" class="dm-stack"></div>
            </section>
        </div>
    `;

    renderDmPlayers();
    renderDmEnemies();
}

function dmSpawnFromTemplateSelect() {
    const select = document.getElementById('dm-quick-spawn-select');
    if (!select || select.value === "") return;
    dmSpawnNpcByIndex(parseInt(select.value));
}

function dmSpawnNpcByIndex(templateIdx) {
    const template = gameState.npcTemplates[templateIdx];
    if (!template) return;
    const spawned = JSON.parse(JSON.stringify(template));
    spawned._uid = 'npc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    gameState.enemies.push(spawned);
    broadcastState();
    renderDmView();
}

function renderDmPlayers() {
    const list = document.getElementById('dm-player-list');
    if (!list) return;
    const ids = Object.keys(gameState.characters);

    if (ids.length === 0) {
        list.innerHTML = `<div class="card"><p class="muted">Noch keine Spieler im Raum.</p></div>`;
        return;
    }

    list.innerHTML = ids.map(id => {
        const c = gameState.characters[id];
        if (!c.items) c.items = [];
        if (!c.attacks) c.attacks = [];
        if (!c.affinities) c.affinities = [];

        const bagUsed = getPlayerBagUsed(c);
        const bagMax = getPlayerBagMax(c);
        const defaultBagMax = 15 + (parseInt(c.stats?.str) || 10);
        const isInf = Boolean(c.bagInfinite);

        return `
            <div class="card dm-player-card">
                <div class="dm-player-header">
                    <div class="char-identity">
                        ${c.avatar ? `<img src="${c.avatar}" class="mini-avatar">` : `<div class="mini-avatar-placeholder">?</div>`}
                        <div>
                            <h3>${c.name} <small>(Lvl ${c.level} | ${c.alignment})</small></h3>
                            <span class="sub-info">${c.origin} | AC: ${c.ac} | Init: ${c.initiative} | Exh: ${c.exhaustion}</span>
                        </div>
                    </div>
                    <div class="dm-badges">
                        <span class="badge-hp">HP: ${c.hp}/${c.maxHp}</span>
                        ${c.hp <= 0 ? `<button type="button" class="btn-death" onclick="dmKillPlayer('${c.id}')">💀 Tot</button>` : ''}
                        <span class="badge-moral">${formatMorality(c.morality)}</span>
                    </div>
                </div>

                <div class="dm-moral-bar">
                    <label class="dm-checkbox-label">
                        <input type="checkbox" ${c.moralityVisible ? 'checked' : ''}
                            onchange="dmToggleMoralityVisibility('${c.id}', this.checked)">
                        Moral-Zähler für Spieler sichtbar (${c.moralityVisible ? 'Eingeblendet' : 'Geheim'})
                    </label>
                </div>

                <div class="dm-bag-control-row">
                    <div>
                        <strong>🎒 Beutel: ${bagUsed} / ${isInf ? '∞' : bagMax} Packmaß</strong>
                        <small class="muted" style="display:block;">Standard (15 + STR): ${defaultBagMax}</small>
                    </div>
                    <div class="dm-bag-inputs">
                        <input type="number" min="0" value="${isInf ? defaultBagMax : bagMax}"
                            ${isInf ? 'disabled' : ''}
                            onchange="dmSetPlayerBagMax('${c.id}', this.value)"
                            title="Maximale Beutel-Kapazität festlegen">
                        <button type="button" onclick="dmResetPlayerBagToDefault('${c.id}')" title="Auf Standard (15 + STR) zurücksetzen">
                            ↺ 15+STR
                        </button>
                        <label class="dm-checkbox-label">
                            <input type="checkbox" ${isInf ? 'checked' : ''}
                                onchange="dmTogglePlayerBagInfinite('${c.id}', this.checked)">
                            ∞ Unendlich
                        </label>
                    </div>
                </div>

                <div class="dm-mini-stats">
                    STR ${c.stats.str} | DEX ${c.stats.dex} | CON ${c.stats.con} |
                    INT ${c.stats.int} | WIS ${c.stats.wis} | CHA ${c.stats.cha}<br>
                    Geld: <span class="coin-pp"><strong>${c.currency.pp}</strong> PP</span> · <span class="coin-gp"><strong>${c.currency.gp}</strong> GP</span> · <span class="coin-sp"><strong>${c.currency.sp}</strong> SP</span> · <span class="coin-cp"><strong>${c.currency.cp}</strong> CP</span>
                </div>

                <div class="dm-quick-actions">
                    <button onclick="dmModifyStat('${c.id}', 'hp', -5)">-5 HP</button>
                    <button onclick="dmModifyStat('${c.id}', 'hp', -1)">-1 HP</button>
                    <button onclick="dmModifyStat('${c.id}', 'hp', 1)">+1 HP</button>
                    <button onclick="dmModifyStat('${c.id}', 'hp', 5)">+5 HP</button>
                    <button class="btn-demonic" onclick="dmModifyStat('${c.id}', 'morality', -1)">-1 Dämonisch</button>
                    <button class="btn-holy" onclick="dmModifyStat('${c.id}', 'morality', 1)">+1 Heilig</button>
                </div>

                <div class="dm-assign-row">
                    <select id="assign-item-${c.id}">
                        <option value="">-- Gegenstand geben (${gameState.customItems.length}) --</option>
                        ${gameState.customItems.map((it, i) => `<option value="${i}">${it.name} (Packmaß ${clampPackmass(it.packmass)} | ${it.action || 'Item'})</option>`).join('')}
                    </select>
                    <button class="btn-primary" onclick="dmAssignItem('${c.id}', 'customItems', 'items', 'assign-item-${c.id}')">+ Gegenstand</button>
                </div>

                <div class="dm-assign-row">
                    <select id="assign-atk-${c.id}">
                        <option value="">-- Attacke/Zauber geben (${gameState.customAttacks.length}) --</option>
                        ${gameState.customAttacks.map((w, i) => `<option value="${i}">${w.name} (${w.action})</option>`).join('')}
                    </select>
                    <button class="btn-primary" onclick="dmAssignItem('${c.id}', 'customAttacks', 'attacks', 'assign-atk-${c.id}')">+ Attacke</button>
                </div>

                <div class="dm-assign-row">
                    <select id="assign-aff-${c.id}">
                        <option value="">-- Merkmal geben (${gameState.customAffinities.length}) --</option>
                        ${gameState.customAffinities.map((a, i) => `<option value="${i}">${a.name} (${a.effect})</option>`).join('')}
                    </select>
                    <button class="btn-primary" onclick="dmAssignItem('${c.id}', 'customAffinities', 'affinities', 'assign-aff-${c.id}')">+ Merkmal</button>
                </div>

                <div class="dm-attacks-editor">
                    <strong>Attacken von ${c.name} (Aktion & Exhaustion live anpassen):</strong>
                    ${c.attacks.length === 0 ? '<p class="muted">Keine Attacken.</p>' : ''}
                    ${c.attacks.map((atk, idx) => `
                        <div class="dm-attack-row">
                            <span class="atk-title">${atk.name}</span>
                            <input type="text" value="${atk.action || ''}" placeholder="Aktion (Schaden / Effekt)"
                                onchange="dmUpdatePlayerAttack('${c.id}', ${idx}, 'action', this.value)">
                            <label class="dm-checkbox-label" title="Verbraucht Exhaustion Point">
                                <input type="checkbox" ${atk.usesExhaustion ? 'checked' : ''}
                                    onchange="dmUpdatePlayerAttack('${c.id}', ${idx}, 'usesExhaustion', this.checked)">
                                ⚡ Exh.
                            </label>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }).join('');
}

function dmSetPlayerBagMax(playerId, newVal) {
    const char = gameState.characters[playerId];
    if (!char) return;
    char.bagCustomMax = Math.max(0, parseInt(newVal) || 0);
    broadcastState();
    renderDmView();
}

function dmResetPlayerBagToDefault(playerId) {
    const char = gameState.characters[playerId];
    if (!char) return;
    char.bagCustomMax = null;
    char.bagInfinite = false;
    broadcastState();
    renderDmView();
}

function dmTogglePlayerBagInfinite(playerId, isInfinite) {
    const char = gameState.characters[playerId];
    if (!char) return;
    char.bagInfinite = Boolean(isInfinite);
    broadcastState();
    renderDmView();
}

function dmKillPlayer(playerId) {
    const char = gameState.characters[playerId];
    if (!char) return;

    openConfirmModal(`"${char.name}" hat 0 HP. Möchtest du diesen Charakter wirklich für TOT erklären und den Spieler zurück ins Hauptmenü schicken?`, () => {
        broadcastPlayerDeath(playerId);
        delete gameState.characters[playerId];
        gameState.combat.order = (gameState.combat.order || []).filter(entry => !(entry.kind === 'player' && entry.id === playerId));
        if (gameState.combat.turnIndex >= gameState.combat.order.length) {
            gameState.combat.turnIndex = 0;
        }
        broadcastState();
        renderChatWidget();
        renderDmView();
    });
}

function renderDmEnemies() {
    const list = document.getElementById('dm-enemy-list');
    if (!list) return;

    if (gameState.enemies.length === 0) {
        list.innerHTML = `<div class="card"><p class="muted">Keine aktiven Monster oder NPCs im Spiel.</p></div>`;
        return;
    }

    list.innerHTML = gameState.enemies.map((e, idx) => `
        <div class="npc-card">
            <div class="dm-player-header">
                <div class="char-identity">
                    ${e.avatar ? `<img src="${e.avatar}" class="mini-avatar">` : `<div class="mini-avatar-placeholder">M</div>`}
                    <div>
                        <strong>${e.name}</strong>
                        <span class="sub-info"> | AC: ${e.ac} | Init: ${e.initiative}</span>
                        <div class="cat-badge-row">
                            ${(e.categories || []).map(cat => `<span class="cat-tag">${cat}</span>`).join('')}
                        </div>
                    </div>
                </div>
                <div class="dm-badges">
                    <span class="badge-hp">HP: ${e.hp}/${e.maxHp}</span>
                    <span class="badge-moral">${formatMorality(e.morality)}</span>
                    <button class="btn-del" onclick="dmRemoveEnemy(${idx})">X</button>
                </div>
            </div>

            ${e.description ? `<p class="npc-desc-box">${e.description}</p>` : ''}

            <div class="dm-mini-stats">
                STR ${e.stats.str} | DEX ${e.stats.dex} | CON ${e.stats.con} |
                INT ${e.stats.int} | WIS ${e.stats.wis} | CHA ${e.stats.cha}<br>
                Geld: ${formatCopperCoins(e.copper || 0)}
            </div>

            <div class="npc-inventory-box">
                <div>
                    <strong>Gegenstände:</strong>
                    ${(e.items || []).length === 0 ? '<span class="muted">Keine</span>' : e.items.map((it, iIdx) =>
        `<span class="inline-item-pill">${it.name} [📦 ${clampPackmass(it.packmass)}] (${it.action || '-'}) <b onclick="dmRemoveNpcItem(${idx}, 'items', ${iIdx})">×</b></span>`
    ).join(' ')}
                </div>
                <div>
                    <strong>Attacken:</strong>
                    ${(e.attacks || []).length === 0 ? '<span class="muted">Keine</span>' : e.attacks.map((a, aIdx) =>
        `<span class="inline-item-pill">${a.name} (${a.action || '-'}) ${a.usesExhaustion ? '⚡' : ''} <b onclick="dmRemoveNpcItem(${idx}, 'attacks', ${aIdx})">×</b></span>`
    ).join(' ')}
                </div>
                <div>
                    <strong>Merkmale:</strong>
                    ${(e.affinities || []).length === 0 ? '<span class="muted">Keine</span>' : e.affinities.map((af, afIdx) =>
        `<span class="inline-item-pill">${af.name} (${af.effect || '-'}) <b onclick="dmRemoveNpcItem(${idx}, 'affinities', ${afIdx})">×</b></span>`
    ).join(' ')}
                </div>
            </div>

            <div class="picker-three-cols">
                <div class="dm-assign-row">
                    <select id="npc-add-item-${idx}">
                        <option value="">+ Gegenstand (${gameState.customItems.length})</option>
                        ${gameState.customItems.map((it, i) => `<option value="${i}">${it.name} (📦 ${clampPackmass(it.packmass)})</option>`).join('')}
                    </select>
                    <button onclick="dmGiveEnemyItem(${idx}, 'customItems', 'items', 'npc-add-item-${idx}')">+ Item</button>
                </div>
                <div class="dm-assign-row">
                    <select id="npc-add-atk-${idx}">
                        <option value="">+ Attacke (${gameState.customAttacks.length})</option>
                        ${gameState.customAttacks.map((w, i) => `<option value="${i}">${w.name}</option>`).join('')}
                    </select>
                    <button onclick="dmGiveEnemyItem(${idx}, 'customAttacks', 'attacks', 'npc-add-atk-${idx}')">+ Attacke</button>
                </div>
                <div class="dm-assign-row">
                    <select id="npc-add-aff-${idx}">
                        <option value="">+ Merkmal (${gameState.customAffinities.length})</option>
                        ${gameState.customAffinities.map((af, i) => `<option value="${i}">${af.name}</option>`).join('')}
                    </select>
                    <button onclick="dmGiveEnemyItem(${idx}, 'customAffinities', 'affinities', 'npc-add-aff-${idx}')">+ Merkmal</button>
                </div>
            </div>

            <div class="enemy-controls">
                <button onclick="dmModifyEnemy(${idx}, 'hp', -5)">-5 HP</button>
                <button onclick="dmModifyEnemy(${idx}, 'hp', -1)">-1 HP</button>
                <button onclick="dmModifyEnemy(${idx}, 'hp', 1)">+1 HP</button>
                <button onclick="dmModifyEnemy(${idx}, 'hp', 5)">+5 HP</button>
                <button class="btn-demonic" onclick="dmModifyEnemy(${idx}, 'morality', -1)">-1 Dämonisch</button>
                <button class="btn-holy" onclick="dmModifyEnemy(${idx}, 'morality', 1)">+1 Heilig</button>
            </div>
        </div>
    `).join('');
}

function dmGiveEnemyItem(enemyIdx, sourceKey, targetKey, selectId) {
    const select = document.getElementById(selectId);
    if (!select || select.value === "") return;
    const item = gameState[sourceKey][parseInt(select.value)];
    if (!gameState.enemies[enemyIdx][targetKey]) gameState.enemies[enemyIdx][targetKey] = [];
    gameState.enemies[enemyIdx][targetKey].push({ ...item });
    broadcastState();
    renderDmEnemies();
}

function dmRemoveNpcItem(enemyIdx, targetKey, itemIdx) {
    const enemy = gameState.enemies[enemyIdx];
    const item = enemy?.[targetKey]?.[itemIdx];
    openConfirmModal(`Möchtest du "${item?.name || 'diesen Eintrag'}" wirklich von "${enemy?.name}" entfernen?`, () => {
        gameState.enemies[enemyIdx][targetKey].splice(itemIdx, 1);
        broadcastState();
        renderDmEnemies();
    });
}

// ============================================================================
// DM TAB 2: STANDARDISIERTE VORLAGEN & BIBLIOTHEK
// ============================================================================
function renderDmTemplatesTab(container) {
    const eNpc = editingState.npc !== null ? gameState.npcTemplates[editingState.npc] : null;
    const eItem = editingState.item !== null ? gameState.customItems[editingState.item] : null;
    const eAtk = editingState.attack !== null ? gameState.customAttacks[editingState.attack] : null;
    const eAff = editingState.affinity !== null ? gameState.customAffinities[editingState.affinity] : null;

    container.innerHTML = `
        <div class="templates-vertical-stack">
            
            <h2>Vorlagen erstellen & bearbeiten</h2>

            <div class="card">
                <div class="creator-header-row">
                    <h3>1. Monster / NPC Vorlage</h3>
                    <select onchange="selectTemplateToEdit('npc', this.value)">
                        <option value="">-- Neu erstellen (oder Vorlage zum Bearbeiten wählen) --</option>
                        ${gameState.npcTemplates.map((t, i) => `<option value="${i}" ${editingState.npc === i ? 'selected' : ''}>Bearbeiten: ${t.name}</option>`).join('')}
                    </select>
                </div>

                <div class="npc-creator-grid">
                    <div id="dm-npc-dropzone" class="drop-zone">
                        ${npcDraft.avatar
        ? `<img src="${npcDraft.avatar}" class="drop-preview-img">
                               <button type="button" class="btn-del drop-remove-btn" onclick="clearDraftAvatar('npc', event)">X</button>`
        : `<div class="drop-zone-prompt"><strong>Monster/NPC Bild</strong><span>Hierher ziehen oder klicken</span></div>`
    }
                        <input type="file" id="dm-npc-file" accept="image/*" class="hidden">
                    </div>

                    <div class="dm-stack">
                        <div class="form-row">
                            <label class="field-label">NAME
                                <input type="text" id="dm-npc-name" placeholder="z.B. Gefallener Paladin" value="${eNpc ? eNpc.name : ''}">
                            </label>
                            <label class="field-label">KATEGORIEN (MIT KOMMA TRENNEN)
                                <input type="text" id="dm-npc-cats" placeholder="z.B. Monster, Ritter, Boss" value="${eNpc ? (eNpc.categories || []).join(', ') : ''}">
                            </label>
                        </div>

                        <label class="field-label">BESCHREIBUNG & VERHALTEN
                            <textarea id="dm-npc-desc" rows="2" placeholder="Beschreibung, Verhalten, Hintergrund...">${eNpc ? (eNpc.description || '') : ''}</textarea>
                        </label>

                        <div class="npc-combat-inputs">
                            <label class="field-label">MAX HP
                                <input type="number" id="dm-npc-hp" value="${eNpc ? eNpc.maxHp : 30}">
                            </label>
                            <label class="field-label">ARMOR CLASS
                                <input type="number" id="dm-npc-ac" value="${eNpc ? eNpc.ac : 14}">
                            </label>
                            <label class="field-label">INITIATIVE
                                <input type="number" id="dm-npc-init" value="${eNpc ? eNpc.initiative : 0}">
                            </label>
                            <label class="field-label">MORAL
                                <input type="number" id="dm-npc-moral" value="${eNpc ? eNpc.morality : 0}">
                            </label>
                            <label class="field-label">GELD IN KUPFER (CP)
                                <input type="number" id="dm-npc-copper" min="0" value="${eNpc ? (eNpc.copper || 0) : 0}">
                            </label>
                        </div>

                        <div class="npc-stats-inputs">
                            <label class="field-label">STR
                                <input type="number" id="dm-npc-str" value="${eNpc ? eNpc.stats.str : 10}">
                            </label>
                            <label class="field-label">DEX
                                <input type="number" id="dm-npc-dex" value="${eNpc ? eNpc.stats.dex : 10}">
                            </label>
                            <label class="field-label">CON
                                <input type="number" id="dm-npc-con" value="${eNpc ? eNpc.stats.con : 10}">
                            </label>
                            <label class="field-label">INT
                                <input type="number" id="dm-npc-int" value="${eNpc ? eNpc.stats.int : 10}">
                            </label>
                            <label class="field-label">WIS
                                <input type="number" id="dm-npc-wis" value="${eNpc ? eNpc.stats.wis : 10}">
                            </label>
                            <label class="field-label">CHA
                                <input type="number" id="dm-npc-cha" value="${eNpc ? eNpc.stats.cha : 10}">
                            </label>
                        </div>
                    </div>
                </div>

                <div class="npc-library-picker">
                    <div class="picker-three-cols">
                        <div class="dm-assign-row">
                            <select id="draft-select-item">
                                <option value="">-- Gegenstand (${gameState.customItems.length}) --</option>
                                ${gameState.customItems.map((it, i) => `<option value="${i}">${it.name} (📦 ${clampPackmass(it.packmass)})</option>`).join('')}
                            </select>
                            <button type="button" onclick="addToNpcDraft('customItems', 'items', 'draft-select-item')">+ Gegenstand</button>
                        </div>

                        <div class="dm-assign-row">
                            <select id="draft-select-atk">
                                <option value="">-- Attacke (${gameState.customAttacks.length}) --</option>
                                ${gameState.customAttacks.map((a, i) => `<option value="${i}">${a.name}</option>`).join('')}
                            </select>
                            <button type="button" onclick="addToNpcDraft('customAttacks', 'attacks', 'draft-select-atk')">+ Attacke</button>
                        </div>

                        <div class="dm-assign-row">
                            <select id="draft-select-aff">
                                <option value="">-- Merkmal (${gameState.customAffinities.length}) --</option>
                                ${gameState.customAffinities.map((af, i) => `<option value="${i}">${af.name}</option>`).join('')}
                            </select>
                            <button type="button" onclick="addToNpcDraft('customAffinities', 'affinities', 'draft-select-aff')">+ Merkmal</button>
                        </div>
                    </div>
                    <div id="npc-draft-items-list" class="npc-inventory-box"></div>
                </div>

                <div class="form-row">
                    <button class="btn-primary" onclick="saveNpcTemplate(false)">
                        ${editingState.npc !== null ? 'Änderungen an Vorlage speichern' : 'Als neue Vorlage speichern'}
                    </button>
                    <button class="btn-secondary" onclick="saveNpcTemplate(true)">Speichern & Direkt spawnen</button>
                    ${editingState.npc !== null ? `<button onclick="selectTemplateToEdit('npc', '')">Abbrechen</button>` : ''}
                </div>
            </div>

            <div class="creators-three-grid">
                
                <div class="card">
                    <div class="creator-header-row">
                        <h3>2. Gegenstände</h3>
                        <select onchange="selectTemplateToEdit('item', this.value)">
                            <option value="">-- Neu / Bearbeiten --</option>
                            ${gameState.customItems.map((it, i) => `<option value="${i}" ${editingState.item === i ? 'selected' : ''}>Bearbeiten: ${it.name}</option>`).join('')}
                        </select>
                    </div>

                    <div id="dm-item-dropzone" class="drop-zone drop-zone-small">
                        ${itemDraftAvatar
        ? `<img src="${itemDraftAvatar}" class="drop-preview-img">
                               <button type="button" class="btn-del drop-remove-btn" onclick="clearDraftAvatar('item', event)">X</button>`
        : `<div class="drop-zone-prompt"><strong>Bild (Gegenstand)</strong><span>Drag & Drop oder Klick</span></div>`
    }
                        <input type="file" id="dm-item-file" accept="image/*" class="hidden">
                    </div>

                    <div class="form-row">
                        <label class="field-label">NAME
                            <input type="text" id="dm-item-name" placeholder="z.B. Schwarze Klinge" value="${eItem ? eItem.name : ''}">
                        </label>
                        <label class="field-label">PACKMASS (1–10)
                            <input type="number" id="dm-item-packmass" min="1" max="10" value="${eItem ? clampPackmass(eItem.packmass) : 1}">
                        </label>
                    </div>
                    <label class="field-label">KATEGORIEN (KOMMAGETRENNT)
                        <input type="text" id="dm-item-cats" placeholder="z.B. Waffe, Schwert, Rüstung" value="${eItem ? (eItem.categories || []).join(', ') : ''}">
                    </label>
                    <label class="field-label">ANFORDERUNG
                        <input type="text" id="dm-item-req" placeholder="z.B. STR 14, Moral -2" value="${eItem ? (eItem.requirement || '') : ''}">
                    </label>
                    <label class="field-label">AKTION
                        <input type="text" id="dm-item-action" placeholder="z.B. 1d8 Schnitt / +2 AC" value="${eItem ? (eItem.action || '') : ''}">
                    </label>
                    
                    <div class="form-row">
                        <button class="btn-primary" onclick="saveCustomItem()">
                            ${editingState.item !== null ? 'Änderungen speichern' : 'Gegenstand speichern'}
                        </button>
                        ${editingState.item !== null ? `<button onclick="selectTemplateToEdit('item', '')">Neu</button>` : ''}
                    </div>
                </div>

                <div class="card">
                    <div class="creator-header-row">
                        <h3>3. Attacken</h3>
                        <select onchange="selectTemplateToEdit('attack', this.value)">
                            <option value="">-- Neu / Bearbeiten --</option>
                            ${gameState.customAttacks.map((a, i) => `<option value="${i}" ${editingState.attack === i ? 'selected' : ''}>Bearbeiten: ${a.name}</option>`).join('')}
                        </select>
                    </div>

                    <div id="dm-atk-dropzone" class="drop-zone drop-zone-small">
                        ${attackDraftAvatar
        ? `<img src="${attackDraftAvatar}" class="drop-preview-img">
                               <button type="button" class="btn-del drop-remove-btn" onclick="clearDraftAvatar('attack', event)">X</button>`
        : `<div class="drop-zone-prompt"><strong>Bild (Attacke)</strong><span>Drag & Drop oder Klick</span></div>`
    }
                        <input type="file" id="dm-atk-file" accept="image/*" class="hidden">
                    </div>

                    <label class="field-label">NAME
                        <input type="text" id="dm-atk-name" placeholder="z.B. Höllenfeuer / Lichtspeer" value="${eAtk ? eAtk.name : ''}">
                    </label>
                    <label class="field-label">KATEGORIEN (KOMMAGETRENNT)
                        <input type="text" id="dm-atk-cats" placeholder="z.B. Zauber, Heilig, Dämonisch" value="${eAtk ? (eAtk.categories || []).join(', ') : ''}">
                    </label>
                    <label class="field-label">AKTION
                        <input type="text" id="dm-atk-action" placeholder="z.B. 2d6+3 Feuerschaden (kostet 2 Moral)" value="${eAtk ? (eAtk.action || '') : ''}">
                    </label>
                    <label class="checkbox-inline-row">
                        <input type="checkbox" id="dm-atk-exh" ${eAtk && eAtk.usesExhaustion ? 'checked' : ''}>
                        Verbraucht Exhaustion Point
                    </label>

                    <div class="form-row">
                        <button class="btn-primary" onclick="saveCustomAttack()">
                            ${editingState.attack !== null ? 'Änderungen speichern' : 'Attacke speichern'}
                        </button>
                        ${editingState.attack !== null ? `<button onclick="selectTemplateToEdit('attack', '')">Neu</button>` : ''}
                    </div>
                </div>

                <div class="card">
                    <div class="creator-header-row">
                        <h3>4. Merkmale</h3>
                        <select onchange="selectTemplateToEdit('affinity', this.value)">
                            <option value="">-- Neu / Bearbeiten --</option>
                            ${gameState.customAffinities.map((af, i) => `<option value="${i}" ${editingState.affinity === i ? 'selected' : ''}>Bearbeiten: ${af.name}</option>`).join('')}
                        </select>
                    </div>

                    <div id="dm-aff-dropzone" class="drop-zone drop-zone-small">
                        ${affinityDraftAvatar
        ? `<img src="${affinityDraftAvatar}" class="drop-preview-img">
                               <button type="button" class="btn-del drop-remove-btn" onclick="clearDraftAvatar('affinity', event)">X</button>`
        : `<div class="drop-zone-prompt"><strong>Bild (Merkmal)</strong><span>Drag & Drop oder Klick</span></div>`
    }
                        <input type="file" id="dm-aff-file" accept="image/*" class="hidden">
                    </div>

                    <label class="field-label">NAME
                        <input type="text" id="dm-aff-name" placeholder="z.B. Paranoia / Dämonenflügel" value="${eAff ? eAff.name : ''}">
                    </label>
                    <label class="field-label">KATEGORIEN (KOMMAGETRENNT)
                        <input type="text" id="dm-aff-cats" placeholder="z.B. Psychose, Mutation, Segen" value="${eAff ? (eAff.categories || []).join(', ') : ''}">
                    </label>
                    <label class="field-label">EFFEKT
                        <input type="text" id="dm-aff-effect" placeholder="z.B. +2 Initiative, -2 WIS" value="${eAff ? (eAff.effect || '') : ''}">
                    </label>

                    <div class="form-row">
                        <button class="btn-primary" onclick="saveCustomAffinity()">
                            ${editingState.affinity !== null ? 'Änderungen speichern' : 'Merkmal speichern'}
                        </button>
                        ${editingState.affinity !== null ? `<button onclick="selectTemplateToEdit('affinity', '')">Neu</button>` : ''}
                    </div>
                </div>

            </div>

            <h2>Bibliothek (Alle erstellten Vorlagen)</h2>
            <div class="card">
                <div class="form-row">
                    <input type="text" id="lib-search-input" placeholder="Nach Name suchen..." value="${libSearchQuery}">
                    <select id="lib-type-select">
                        <option value="ALL" ${libSelectedType === 'ALL' ? 'selected' : ''}>Alle Typen</option>
                        <option value="npc" ${libSelectedType === 'npc' ? 'selected' : ''}>Monster & NPCs</option>
                        <option value="item" ${libSelectedType === 'item' ? 'selected' : ''}>Gegenstände</option>
                        <option value="attack" ${libSelectedType === 'attack' ? 'selected' : ''}>Attacken</option>
                        <option value="affinity" ${libSelectedType === 'affinity' ? 'selected' : ''}>Merkmale</option>
                    </select>
                    <select id="lib-sort-select">
                        <option value="name" ${libSortBy === 'name' ? 'selected' : ''}>Sortieren: Name (A-Z)</option>
                        <option value="category" ${libSortBy === 'category' ? 'selected' : ''}>Sortieren: Kategorie</option>
                        <option value="type" ${libSortBy === 'type' ? 'selected' : ''}>Sortieren: Typ</option>
                    </select>
                </div>

                <div>
                    <small class="muted">Nach deinen Kategorien filtern:</small>
                    <div id="lib-category-pills" class="category-pills-bar"></div>
                </div>

                <div id="library-results-list" class="library-grid"></div>
            </div>

        </div>
    `;

    bindImageDropZone('dm-npc-dropzone', 'dm-npc-file', (b64) => { npcDraft.avatar = b64; renderDmView(); });
    bindImageDropZone('dm-item-dropzone', 'dm-item-file', (b64) => { itemDraftAvatar = b64; renderDmView(); });
    bindImageDropZone('dm-atk-dropzone', 'dm-atk-file', (b64) => { attackDraftAvatar = b64; renderDmView(); });
    bindImageDropZone('dm-aff-dropzone', 'dm-aff-file', (b64) => { affinityDraftAvatar = b64; renderDmView(); });

    document.getElementById('lib-search-input').addEventListener('input', (e) => {
        libSearchQuery = e.target.value;
        renderLibraryResults();
    });
    document.getElementById('lib-type-select').addEventListener('change', (e) => {
        libSelectedType = e.target.value;
        renderLibraryResults();
    });
    document.getElementById('lib-sort-select').addEventListener('change', (e) => {
        libSortBy = e.target.value;
        renderLibraryResults();
    });

    renderNpcDraftPreview();
    renderCategoryPills();
    renderLibraryResults();
}

function clearDraftAvatar(type, e) {
    e.stopPropagation();
    openConfirmModal("Möchtest du dieses Vorschaubild wirklich entfernen?", () => {
        if (type === 'npc') npcDraft.avatar = '';
        if (type === 'item') itemDraftAvatar = '';
        if (type === 'attack') attackDraftAvatar = '';
        if (type === 'affinity') affinityDraftAvatar = '';
        renderDmView();
    });
}

function selectTemplateToEdit(type, idxStr) {
    const idx = idxStr === "" ? null : parseInt(idxStr);
    editingState[type] = idx;

    if (type === 'npc') {
        if (idx !== null) {
            const t = gameState.npcTemplates[idx];
            npcDraft = {
                avatar: t.avatar || '',
                items: JSON.parse(JSON.stringify(t.items || [])),
                attacks: JSON.parse(JSON.stringify(t.attacks || [])),
                affinities: JSON.parse(JSON.stringify(t.affinities || []))
            };
        } else {
            npcDraft = { avatar: '', items: [], attacks: [], affinities: [] };
        }
    } else if (type === 'item') {
        itemDraftAvatar = idx !== null ? (gameState.customItems[idx].avatar || '') : '';
    } else if (type === 'attack') {
        attackDraftAvatar = idx !== null ? (gameState.customAttacks[idx].avatar || '') : '';
    } else if (type === 'affinity') {
        affinityDraftAvatar = idx !== null ? (gameState.customAffinities[idx].avatar || '') : '';
    }

    renderDmView();
}

function renderNpcDraftPreview() {
    const itemsBox = document.getElementById('npc-draft-items-list');
    if (!itemsBox) return;
    itemsBox.innerHTML = `
        <div><strong>Gegenstände:</strong> ${npcDraft.items.map((it, i) => `<span class="inline-item-pill">${it.name} [📦 ${clampPackmass(it.packmass)}] <b onclick="removeFromNpcDraft('items', ${i})">×</b></span>`).join(' ') || '<span class="muted">Keine</span>'}</div>
        <div><strong>Attacken:</strong> ${npcDraft.attacks.map((a, i) => `<span class="inline-item-pill">${a.name} <b onclick="removeFromNpcDraft('attacks', ${i})">×</b></span>`).join(' ') || '<span class="muted">Keine</span>'}</div>
        <div><strong>Merkmale:</strong> ${npcDraft.affinities.map((af, i) => `<span class="inline-item-pill">${af.name} <b onclick="removeFromNpcDraft('affinities', ${i})">×</b></span>`).join(' ') || '<span class="muted">Keine</span>'}</div>
    `;
}

function addToNpcDraft(sourceKey, targetKey, selectId) {
    const select = document.getElementById(selectId);
    if (!select || select.value === "") return;
    const item = gameState[sourceKey][parseInt(select.value)];
    npcDraft[targetKey].push({ ...item });
    renderNpcDraftPreview();
}

function removeFromNpcDraft(targetKey, idx) {
    openConfirmModal("Diesen Eintrag wirklich aus dem Vorlagen-Entwurf entfernen?", () => {
        npcDraft[targetKey].splice(idx, 1);
        renderNpcDraftPreview();
    });
}

function saveNpcTemplate(spawnImmediately) {
    const name = document.getElementById('dm-npc-name').value.trim();
    if (!name) return alert("Bitte einen Namen für das Monster / den NPC eingeben!");

    const hp = parseInt(document.getElementById('dm-npc-hp').value) || 20;
    const copper = Math.max(0, parseInt(document.getElementById('dm-npc-copper').value) || 0);

    const newNpc = {
        name: name,
        categories: parseCategories(document.getElementById('dm-npc-cats').value),
        avatar: npcDraft.avatar,
        description: document.getElementById('dm-npc-desc').value.trim(),
        hp: hp,
        maxHp: hp,
        ac: parseInt(document.getElementById('dm-npc-ac').value) || 10,
        initiative: parseInt(document.getElementById('dm-npc-init').value) || 0,
        morality: parseInt(document.getElementById('dm-npc-moral').value) || 0,
        copper: copper,
        stats: {
            str: parseInt(document.getElementById('dm-npc-str').value) || 10,
            dex: parseInt(document.getElementById('dm-npc-dex').value) || 10,
            con: parseInt(document.getElementById('dm-npc-con').value) || 10,
            int: parseInt(document.getElementById('dm-npc-int').value) || 10,
            wis: parseInt(document.getElementById('dm-npc-wis').value) || 10,
            cha: parseInt(document.getElementById('dm-npc-cha').value) || 10
        },
        items: JSON.parse(JSON.stringify(npcDraft.items)),
        attacks: JSON.parse(JSON.stringify(npcDraft.attacks)),
        affinities: JSON.parse(JSON.stringify(npcDraft.affinities))
    };

    if (editingState.npc !== null) {
        gameState.npcTemplates[editingState.npc] = newNpc;
        editingState.npc = null;
    } else {
        gameState.npcTemplates.push(newNpc);
    }

    if (spawnImmediately) {
        const spawned = JSON.parse(JSON.stringify(newNpc));
        spawned._uid = 'npc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        gameState.enemies.push(spawned);
    }

    npcDraft = { avatar: '', items: [], attacks: [], affinities: [] };
    broadcastState();
    renderDmView();
}

function saveCustomItem() {
    const name = document.getElementById('dm-item-name').value.trim();
    const rawPackmass = parseInt(document.getElementById('dm-item-packmass').value);
    if (!name) return alert("Bitte Gegenstandsname eingeben!");
    if (isNaN(rawPackmass) || rawPackmass < 1 || rawPackmass > 10) {
        return alert("Das Packmaß muss zwischen 1 und 10 liegen!");
    }

    const obj = {
        avatar: itemDraftAvatar,
        name: name,
        packmass: clampPackmass(rawPackmass),
        categories: parseCategories(document.getElementById('dm-item-cats').value),
        requirement: document.getElementById('dm-item-req').value.trim(),
        action: document.getElementById('dm-item-action').value.trim()
    };

    if (editingState.item !== null) {
        gameState.customItems[editingState.item] = obj;
        editingState.item = null;
    } else {
        gameState.customItems.push(obj);
    }
    itemDraftAvatar = '';
    broadcastState();
    renderDmView();
}

function saveCustomAttack() {
    const name = document.getElementById('dm-atk-name').value.trim();
    if (!name) return alert("Bitte Namen der Attacke eingeben!");

    const obj = {
        avatar: attackDraftAvatar,
        name: name,
        categories: parseCategories(document.getElementById('dm-atk-cats').value),
        action: document.getElementById('dm-atk-action').value.trim() || '1d6',
        usesExhaustion: document.getElementById('dm-atk-exh').checked
    };

    if (editingState.attack !== null) {
        gameState.customAttacks[editingState.attack] = obj;
        editingState.attack = null;
    } else {
        gameState.customAttacks.push(obj);
    }
    attackDraftAvatar = '';
    broadcastState();
    renderDmView();
}

function saveCustomAffinity() {
    const name = document.getElementById('dm-aff-name').value.trim();
    if (!name) return alert("Bitte Namen für das Merkmal eingeben!");

    const obj = {
        avatar: affinityDraftAvatar,
        name: name,
        categories: parseCategories(document.getElementById('dm-aff-cats').value),
        effect: document.getElementById('dm-aff-effect').value.trim()
    };

    if (editingState.affinity !== null) {
        gameState.customAffinities[editingState.affinity] = obj;
        editingState.affinity = null;
    } else {
        gameState.customAffinities.push(obj);
    }
    affinityDraftAvatar = '';
    broadcastState();
    renderDmView();
}

function renderCategoryPills() {
    const bar = document.getElementById('lib-category-pills');
    if (!bar) return;

    const allCats = getAllCustomCategories();
    bar.innerHTML = `
        <button class="cat-pill ${libSelectedCategory === 'ALL' ? 'active' : ''}" onclick="selectLibCategory('ALL')">Alle Kategorien</button>
        ${allCats.map(cat => `
            <button class="cat-pill ${libSelectedCategory.toLowerCase() === cat.toLowerCase() ? 'active' : ''}"
                onclick="selectLibCategory('${cat.replace(/'/g, "\\'")}')">${cat}</button>
        `).join('')}
    `;
}

function selectLibCategory(cat) {
    libSelectedCategory = cat;
    renderCategoryPills();
    renderLibraryResults();
}

function renderLibraryResults() {
    const listEl = document.getElementById('library-results-list');
    if (!listEl) return;

    let combined = [];
    gameState.npcTemplates.forEach((item, idx) => combined.push({ ...item, _libType: 'npc', _typeLabel: 'Monster / NPC', _idx: idx }));
    gameState.customItems.forEach((item, idx) => combined.push({ ...item, _libType: 'item', _typeLabel: 'Gegenstand', _idx: idx }));
    gameState.customAttacks.forEach((item, idx) => combined.push({ ...item, _libType: 'attack', _typeLabel: 'Attacke', _idx: idx }));
    gameState.customAffinities.forEach((item, idx) => combined.push({ ...item, _libType: 'affinity', _typeLabel: 'Merkmal', _idx: idx }));

    if (libSelectedType !== 'ALL') {
        combined = combined.filter(item => item._libType === libSelectedType);
    }
    if (libSelectedCategory !== 'ALL') {
        combined = combined.filter(item =>
            (item.categories || []).some(c => c.toLowerCase() === libSelectedCategory.toLowerCase())
        );
    }
    if (libSearchQuery.trim() !== '') {
        const q = libSearchQuery.trim().toLowerCase();
        combined = combined.filter(item => item.name.toLowerCase().includes(q));
    }

    combined.sort((a, b) => {
        if (libSortBy === 'category') {
            const catA = (a.categories && a.categories[0]) ? a.categories[0] : 'ZZZ';
            const catB = (b.categories && b.categories[0]) ? b.categories[0] : 'ZZZ';
            return catA.localeCompare(catB) || a.name.localeCompare(b.name);
        }
        if (libSortBy === 'type') {
            return a._typeLabel.localeCompare(b._typeLabel) || a.name.localeCompare(b.name);
        }
        return a.name.localeCompare(b.name);
    });

    if (combined.length === 0) {
        listEl.innerHTML = `<p class="muted">Keine Vorlagen in der Bibliothek gefunden.</p>`;
        return;
    }

    listEl.innerHTML = combined.map(item => `
        <div class="lib-item-card">
            <div class="dm-player-header">
                <div class="char-identity">
                    ${item.avatar ? `<img src="${item.avatar}" class="mini-avatar">` : `<div class="mini-avatar-placeholder">${item.name[0]}</div>`}
                    <div>
                        <span class="tag">${item._typeLabel}</span>
                        <strong>${item.name}</strong>
                        ${item._libType === 'item' ? `<span class="packmass-pill">📦 Packmaß: ${clampPackmass(item.packmass)}</span>` : ''}
                        ${item._libType === 'attack' && item.usesExhaustion ? `<span class="exh-badge">⚡ Exhaustion</span>` : ''}
                        <div class="cat-badge-row">
                            ${(item.categories || []).map(cat => `<span class="cat-tag">${cat}</span>`).join('')}
                        </div>
                    </div>
                </div>
                <div class="dm-badges">
                    <button onclick="selectTemplateToEdit('${item._libType}', '${item._idx}'); window.scrollTo({top: 0, behavior: 'smooth'});">Bearbeiten</button>
                    ${item._libType === 'npc'
        ? `<button class="btn-primary" onclick="dmSpawnNpcByIndex(${item._idx}); switchDmTab('gameplay');">Spawnen</button>`
        : ''
    }
                    <button class="btn-del" onclick="deleteLibraryItem('${item._libType}', ${item._idx})">X</button>
                </div>
            </div>

            ${item._libType === 'npc' ? `
                ${item.description ? `<p class="npc-desc-box">${item.description}</p>` : ''}
                <small class="muted">HP: ${item.maxHp} | AC: ${item.ac} | Init: ${item.initiative} | Moral: ${item.morality} | Geld: ${formatCopperCoins(item.copper || 0)}</small>
            ` : ''}

            ${item._libType === 'item' ? `
                <small class="muted"><strong>Anforderung:</strong> ${item.requirement || 'Keine'} | <strong>Aktion:</strong> ${item.action || '-'}</small>
            ` : ''}

            ${item._libType === 'attack' ? `
                <small class="muted"><strong>Aktion:</strong> ${item.action || '-'}</small>
            ` : ''}

            ${item._libType === 'affinity' ? `
                <small class="muted"><strong>Effekt:</strong> ${item.effect || '-'}</small>
            ` : ''}
        </div>
    `).join('');
}

function deleteLibraryItem(libType, idx) {
    let itemName = 'diese Vorlage';
    if (libType === 'npc') itemName = gameState.npcTemplates[idx]?.name;
    if (libType === 'item') itemName = gameState.customItems[idx]?.name;
    if (libType === 'attack') itemName = gameState.customAttacks[idx]?.name;
    if (libType === 'affinity') itemName = gameState.customAffinities[idx]?.name;

    openConfirmModal(`Möchtest du "${itemName}" wirklich dauerhaft aus der Bibliothek löschen?`, () => {
        if (libType === 'npc') gameState.npcTemplates.splice(idx, 1);
        if (libType === 'item') gameState.customItems.splice(idx, 1);
        if (libType === 'attack') gameState.customAttacks.splice(idx, 1);
        if (libType === 'affinity') gameState.customAffinities.splice(idx, 1);
        editingState[libType] = null;
        broadcastState();
        renderDmView();
    });
}

// ============================================================================
// DM TAB 3: NEUES TAKTISCHES KAMPFFELD (Top-Leiste + 3-Spalten-Cockpit)
// ============================================================================
function resolveCombatant(entry) {
    return resolveCombatantShared(entry);
}

function cleanStaleCombatants() {
    ensureEnemyUids();
    ensureBattlemapState();
    gameState.combat.order = (gameState.combat.order || []).filter(entry => {
        return resolveCombatant(entry) !== null;
    });
    if (gameState.combat.turnIndex >= gameState.combat.order.length) {
        gameState.combat.turnIndex = 0;
    }
}

function syncPlayersOnlyIntoCombat() {
    ensureEnemyUids();
    cleanStaleCombatants();

    const teamNames = Object.keys(gameState.combat.teams);
    const defaultPlayerTeam = teamNames.includes("Helden") ? "Helden" : teamNames[0];

    Object.keys(gameState.characters).forEach(pid => {
        const c = gameState.characters[pid];
        const key = `player_${pid}`;
        const alreadyInCombat = gameState.combat.order.some(e => e.key === key);
        if (!alreadyInCombat) {
            const free = findFirstFreeGridCell(key);
            gameState.combat.order.push({
                key: key,
                kind: 'player',
                id: pid,
                initiative: c.initiative || 10,
                teamName: defaultPlayerTeam,
                conditions: [],
                row: free.row,
                col: free.col
            });
        }
    });

    gameState.combat.active = true;
    if (!gameState.combat.round) gameState.combat.round = 1;
    sortCombatOrder();
    broadcastState();
    renderDmView();
}

function addSelectedParticipantToCombat() {
    ensureBattlemapState();
    const partSelect = document.getElementById('combat-add-participant-select');
    const teamSelect = document.getElementById('combat-add-team-select');
    if (!partSelect || !partSelect.value) {
        return alert("Bitte zuerst einen Spieler oder ein Monster/NPC aus der Liste auswählen!");
    }

    const val = partSelect.value;
    const teamName = teamSelect ? teamSelect.value : "Helden";

    if (val.startsWith('player:')) {
        const pid = val.replace('player:', '');
        const c = gameState.characters[pid];
        if (!c) return;
        const key = `player_${pid}`;
        const free = findFirstFreeGridCell(key);
        gameState.combat.order.push({
            key: key,
            kind: 'player',
            id: pid,
            initiative: c.initiative || 10,
            teamName: teamName,
            conditions: [],
            row: free.row,
            col: free.col
        });
    } else if (val.startsWith('enemy:')) {
        const uid = val.replace('enemy:', '');
        const idx = gameState.enemies.findIndex(e => e._uid === uid);
        if (idx === -1) return;
        const enemy = gameState.enemies[idx];
        const free = findFirstFreeGridCell(uid);
        gameState.combat.order.push({
            key: uid,
            kind: 'enemy',
            idx: idx,
            initiative: enemy.initiative || 10,
            teamName: teamName,
            conditions: [],
            row: free.row,
            col: free.col
        });
    }

    gameState.combat.active = true;
    sortCombatOrder();
    broadcastState();
    renderDmView();
}

function removeCombatantFromCombat(orderIdx) {
    const entry = gameState.combat.order[orderIdx];
    const actor = resolveCombatant(entry);
    const name = actor ? actor.name : 'diesen Teilnehmer';

    openConfirmModal(`Möchtest du "${name}" wirklich aus dem laufenden Kampf und vom Spielfeld entfernen?`, () => {
        gameState.combat.order.splice(orderIdx, 1);
        if (gameState.combat.turnIndex >= gameState.combat.order.length) {
            gameState.combat.turnIndex = 0;
        }
        broadcastState();
        renderDmView();
    });
}

function sortCombatOrder() {
    gameState.combat.order.sort((a, b) => b.initiative - a.initiative);
    if (gameState.combat.turnIndex >= gameState.combat.order.length) {
        gameState.combat.turnIndex = 0;
    }
}

function rollInitiativeFor(mode, btnEl) {
    cleanStaleCombatants();
    if (gameState.combat.order.length === 0) {
        return alert("Es sind noch keine Kämpfer im Kampf! Nutze '🔄 Spieler-Sync' oder füge links Teilnehmer hinzu.");
    }
    gameState.combat.active = true;

    gameState.combat.order.forEach(entry => {
        if (mode === 'enemies' && entry.kind !== 'enemy') return;
        const actor = resolveCombatant(entry);
        if (!actor) return;

        const initBonus = parseInt(actor.initiative) || Math.floor(((actor.stats?.dex || 10) - 10) / 2);
        const modStr = initBonus >= 0 ? `+${initBonus}` : `${initBonus}`;
        const roll = triggerUniversalRoll(`1d20${modStr}`, 'Initiative', actor.name, btnEl);
        entry.initiative = roll.total;
    });

    sortCombatOrder();
    broadcastState();
    renderDmView();
}

function changeCombatTurn(delta) {
    const len = gameState.combat.order.length;
    if (len === 0) return;

    let next = gameState.combat.turnIndex + delta;
    if (next >= len) {
        next = 0;
        gameState.combat.round += 1;
    } else if (next < 0) {
        next = len - 1;
        gameState.combat.round = Math.max(1, gameState.combat.round - 1);
    }

    gameState.combat.turnIndex = next;
    broadcastState();
    renderDmView();
}

function endCombatSession() {
    openConfirmModal("Möchtest du den aktuellen Kampf wirklich beenden und alle Kämpfer vom Spielfeld entfernen?", () => {
        gameState.combat.active = false;
        gameState.combat.round = 1;
        gameState.combat.turnIndex = 0;
        gameState.combat.order = [];
        broadcastState();
        renderDmView();
    });
}

function updateCombatantInit(idx, newVal) {
    gameState.combat.order[idx].initiative = parseInt(newVal) || 0;
    sortCombatOrder();
    broadcastState();
    renderDmView();
}

function setCombatantTeam(orderIdx, teamName) {
    gameState.combat.order[orderIdx].teamName = teamName;
    broadcastState();
    renderDmView();
}

function addNewTeamByDm() {
    const nameInput = document.getElementById('new-team-name-input');
    const colorInput = document.getElementById('new-team-color-input');
    const name = nameInput ? nameInput.value.trim() : '';
    const color = colorInput ? colorInput.value : '#a855f7';

    if (!name) return alert("Bitte einen Team-Namen eingeben!");
    if (!gameState.combat.teams) gameState.combat.teams = {};

    gameState.combat.teams[name] = color;
    nameInput.value = '';
    broadcastState();
    renderDmView();
}

function applyCombatHpDelta(orderIdx, delta) {
    const entry = gameState.combat.order[orderIdx];
    const actor = resolveCombatant(entry);
    if (!actor) return;
    actor.hp += delta;
    broadcastState();
    renderDmView();
}

function applyCustomCombatHp(orderIdx, sign) {
    const input = document.getElementById(`combat-hp-input-${orderIdx}`);
    if (!input) return;
    const val = parseInt(input.value) || 0;
    if (val === 0) return;
    applyCombatHpDelta(orderIdx, val * sign);
}

function addCombatCondition(orderIdx) {
    const select = document.getElementById(`cond-select-${orderIdx}`);
    if (!select || !select.value) return;
    const cond = select.value;
    const entry = gameState.combat.order[orderIdx];
    if (!entry.conditions.includes(cond)) {
        entry.conditions.push(cond);
    }
    broadcastState();
    renderDmView();
}

function removeCombatCondition(orderIdx, condIdx) {
    const condName = gameState.combat.order[orderIdx]?.conditions?.[condIdx] || 'diesen Zustand';
    openConfirmModal(`Zustand "${condName}" wirklich entfernen?`, () => {
        gameState.combat.order[orderIdx].conditions.splice(condIdx, 1);
        broadcastState();
        renderDmView();
    });
}

// ============================================================================
// DM TAB 3: NEUES TAKTISCHES KAMPFFELD (Top-Leiste + 3-Spalten-Cockpit)
// ============================================================================
function resolveCombatant(entry) {
    return resolveCombatantShared(entry);
}

function cleanStaleCombatants() {
    ensureEnemyUids();
    ensureBattlemapState();
    gameState.combat.order = (gameState.combat.order || []).filter(entry => {
        return resolveCombatant(entry) !== null;
    });
    if (gameState.combat.turnIndex >= gameState.combat.order.length) {
        gameState.combat.turnIndex = 0;
    }
}

function dmToggleBattlemapVisibility(isVisible) {
    ensureBattlemapState();
    gameState.combat.battlemapVisibleToPlayers = Boolean(isVisible);
    broadcastState();
    renderDmView();
}

function syncPlayersOnlyIntoCombat() {
    ensureEnemyUids();
    cleanStaleCombatants();

    const teamNames = Object.keys(gameState.combat.teams);
    const defaultPlayerTeam = teamNames.includes("Helden") ? "Helden" : teamNames[0];

    Object.keys(gameState.characters).forEach(pid => {
        const c = gameState.characters[pid];
        const key = `player_${pid}`;
        const alreadyInCombat = gameState.combat.order.some(e => e.key === key);
        if (!alreadyInCombat) {
            const free = findFirstFreeGridCell(key);
            gameState.combat.order.push({
                key: key,
                kind: 'player',
                id: pid,
                initiative: c.initiative || 10,
                teamName: defaultPlayerTeam,
                conditions: [],
                row: free.row,
                col: free.col
            });
        }
    });

    gameState.combat.active = true;
    if (!gameState.combat.round) gameState.combat.round = 1;
    sortCombatOrder();
    broadcastState();
    renderDmView();
}

function addParticipantToSpecificTeam(val, teamName) {
    ensureEnemyUids();
    ensureBattlemapState();
    if (!val) return;

    if (val.startsWith('player:')) {
        const pid = val.replace('player:', '');
        const c = gameState.characters[pid];
        if (!c) return;
        const key = `player_${pid}`;
        const existing = gameState.combat.order.find(e => e.key === key);
        if (existing) {
            existing.teamName = teamName;
        } else {
            const free = findFirstFreeGridCell(key);
            gameState.combat.order.push({
                key: key,
                kind: 'player',
                id: pid,
                initiative: c.initiative || 10,
                teamName: teamName,
                conditions: [],
                row: free.row,
                col: free.col
            });
        }
    } else if (val.startsWith('enemy:')) {
        const uid = val.replace('enemy:', '');
        const idx = gameState.enemies.findIndex(e => e._uid === uid);
        if (idx === -1) return;
        const enemy = gameState.enemies[idx];
        const existing = gameState.combat.order.find(e => e.key === uid);
        if (existing) {
            existing.teamName = teamName;
        } else {
            const free = findFirstFreeGridCell(uid);
            gameState.combat.order.push({
                key: uid,
                kind: 'enemy',
                idx: idx,
                initiative: enemy.initiative || 10,
                teamName: teamName,
                conditions: [],
                row: free.row,
                col: free.col
            });
        }
    }

    gameState.combat.active = true;
    sortCombatOrder();
    broadcastState();
    renderDmView();
}

function addSelectedParticipantToCombat() {
    const partSelect = document.getElementById('combat-add-participant-select');
    const teamSelect = document.getElementById('combat-add-team-select');
    if (!partSelect || !partSelect.value) {
        return alert("Bitte zuerst einen Spieler oder ein Monster/NPC aus der Liste auswählen!");
    }
    const teamName = teamSelect ? teamSelect.value : "Helden";
    addParticipantToSpecificTeam(partSelect.value, teamName);
}

function quickAddIntoTeamCard(selectEl, teamName) {
    if (!selectEl || !selectEl.value) return;
    addParticipantToSpecificTeam(selectEl.value, teamName);
}

function removeCombatantFromCombat(orderIdx) {
    const entry = gameState.combat.order[orderIdx];
    const actor = resolveCombatant(entry);
    const name = actor ? actor.name : 'diesen Teilnehmer';

    openConfirmModal(`Möchtest du "${name}" wirklich aus dem laufenden Kampf und vom Spielfeld entfernen?`, () => {
        gameState.combat.order.splice(orderIdx, 1);
        if (gameState.combat.turnIndex >= gameState.combat.order.length) {
            gameState.combat.turnIndex = 0;
        }
        broadcastState();
        renderDmView();
    });
}

function sortCombatOrder() {
    gameState.combat.order.sort((a, b) => b.initiative - a.initiative);
    if (gameState.combat.turnIndex >= gameState.combat.order.length) {
        gameState.combat.turnIndex = 0;
    }
}

function rollInitiativeFor(mode, btnEl) {
    cleanStaleCombatants();
    if (gameState.combat.order.length === 0) {
        return alert("Es sind noch keine Kämpfer im Kampf! Nutze '🔄 Spieler-Sync' oder füge links Teilnehmer hinzu.");
    }
    gameState.combat.active = true;

    gameState.combat.order.forEach(entry => {
        if (mode === 'enemies' && entry.kind !== 'enemy') return;
        const actor = resolveCombatant(entry);
        if (!actor) return;

        const initBonus = parseInt(actor.initiative) || Math.floor(((actor.stats?.dex || 10) - 10) / 2);
        const modStr = initBonus >= 0 ? `+${initBonus}` : `${initBonus}`;
        const roll = triggerUniversalRoll(`1d20${modStr}`, 'Initiative', actor.name, btnEl);
        entry.initiative = roll.total;
    });

    sortCombatOrder();
    broadcastState();
    renderDmView();
}

function changeCombatTurn(delta) {
    const len = gameState.combat.order.length;
    if (len === 0) return;

    let next = gameState.combat.turnIndex + delta;
    if (next >= len) {
        next = 0;
        gameState.combat.round += 1;
    } else if (next < 0) {
        next = len - 1;
        gameState.combat.round = Math.max(1, gameState.combat.round - 1);
    }

    gameState.combat.turnIndex = next;
    broadcastState();
    renderDmView();
}

function endCombatSession() {
    openConfirmModal("Möchtest du den aktuellen Kampf wirklich beenden und alle Kämpfer vom Spielfeld entfernen?", () => {
        gameState.combat.active = false;
        gameState.combat.round = 1;
        gameState.combat.turnIndex = 0;
        gameState.combat.order = [];
        broadcastState();
        renderDmView();
    });
}

function updateCombatantInit(idx, newVal) {
    gameState.combat.order[idx].initiative = parseInt(newVal) || 0;
    sortCombatOrder();
    broadcastState();
    renderDmView();
}

function setCombatantTeam(orderIdx, teamName) {
    gameState.combat.order[orderIdx].teamName = teamName;
    broadcastState();
    renderDmView();
}

function addNewTeamByDm() {
    const nameInput = document.getElementById('new-team-name-input');
    const colorInput = document.getElementById('new-team-color-input');
    const name = nameInput ? nameInput.value.trim() : '';
    const color = colorInput ? colorInput.value : '#a855f7';

    if (!name) return alert("Bitte einen Team-Namen eingeben!");
    if (!gameState.combat.teams) gameState.combat.teams = {};

    gameState.combat.teams[name] = color;
    nameInput.value = '';
    broadcastState();
    renderDmView();
}

function deleteTeamByDm(teamName) {
    const teamKeys = Object.keys(gameState.combat.teams || {});
    if (teamKeys.length <= 1) return alert("Mindestens ein Team muss bestehen bleiben!");

    openConfirmModal(`Möchtest du das Team "${teamName}" wirklich löschen?`, () => {
        delete gameState.combat.teams[teamName];
        const fallbackTeam = Object.keys(gameState.combat.teams)[0];
        (gameState.combat.order || []).forEach(entry => {
            if (entry.teamName === teamName) entry.teamName = fallbackTeam;
        });
        broadcastState();
        renderDmView();
    });
}

function applyCombatHpDelta(orderIdx, delta) {
    const entry = gameState.combat.order[orderIdx];
    const actor = resolveCombatant(entry);
    if (!actor) return;
    actor.hp += delta;
    broadcastState();
    renderDmView();
}

function applyCustomCombatHp(orderIdx, sign) {
    const input = document.getElementById(`combat-hp-input-${orderIdx}`);
    if (!input) return;
    const val = parseInt(input.value) || 0;
    if (val === 0) return;
    applyCombatHpDelta(orderIdx, val * sign);
}

function addCombatCondition(orderIdx) {
    const select = document.getElementById(`cond-select-${orderIdx}`);
    if (!select || !select.value) return;
    const cond = select.value;
    const entry = gameState.combat.order[orderIdx];
    if (!entry.conditions.includes(cond)) {
        entry.conditions.push(cond);
    }
    broadcastState();
    renderDmView();
}

function removeCombatCondition(orderIdx, condIdx) {
    const condName = gameState.combat.order[orderIdx]?.conditions?.[condIdx] || 'diesen Zustand';
    openConfirmModal(`Zustand "${condName}" wirklich entfernen?`, () => {
        gameState.combat.order[orderIdx].conditions.splice(condIdx, 1);
        broadcastState();
        renderDmView();
    });
}

// ============================================================================
// SPIELFELD-LOGIK (Grid erweitern, Block-Palette, Drag & Drop, Vorlagen)
// ============================================================================
function dmResizeBattlemap(dRows, dCols) {
    ensureBattlemapState();
    const map = gameState.combat.map;
    const newRows = Math.max(2, Math.min(24, map.rows + dRows));
    const newCols = Math.max(2, Math.min(24, map.cols + dCols));
    map.rows = newRows;
    map.cols = newCols;

    (gameState.combat.order || []).forEach(entry => {
        if (entry.row >= newRows) entry.row = newRows - 1;
        if (entry.col >= newCols) entry.col = newCols - 1;
    });

    broadcastState();
    renderDmView();
}

// Klick auf einen Block aktiviert den Baumodus; erneuter Klick auf denselben Block verlässt den Baumodus!
function dmSelectPaletteBlock(blockId) {
    ensureBattlemapState();
    if (gameState.combat.map.selectedBlockId === blockId) {
        gameState.combat.map.selectedBlockId = null;
    } else {
        gameState.combat.map.selectedBlockId = blockId;
    }
    renderDmView();
}

function dmToggleNewBlockCreator() {
    showNewBlockCreator = !showNewBlockCreator;
    renderDmView();
}

function dmCreatePaletteBlock() {
    ensureBattlemapState();
    const colorEl = document.getElementById('dm-new-block-color');
    const nameEl = document.getElementById('dm-new-block-name');
    const color = colorEl ? colorEl.value : newBlockDraftColor;
    const rawName = nameEl ? nameEl.value.trim() : '';
    const name = rawName || `Block ${color.toUpperCase()}`;

    const newBlock = {
        id: 'block_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        name: name,
        color: color,
        isDefault: false
    };

    gameState.combat.map.palette.push(newBlock);
    gameState.combat.map.selectedBlockId = newBlock.id; // Aktiviert direkt den Baumodus mit dem neuen Block
    newBlockDraftName = '';
    showNewBlockCreator = false;
    broadcastState();
    renderDmView();
}

function dmRemoveSelectedBlock() {
    ensureBattlemapState();
    const map = gameState.combat.map;
    const selected = map.palette.find(b => b.id === map.selectedBlockId);
    if (!selected || selected.isDefault) return;

    openConfirmModal(`Möchtest du den Block "${selected.name}" wirklich aus der Block-Liste entfernen? Alle damit gesetzten Felder auf dem Spielfeld werden wieder Grau.`, () => {
        map.palette = map.palette.filter(b => b.id !== selected.id);
        Object.keys(map.cells).forEach(cellKey => {
            if (map.cells[cellKey] === selected.id) {
                delete map.cells[cellKey];
            }
        });
        map.selectedBlockId = null; // Zurück in den Bewegungsmodus
        broadcastState();
        renderDmView();
    });
}


function dmHandleBlockDragStart(e, blockId) {
    e.dataTransfer.setData('text/plain', `block:${blockId}`);
    gameState.combat.map.selectedBlockId = blockId;
}

function dmHandleCellDragOver(e) {
    e.preventDefault();
    e.currentTarget.classList.add('cell-drop-hover');
}

function dmHandleCellDragLeave(e) {
    e.currentTarget.classList.remove('cell-drop-hover');
}

function dmHandleCellDrop(e, r, c) {
    e.preventDefault();
    e.currentTarget.classList.remove('cell-drop-hover');
    const data = e.dataTransfer.getData('text/plain') || '';
    if (data.startsWith('block:')) {
        const blockId = data.replace('block:', '');
        ensureBattlemapState();
        gameState.combat.map.cells[`${r}_${c}`] = blockId;
        broadcastState();
        renderDmView();
    }
}

function dmSaveBattlemapTemplate() {
    ensureBattlemapState();
    const input = document.getElementById('dm-map-template-name');
    const name = input ? input.value.trim() : '';
    if (!name) return alert("Bitte gib einen Namen für die Spielfeld-Vorlage ein!");

    const map = gameState.combat.map;
    const templateObj = {
        name: name,
        rows: map.rows,
        cols: map.cols,
        cells: JSON.parse(JSON.stringify(map.cells)),
        palette: JSON.parse(JSON.stringify(map.palette))
    };

    const existingIdx = gameState.mapTemplates.findIndex(t => t.name.toLowerCase() === name.toLowerCase());
    if (existingIdx !== -1) {
        gameState.mapTemplates[existingIdx] = templateObj;
    } else {
        gameState.mapTemplates.push(templateObj);
    }

    input.value = '';
    broadcastState();
    renderDmView();
}

function dmLoadBattlemapTemplate() {
    ensureBattlemapState();
    const select = document.getElementById('dm-map-template-select');
    if (!select || select.value === "") return alert("Bitte wähle zuerst eine gespeicherte Spielfeld-Vorlage aus!");

    const tpl = gameState.mapTemplates[parseInt(select.value)];
    if (!tpl) return;

    gameState.combat.map.rows = tpl.rows || 6;
    gameState.combat.map.cols = tpl.cols || 6;
    gameState.combat.map.cells = JSON.parse(JSON.stringify(tpl.cells || {}));
    gameState.combat.map.palette = JSON.parse(JSON.stringify(tpl.palette || [
        { id: 'block_gray', name: 'Pures Grau', color: '#3f3f46', isDefault: true }
    ]));
    gameState.combat.map.selectedBlockId = null;

    ensureBattlemapState();
    broadcastState();
    renderDmView();
    centerBattlemapInViewport();
}

function renderDmCombatTab(container) {
    cleanStaleCombatants();
    ensureBattlemapState();

    const order = gameState.combat.order || [];
    const map = gameState.combat.map;
    const teamNames = Object.keys(gameState.combat.teams);

    const inCombatKeys = new Set(order.map(e => e.key));
    const availablePlayers = Object.values(gameState.characters).filter(c => !inCombatKeys.has(`player_${c.id}`));
    const availableEnemies = gameState.enemies.filter(e => !inCombatKeys.has(e._uid));

    const participantOptionsHtml = `
        ${availablePlayers.length > 0 ? `
            <optgroup label="Spieler (noch nicht im Kampf)">
                ${availablePlayers.map(p => `<option value="player:${p.id}">🛡️ ${p.name} (HP ${p.hp}/${p.maxHp})</option>`).join('')}
            </optgroup>
        ` : ''}
        ${availableEnemies.length > 0 ? `
            <optgroup label="Monster & NPCs (noch nicht im Kampf)">
                ${availableEnemies.map(e => `<option value="enemy:${e._uid}">👹 ${e.name} (HP ${e.hp}/${e.maxHp})</option>`).join('')}
            </optgroup>
        ` : ''}
    `;

    const teamsMap = {};
    teamNames.forEach(t => teamsMap[t] = []);
    order.forEach((entry, orderIdx) => {
        const actor = resolveCombatant(entry);
        if (!actor) return;
        const t = entry.teamName || teamNames[0];
        if (!teamsMap[t]) teamsMap[t] = [];
        teamsMap[t].push({ entry, actor, orderIdx });
    });

    const selectedBlock = map.selectedBlockId
        ? map.palette.find(b => b.id === map.selectedBlockId) || null
        : null;
    const isBuildMode = Boolean(selectedBlock);

    container.innerHTML = `
        <div class="combat-master-wrapper">
            
            <!-- A) OBERE SCHMALE ZUG-LEISTE -->
            ${buildTopTurnBarHtml(true)}

            <!-- B) 3-SPALTEN-COCKPIT DARUNTER -->
            <div class="combat-three-col-cockpit">
                
                <!-- 1. LINKE SCHMALE SPALTE: Teilnehmer & Teams -->
                <aside class="combat-left-col">
                    
                    <div class="card combat-side-card">
                        <div class="side-card-title-row">
                            <h3>⚔️ Teilnehmer & Teams</h3>
                        </div>

                        <label class="field-label">SPIELER ODER MONSTER ZUM KAMPF HINZUFÜGEN
                            <select id="combat-add-participant-select">
                                <option value="">-- Kämpfer wählen (${availablePlayers.length + availableEnemies.length} verfügbar) --</option>
                                ${participantOptionsHtml}
                            </select>
                        </label>

                        <div class="dm-assign-row">
                            <select id="combat-add-team-select">
                                ${teamNames.map(t => `<option value="${t}">In Team: ${t}</option>`).join('')}
                            </select>
                            <button type="button" class="btn-primary" onclick="addSelectedParticipantToCombat()">+ Hinzufügen</button>
                        </div>

                        <div class="side-card-divider"></div>

                        <label class="field-label">NEUES TEAM ERSTELLEN
                            <div class="team-create-row">
                                <input type="text" id="new-team-name-input" placeholder="Team-Name (z.B. Wachen)...">
                                <input type="color" id="new-team-color-input" value="#a855f7" title="Teamfarbe wählen">
                                <button type="button" class="btn-secondary" onclick="addNewTeamByDm()">+ Team</button>
                            </div>
                        </label>
                    </div>

                    <div class="combat-teams-vertical-list">
                        ${teamNames.map(tName => {
        const color = gameState.combat.teams[tName] || '#ffffff';
        const members = teamsMap[tName] || [];
        const safeTeamName = tName.replace(/'/g, "\\'");
        return `
                                <div class="card team-group-card" style="border-top: 4px solid ${color};">
                                    <div class="team-group-header" style="color: ${color};">
                                        <strong>${tName} (${members.length})</strong>
                                        ${teamNames.length > 1 ? `<button type="button" class="btn-del btn-tiny-del" title="Team löschen" onclick="deleteTeamByDm('${safeTeamName}')">🗑️</button>` : ''}
                                    </div>

                                    ${(availablePlayers.length + availableEnemies.length) > 0 ? `
                                        <select class="team-quick-add-select" onchange="quickAddIntoTeamCard(this, '${safeTeamName}')">
                                            <option value="">+ Kämpfer direkt in „${tName}“ setzen...</option>
                                            ${participantOptionsHtml}
                                        </select>
                                    ` : ''}

                                    ${members.length === 0 ? `<small class="muted">Keine Kämpfer in diesem Team.</small>` : ''}

                                    <div class="team-members-stack">
                                        ${members.map(({ entry, actor, orderIdx }) => {
            const isTurn = orderIdx === gameState.combat.turnIndex;
            const isDead = actor.hp <= 0;
            return `
                                                <div class="team-combatant-item ${isTurn ? 'active-turn-row' : ''} ${isDead ? 'combatant-down' : ''}" style="border-left: 4px solid ${color};">
                                                    <div class="team-combatant-top">
                                                        <div class="char-identity">
                                                            ${actor.avatar
                ? `<img src="${actor.avatar}" class="mini-avatar">`
                : `<div class="mini-avatar-placeholder">${actor.name[0]}</div>`
            }
                                                            <div>
                                                                <div class="combat-name-line">
                                                                    ${isTurn ? `<span class="turn-indicator-pill">▶ ZUG</span>` : ''}
                                                                    <strong>${actor.name}</strong>
                                                                </div>
                                                                <small class="muted">AC ${actor.ac} · Feld (${entry.row + 1},${entry.col + 1})</small>
                                                            </div>
                                                        </div>
                                                        <div class="dm-badges">
                                                            <span class="badge-hp">${actor.hp}/${actor.maxHp}</span>
                                                            ${entry.kind === 'player' && isDead ? `
                                                                <button type="button" class="btn-death" onclick="dmKillPlayer('${actor.id}')">💀 Tot</button>
                                                            ` : ''}
                                                            <button type="button" class="btn-del" title="Aus Kampf & vom Spielfeld entfernen" onclick="removeCombatantFromCombat(${orderIdx})">✕</button>
                                                        </div>
                                                    </div>

                                                    <div class="team-combatant-meta-row">
                                                        <label class="mini-inline-label">Init:
                                                            <input type="number" value="${entry.initiative}" onchange="updateCombatantInit(${orderIdx}, this.value)">
                                                        </label>
                                                        <select onchange="setCombatantTeam(${orderIdx}, this.value)" style="border-color: ${color}; color: ${color};">
                                                            ${teamNames.map(t => `<option value="${t}" ${entry.teamName === t ? 'selected' : ''}>${t}</option>`).join('')}
                                                        </select>
                                                    </div>

                                                    <div class="dm-quick-actions">
                                                        <button type="button" onclick="applyCombatHpDelta(${orderIdx}, -5)">-5</button>
                                                        <button type="button" onclick="applyCombatHpDelta(${orderIdx}, -1)">-1</button>
                                                        <button type="button" onclick="applyCombatHpDelta(${orderIdx}, 1)">+1</button>
                                                        <button type="button" onclick="applyCombatHpDelta(${orderIdx}, 5)">+5</button>
                                                    </div>

                                                    <div class="combat-custom-dmg">
                                                        <input type="number" id="combat-hp-input-${orderIdx}" placeholder="HP" min="1">
                                                        <button type="button" class="btn-demonic" onclick="applyCustomCombatHp(${orderIdx}, -1)">-DMG</button>
                                                        <button type="button" class="btn-holy" onclick="applyCustomCombatHp(${orderIdx}, 1)">+HEAL</button>
                                                    </div>

                                                    <div class="cat-badge-row">
                                                        ${(entry.conditions || []).map((cond, cIdx) => `
                                                            <span class="inline-item-pill">${cond} <b onclick="removeCombatCondition(${orderIdx}, ${cIdx})">×</b></span>
                                                        `).join('')}
                                                    </div>

                                                    <select id="cond-select-${orderIdx}" onchange="addCombatCondition(${orderIdx})">
                                                        <option value="">+ Zustand...</option>
                                                        <option value="Blutend">Blutend</option>
                                                        <option value="Brennend">Brennend</option>
                                                        <option value="Betäubt">Betäubt</option>
                                                        <option value="Vergiftet">Vergiftet</option>
                                                        <option value="Verängstigt">Verängstigt</option>
                                                        <option value="Dämonischer Rausch">Dämonischer Rausch</option>
                                                        <option value="Heiliger Schutz">Heiliger Schutz</option>
                                                    </select>
                                                </div>
                                            `;
        }).join('')}
                                    </div>
                                </div>
                            `;
    }).join('')}
                    </div>

                </aside>

                <!-- 2. MITTLERE GROSSE BOX: Das interaktive Spielfeld mit 2 Zeiger-Modi -->
                <section class="card battlemap-board-card">
                    <div class="battlemap-board-header">
                        <div>
                            <div class="combat-name-line">
                                <h3>🗺️ Spielfeld (${map.rows} × ${map.cols} Grid)</h3>
                                ${isBuildMode
        ? `<span class="mode-status-pill mode-pill-build" onclick="dmSelectPaletteBlock('${selectedBlock.id}')" title="Klicken oder rechts denselben Block drücken, um in den Bewegungsmodus zu wechseln">🧱 Baumodus: ${selectedBlock.name} (✕ Beenden)</span>`
        : `<span class="mode-status-pill mode-pill-move">🖐️ Verschieben- & Bewegungsmodus</span>`
    }
                            </div>
                            <small class="muted">
                                ${isBuildMode
        ? 'Baumodus aktiv: Halte die Maustaste über dem Grid gedrückt zum Malen · Klicke rechts denselben Block nochmal zum Verlassen.'
        : 'Bewegungsmodus: Halte die Maustaste gedrückt zum freien Verschieben der Karte · Mausrad zoomt zum Mauszeiger.'
    }
                            </small>
                        </div>

                        <div class="battlemap-resize-controls">
                            ${buildBattlemapZoomControlsHtml()}
                            <button type="button" onclick="dmResizeBattlemap(1, 0)" title="Zeile hinzufügen">+ Zeile</button>
                            <button type="button" onclick="dmResizeBattlemap(-1, 0)" title="Zeile entfernen">− Zeile</button>
                            <button type="button" onclick="dmResizeBattlemap(0, 1)" title="Spalte hinzufügen">+ Spalte</button>
                            <button type="button" onclick="dmResizeBattlemap(0, -1)" title="Spalte entfernen">− Spalte</button>
                            <button type="button" class="btn-del" onclick="dmClearBattlemapCells()" title="Alle Blöcke zurücksetzen">↺ Reset</button>
                        </div>
                    </div>

                    <!-- Spielfeld-Vorlagen Speichern & Laden -->
                    <div class="battlemap-template-bar">
                        <div class="dm-assign-row">
                            <input type="text" id="dm-map-template-name" placeholder="Vorlagenname (z.B. Thronsaal)...">
                            <button type="button" class="btn-secondary" onclick="dmSaveBattlemapTemplate()">💾 Spielfeld speichern</button>
                        </div>
                        <div class="dm-assign-row">
                            <select id="dm-map-template-select">
                                <option value="">-- Gespeichertes Spielfeld laden (${gameState.mapTemplates.length}) --</option>
                                ${gameState.mapTemplates.map((tpl, i) => `<option value="${i}">${tpl.name} (${tpl.rows}×${tpl.cols})</option>`).join('')}
                            </select>
                            <button type="button" class="btn-primary" onclick="dmLoadBattlemapTemplate()">📂 Laden</button>
                            ${gameState.mapTemplates.length > 0 ? `<button type="button" class="btn-del" onclick="dmDeleteBattlemapTemplate()" title="Ausgewählte Vorlage löschen">🗑️</button>` : ''}
                        </div>
                    </div>

                    <!-- Freies 2D-Kamerafeld (Pan & Cursor-Zoom) -->
                    <div id="battlemap-stage-wrapper"
                         class="battlemap-stage-wrapper ${isBuildMode ? 'stage-mode-build' : 'stage-mode-move'}"
                         onpointerdown="handleBattlemapStagePointerDown(event, true)"
                         onwheel="handleBattlemapWheel(event)">
                        <div id="battlemap-pan-zoom-plane"
                             class="battlemap-pan-zoom-plane"
                             style="transform: translate(${battlemapPanX}px, ${battlemapPanY}px) scale(${battlemapZoom});">
                            <div id="active-battlemap-grid"
                                 class="battlemap-grid"
                                 style="grid-template-columns: repeat(${map.cols}, 74px); grid-template-rows: repeat(${map.rows}, 74px);">
                                ${buildBattlemapGridCellsHtml(true)}
                            </div>
                        </div>
                    </div>
                </section>

                <!-- 3. RECHTE SCHMALE SPALTE: Block-Palette -->
                <aside class="card battlemap-palette-card">
                    <div class="palette-top-header">
                        <h3>🧱 Block-Arten</h3>
                        <button type="button" class="btn-primary" style="width:100%;" onclick="dmToggleNewBlockCreator()">
                            ${showNewBlockCreator ? '✕ Schließen' : '+ Neuer Block'}
                        </button>
                    </div>

                    ${showNewBlockCreator ? `
                        <div class="palette-creator-popover">
                            <label class="field-label">BLOCK-FARBE WÄHLEN
                                <input type="color" id="dm-new-block-color" value="${newBlockDraftColor}"
                                    onchange="newBlockDraftColor = this.value"
                                    style="width:100%; height:38px; padding:2px; cursor:pointer;">
                            </label>
                            <label class="field-label">NAME (OPTIONAL)
                                <input type="text" id="dm-new-block-name" placeholder="z.B. Lava, Wasser, Wand" value="${newBlockDraftName}"
                                     oninput="newBlockDraftName = this.value">
                            </label>
                            <button type="button" class="btn-secondary" style="width:100%;" onclick="dmCreatePaletteBlock()">✓ Block erschaffen</button>
                        </div>
                    ` : ''}

                    ${selectedBlock && !selectedBlock.isDefault ? `
                        <button type="button" class="btn-del palette-remove-btn" onclick="dmRemoveSelectedBlock()">
                            🗑️ Block entfernen („${selectedBlock.name}“)
                        </button>
                    ` : ''}

                    <small class="muted">1× Klick = Baumodus an · 2× Klick auf denselben Block = Baumodus aus:</small>

                    <div class="palette-blocks-scroll">
                        ${map.palette.map(b => {
        const isSelected = b.id === map.selectedBlockId;
        return `
                                <div class="palette-block-entry ${isSelected ? 'palette-block-active' : ''}"
                                     draggable="true"
                                     ondragstart="dmHandleBlockDragStart(event, '${b.id}')"
                                     onclick="dmSelectPaletteBlock('${b.id}')">
                                    <div class="palette-color-swatch" style="background-color: ${b.color};"></div>
                                    <div class="palette-block-meta">
                                        <strong>${b.name}</strong>
                                        <small class="muted">${isSelected ? '🧱 Baumodus aktiv' : b.color}</small>
                                    </div>
                                </div>
                            `;
    }).join('')}
                    </div>
                </aside>

            </div>
        </div>
    `;

    initBattlemapViewport();
}



function dmModifyStat(playerId, prop, delta) {
    const char = gameState.characters[playerId];
    if (!char) return;
    char[prop] += delta;
    broadcastState();
    renderDmView();
}

function dmToggleMoralityVisibility(playerId, isVisible) {
    const char = gameState.characters[playerId];
    if (!char) return;
    char.moralityVisible = isVisible;
    broadcastState();
    renderDmView();
}

function dmAssignItem(playerId, sourceKey, targetKey, selectId) {
    const select = document.getElementById(selectId);
    if (!select || select.value === "") return;
    const char = gameState.characters[playerId];
    if (!char) return;

    const item = gameState[sourceKey][parseInt(select.value)];
    if (!item) return;

    if (targetKey === 'items') {
        const packmass = clampPackmass(item.packmass);
        if (!canAddItemToPlayerBag(char, packmass)) {
            const used = getPlayerBagUsed(char);
            const max = getPlayerBagMax(char);
            return alert(`Nicht genug Beutelplatz bei ${char.name}! "${item.name}" hat ein Packmaß von ${packmass}, aber der Beutel ist bei ${used} / ${max} Packmaß.`);
        }
    }

    if (!char[targetKey]) char[targetKey] = [];
    char[targetKey].push({ ...item });
    broadcastState();
    renderDmView();
}

function dmUpdatePlayerAttack(playerId, atkIdx, field, val) {
    const char = gameState.characters[playerId];
    if (!char || !char.attacks[atkIdx]) return;
    char.attacks[atkIdx][field] = val;
    broadcastState();
    renderDmView();
}

function dmModifyEnemy(idx, prop, delta) {
    gameState.enemies[idx][prop] += delta;
    broadcastState();
    renderDmEnemies();
}

function dmRemoveEnemy(idx) {
    const enemy = gameState.enemies[idx];
    openConfirmModal(`Möchtest du "${enemy ? enemy.name : 'dieses Monster'}" wirklich aus dem Spiel entfernen?`, () => {
        gameState.enemies.splice(idx, 1);
        cleanStaleCombatants();
        broadcastState();
        renderDmEnemies();
    });
}
