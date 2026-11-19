let activeDmTab = 'gameplay';

let libSearchQuery = '';
let libSelectedCategory = 'ALL';
let libSelectedType = 'ALL';
let libSortBy = 'name';

let editingState = {
    npc: null,
    item: null,
    attack: null,
    spell: null,
    affinity: null
};

let npcDraft = { avatar: '', items: [], attacks: [], spells: [], affinities: [] };
let itemDraftAvatar = '';
let attackDraftAvatar = '';
let spellDraftAvatar = '';
let affinityDraftAvatar = '';

let showNewBlockCreator = false;
let newBlockDraftColor = '#ef4444';
let newBlockDraftName = '';

function getAllCustomCategories() {
    ensureSpellsAndDmNotesState();
    const set = new Set();
    const collect = (list) => {
        (list || []).forEach(entry => {
            (entry.categories || []).forEach(cat => set.add(cat));
        });
    };
    collect(gameState.npcTemplates);
    collect(gameState.customItems);
    collect(gameState.customAttacks);
    collect(gameState.customSpells);
    collect(gameState.customAffinities);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
}

const LIB_TYPES = {
    npc: { list: 'npcTemplates', label: 'Monster / NPC' },
    item: { list: 'customItems', label: 'Gegenstand' },
    attack: { list: 'customAttacks', label: 'Attacke' },
    spell: { list: 'customSpells', label: 'Zauber' },
    affinity: { list: 'customAffinities', label: 'Merkmal' }
};

function makeNpcUid(suffix) {
    return 'npc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7) + (suffix !== undefined ? '_' + suffix : '');
}

// Liest eine Zahl aus einem Eingabefeld; Fallback nur bei leerem/ungültigem Feld (0 bleibt 0).
function readNumberInput(id, fallback) {
    const el = document.getElementById(id);
    const n = el ? parseInt(el.value) : NaN;
    return isNaN(n) ? fallback : n;
}

function numOr(value, fallback) {
    const n = parseInt(value);
    return isNaN(n) ? fallback : n;
}

function ensureEnemyUids() {
    gameState.enemies.forEach((e, idx) => {
        if (!e._uid) {
            e._uid = makeNpcUid(idx);
        }
    });
}

function switchDmTab(tabName) {
    activeDmTab = tabName;
    document.getElementById('dm-tab-btn-gameplay')?.classList.toggle('active', tabName === 'gameplay');
    document.getElementById('dm-tab-btn-templates')?.classList.toggle('active', tabName === 'templates');
    document.getElementById('dm-tab-btn-combat')?.classList.toggle('active', tabName === 'combat');
    document.getElementById('dm-tab-btn-notes')?.classList.toggle('active', tabName === 'notes');
    renderDmView();
}

function renderDmView(options) {
    const container = document.getElementById('dm-view-content');
    if (!container) return;
    const snapshot = options && options.preserveInputs ? snapshotFormState(container) : null;
    ensureEnemyUids();
    ensureBattlemapState();
    ensureSpellsAndDmNotesState();

    if (activeDmTab === 'gameplay') {
        renderDmGameplayTab(container);
    } else if (activeDmTab === 'templates') {
        renderDmTemplatesTab(container);
    } else if (activeDmTab === 'combat') {
        renderDmCombatTab(container);
    } else if (activeDmTab === 'notes') {
        renderDmNotesTab(container);
    }

    if (snapshot) restoreFormState(container, snapshot);
}

// ============================================================================
// DM TAB 1: GAMEPLAY (Inkl. Schnell-Notizblock & Zauber-Verwaltung)
// ============================================================================
function renderDmGameplayTab(container) {
    ensureSpellsAndDmNotesState();
    container.innerHTML = `
        <!-- Kompakte DM Schnell-Notizen direkt im Gameplay-Tab -->
        <div class="card dm-quick-notes-banner">
            <div class="creator-header-row">
                <div>
                    <h3>${icon('quill')} DM Schnell-Notizen (Live-Session)</h3>
                    <small class="muted">Wird automatisch mit deinem großen Notizbuch (Tab 4) und der Session-Datei gespeichert.</small>
                </div>
                <button type="button" class="btn-secondary" onclick="switchDmTab('notes')">${icon('tome')} Großes DM-Notizbuch öffnen (Tab 4)</button>
            </div>
            <textarea id="dm-gameplay-quick-notes" rows="3" placeholder="Schnelle Notizen für die laufende Runde (Initiativen-Ideen, erfundene NPC-Namen, Status, Loot, Geheimnisse)...">${esc(gameState.dmNotes.quick)}</textarea>
        </div>

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
                            ${gameState.npcTemplates.map((t, i) => `<option value="${i}">${esc(t.name)} (HP ${esc(t.maxHp)} | AC ${esc(t.ac)})</option>`).join('')}
                        </select>
                        <button class="btn-primary" onclick="dmSpawnFromTemplateSelect()">+ Spawnen</button>
                    </div>
                </div>
                <div id="dm-enemy-list" class="dm-stack"></div>
            </section>
        </div>
    `;

    const quickNotesEl = document.getElementById('dm-gameplay-quick-notes');
    if (quickNotesEl) {
        quickNotesEl.addEventListener('input', (e) => {
            gameState.dmNotes.quick = e.target.value;
        });
    }

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
    if (!Array.isArray(spawned.spells)) spawned.spells = [];
    spawned._uid = makeNpcUid();
    gameState.enemies.push(spawned);
    broadcastState();
    renderDmView();
}

function buildItemOptionsHtml() {
    return gameState.customItems.map((it, i) => `<option value="${i}">${esc(it.name)} (Packmaß ${esc(clampPackmass(it.packmass))} | ${esc(it.action || 'Item')})</option>`).join('');
}

function buildAttackOptionsHtml() {
    return gameState.customAttacks.map((w, i) => `<option value="${i}">${esc(w.name)} (${esc(w.action)})</option>`).join('');
}

function buildSpellOptionsHtml() {
    return gameState.customSpells.map((sp, i) => `<option value="${i}">${esc(sp.name)} (Anf: ${esc(sp.requirement || 'Keine')} | ${esc(sp.action)})</option>`).join('');
}

function buildAffinityOptionsHtml() {
    return gameState.customAffinities.map((a, i) => `<option value="${i}">${esc(a.name)} (${esc(a.effect)})</option>`).join('');
}

