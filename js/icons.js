// =========================================================
// GLYPHEN: Ein einziges, handgezeichnetes Strich-Icon-Set.
// Ersetzt Emoji-Slop. Pfaddaten liegen HIER (eine Quelle),
// gemountet wird ein verstecktes <symbol>-Sprite, referenziert
// über <use href="#i-name">. Funktioniert auch in innerHTML.
// =========================================================

const ICON_SYMBOLS = {
    palette: '<path d="M12 3.2a8.8 8.8 0 1 0 0 17.6c1.3 0 2-.9 2-1.8 0-1.3-1.1-1.5-1.1-2.7 0-.9.7-1.5 1.6-1.5h2.2a3.9 3.9 0 0 0 3.9-3.9C20.6 6.6 16.8 3.2 12 3.2Z"/><circle cx="7.6" cy="11.4" r="1" fill="currentColor" stroke="none"/><circle cx="10" cy="7.4" r="1" fill="currentColor" stroke="none"/><circle cx="14.4" cy="7.4" r="1" fill="currentColor" stroke="none"/>',
    dice: '<path d="M12 2.6 20.2 7.3v9.4L12 21.4 3.8 16.7V7.3Z"/><path d="M12 6.9 16.5 14.6h-9L12 6.9Z"/><path d="M12 21.4V14.6"/>',
    save: '<path d="M12 3.5v10.2"/><path d="m7.8 9.6 4.2 4.1 4.2-4.1"/><path d="M4.5 15.5v2.7c0 .9.7 1.6 1.6 1.6h11.8c.9 0 1.6-.7 1.6-1.6v-2.7"/>',
    folder: '<path d="M3.5 7A2.5 2.5 0 0 1 6 4.5h3.2l2 2.5H18A2.5 2.5 0 0 1 20.5 9.5v7A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5Z"/>',
    bag: '<path d="M6.6 8.2h10.8l1.1 10.9a1.6 1.6 0 0 1-1.6 1.8H7.1a1.6 1.6 0 0 1-1.6-1.8Z"/><path d="M9.2 8.2V6.4a2.8 2.8 0 0 1 5.6 0v1.8"/>',
    box: '<path d="M12 2.9 3.6 7.4v9.2L12 21.1l8.4-4.5V7.4Z"/><path d="M3.6 7.4 12 11.9l8.4-4.5"/><path d="M12 11.9v9.2"/>',
    blade: '<path d="M14.5 17.5 3.2 6.2 3 3l3.2.2L17.5 14.5"/><path d="m13 19 6-6"/><path d="m16 16 4 4"/><path d="m19 19 2 2"/>',
    spark: '<path d="M11 3.5 12.6 8.4 17.5 10l-4.9 1.6L11 16.5l-1.6-4.9L4.5 10l4.9-1.6Z"/><path d="m18 15.5.6 1.9 1.9.6-1.9.6-.6 1.9-.6-1.9-1.9-.6 1.9-.6Z"/>',
    eye: '<path d="M2.8 12S6.2 5.8 12 5.8 21.2 12 21.2 12 18 18.2 12 18.2 2.8 12 2.8 12Z"/><circle cx="12" cy="12" r="2.8"/>',
    lock: '<rect x="5.2" y="10.4" width="13.6" height="9.6" rx="2"/><path d="M8.6 10.4V7.8a3.4 3.4 0 0 1 6.8 0v2.6"/><path d="M12 14.2v2.4"/>',
    skull: '<path d="M12 3a7.4 7.4 0 0 0-7.4 7.4c0 2.6 1.4 4.3 2.9 5.4v2.7A2.5 2.5 0 0 0 10 21h4a2.5 2.5 0 0 0 2.5-2.5v-2.7c1.5-1.1 2.9-2.8 2.9-5.4A7.4 7.4 0 0 0 12 3Z"/><circle cx="9.3" cy="10.8" r="1.3"/><circle cx="14.7" cy="10.8" r="1.3"/><path d="M10.6 17.4h2.8"/>',
    tome: '<path d="M4.5 19.2A2.3 2.3 0 0 1 6.8 17H19.5"/><path d="M6.8 2.8H19.5v18.4H6.8a2.3 2.3 0 0 1-2.3-2.3V5.1a2.3 2.3 0 0 1 2.3-2.3Z"/><path d="M9 7.5h6.5"/>',
    scroll: '<path d="M6.5 3.5h8.6L18.5 6.9v13.6h-12Z"/><path d="M15.1 3.5v3.4h3.4"/><path d="M9 11h6.5M9 14.5h6.5"/>',
    map: '<path d="m3.5 6.3 5.7-2.4 5.6 2.4 5.7-2.4v13.8l-5.7 2.4-5.6-2.4-5.7 2.4Z"/><path d="M9.2 3.9v13.8M14.8 6.3v13.8"/>',
    brick: '<rect x="3.5" y="5.8" width="17" height="12.4" rx="1.6"/><path d="M3.5 12h17"/><path d="M12 5.8V12M7.8 12v6.2M16.2 12v6.2"/>',
    pin: '<path d="M12 21.2S5.6 14.7 5.6 10a6.4 6.4 0 0 1 12.8 0c0 4.7-6.4 11.2-6.4 11.2Z"/><circle cx="12" cy="9.9" r="2.1"/>',
    shield: '<path d="M12 2.6 19.4 5v6.1c0 4.9-3.1 8.4-7.4 10.3-4.3-1.9-7.4-5.4-7.4-10.3V5Z"/>',
    portal: '<circle cx="12" cy="12" r="8.4"/><circle cx="12" cy="12" r="4.4"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>',
    flask: '<path d="M9.6 3h4.8"/><path d="M10.6 3v5L5.2 17.8A2 2 0 0 0 7 20.8h10a2 2 0 0 0 1.8-3L13.4 8V3"/><path d="M7.8 14.8h8.4"/>',
    bolt: '<path d="M13 2.8 5.4 13.4h4.8L10.4 21.2 18.6 10.6h-5Z"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20.2 3.6v4.6h-4.6"/>',
    send: '<path d="M20.5 3.5 10.4 13.6"/><path d="M20.5 3.5 14 20.6l-3.6-7-7-3.6Z"/>',
    chat: '<path d="M20.8 11.7a8.2 8.2 0 0 1-8.2 8.2H3.8l1.9-3.1a8.2 8.2 0 1 1 15.1-5.1Z"/><path d="M8.4 11.4h.01M12.3 11.4h.01M16.2 11.4h.01"/>',
    plus: '<path d="M12 5.2v13.6M5.2 12h13.6"/>',
    x: '<path d="m6 6 12 12M18 6 6 18"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    trash: '<path d="M4.2 6.8h15.6"/><path d="M9.6 6.8V4.6h4.8v2.2"/><path d="M6.4 6.8 7.4 19.8a1.6 1.6 0 0 0 1.6 1.5h6a1.6 1.6 0 0 0 1.6-1.5l1-13"/><path d="M10.2 10.8v6.4M13.8 10.8v6.4"/>',
    coin: '<circle cx="12" cy="12" r="8.4"/><circle cx="12" cy="12" r="4.6"/>',
    swap: '<path d="M4.5 7.8h13l-3.4-3.4"/><path d="M19.5 16.2h-13l3.4 3.4"/>',
    move: '<path d="M12 2.8v18.4M2.8 12h18.4"/><path d="m9.2 5.4 2.8-2.6 2.8 2.6M9.2 18.6l2.8 2.6 2.8-2.6M5.4 9.2 2.8 12l2.6 2.8M18.6 9.2 21.2 12l-2.6 2.8"/>',
    zoomIn: '<circle cx="10.8" cy="10.8" r="6.8"/><path d="m20.4 20.4-4.9-4.9"/><path d="M10.8 7.8v6M7.8 10.8h6"/>',
    zoomOut: '<circle cx="10.8" cy="10.8" r="6.8"/><path d="m20.4 20.4-4.9-4.9"/><path d="M7.8 10.8h6"/>',
    turn: '<circle cx="12" cy="12" r="8.4"/><path d="M12 7.4V12l3.1 2"/>',
    quill: '<path d="M19.8 4.2c-5.8 0-10.5 3.8-12.4 9.4l-2.9 6 6-2.9c5.6-1.9 9.4-6.7 9.4-12.4Z"/><path d="M6.8 17.2 14 10"/>',
    target: '<circle cx="12" cy="12" r="8.4"/><circle cx="12" cy="12" r="4.4"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>',
    sun: '<circle cx="12" cy="12" r="3.8"/><path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8"/>',
    moon: '<path d="M19.6 14.4A8 8 0 0 1 9.6 4.4a8 8 0 1 0 10 10Z"/>'
};

// Baut die Markup-Schnipsel: <svg class="icon"><use href="#i-name"></use></svg>
function icon(name, extraClass = '') {
    const safe = Object.prototype.hasOwnProperty.call(ICON_SYMBOLS, name) ? name : 'dice';
    return `<svg class="icon${extraClass ? ' ' + extraClass : ''}" aria-hidden="true"><use href="#i-${safe}"></use></svg>`;
}

// Sprite einmalig in den DOM hängen (vor allen Render-Aufrufen).
// Läuft im <head>: body existiert dort noch nicht → auf DOMContentLoaded warten.
(function mountIconSprite() {
    if (!document.body) {
        document.addEventListener('DOMContentLoaded', mountIconSprite, { once: true });
        return;
    }
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'icon-sprite');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = Object.keys(ICON_SYMBOLS).map(name =>
        `<symbol id="i-${name}" viewBox="0 0 24 24">${ICON_SYMBOLS[name]}</symbol>`
    ).join('');
    document.body.appendChild(svg);
})();