function renderDmPlayers() {
    const list = document.getElementById('dm-player-list');
    if (!list) return;
    const ids = Object.keys(gameState.characters);

    if (ids.length === 0) {
        list.innerHTML = `<div class="card"><p class="muted">Noch keine Spieler im Raum.</p></div>`;
        return;
    }

    const itemOptions = buildItemOptionsHtml();
    const attackOptions = buildAttackOptionsHtml();
    const spellOptions = buildSpellOptionsHtml();
    const affinityOptions = buildAffinityOptionsHtml();

    list.innerHTML = ids.map(id => {
        const c = normalizeCharacter(gameState.characters[id]);
        const cid = jsArg(c.id);

        const bagUsed = getPlayerBagUsed(c);
        const bagMax = getPlayerBagMax(c);
        const defaultBagMax = 15 + (parseInt(c.stats?.str) || 10);
        const isInf = Boolean(c.bagInfinite);
        const fillPercent = isInf ? 25 : Math.min(100, Math.round((bagUsed / Math.max(1, bagMax)) * 100));
        const isFull = !isInf && bagUsed >= bagMax;

        return `
            <div class="card dm-player-card">
                <div class="dm-player-header">
                    <div class="char-identity">
                        ${c.avatar ? `<img src="${esc(c.avatar)}" class="mini-avatar">` : `<div class="mini-avatar-placeholder">?</div>`}
                        <div>
                            <h3>${esc(c.name)} <small>(Lvl ${esc(c.level)} | ${esc(c.alignment)})</small></h3>
                            <span class="sub-info">${esc(c.origin)} | AC: ${esc(c.ac)} | Init: ${esc(c.initiative)} | Prof: +${esc(c.proficiency || 2)} | Exh: ${esc(c.exhaustion)}</span>
                        </div>
                    </div>
                    <div class="dm-badges">
                        <span class="badge-hp">HP: ${esc(c.hp)}/${esc(c.maxHp)}</span>
                        ${c.hp <= 0 ? `<button type="button" class="btn-death" onclick="dmKillPlayer(${cid})">${icon('skull')} Tot</button>` : ''}
                        <span class="badge-moral">${esc(formatMorality(c.morality))}</span>
                    </div>
                </div>

                <div class="dm-moral-bar">
                    <label class="dm-checkbox-label">
                        <input type="checkbox" ${c.moralityVisible ? 'checked' : ''}
                            onchange="dmToggleMoralityVisibility(${cid}, this.checked)">
                        Moral-Zähler für Spieler sichtbar (${c.moralityVisible ? 'Eingeblendet' : 'Geheim'})
                    </label>
                </div>

                <!-- TASCHEN-AUSLASTUNG & STEUERUNG -->
                <div class="dm-bag-control-row">
                    <div class="dm-bag-meter">
                        <strong>${icon('bag')} Beutel: ${esc(bagUsed)} / ${isInf ? '∞' : esc(bagMax)} Packmaß (${isInf ? 'Unendlich' : esc(fillPercent) + '%'})</strong>
                        <div class="bag-progress-track bag-progress-track-spaced">
                            <div class="bag-progress-fill ${isFull ? 'fill-full' : ''}" style="width: ${esc(fillPercent)}%;"></div>
                        </div>
                        <small class="muted">
                            ${isInf ? 'Unendliche Kapazität aktiv' : `Freier Platz: ${esc(Math.max(0, bagMax - bagUsed))} Packmaß`} · Standard (15 + STR): ${esc(defaultBagMax)}
                        </small>
                    </div>
                    <div class="dm-bag-inputs">
                        <input type="number" min="0" id="dm-bag-max-${esc(c.id)}" value="${esc(isInf ? defaultBagMax : bagMax)}"
                            ${isInf ? 'disabled' : ''}
                            onchange="dmSetPlayerBagMax(${cid}, this.value)"
                            title="Maximale Beutel-Kapazität festlegen">
                        <button type="button" onclick="dmResetPlayerBagToDefault(${cid})" title="Auf Standard (15 + STR) zurücksetzen">
                            ${icon('refresh')} 15+STR
                        </button>
                        <label class="dm-checkbox-label">
                            <input type="checkbox" ${isInf ? 'checked' : ''}
                                onchange="dmTogglePlayerBagInfinite(${cid}, this.checked)">
                            ∞ Unendlich
                        </label>
                    </div>
                </div>

                <div class="dm-mini-stats">
                    STR ${esc(c.stats.str)} | DEX ${esc(c.stats.dex)} | CON ${esc(c.stats.con)} |
                    INT ${esc(c.stats.int)} | WIS ${esc(c.stats.wis)} | CHA ${esc(c.stats.cha)}<br>
                    Geld: <span class="coin-pp"><strong>${esc(c.currency.pp)}</strong> PP</span> · <span class="coin-gp"><strong>${esc(c.currency.gp)}</strong> GP</span> · <span class="coin-sp"><strong>${esc(c.currency.sp)}</strong> SP</span> · <span class="coin-cp"><strong>${esc(c.currency.cp)}</strong> CP</span>
                </div>

                <!-- NEU: SKILLS ANZEIGE (NUR FÜR DM SICHTBAR) -->
                <div class="dm-attacks-editor">
                    <strong>${icon('target')} Ausgewählte Skills von ${esc(c.name)}:</strong>
                    ${c.skills.length === 0
            ? '<p class="muted">Keine Skills ausgewählt.</p>'
            : `<div class="cat-badge-row cat-badge-row-spaced">
                            ${c.skills.map(s => `<span class="inline-item-pill">${esc(s)}</span>`).join(' ')}
                           </div>`
        }
                </div>

                <div class="dm-quick-actions">
                    <button onclick="dmModifyStat(${cid}, 'hp', -5)">-5 HP</button>
                    <button onclick="dmModifyStat(${cid}, 'hp', -1)">-1 HP</button>
                    <button onclick="dmModifyStat(${cid}, 'hp', 1)">+1 HP</button>
                    <button onclick="dmModifyStat(${cid}, 'hp', 5)">+5 HP</button>
                    <button class="btn-demonic" onclick="dmModifyStat(${cid}, 'morality', -1)">-1 Dämonisch</button>
                    <button class="btn-holy" onclick="dmModifyStat(${cid}, 'morality', 1)">+1 Heilig</button>
                </div>

                <div class="dm-assign-row">
                    <select id="assign-item-${esc(c.id)}">
                        <option value="">-- Gegenstand geben (${gameState.customItems.length}) --</option>
                        ${itemOptions}
                    </select>
                    <button class="btn-primary" onclick="dmAssignItem(${cid}, 'customItems', 'items', ${jsArg('assign-item-' + c.id)})">+ Gegenstand</button>
                </div>

                <div class="dm-assign-row">
                    <select id="assign-atk-${esc(c.id)}">
                        <option value="">-- Attacke geben (${gameState.customAttacks.length}) --</option>
                        ${attackOptions}
                    </select>
                    <button class="btn-primary" onclick="dmAssignItem(${cid}, 'customAttacks', 'attacks', ${jsArg('assign-atk-' + c.id)})">+ Attacke</button>
                </div>

                <div class="dm-assign-row">
                    <select id="assign-spell-${esc(c.id)}">
                        <option value="">-- Zauber geben (${gameState.customSpells.length}) --</option>
                        ${spellOptions}
                    </select>
                    <button class="btn-primary" onclick="dmAssignItem(${cid}, 'customSpells', 'spells', ${jsArg('assign-spell-' + c.id)})">+ Zauber</button>
                </div>

                <div class="dm-assign-row">
                    <select id="assign-aff-${esc(c.id)}">
                        <option value="">-- Merkmal geben (${gameState.customAffinities.length}) --</option>
                        ${affinityOptions}
                    </select>
                    <button class="btn-primary" onclick="dmAssignItem(${cid}, 'customAffinities', 'affinities', ${jsArg('assign-aff-' + c.id)})">+ Merkmal</button>
                </div>

                <!-- NEU: GEGENSTÄNDE DES SPIELERS ANZEIGEN & ENTFERNEN -->
                <div class="dm-attacks-editor">
                    <strong>${icon('bag')} Gegenstände im Beutel von ${esc(c.name)} (${esc(bagUsed)}/${isInf ? '∞' : esc(bagMax)} Packmaß):</strong>
                    ${c.items.length === 0 ? '<p class="muted">Keine Gegenstände im Beutel.</p>' : ''}
                    ${c.items.map((it, idx) => `
                        <div class="dm-attack-row">
                            <span class="atk-title">${esc(it.name)} <span class="packmass-pill">${icon('box')} ${esc(clampPackmass(it.packmass))}</span></span>
                            <small class="muted">Anf: ${esc(it.requirement || 'Keine')} | Aktion: ${esc(it.action || '-')}</small>
                            <button type="button" class="btn-del" title="Gegenstand entfernen" onclick="dmRemovePlayerEntry(${cid}, 'items', ${idx})" aria-label="Entfernen">${icon('x')}</button>
                        </div>
                    `).join('')}
                </div>

                <!-- NEU: MERKMALE DES SPIELERS ANZEIGEN & ENTFERNEN -->
                <div class="dm-attacks-editor">
                    <strong>${icon('flask')} Merkmale von ${esc(c.name)}:</strong>
                    ${c.affinities.length === 0 ? '<p class="muted">Keine Merkmale aktiv.</p>' : ''}
                    ${c.affinities.map((af, idx) => `
                        <div class="dm-attack-row">
                            <span class="atk-title">${esc(af.name)}</span>
                            <small class="muted">Effekt: ${esc(af.effect || af.desc || '-')}</small>
                            <button type="button" class="btn-del" title="Merkmal entfernen" onclick="dmRemovePlayerEntry(${cid}, 'affinities', ${idx})" aria-label="Entfernen">${icon('x')}</button>
                        </div>
                    `).join('')}
                </div>

                <!-- ATTACKEN DES SPIELERS BEARBEITEN & ENTFERNEN -->
                <div class="dm-attacks-editor">
                    <strong>${icon('blade')} Attacken von ${esc(c.name)} (Aktion & Exhaustion live anpassen):</strong>
                    ${c.attacks.length === 0 ? '<p class="muted">Keine Attacken.</p>' : ''}
                    ${c.attacks.map((atk, idx) => `
                        <div class="dm-attack-row">
                            <span class="atk-title">${esc(atk.name)}</span>
                            <input type="text" id="dm-patk-action-${esc(c.id)}-${idx}" value="${esc(atk.action || '')}" placeholder="Aktion (Schaden / Effekt)"
                                onchange="dmUpdatePlayerAttack(${cid}, ${idx}, 'action', this.value)">
                            <label class="dm-checkbox-label" title="Verbraucht Exhaustion Point">
                                <input type="checkbox" ${atk.usesExhaustion ? 'checked' : ''}
                                    onchange="dmUpdatePlayerAttack(${cid}, ${idx}, 'usesExhaustion', this.checked)">
                                ${icon('bolt')} Exh.
                            </label>
                            <button type="button" class="btn-del" title="Attacke entfernen" onclick="dmRemovePlayerEntry(${cid}, 'attacks', ${idx})" aria-label="Entfernen">${icon('x')}</button>
                        </div>
                    `).join('')}
                </div>

                <!-- ZAUBER DES SPIELERS BEARBEITEN & ENTFERNEN -->
                <div class="dm-attacks-editor">
                    <strong>${icon('spark')} Zauber von ${esc(c.name)} (Anforderung, Aktion & Exhaustion live anpassen):</strong>
                    ${c.spells.length === 0 ? '<p class="muted">Keine Zauber.</p>' : ''}
                    ${c.spells.map((sp, idx) => `
                        <div class="dm-spell-row">
                            <span class="atk-title">${icon('spark')} ${esc(sp.name)}</span>
                            <input type="text" id="dm-pspell-req-${esc(c.id)}-${idx}" value="${esc(sp.requirement || '')}" placeholder="Anforderung"
                                onchange="dmUpdatePlayerSpell(${cid}, ${idx}, 'requirement', this.value)">
                            <input type="text" id="dm-pspell-action-${esc(c.id)}-${idx}" value="${esc(sp.action || '')}" placeholder="Aktion (Schaden / Effekt)"
                                onchange="dmUpdatePlayerSpell(${cid}, ${idx}, 'action', this.value)">
                            <label class="dm-checkbox-label" title="Verbraucht Exhaustion Point">
                                <input type="checkbox" ${sp.usesExhaustion ? 'checked' : ''}
                                    onchange="dmUpdatePlayerSpell(${cid}, ${idx}, 'usesExhaustion', this.checked)">
                                ${icon('bolt')} Exh.
                            </label>
                            <button type="button" class="btn-del" title="Zauber entfernen" onclick="dmRemovePlayerEntry(${cid}, 'spells', ${idx})" aria-label="Entfernen">${icon('x')}</button>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }).join('');
}

function dmRemovePlayerEntry(playerId, listKey, idx) {
    const char = gameState.characters[playerId];
    if (!char || !Array.isArray(char[listKey])) return;
    const entry = char[listKey][idx];
    const entryName = entry ? entry.name : undefined;
    const label = entry && entry.name ? `"${entry.name}"` : 'diesen Eintrag';

    openConfirmModal(`Möchtest du ${label} wirklich vom Charakterbogen von "${char.name}" entfernen?`, () => {
        // Charakter neu lesen: ein Spieler-Update kann das Objekt inzwischen ersetzt haben
        const current = gameState.characters[playerId];
        if (!current || !Array.isArray(current[listKey])) return;
        const target = current[listKey][idx];
        if (!target || target.name !== entryName) return;
        current[listKey].splice(idx, 1);
        broadcastState();
        renderDmView();
    });
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
        const oldOrder = gameState.combat.order || [];
        const activeKey = oldOrder[gameState.combat.turnIndex]?.key;
        gameState.combat.order = oldOrder.filter(entry => !(entry.kind === 'player' && entry.id === playerId));
        restoreTurnPointer(activeKey, oldOrder, gameState.combat.turnIndex);
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

    const itemOptions = gameState.customItems.map((it, i) => `<option value="${i}">${esc(it.name)} (${esc(clampPackmass(it.packmass))})</option>`).join('');
    const attackOptions = gameState.customAttacks.map((w, i) => `<option value="${i}">${esc(w.name)}</option>`).join('');
    const spellOptions = gameState.customSpells.map((sp, i) => `<option value="${i}">${esc(sp.name)}</option>`).join('');
    const affinityOptions = gameState.customAffinities.map((af, i) => `<option value="${i}">${esc(af.name)}</option>`).join('');

    list.innerHTML = gameState.enemies.map((e, idx) => {
        const st = e.stats || {};
        const stat = (k) => esc(st[k] === undefined || st[k] === null ? 10 : st[k]);
        return `
        <div class="npc-card">
            <div class="dm-player-header">
                <div class="char-identity">
                    ${e.avatar ? `<img src="${esc(e.avatar)}" class="mini-avatar">` : `<div class="mini-avatar-placeholder">M</div>`}
                    <div>
                        <strong>${esc(e.name)}</strong>
                        <span class="sub-info"> | AC: ${esc(e.ac)} | Init: ${esc(e.initiative)}</span>
                        <div class="cat-badge-row">
                            ${(e.categories || []).map(cat => `<span class="cat-tag">${esc(cat)}</span>`).join('')}
                        </div>
                    </div>
                </div>
                <div class="dm-badges">
                    <span class="badge-hp">HP: ${esc(e.hp)}/${esc(e.maxHp)}</span>
                    <span class="badge-moral">${esc(formatMorality(e.morality))}</span>
                    <button class="btn-del" onclick="dmRemoveEnemy(${idx})" title="Entfernen" aria-label="Entfernen">${icon('x')}</button>
                </div>
            </div>

            ${e.description ? `<p class="npc-desc-box">${esc(e.description)}</p>` : ''}

            <div class="dm-mini-stats">
                STR ${stat('str')} | DEX ${stat('dex')} | CON ${stat('con')} |
                INT ${stat('int')} | WIS ${stat('wis')} | CHA ${stat('cha')}<br>
                Geld: ${formatCopperCoins(e.copper || 0)}
            </div>

            <div class="npc-inventory-box">
                <div>
                    <strong>Gegenstände:</strong>
                    ${(e.items || []).length === 0 ? '<span class="muted">Keine</span>' : e.items.map((it, iIdx) =>
        `<span class="inline-item-pill">${esc(it.name)} [${icon('box')} ${esc(clampPackmass(it.packmass))}] (${esc(it.action || '-')}) <b onclick="dmRemoveNpcItem(${idx}, 'items', ${iIdx})">×</b></span>`
    ).join(' ')}
                </div>
                <div>
                    <strong>Attacken:</strong>
                    ${(e.attacks || []).length === 0 ? '<span class="muted">Keine</span>' : e.attacks.map((a, aIdx) =>
        `<span class="inline-item-pill">${esc(a.name)} (${esc(a.action || '-')}) ${a.usesExhaustion ? icon('bolt') : ''} <b onclick="dmRemoveNpcItem(${idx}, 'attacks', ${aIdx})">×</b></span>`
    ).join(' ')}
                </div>
                <div>
                    <strong>Zauber:</strong>
                    ${(e.spells || []).length === 0 ? '<span class="muted">Keine</span>' : e.spells.map((sp, sIdx) =>
        `<span class="inline-item-pill">${icon('spark')} ${esc(sp.name)} [Anf: ${esc(sp.requirement || 'Keine')}] (${esc(sp.action || '-')}) ${sp.usesExhaustion ? icon('bolt') : ''} <b onclick="dmRemoveNpcItem(${idx}, 'spells', ${sIdx})">×</b></span>`
    ).join(' ')}
                </div>
                <div>
                    <strong>Merkmale:</strong>
                    ${(e.affinities || []).length === 0 ? '<span class="muted">Keine</span>' : e.affinities.map((af, afIdx) =>
        `<span class="inline-item-pill">${esc(af.name)} (${esc(af.effect || '-')}) <b onclick="dmRemoveNpcItem(${idx}, 'affinities', ${afIdx})">×</b></span>`
    ).join(' ')}
                </div>
            </div>

            <div class="picker-four-cols">
                <div class="dm-assign-row">
                    <select id="npc-add-item-${idx}">
                        <option value="">+ Gegenstand (${gameState.customItems.length})</option>
                        ${itemOptions}
                    </select>
                    <button onclick="dmGiveEnemyItem(${idx}, 'customItems', 'items', 'npc-add-item-${idx}')">+ Item</button>
                </div>
                <div class="dm-assign-row">
                    <select id="npc-add-atk-${idx}">
                        <option value="">+ Attacke (${gameState.customAttacks.length})</option>
                        ${attackOptions}
                    </select>
                    <button onclick="dmGiveEnemyItem(${idx}, 'customAttacks', 'attacks', 'npc-add-atk-${idx}')">+ Attacke</button>
                </div>
                <div class="dm-assign-row">
                    <select id="npc-add-spell-${idx}">
                        <option value="">+ Zauber (${gameState.customSpells.length})</option>
                        ${spellOptions}
                    </select>
                    <button onclick="dmGiveEnemyItem(${idx}, 'customSpells', 'spells', 'npc-add-spell-${idx}')">+ Zauber</button>
                </div>
                <div class="dm-assign-row">
                    <select id="npc-add-aff-${idx}">
                        <option value="">+ Merkmal (${gameState.customAffinities.length})</option>
                        ${affinityOptions}
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
    `;
    }).join('');
}

function dmGiveEnemyItem(enemyIdx, sourceKey, targetKey, selectId) {
    const select = document.getElementById(selectId);
    if (!select || select.value === "") return;
    const enemy = gameState.enemies[enemyIdx];
    const item = gameState[sourceKey][parseInt(select.value)];
    if (!enemy || !item) return;
    if (!enemy[targetKey]) enemy[targetKey] = [];
    enemy[targetKey].push({ ...item });
    broadcastState();
    renderDmEnemies();
}

function dmRemoveNpcItem(enemyIdx, targetKey, itemIdx) {
    const enemy = gameState.enemies[enemyIdx];
    const enemyUid = enemy ? enemy._uid : null;
    const item = enemy?.[targetKey]?.[itemIdx];
    const itemName = item ? item.name : undefined;
    openConfirmModal(`Möchtest du "${item?.name || 'diesen Eintrag'}" wirklich von "${enemy?.name}" entfernen?`, () => {
        // Über _uid neu suchen: die Liste kann sich seit dem Klick geändert haben
        const current = gameState.enemies.find(e => e._uid === enemyUid);
        const list = current ? current[targetKey] : null;
        const target = Array.isArray(list) ? list[itemIdx] : null;
        if (!target || target.name !== itemName) return;
        list.splice(itemIdx, 1);
        broadcastState();
        renderDmEnemies();
    });
}

// ============================================================================
// DM TAB 2: VORLAGEN & BIBLIOTHEK
// ============================================================================
function renderDmTemplatesTab(container) {
    ensureSpellsAndDmNotesState();
    const eNpc = editingState.npc !== null ? gameState.npcTemplates[editingState.npc] : null;
    const eItem = editingState.item !== null ? gameState.customItems[editingState.item] : null;
    const eAtk = editingState.attack !== null ? gameState.customAttacks[editingState.attack] : null;
    const eSpell = editingState.spell !== null ? gameState.customSpells[editingState.spell] : null;
    const eAff = editingState.affinity !== null ? gameState.customAffinities[editingState.affinity] : null;

    const draftItemOptions = gameState.customItems.map((it, i) => `<option value="${i}">${esc(it.name)} (${esc(clampPackmass(it.packmass))})</option>`).join('');
    const draftAttackOptions = gameState.customAttacks.map((a, i) => `<option value="${i}">${esc(a.name)}</option>`).join('');
    const draftSpellOptions = gameState.customSpells.map((sp, i) => `<option value="${i}">${esc(sp.name)}</option>`).join('');
    const draftAffinityOptions = gameState.customAffinities.map((af, i) => `<option value="${i}">${esc(af.name)}</option>`).join('');
    const eStats = (eNpc && eNpc.stats) || {};
    const eStat = (k) => esc(eStats[k] === undefined || eStats[k] === null ? 10 : eStats[k]);

    container.innerHTML = `
        <div class="templates-vertical-stack">
            
            <h2>Vorlagen erstellen & bearbeiten</h2>

            <div class="card">
                <div class="creator-header-row">
                    <h3>1. Monster / NPC Vorlage</h3>
                    <select onchange="selectTemplateToEdit('npc', this.value)">
                        <option value="">-- Neu erstellen (oder Vorlage zum Bearbeiten wählen) --</option>
                        ${gameState.npcTemplates.map((t, i) => `<option value="${i}" ${editingState.npc === i ? 'selected' : ''}>Bearbeiten: ${esc(t.name)}</option>`).join('')}
                    </select>
                </div>

                <div class="npc-creator-grid">
                    <div id="dm-npc-dropzone" class="drop-zone">
                        ${npcDraft.avatar
        ? `<img src="${esc(npcDraft.avatar)}" class="drop-preview-img">
                               <button type="button" class="btn-del drop-remove-btn" onclick="clearDraftAvatar('npc', event)" title="Entfernen" aria-label="Entfernen">${icon('x')}</button>`
        : `<div class="drop-zone-prompt"><strong>Monster/NPC Bild</strong><span>Hierher ziehen oder klicken</span></div>`
    }
                        <input type="file" id="dm-npc-file" accept="image/*" class="hidden">
                    </div>

                    <div class="dm-stack">
                        <div class="form-row">
                            <label class="field-label">NAME
                                <input type="text" id="dm-npc-name" placeholder="z.B. Gefallener Paladin" value="${esc(eNpc ? eNpc.name : '')}">
                            </label>
                            <label class="field-label">KATEGORIEN (MIT KOMMA TRENNEN)
                                <input type="text" id="dm-npc-cats" placeholder="z.B. Monster, Ritter, Boss" value="${esc(eNpc ? (eNpc.categories || []).join(', ') : '')}">
                            </label>
                        </div>

                        <label class="field-label">BESCHREIBUNG & VERHALTEN
                            <textarea id="dm-npc-desc" rows="2" placeholder="Beschreibung, Verhalten, Hintergrund...">${esc(eNpc ? eNpc.description : '')}</textarea>
                        </label>

                        <div class="npc-combat-inputs">
                            <label class="field-label">MAX HP
                                <input type="number" id="dm-npc-hp" value="${esc(eNpc ? eNpc.maxHp : 30)}">
                            </label>
                            <label class="field-label">ARMOR CLASS
                                <input type="number" id="dm-npc-ac" value="${esc(eNpc ? eNpc.ac : 14)}">
                            </label>
                            <label class="field-label">INITIATIVE
                                <input type="number" id="dm-npc-init" value="${esc(eNpc ? eNpc.initiative : 0)}">
                            </label>
                            <label class="field-label">MORAL
                                <input type="number" id="dm-npc-moral" value="${esc(eNpc ? eNpc.morality : 0)}">
                            </label>
                            <label class="field-label">GELD IN KUPFER (CP)
                                <input type="number" id="dm-npc-copper" min="0" value="${esc(eNpc ? (eNpc.copper || 0) : 0)}">
                            </label>
                        </div>

                        <div class="npc-stats-inputs">
                            <label class="field-label">STR
                                <input type="number" id="dm-npc-str" value="${eStat('str')}">
                            </label>
                            <label class="field-label">DEX
                                <input type="number" id="dm-npc-dex" value="${eStat('dex')}">
                            </label>
                            <label class="field-label">CON
                                <input type="number" id="dm-npc-con" value="${eStat('con')}">
                            </label>
                            <label class="field-label">INT
                                <input type="number" id="dm-npc-int" value="${eStat('int')}">
                            </label>
                            <label class="field-label">WIS
                                <input type="number" id="dm-npc-wis" value="${eStat('wis')}">
                            </label>
                            <label class="field-label">CHA
                                <input type="number" id="dm-npc-cha" value="${eStat('cha')}">
                            </label>
                        </div>
                    </div>
                </div>

                <div class="npc-library-picker">
                    <div class="picker-four-cols">
                        <div class="dm-assign-row">
                            <select id="draft-select-item">
                                <option value="">-- Gegenstand (${gameState.customItems.length}) --</option>
                                ${draftItemOptions}
                            </select>
                            <button type="button" onclick="addToNpcDraft('customItems', 'items', 'draft-select-item')">+ Item</button>
                        </div>

                        <div class="dm-assign-row">
                            <select id="draft-select-atk">
                                <option value="">-- Attacke (${gameState.customAttacks.length}) --</option>
                                ${draftAttackOptions}
                            </select>
                            <button type="button" onclick="addToNpcDraft('customAttacks', 'attacks', 'draft-select-atk')">+ Attacke</button>
                        </div>

                        <div class="dm-assign-row">
                            <select id="draft-select-spell">
                                <option value="">-- Zauber (${gameState.customSpells.length}) --</option>
                                ${draftSpellOptions}
                            </select>
                            <button type="button" onclick="addToNpcDraft('customSpells', 'spells', 'draft-select-spell')">+ Zauber</button>
                        </div>

                        <div class="dm-assign-row">
                            <select id="draft-select-aff">
                                <option value="">-- Merkmal (${gameState.customAffinities.length}) --</option>
                                ${draftAffinityOptions}
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

            <!-- 2×2 Raster für Gegenstände, Attacken, Zauber & Merkmale -->
            <div class="creators-four-grid">
                
                <!-- 2. GEGENSTÄNDE -->
                <div class="card">
                    <div class="creator-header-row">
                        <h3>2. Gegenstände</h3>
                        <select onchange="selectTemplateToEdit('item', this.value)">
                            <option value="">-- Neu / Bearbeiten --</option>
                            ${gameState.customItems.map((it, i) => `<option value="${i}" ${editingState.item === i ? 'selected' : ''}>Bearbeiten: ${esc(it.name)}</option>`).join('')}
                        </select>
                    </div>

                    <div id="dm-item-dropzone" class="drop-zone drop-zone-small">
                        ${itemDraftAvatar
        ? `<img src="${esc(itemDraftAvatar)}" class="drop-preview-img">
                               <button type="button" class="btn-del drop-remove-btn" onclick="clearDraftAvatar('item', event)" title="Entfernen" aria-label="Entfernen">${icon('x')}</button>`
        : `<div class="drop-zone-prompt"><strong>Bild (Gegenstand)</strong><span>Drag & Drop oder Klick</span></div>`
    }
                        <input type="file" id="dm-item-file" accept="image/*" class="hidden">
                    </div>

                    <div class="form-row">
                        <label class="field-label">NAME
                            <input type="text" id="dm-item-name" placeholder="z.B. Schwarze Klinge" value="${esc(eItem ? eItem.name : '')}">
                        </label>
                        <label class="field-label">PACKMASS (1–10)
                            <input type="number" id="dm-item-packmass" min="1" max="10" value="${esc(eItem ? clampPackmass(eItem.packmass) : 1)}">
                        </label>
                    </div>
                    <label class="field-label">KATEGORIEN (KOMMAGETRENNT)
                        <input type="text" id="dm-item-cats" placeholder="z.B. Waffe, Schwert, Rüstung" value="${esc(eItem ? (eItem.categories || []).join(', ') : '')}">
                    </label>
                    <label class="field-label">ANFORDERUNG
                        <input type="text" id="dm-item-req" placeholder="z.B. STR 14, Moral -2" value="${esc(eItem ? eItem.requirement : '')}">
                    </label>
                    <label class="field-label">AKTION
                        <input type="text" id="dm-item-action" placeholder="z.B. 1d8 Schnitt / +2 AC" value="${esc(eItem ? eItem.action : '')}">
                    </label>
                    
                    <div class="form-row">
                        <button class="btn-primary" onclick="saveCustomItem()">
                            ${editingState.item !== null ? 'Änderungen speichern' : 'Gegenstand speichern'}
                        </button>
                        ${editingState.item !== null ? `<button onclick="selectTemplateToEdit('item', '')">Neu</button>` : ''}
                    </div>
                </div>

                <!-- 3. ATTACKEN -->
                <div class="card">
                    <div class="creator-header-row">
                        <h3>3. Attacken</h3>
                        <select onchange="selectTemplateToEdit('attack', this.value)">
                            <option value="">-- Neu / Bearbeiten --</option>
                            ${gameState.customAttacks.map((a, i) => `<option value="${i}" ${editingState.attack === i ? 'selected' : ''}>Bearbeiten: ${esc(a.name)}</option>`).join('')}
                        </select>
                    </div>

                    <div id="dm-atk-dropzone" class="drop-zone drop-zone-small">
                        ${attackDraftAvatar
        ? `<img src="${esc(attackDraftAvatar)}" class="drop-preview-img">
                               <button type="button" class="btn-del drop-remove-btn" onclick="clearDraftAvatar('attack', event)" title="Entfernen" aria-label="Entfernen">${icon('x')}</button>`
        : `<div class="drop-zone-prompt"><strong>Bild (Attacke)</strong><span>Drag & Drop oder Klick</span></div>`
    }
                        <input type="file" id="dm-atk-file" accept="image/*" class="hidden">
                    </div>

                    <label class="field-label">NAME
                        <input type="text" id="dm-atk-name" placeholder="z.B. Schwerthieb / Sturmangriff" value="${esc(eAtk ? eAtk.name : '')}">
                    </label>
                    <label class="field-label">KATEGORIEN (KOMMAGETRENNT)
                        <input type="text" id="dm-atk-cats" placeholder="z.B. Nahkampf, Physisch" value="${esc(eAtk ? (eAtk.categories || []).join(', ') : '')}">
                    </label>
                    <label class="field-label">AKTION
                        <input type="text" id="dm-atk-action" placeholder="z.B. 2d6+3 Schaden" value="${esc(eAtk ? eAtk.action : '')}">
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

                <!-- 4. ZAUBER -->
                <div class="card">
                    <div class="creator-header-row">
                        <h3>4. Zauber</h3>
                        <select onchange="selectTemplateToEdit('spell', this.value)">
                            <option value="">-- Neu / Bearbeiten --</option>
                            ${gameState.customSpells.map((sp, i) => `<option value="${i}" ${editingState.spell === i ? 'selected' : ''}>Bearbeiten: ${esc(sp.name)}</option>`).join('')}
                        </select>
                    </div>

                    <div id="dm-spell-dropzone" class="drop-zone drop-zone-small">
                        ${spellDraftAvatar
        ? `<img src="${esc(spellDraftAvatar)}" class="drop-preview-img">
                               <button type="button" class="btn-del drop-remove-btn" onclick="clearDraftAvatar('spell', event)" title="Entfernen" aria-label="Entfernen">${icon('x')}</button>`
        : `<div class="drop-zone-prompt"><strong>Bild (Zauber)</strong><span>Drag & Drop oder Klick</span></div>`
    }
                        <input type="file" id="dm-spell-file" accept="image/*" class="hidden">
                    </div>

                    <label class="field-label">NAME
                        <input type="text" id="dm-spell-name" placeholder="z.B. Höllenfeuer / Lichtspeer" value="${esc(eSpell ? eSpell.name : '')}">
                    </label>
                    <label class="field-label">KATEGORIEN (KOMMAGETRENNT)
                        <input type="text" id="dm-spell-cats" placeholder="z.B. Feuer, Heilig, Dämonisch" value="${esc(eSpell ? (eSpell.categories || []).join(', ') : '')}">
                    </label>
                    <label class="field-label">ANFORDERUNG
                        <input type="text" id="dm-spell-req" placeholder="z.B. INT 14, Moral -3" value="${esc(eSpell ? eSpell.requirement : '')}">
                    </label>
                    <label class="field-label">AKTION
                        <input type="text" id="dm-spell-action" placeholder="z.B. 3d6 Feuerschaden / +4 Heilung" value="${esc(eSpell ? eSpell.action : '')}">
                    </label>
                    <label class="checkbox-inline-row">
                        <input type="checkbox" id="dm-spell-exh" ${eSpell && eSpell.usesExhaustion ? 'checked' : ''}>
                        Verbraucht Exhaustion Point
                    </label>

                    <div class="form-row">
                        <button class="btn-primary" onclick="saveCustomSpell()">
                            ${editingState.spell !== null ? 'Änderungen speichern' : 'Zauber speichern'}
                        </button>
                        ${editingState.spell !== null ? `<button onclick="selectTemplateToEdit('spell', '')">Neu</button>` : ''}
                    </div>
                </div>

                <!-- 5. MERKMALE -->
                <div class="card">
                    <div class="creator-header-row">
                        <h3>5. Merkmale</h3>
                        <select onchange="selectTemplateToEdit('affinity', this.value)">
                            <option value="">-- Neu / Bearbeiten --</option>
                            ${gameState.customAffinities.map((af, i) => `<option value="${i}" ${editingState.affinity === i ? 'selected' : ''}>Bearbeiten: ${esc(af.name)}</option>`).join('')}
                        </select>
                    </div>

                    <div id="dm-aff-dropzone" class="drop-zone drop-zone-small">
                        ${affinityDraftAvatar
        ? `<img src="${esc(affinityDraftAvatar)}" class="drop-preview-img">
                               <button type="button" class="btn-del drop-remove-btn" onclick="clearDraftAvatar('affinity', event)" title="Entfernen" aria-label="Entfernen">${icon('x')}</button>`
        : `<div class="drop-zone-prompt"><strong>Bild (Merkmal)</strong><span>Drag & Drop oder Klick</span></div>`
    }
                        <input type="file" id="dm-aff-file" accept="image/*" class="hidden">
                    </div>

                    <label class="field-label">NAME
                        <input type="text" id="dm-aff-name" placeholder="z.B. Paranoia / Dämonenflügel" value="${esc(eAff ? eAff.name : '')}">
                    </label>
                    <label class="field-label">KATEGORIEN (KOMMAGETRENNT)
                        <input type="text" id="dm-aff-cats" placeholder="z.B. Psychose, Mutation, Segen" value="${esc(eAff ? (eAff.categories || []).join(', ') : '')}">
                    </label>
                    <label class="field-label">EFFEKT
                        <input type="text" id="dm-aff-effect" placeholder="z.B. +2 Initiative, -2 WIS" value="${esc(eAff ? eAff.effect : '')}">
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
                    <input type="text" id="lib-search-input" placeholder="Nach Name suchen..." value="${esc(libSearchQuery)}">
                    <select id="lib-type-select">
                        <option value="ALL" ${libSelectedType === 'ALL' ? 'selected' : ''}>Alle Typen</option>
                        <option value="npc" ${libSelectedType === 'npc' ? 'selected' : ''}>Monster & NPCs</option>
                        <option value="item" ${libSelectedType === 'item' ? 'selected' : ''}>Gegenstände</option>
                        <option value="attack" ${libSelectedType === 'attack' ? 'selected' : ''}>Attacken</option>
                        <option value="spell" ${libSelectedType === 'spell' ? 'selected' : ''}>Zauber</option>
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

    bindImageDropZone('dm-npc-dropzone', 'dm-npc-file', (b64) => { npcDraft.avatar = b64; renderDmView({ preserveInputs: true }); });
    bindImageDropZone('dm-item-dropzone', 'dm-item-file', (b64) => { itemDraftAvatar = b64; renderDmView({ preserveInputs: true }); });
    bindImageDropZone('dm-atk-dropzone', 'dm-atk-file', (b64) => { attackDraftAvatar = b64; renderDmView({ preserveInputs: true }); });
    bindImageDropZone('dm-spell-dropzone', 'dm-spell-file', (b64) => { spellDraftAvatar = b64; renderDmView({ preserveInputs: true }); });
    bindImageDropZone('dm-aff-dropzone', 'dm-aff-file', (b64) => { affinityDraftAvatar = b64; renderDmView({ preserveInputs: true }); });

    let libSearchTimer = null;
    document.getElementById('lib-search-input').addEventListener('input', (e) => {
        libSearchQuery = e.target.value;
        clearTimeout(libSearchTimer);
        libSearchTimer = setTimeout(renderLibraryResults, 150);
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
        resetDraftAvatar(type);
        renderDmView({ preserveInputs: true });
    });
}

function selectTemplateToEdit(type, idxStr) {
    let idx = idxStr === "" ? null : parseInt(idxStr);
    const lib = LIB_TYPES[type];
    if (idx !== null && (isNaN(idx) || !lib || !gameState[lib.list][idx])) idx = null;
    editingState[type] = idx;

    if (type === 'npc') {
        if (idx !== null) {
            const t = gameState.npcTemplates[idx];
            npcDraft = {
                avatar: t.avatar || '',
                items: JSON.parse(JSON.stringify(t.items || [])),
                attacks: JSON.parse(JSON.stringify(t.attacks || [])),
                spells: JSON.parse(JSON.stringify(t.spells || [])),
                affinities: JSON.parse(JSON.stringify(t.affinities || []))
            };
        } else {
            npcDraft = { avatar: '', items: [], attacks: [], spells: [], affinities: [] };
        }
    } else if (type === 'item') {
        itemDraftAvatar = idx !== null ? (gameState.customItems[idx].avatar || '') : '';
    } else if (type === 'attack') {
        attackDraftAvatar = idx !== null ? (gameState.customAttacks[idx].avatar || '') : '';
    } else if (type === 'spell') {
        spellDraftAvatar = idx !== null ? (gameState.customSpells[idx].avatar || '') : '';
    } else if (type === 'affinity') {
        affinityDraftAvatar = idx !== null ? (gameState.customAffinities[idx].avatar || '') : '';
    }

    renderDmView();
}

function renderNpcDraftPreview() {
    const itemsBox = document.getElementById('npc-draft-items-list');
    if (!itemsBox) return;
    itemsBox.innerHTML = `
        <div><strong>Gegenstände:</strong> ${(npcDraft.items || []).map((it, i) => `<span class="inline-item-pill">${esc(it.name)} [${icon('box')} ${esc(clampPackmass(it.packmass))}] <b onclick="removeFromNpcDraft('items', ${i})">×</b></span>`).join(' ') || '<span class="muted">Keine</span>'}</div>
        <div><strong>Attacken:</strong> ${(npcDraft.attacks || []).map((a, i) => `<span class="inline-item-pill">${esc(a.name)} <b onclick="removeFromNpcDraft('attacks', ${i})">×</b></span>`).join(' ') || '<span class="muted">Keine</span>'}</div>
        <div><strong>Zauber:</strong> ${(npcDraft.spells || []).map((sp, i) => `<span class="inline-item-pill">${icon('spark')} ${esc(sp.name)} <b onclick="removeFromNpcDraft('spells', ${i})">×</b></span>`).join(' ') || '<span class="muted">Keine</span>'}</div>
        <div><strong>Merkmale:</strong> ${(npcDraft.affinities || []).map((af, i) => `<span class="inline-item-pill">${esc(af.name)} <b onclick="removeFromNpcDraft('affinities', ${i})">×</b></span>`).join(' ') || '<span class="muted">Keine</span>'}</div>
    `;
}

function addToNpcDraft(sourceKey, targetKey, selectId) {
    const select = document.getElementById(selectId);
    if (!select || select.value === "") return;
    const item = gameState[sourceKey][parseInt(select.value)];
    if (!item) return;
    if (!npcDraft[targetKey]) npcDraft[targetKey] = [];
    npcDraft[targetKey].push({ ...item });
    renderNpcDraftPreview();
}

function removeFromNpcDraft(targetKey, idx) {
    const entry = (npcDraft[targetKey] || [])[idx];
    const entryName = entry ? entry.name : undefined;
    openConfirmModal("Diesen Eintrag wirklich aus dem Vorlagen-Entwurf entfernen?", () => {
        const list = npcDraft[targetKey];
        const target = Array.isArray(list) ? list[idx] : null;
        if (!target || target.name !== entryName) return;
        list.splice(idx, 1);
        renderNpcDraftPreview();
    });
}

function saveNpcTemplate(spawnImmediately) {
    const name = document.getElementById('dm-npc-name').value.trim();
    if (!name) return alert("Bitte einen Namen für das Monster / den NPC eingeben!");

    const hp = readNumberInput('dm-npc-hp', 20);
    const copper = Math.max(0, readNumberInput('dm-npc-copper', 0));

    const newNpc = {
        name: name,
        categories: parseCategories(document.getElementById('dm-npc-cats').value),
        avatar: npcDraft.avatar,
        description: document.getElementById('dm-npc-desc').value.trim(),
        hp: hp,
        maxHp: hp,
        ac: readNumberInput('dm-npc-ac', 10),
        initiative: readNumberInput('dm-npc-init', 0),
        morality: readNumberInput('dm-npc-moral', 0),
        copper: copper,
        stats: {
            str: readNumberInput('dm-npc-str', 10),
            dex: readNumberInput('dm-npc-dex', 10),
            con: readNumberInput('dm-npc-con', 10),
            int: readNumberInput('dm-npc-int', 10),
            wis: readNumberInput('dm-npc-wis', 10),
            cha: readNumberInput('dm-npc-cha', 10)
        },
        items: JSON.parse(JSON.stringify(npcDraft.items || [])),
        attacks: JSON.parse(JSON.stringify(npcDraft.attacks || [])),
        spells: JSON.parse(JSON.stringify(npcDraft.spells || [])),
        affinities: JSON.parse(JSON.stringify(npcDraft.affinities || []))
    };

    if (editingState.npc !== null) {
        gameState.npcTemplates[editingState.npc] = newNpc;
        editingState.npc = null;
    } else {
        gameState.npcTemplates.push(newNpc);
    }

    if (spawnImmediately) {
        const spawned = JSON.parse(JSON.stringify(newNpc));
        spawned._uid = makeNpcUid();
        gameState.enemies.push(spawned);
    }

    npcDraft = { avatar: '', items: [], attacks: [], spells: [], affinities: [] };
    broadcastState();
    renderDmView();
}

function resetDraftAvatar(type) {
    if (type === 'item') itemDraftAvatar = '';
    if (type === 'attack') attackDraftAvatar = '';
    if (type === 'spell') spellDraftAvatar = '';
    if (type === 'affinity') affinityDraftAvatar = '';
}

// Gemeinsamer Abschluss der Speichern-Funktionen: bearbeiten oder anhängen, Entwurf zurücksetzen, senden, rendern
function commitLibraryEntry(type, obj) {
    const list = gameState[LIB_TYPES[type].list];
    if (editingState[type] !== null && editingState[type] < list.length) {
        list[editingState[type]] = obj;
    } else {
        list.push(obj);
    }
    editingState[type] = null;
    resetDraftAvatar(type);
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

    commitLibraryEntry('item', obj);
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

    commitLibraryEntry('attack', obj);
}

function saveCustomSpell() {
    ensureSpellsAndDmNotesState();
    const name = document.getElementById('dm-spell-name').value.trim();
    if (!name) return alert("Bitte Namen für den Zauber eingeben!");

    const obj = {
        avatar: spellDraftAvatar,
        name: name,
        categories: parseCategories(document.getElementById('dm-spell-cats').value),
        requirement: document.getElementById('dm-spell-req').value.trim(),
        action: document.getElementById('dm-spell-action').value.trim() || '1d8',
        usesExhaustion: document.getElementById('dm-spell-exh').checked
    };

    commitLibraryEntry('spell', obj);
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

    commitLibraryEntry('affinity', obj);
}

function renderCategoryPills() {
    const bar = document.getElementById('lib-category-pills');
    if (!bar) return;

    const allCats = getAllCustomCategories();
    bar.innerHTML = `
        <button class="cat-pill ${libSelectedCategory === 'ALL' ? 'active' : ''}" onclick="selectLibCategory('ALL')">Alle Kategorien</button>
        ${allCats.map(cat => `
            <button class="cat-pill ${libSelectedCategory.toLowerCase() === cat.toLowerCase() ? 'active' : ''}"
                onclick="selectLibCategory(${jsArg(cat)})">${esc(cat)}</button>
        `).join('')}
    `;
}

function selectLibCategory(cat) {
    libSelectedCategory = cat;
    renderCategoryPills();
    renderLibraryResults();
}

function renderLibraryResults() {
    ensureSpellsAndDmNotesState();
    const listEl = document.getElementById('library-results-list');
    if (!listEl) return;

    let combined = [];
    Object.keys(LIB_TYPES).forEach(type => {
        gameState[LIB_TYPES[type].list].forEach((item, idx) => combined.push({ item, type, idx }));
    });

    if (libSelectedType !== 'ALL') {
        combined = combined.filter(entry => entry.type === libSelectedType);
    }
    if (libSelectedCategory !== 'ALL') {
        combined = combined.filter(entry =>
            (entry.item.categories || []).some(c => String(c).toLowerCase() === libSelectedCategory.toLowerCase())
        );
    }
    const nameOf = (entry) => String(entry.item.name || '');
    if (libSearchQuery.trim() !== '') {
        const q = libSearchQuery.trim().toLowerCase();
        combined = combined.filter(entry => nameOf(entry).toLowerCase().includes(q));
    }

    combined.sort((a, b) => {
        if (libSortBy === 'category') {
            const catA = (a.item.categories && a.item.categories[0]) ? String(a.item.categories[0]) : 'ZZZ';
            const catB = (b.item.categories && b.item.categories[0]) ? String(b.item.categories[0]) : 'ZZZ';
            return catA.localeCompare(catB) || nameOf(a).localeCompare(nameOf(b));
        }
        if (libSortBy === 'type') {
            return LIB_TYPES[a.type].label.localeCompare(LIB_TYPES[b.type].label) || nameOf(a).localeCompare(nameOf(b));
        }
        return nameOf(a).localeCompare(nameOf(b));
    });

    if (combined.length === 0) {
        listEl.innerHTML = `<p class="muted">Keine Vorlagen in der Bibliothek gefunden.</p>`;
        return;
    }

    listEl.innerHTML = combined.map(({ item, type, idx }) => `
        <div class="lib-item-card">
            <div class="dm-player-header">
                <div class="char-identity">
                    ${item.avatar ? `<img src="${esc(item.avatar)}" class="mini-avatar">` : `<div class="mini-avatar-placeholder">${esc(String(item.name || '')[0])}</div>`}
                    <div>
                        <span class="tag">${esc(LIB_TYPES[type].label)}</span>
                        <strong>${esc(item.name)}</strong>
                        ${type === 'item' ? `<span class="packmass-pill">${icon('box')} Packmaß: ${esc(clampPackmass(item.packmass))}</span>` : ''}
                        ${(type === 'attack' || type === 'spell') && item.usesExhaustion ? `<span class="exh-badge">${icon('bolt')} Exhaustion</span>` : ''}
                        <div class="cat-badge-row">
                            ${(item.categories || []).map(cat => `<span class="cat-tag">${esc(cat)}</span>`).join('')}
                        </div>
                    </div>
                </div>
                <div class="dm-badges">
                    <button onclick="selectTemplateToEdit('${type}', '${idx}'); window.scrollTo({top: 0, behavior: 'smooth'});">Bearbeiten</button>
                    ${type === 'npc'
        ? `<button class="btn-primary" onclick="dmSpawnNpcByIndex(${idx}); switchDmTab('gameplay');">Spawnen</button>`
        : ''
    }
                    <button class="btn-del" onclick="deleteLibraryItem('${type}', ${idx})" title="Entfernen" aria-label="Entfernen">${icon('x')}</button>
                </div>
            </div>

            ${type === 'npc' ? `
                ${item.description ? `<p class="npc-desc-box">${esc(item.description)}</p>` : ''}
                <small class="muted">HP: ${esc(item.maxHp)} | AC: ${esc(item.ac)} | Init: ${esc(item.initiative)} | Moral: ${esc(item.morality)} | Geld: ${formatCopperCoins(item.copper || 0)}</small>
            ` : ''}

            ${type === 'item' ? `
                <small class="muted"><strong>Anforderung:</strong> ${esc(item.requirement || 'Keine')} | <strong>Aktion:</strong> ${esc(item.action || '-')}</small>
            ` : ''}

            ${type === 'attack' ? `
                <small class="muted"><strong>Aktion:</strong> ${esc(item.action || '-')}</small>
            ` : ''}

            ${type === 'spell' ? `
                <small class="muted"><strong>Anforderung:</strong> ${esc(item.requirement || 'Keine')} | <strong>Aktion:</strong> ${esc(item.action || '-')}</small>
            ` : ''}

            ${type === 'affinity' ? `
                <small class="muted"><strong>Effekt:</strong> ${esc(item.effect || '-')}</small>
            ` : ''}
        </div>
    `).join('');
}

function deleteLibraryItem(libType, idx) {
    const lib = LIB_TYPES[libType];
    if (!lib) return;
    const entry = gameState[lib.list][idx];
    const itemName = entry?.name;

    openConfirmModal(`Möchtest du "${itemName}" wirklich dauerhaft aus der Bibliothek löschen?`, () => {
        const list = gameState[lib.list];
        // Nur löschen, wenn noch derselbe Eintrag an derselben Stelle steht
        if (!entry || list[idx] !== entry) return;
        list.splice(idx, 1);
        editingState[libType] = null;
        broadcastState();
        renderDmView();
    });
}

// ============================================================================
// DM TAB 3: TAKTISCHES KAMPFFELD
// ============================================================================
// Setzt den Zug-Zeiger nach dem Entfernen von Einträgen wieder auf denselben Kämpfer.
// Wurde der aktive Eintrag selbst entfernt, rückt der nächste Kämpfer an seine Stelle.
function restoreTurnPointer(activeKey, oldOrder, oldTurnIndex) {
    const order = gameState.combat.order;
    if (order.length === 0) {
        gameState.combat.turnIndex = 0;
        return;
    }
    if (activeKey !== undefined) {
        const found = order.findIndex(e => e.key === activeKey);
        if (found !== -1) {
            gameState.combat.turnIndex = found;
            return;
        }
    }
    let before = 0;
    for (let i = 0; i < oldTurnIndex && i < oldOrder.length; i++) {
        if (order.includes(oldOrder[i])) before++;
    }
    gameState.combat.turnIndex = before >= order.length ? 0 : before;
}

function cleanStaleCombatants() {
    ensureEnemyUids();
    ensureBattlemapState();
    const oldOrder = gameState.combat.order || [];
    const oldTurnIndex = gameState.combat.turnIndex;
    const activeKey = oldOrder[oldTurnIndex]?.key;
    const teamNames = Object.keys(gameState.combat.teams || {});
    gameState.combat.order = oldOrder.filter(entry => {
        return resolveCombatantShared(entry) !== null;
    });
    // Unbekannte Teams (z.B. nach Import) dem ersten vorhandenen Team zuordnen
    if (teamNames.length > 0) {
        gameState.combat.order.forEach(entry => {
            if (!teamNames.includes(entry.teamName)) entry.teamName = teamNames[0];
        });
    }
    if (gameState.combat.order.length !== oldOrder.length) {
        restoreTurnPointer(activeKey, oldOrder, oldTurnIndex);
    } else if (gameState.combat.turnIndex >= gameState.combat.order.length) {
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
                initiative: numOr(c.initiative, 10),
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
                initiative: numOr(c.initiative, 10),
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
                initiative: numOr(enemy.initiative, 10),
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
    const actor = resolveCombatantShared(entry);
    const name = actor ? actor.name : 'diesen Teilnehmer';

    openConfirmModal(`Möchtest du "${name}" wirklich aus dem laufenden Kampf und vom Spielfeld entfernen?`, () => {
        const oldOrder = gameState.combat.order.slice();
        const oldTurnIndex = gameState.combat.turnIndex;
        const activeKey = oldOrder[oldTurnIndex]?.key;
        gameState.combat.order.splice(orderIdx, 1);
        restoreTurnPointer(activeKey, oldOrder, oldTurnIndex);
        broadcastState();
        renderDmView();
    });
}

function sortCombatOrder() {
    const order = gameState.combat.order;
    const activeKey = order[gameState.combat.turnIndex]?.key;
    order.sort((a, b) => b.initiative - a.initiative);
    const activeIdx = activeKey !== undefined ? order.findIndex(e => e.key === activeKey) : -1;
    if (activeIdx !== -1) {
        gameState.combat.turnIndex = activeIdx;
    } else if (gameState.combat.turnIndex >= order.length) {
        gameState.combat.turnIndex = 0;
    }
}

function rollInitiativeFor(mode, btnEl) {
    cleanStaleCombatants();
    if (gameState.combat.order.length === 0) {
        return alert("Es sind noch keine Kämpfer im Kampf! Nutze 'Spieler-Sync' oder füge links Teilnehmer hinzu.");
    }
    gameState.combat.active = true;

    gameState.combat.order.forEach(entry => {
        if (mode === 'enemies' && entry.kind !== 'enemy') return;
        const actor = resolveCombatantShared(entry);
        if (!actor) return;

        const initBonus = numOr(actor.initiative, Math.floor(((actor.stats?.dex || 10) - 10) / 2));
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
        gameState.combat.round = (gameState.combat.round || 1) + 1;
    } else if (next < 0) {
        next = len - 1;
        gameState.combat.round = Math.max(1, (gameState.combat.round || 1) - 1);
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
    const actor = resolveCombatantShared(entry);
    if (!actor) return;
    actor.hp = (Number(actor.hp) || 0) + delta;
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
    if (!entry) return;
    if (!Array.isArray(entry.conditions)) entry.conditions = [];
    if (!entry.conditions.includes(cond)) {
        entry.conditions.push(cond);
    }
    broadcastState();
    renderDmView();
}

function removeCombatCondition(orderIdx, condIdx) {
    const entry = gameState.combat.order[orderIdx];
    const cond = entry?.conditions?.[condIdx];
    const condName = cond || 'diesen Zustand';
    openConfirmModal(`Zustand "${condName}" wirklich entfernen?`, () => {
        if (!entry || gameState.combat.order[orderIdx] !== entry) return;
        if (!Array.isArray(entry.conditions) || entry.conditions[condIdx] !== cond) return;
        entry.conditions.splice(condIdx, 1);
        broadcastState();
        renderDmView();
    });
}

// ============================================================================
// SPIELFELD-LOGIK
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
    gameState.combat.map.selectedBlockId = newBlock.id;
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
        if (!map.palette.includes(selected)) return;
        map.palette = map.palette.filter(b => b.id !== selected.id);
        Object.keys(map.cells).forEach(cellKey => {
            if (map.cells[cellKey] === selected.id) {
                delete map.cells[cellKey];
            }
        });
        map.selectedBlockId = null;
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

function dmDeleteBattlemapTemplate() {
    ensureBattlemapState();
    const select = document.getElementById('dm-map-template-select');
    if (!select || select.value === "") return alert("Bitte wähle zuerst eine Vorlage zum Löschen aus!");
    const idx = parseInt(select.value);
    const tpl = gameState.mapTemplates[idx];
    if (!tpl) return;

    openConfirmModal(`Möchtest du die Spielfeld-Vorlage "${tpl.name}" wirklich löschen?`, () => {
        if (gameState.mapTemplates[idx] !== tpl) return;
        gameState.mapTemplates.splice(idx, 1);
        broadcastState();
        renderDmView();
    });
}

function dmClearBattlemapCells() {
    openConfirmModal("Möchtest du wirklich alle Blöcke auf dem Spielfeld auf Pures Grau zurücksetzen?", () => {
        ensureBattlemapState();
        gameState.combat.map.cells = {};
        broadcastState();
        renderDmView();
    });
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
                ${availablePlayers.map(p => `<option value="${esc('player:' + p.id)}">${esc(p.name)} (HP ${esc(p.hp)}/${esc(p.maxHp)})</option>`).join('')}
            </optgroup>
        ` : ''}
        ${availableEnemies.length > 0 ? `
            <optgroup label="Monster & NPCs (noch nicht im Kampf)">
                ${availableEnemies.map(e => `<option value="${esc('enemy:' + e._uid)}">${esc(e.name)} (HP ${esc(e.hp)}/${esc(e.maxHp)})</option>`).join('')}
            </optgroup>
        ` : ''}
    `;

    const teamsMap = {};
    teamNames.forEach(t => teamsMap[t] = []);
    order.forEach((entry, orderIdx) => {
        const actor = resolveCombatantShared(entry);
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
            
            ${buildTopTurnBarHtml(true)}

            <div class="combat-three-col-cockpit">
                
                <aside class="combat-left-col">
                    
                    <div class="card combat-side-card">
                        <div class="side-card-title-row">
                            <h3>${icon('blade')} Teilnehmer & Teams</h3>
                        </div>

                        <label class="field-label">SPIELER ODER MONSTER ZUM KAMPF HINZUFÜGEN
                            <select id="combat-add-participant-select">
                                <option value="">-- Kämpfer wählen (${availablePlayers.length + availableEnemies.length} verfügbar) --</option>
                                ${participantOptionsHtml}
                            </select>
                        </label>

                        <div class="dm-assign-row">
                            <select id="combat-add-team-select">
                                ${teamNames.map(t => `<option value="${esc(t)}">In Team: ${esc(t)}</option>`).join('')}
                            </select>
                            <button type="button" class="btn-primary" onclick="addSelectedParticipantToCombat()">+ Hinzufügen</button>
                        </div>

                        <div class="side-card-divider"></div>

                        <label class="field-label">NEUES TEAM ERSTELLEN
                            <div class="team-create-row">
                                <input type="text" id="new-team-name-input" placeholder="Team-Name (z.B. Wachen)...">
                                <input type="color" id="new-team-color-input" value="#8a6fae" title="Teamfarbe wählen">
                                <button type="button" class="btn-secondary" onclick="addNewTeamByDm()">+ Team</button>
                            </div>
                        </label>
                    </div>

                    <div class="combat-teams-vertical-list">
                        ${teamNames.map(tName => {
        const color = safeColor(gameState.combat.teams[tName] || '#ffffff', '#ffffff');
        const members = teamsMap[tName] || [];
        const teamArg = jsArg(tName);
        return `
                                <div class="card team-group-card" style="--team-c: ${color};">
                                    <div class="team-group-header">
                                        <span class="team-identity">
                                            <span class="team-color-dot" aria-hidden="true"></span>
                                            <strong>${esc(tName)} (${members.length})</strong>
                                        </span>
                                        ${teamNames.length > 1 ? `<button type="button" class="btn-del btn-tiny-del" title="Team löschen" onclick="deleteTeamByDm(${teamArg})">${icon('trash')}</button>` : ''}
                                    </div>

                                    ${(availablePlayers.length + availableEnemies.length) > 0 ? `
                                        <select class="team-quick-add-select" onchange="quickAddIntoTeamCard(this, ${teamArg})">
                                            <option value="">+ Kämpfer direkt in „${esc(tName)}“ setzen...</option>
                                            ${participantOptionsHtml}
                                        </select>
                                    ` : ''}

                                    ${members.length === 0 ? `<small class="muted">Keine Kämpfer in diesem Team.</small>` : ''}

                                    <div class="team-members-stack">
                                        ${members.map(({ entry, actor, orderIdx }) => {
            const isTurn = orderIdx === gameState.combat.turnIndex;
            const isDead = actor.hp <= 0;
            return `
                                                <div class="team-combatant-item ${isTurn ? 'active-turn-row' : ''} ${isDead ? 'combatant-down' : ''}">
                                                    <div class="team-combatant-top">
                                                        <div class="char-identity">
                                                            ${actor.avatar
                ? `<img src="${esc(actor.avatar)}" class="mini-avatar">`
                : `<div class="mini-avatar-placeholder">${esc(String(actor.name || '')[0])}</div>`
            }
                                                            <div>
                                                                <div class="combat-name-line">
                                                                    ${isTurn ? `<span class="turn-indicator-pill">${icon('turn')} ZUG</span>` : ''}
                                                                    <strong>${esc(actor.name)}</strong>
                                                                </div>
                                                                <small class="muted">AC ${esc(actor.ac)} · Feld (${esc(entry.row + 1)},${esc(entry.col + 1)})</small>
                                                            </div>
                                                        </div>
                                                        <div class="dm-badges">
                                                            <span class="badge-hp">${esc(actor.hp)}/${esc(actor.maxHp)}</span>
                                                            ${entry.kind === 'player' && isDead ? `
                                                                <button type="button" class="btn-death" onclick="dmKillPlayer(${jsArg(actor.id)})">${icon('skull')} Tot</button>
                                                            ` : ''}
                                                            <button type="button" class="btn-del" title="Aus Kampf & vom Spielfeld entfernen" aria-label="Aus Kampf entfernen" onclick="removeCombatantFromCombat(${orderIdx})">${icon('x')}</button>
                                                        </div>
                                                    </div>

                                                    <div class="team-combatant-meta-row">
                                                        <label class="mini-inline-label">Init:
                                                            <input type="number" id="combat-init-${orderIdx}" value="${esc(entry.initiative)}" onchange="updateCombatantInit(${orderIdx}, this.value)">
                                                        </label>
                                                        <select onchange="setCombatantTeam(${orderIdx}, this.value)" aria-label="Team">
                                                            ${teamNames.map(t => `<option value="${esc(t)}" ${entry.teamName === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
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
                                                            <span class="inline-item-pill">${esc(cond)} <b onclick="removeCombatCondition(${orderIdx}, ${cIdx})">×</b></span>
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

                <section class="card battlemap-board-card">
                    <div class="battlemap-board-header">
                        <div>
                            <div class="combat-name-line">
                                <h3>${icon('map')} Spielfeld (${esc(map.rows)} × ${esc(map.cols)} Grid)</h3>
                                ${isBuildMode
        ? `<span class="mode-status-pill mode-pill-build" onclick="dmSelectPaletteBlock(${jsArg(selectedBlock.id)})" title="Klicken oder rechts denselben Block drücken, um in den Bewegungsmodus zu wechseln">${icon('brick')} Baumodus: ${esc(selectedBlock.name)} · Beenden ${icon('x')}</span>`
        : `<span class="mode-status-pill mode-pill-move">${icon('move')} Verschieben- & Bewegungsmodus</span>`
    }
                            </div>
                            <small class="muted">
                                ${isBuildMode
        ? 'Baumodus aktiv: Halte die Maustaste über dem Grid gedrückt zum Malen · Klicke rechts denselben Block nochmal zum Verlassen.'
        : 'Bewegungsmodus: Halte die Maustaste gedrückt zum freien Verschieben der Karte · Mausrad zoomt zum Mauszeiger · +/− zoomt, 0 zentriert.'
    }
                            </small>
                        </div>

                        <div class="battlemap-resize-controls">
                            ${buildBattlemapZoomControlsHtml()}
                            <button type="button" onclick="dmResizeBattlemap(1, 0)" title="Zeile hinzufügen">+ Zeile</button>
                            <button type="button" onclick="dmResizeBattlemap(-1, 0)" title="Zeile entfernen">− Zeile</button>
                            <button type="button" onclick="dmResizeBattlemap(0, 1)" title="Spalte hinzufügen">+ Spalte</button>
                            <button type="button" onclick="dmResizeBattlemap(0, -1)" title="Spalte entfernen">− Spalte</button>
                            <button type="button" class="btn-del" onclick="dmClearBattlemapCells()" title="Alle Blöcke zurücksetzen">${icon('refresh')} Reset</button>
                        </div>
                    </div>

                    <div class="battlemap-template-bar">
                        <div class="dm-assign-row">
                            <input type="text" id="dm-map-template-name" placeholder="Vorlagenname (z.B. Thronsaal)...">
                            <button type="button" class="btn-secondary" onclick="dmSaveBattlemapTemplate()">${icon('save')} Spielfeld speichern</button>
                        </div>
                        <div class="dm-assign-row">
                            <select id="dm-map-template-select">
                                <option value="">-- Gespeichertes Spielfeld laden (${gameState.mapTemplates.length}) --</option>
                                ${gameState.mapTemplates.map((tpl, i) => `<option value="${i}">${esc(tpl.name)} (${esc(tpl.rows)}×${esc(tpl.cols)})</option>`).join('')}
                            </select>
                            <button type="button" class="btn-primary" onclick="dmLoadBattlemapTemplate()">${icon('folder')} Laden</button>
                            ${gameState.mapTemplates.length > 0 ? `<button type="button" class="btn-del" onclick="dmDeleteBattlemapTemplate()" title="Ausgewählte Vorlage löschen">${icon('trash')}</button>` : ''}
                        </div>
                    </div>

                    <div id="battlemap-stage-wrapper"
                         class="battlemap-stage-wrapper ${isBuildMode ? 'stage-mode-build' : 'stage-mode-move'}"
                         onpointerdown="handleBattlemapStagePointerDown(event, true)"
                         onwheel="handleBattlemapWheel(event)">
                        <div id="battlemap-pan-zoom-plane"
                             class="battlemap-pan-zoom-plane"
                             style="transform: translate(${battlemapPanX}px, ${battlemapPanY}px) scale(${battlemapZoom});">
                            <div id="active-battlemap-grid"
                                 class="battlemap-grid"
                                 style="grid-template-columns: repeat(${parseInt(map.cols) || 6}, var(--cell-px)); grid-template-rows: repeat(${parseInt(map.rows) || 6}, var(--cell-px));">
                                ${buildBattlemapGridCellsHtml(true)}
                            </div>
                        </div>
                    </div>
                </section>

                <aside class="card battlemap-palette-card">
                    <div class="palette-top-header">
                        <h3>${icon('brick')} Block-Arten</h3>
                        <button type="button" class="btn-primary btn-block" onclick="dmToggleNewBlockCreator()">
                            ${showNewBlockCreator ? `${icon('x')} Schließen` : `${icon('plus')} Neuer Block`}
                        </button>
                    </div>

                    ${showNewBlockCreator ? `
                        <div class="palette-creator-popover">
                            <label class="field-label">BLOCK-FARBE WÄHLEN
                                <input type="color" id="dm-new-block-color" value="${esc(safeColor(newBlockDraftColor, '#ef4444'))}"
                                    onchange="newBlockDraftColor = this.value">
                            </label>
                            <label class="field-label">NAME (OPTIONAL)
                                <input type="text" id="dm-new-block-name" placeholder="z.B. Lava, Wasser, Wand" value="${esc(newBlockDraftName)}"
                                     oninput="newBlockDraftName = this.value">
                            </label>
                            <button type="button" class="btn-secondary btn-block" onclick="dmCreatePaletteBlock()">${icon('check')} Block erschaffen</button>
                        </div>
                    ` : ''}

                    ${selectedBlock && !selectedBlock.isDefault ? `
                        <button type="button" class="btn-del palette-remove-btn" onclick="dmRemoveSelectedBlock()">
                            ${icon('trash')} Block entfernen („${esc(selectedBlock.name)}“)
                        </button>
                    ` : ''}

                    <small class="muted">1× Klick = Baumodus an · 2× Klick auf denselben Block = Baumodus aus:</small>

                    <div class="palette-blocks-scroll">
                        ${map.palette.map(b => {
        const isSelected = b.id === map.selectedBlockId;
        return `
                                <div class="palette-block-entry ${isSelected ? 'palette-block-active' : ''}"
                                     draggable="true"
                                     ondragstart="dmHandleBlockDragStart(event, ${jsArg(b.id)})"
                                     onclick="dmSelectPaletteBlock(${jsArg(b.id)})">
                                    <div class="palette-color-swatch" style="background-color: ${safeColor(b.color)};"></div>
                                    <div class="palette-block-meta">
                                        <strong>${esc(b.name)}</strong>
                                        <small class="muted">${isSelected ? 'Baumodus aktiv' : esc(b.color)}</small>
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

// ============================================================================
// DM TAB 4: GROSSES DM-NOTIZBUCH
// ============================================================================
function renderDmNotesTab(container) {
    ensureSpellsAndDmNotesState();
    const notes = gameState.dmNotes;

    container.innerHTML = `
        <div class="templates-vertical-stack">
            <div class="creator-header-row">
                <div>
                    <h2>${icon('tome')} Dungeon Master Notizbuch</h2>
                    <small class="muted">Alle Notizen hier sind nur für dich als DM sichtbar und werden beim Klick auf „Session speichern“ in deiner Session-Datei mitgesichert.</small>
                </div>
            </div>

            <div class="dm-notes-grid">
                <div class="card">
                    <h3>${icon('bolt')} Schnell-Notizen & Aktuelle Session</h3>
                    <small class="muted">Synchronisiert mit dem Schnell-Notizfeld oben im Gameplay-Tab.</small>
                    <textarea id="dm-notes-quick" rows="7" placeholder="Was passiert gerade? Laufende Effekte, Versprechen an Spieler, spontane Einfälle...">${esc(notes.quick)}</textarea>
                </div>

                <div class="card">
                    <h3>${icon('scroll')} Kampagnen-Story & Roter Faden</h3>
                    <small class="muted">Hauptquest, Akte, wichtige Meilensteine und Hintergrundgeschichte.</small>
                    <textarea id="dm-notes-story" rows="7" placeholder="Wie geht die Geschichte weiter? Welche Entscheidungen haben die Spieler getroffen?">${esc(notes.story)}</textarea>
                </div>

                <div class="card">
                    <h3>${icon('eye')} Geheimnisse, Plots & Twists (Geheim)</h3>
                    <small class="muted">Verräter, versteckte Hinweise, Fallen, wahre Motive von NPCs.</small>
                    <textarea id="dm-notes-secrets" rows="7" placeholder="Was wissen die Spieler noch nicht? Welche Überraschungen lauern?">${esc(notes.secrets)}</textarea>
                </div>

                <div class="card">
                    <h3>${icon('map')} Orte, Fraktionen & Wichtige NPCs</h3>
                    <small class="muted">Städte, Tavernen, Höllen-/Himmels-Ebenen, Anführer und Belohnungen.</small>
                    <textarea id="dm-notes-world" rows="7" placeholder="Ortsbeschreibungen, Fraktions-Beziehungen, Händler-Inventare...">${esc(notes.world)}</textarea>
                </div>
            </div>

            <div class="card">
                <h3>${icon('pin')} Eigene Notiz-Karten (Rätsel, Boss-Phasen, Loot-Listen, Quests)</h3>
                <div class="dm-assign-row">
                    <input type="text" id="dm-new-note-title" placeholder="Titel der neuen Notiz-Karte (z.B. Rätsel im Thronsaal / Boss-Mechanik)...">
                    <button type="button" class="btn-primary" onclick="dmAddCustomNoteCard()">+ Neue Notiz-Karte anlegen</button>
                </div>

                <div class="dm-custom-notes-list">
                    ${notes.entries.length === 0 ? '<p class="muted">Noch keine eigenen Notiz-Karten angelegt.</p>' : ''}
                    ${notes.entries.map((entry, idx) => `
                        <div class="card dm-custom-note-card">
                            <div class="creator-header-row">
                                <input type="text" id="dm-note-title-${esc(entry.id || idx)}" value="${esc(entry.title)}" placeholder="Titel..."
                                    class="note-title-input" aria-label="Titel der Notiz-Karte"
                                    onchange="dmUpdateCustomNoteCard(${idx}, 'title', this.value)">
                                <button type="button" class="btn-del" onclick="dmDeleteCustomNoteCard(${idx})">${icon('trash')} Karte löschen</button>
                            </div>
                            <textarea rows="5" id="dm-note-content-${esc(entry.id || idx)}" placeholder="Inhalt dieser Notiz-Karte..."
                                oninput="dmUpdateCustomNoteCard(${idx}, 'content', this.value)">${esc(entry.content)}</textarea>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
    `;

    const bindArea = (id, key) => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', (e) => {
                gameState.dmNotes[key] = e.target.value;
            });
        }
    };

    bindArea('dm-notes-quick', 'quick');
    bindArea('dm-notes-story', 'story');
    bindArea('dm-notes-secrets', 'secrets');
    bindArea('dm-notes-world', 'world');
}

function dmAddCustomNoteCard() {
    ensureSpellsAndDmNotesState();
    const titleInput = document.getElementById('dm-new-note-title');
    const title = titleInput && titleInput.value.trim() ? titleInput.value.trim() : `Notiz #${gameState.dmNotes.entries.length + 1}`;
    gameState.dmNotes.entries.unshift({
        id: 'note_' + Date.now(),
        title: title,
        content: ''
    });
    if (titleInput) titleInput.value = '';
    renderDmView();
}

function dmUpdateCustomNoteCard(idx, field, val) {
    ensureSpellsAndDmNotesState();
    if (!gameState.dmNotes.entries[idx]) return;
    gameState.dmNotes.entries[idx][field] = val;
}

function dmDeleteCustomNoteCard(idx) {
    ensureSpellsAndDmNotesState();
    const entry = gameState.dmNotes.entries[idx];
    const title = entry && entry.title ? `"${entry.title}"` : 'diese Notiz-Karte';
    openConfirmModal(`Möchtest du ${title} wirklich löschen?`, () => {
        gameState.dmNotes.entries.splice(idx, 1);
        renderDmView();
    });
}

function dmModifyStat(playerId, prop, delta) {
    const char = gameState.characters[playerId];
    if (!char) return;
    char[prop] = (Number(char[prop]) || 0) + delta;
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

function dmUpdatePlayerSpell(playerId, spellIdx, field, val) {
    const char = gameState.characters[playerId];
    if (!char || !char.spells || !char.spells[spellIdx]) return;
    char.spells[spellIdx][field] = val;
    broadcastState();
    renderDmView();
}

function dmModifyEnemy(idx, prop, delta) {
    const enemy = gameState.enemies[idx];
    if (!enemy) return;
    enemy[prop] = (Number(enemy[prop]) || 0) + delta;
    broadcastState();
    renderDmEnemies();
}

function dmRemoveEnemy(idx) {
    const enemy = gameState.enemies[idx];
    const uid = enemy ? enemy._uid : null;
    openConfirmModal(`Möchtest du "${enemy ? enemy.name : 'dieses Monster'}" wirklich aus dem Spiel entfernen?`, () => {
        // Über _uid neu suchen: die Liste kann sich seit dem Klick geändert haben
        const currentIdx = gameState.enemies.findIndex(e => e._uid === uid);
        if (currentIdx === -1) return;
        gameState.enemies.splice(currentIdx, 1);
        cleanStaleCombatants();
        broadcastState();
        renderDmEnemies();
    });
}
