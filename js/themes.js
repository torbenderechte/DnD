// =========================================================
// THEMEN: Registry, Anwenden vor dem ersten Zeichnen, Umschalter.
// Aktives Thema = <html data-theme="id">; Themen mit CSS-Datei laden
// genau diese eine Datei als <link id="theme-stylesheet">.
// API: window.AfterlifeThemes = { THEMES, getTheme(), setTheme(id) }
// =========================================================
(function () {
    'use strict';
    const STORAGE_KEY = 'afterlife-theme';
    const THEMES = [
        { id: 'day',      name: 'Tagdruck',  tagline: 'Holzschnitt auf Papier',        css: null, bg: '#e9e1cf', fg: '#1a1613', accent: '#b02a1b' },
        { id: 'night',    name: 'Nachtdruck', tagline: 'Holzschnitt im Negativ',       css: null, bg: '#15110e', fg: '#e6dcc6', accent: '#e5593f' },
        { id: 'obsidian', name: 'Obsidian',  tagline: 'Schlicht & dunkel',             css: 'css/themes/obsidian.css', bg: '#121316', fg: '#e6e8ee', accent: '#7c8cff' },
        { id: 'aether',   name: 'Äther',     tagline: 'Abstrakt & animiert',           css: 'css/themes/aether.css',   bg: '#0b0820', fg: '#ece9ff', accent: '#b07cff' },
        { id: 'phosphor', name: 'Phosphor',  tagline: 'Retro-Terminal',                css: 'css/themes/phosphor.css', bg: '#050a06', fg: '#33ff66', accent: '#ffb000' },
        { id: 'grimoire', name: 'Grimoire',  tagline: 'Leder, Kerzenlicht & Blattgold', css: 'css/themes/grimoire.css', bg: '#1a120d', fg: '#ead9b5', accent: '#c9a45c' },
        { id: 'prisma',   name: 'Prisma',    tagline: 'Holografisch & schillernd',     css: 'css/themes/prisma.css',   bg: '#f3f0fa', fg: '#1d1b2e', accent: '#7a5cff' },
        { id: 'kawumm',   name: 'Kawumm',    tagline: 'Comic, Raster & Sprechblasen',  css: 'css/themes/kawumm.css',   bg: '#fff6dc', fg: '#111111', accent: '#ff3b30' },
        { id: 'daemon',   name: 'Roter Dämon', tagline: 'Horrorhaus: Blut, Rost & Flackerlicht', css: 'css/themes/daemon.css', bg: '#0d0b0a', fg: '#ddd3c4', accent: '#c0141c' },
        { id: 'lostplace', name: 'Lost Place', tagline: 'Event: Backrooms, Neonflackern & VHS', css: 'css/themes/lostplace.css', bg: '#1b1a0f', fg: '#f1e9c4', accent: '#ffd23f' }
    ];
    const byId = id => THEMES.find(t => t.id === id);
    const root = document.documentElement;
    let current = 'day';
    let busy = 0;

    function readSaved() {
        try { const v = localStorage.getItem(STORAGE_KEY); if (v && byId(v)) return v; } catch (e) { /* gesperrt */ }
        return 'day';
    }
    function setMeta(t) {
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t.bg);
    }
    function markPicker() {
        document.querySelectorAll('.theme-option').forEach(o => {
            const on = o.dataset.themeId === current;
            o.classList.toggle('is-active', on);
            o.setAttribute('aria-checked', String(on));
        });
    }
    function commit(t) {
        current = t.id;
        root.dataset.theme = t.id;
        setMeta(t);
        markPicker();
    }

    // Vor dem ersten Zeichnen (läuft synchron im <head>)
    const initial = byId(readSaved());
    current = initial.id;
    root.dataset.theme = initial.id;
    if (initial.css) document.write('<link id="theme-stylesheet" rel="stylesheet" href="' + initial.css + '">');
    // <meta name="theme-color"> steht im Head vor diesem Skript
    setMeta(initial);

    function setTheme(id) {
        const t = byId(id);
        if (!t) return false;
        if (t.id === current && !busy) return true;
        const ticket = ++busy;
        const old = document.getElementById('theme-stylesheet');
        const finish = () => {
            if (ticket !== busy) return;
            busy = 0;
            commit(t);
            try { localStorage.setItem(STORAGE_KEY, t.id); } catch (e) { /* gesperrt */ }
        };
        if (!t.css) {
            finish();
            if (old) old.remove();
            return true;
        }
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = t.css;
        link.dataset.pending = '1';
        link.onload = () => {
            if (ticket !== busy) { link.remove(); return; }
            link.removeAttribute('data-pending');
            link.id = 'theme-stylesheet-next';
            if (old) old.remove();
            link.id = 'theme-stylesheet';
            finish();
        };
        link.onerror = () => {
            link.remove();
            if (ticket === busy) busy = 0;
            console.warn('Thema konnte nicht geladen werden:', t.css);
        };
        // Alte Pending-Links aufräumen
        document.querySelectorAll('link[data-pending]').forEach(l => l.remove());
        (old && old.parentNode ? old.parentNode : document.head).insertBefore(link, old ? old.nextSibling : null);
        return true;
    }

    // Vorschaubild: einheitliche Mini-Oberfläche, nur aus bg/fg/accent des Themas.
    // Alle Farben als Inline-Style, damit kein Thema-CSS das Bild verändert.
    function previewSvg(t) {
        const f = (c, o) => ' style="fill:' + c + (o != null ? ';fill-opacity:' + o : '') + ';stroke:none"';
        const r = (x, y, w, h, rx, c, o) => '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + rx + '"' + f(c, o) + '/>';
        return '<span class="theme-preview" aria-hidden="true"><svg viewBox="0 0 160 96" preserveAspectRatio="xMidYMid slice" focusable="false">' +
            r(0, 0, 160, 96, 0, t.bg) +
            r(0, 0, 160, 16, 0, t.fg, 0.1) +
            '<circle cx="10" cy="8" r="3.5"' + f(t.accent) + '/>' +
            r(18, 6, 34, 4, 2, t.fg, 0.85) +
            r(128, 5, 24, 6, 3, t.fg, 0.3) +
            r(10, 26, 62, 6, 3, t.fg) +
            r(10, 38, 54, 3.5, 1.75, t.fg, 0.5) +
            r(10, 45, 46, 3.5, 1.75, t.fg, 0.5) +
            r(10, 52, 50, 3.5, 1.75, t.fg, 0.5) +
            r(10, 66, 40, 14, 3, t.accent) +
            r(16, 71.5, 28, 3, 1.5, t.bg, 0.9) +
            r(84, 26, 66, 58, 4, t.fg, 0.08) +
            '<circle cx="117" cy="47" r="12"' + f(t.accent, 0.9) + '/>' +
            r(96, 66, 42, 3.5, 1.75, t.fg, 0.6) +
            r(102, 73, 30, 3.5, 1.75, t.fg, 0.35) +
            '</svg></span>';
    }

    function buildPicker() {
        const bar = document.querySelector('.header-right-bar');
        if (!bar || document.getElementById('btn-theme-picker')) return;
        const label = 'Erscheinungsbild wählen';
        const wrap = document.createElement('div');
        wrap.className = 'theme-picker';
        wrap.innerHTML =
            '<button type="button" id="btn-theme-picker" class="btn-icon theme-picker-btn" aria-haspopup="menu" aria-expanded="false" aria-controls="theme-menu" title="' + label + '" aria-label="' + label + '">' +
            '<svg class="icon" aria-hidden="true"><use href="#i-palette"></use></svg></button>' +
            '<div id="theme-menu" class="theme-menu" role="menu" aria-label="' + label + '" hidden>' +
            '<div class="theme-menu-title">Erscheinungsbild</div>' +
            THEMES.map(t =>
                '<button type="button" class="theme-option' + (t.id === current ? ' is-active' : '') + '" role="menuitemradio" aria-checked="' + (t.id === current) + '" data-theme-id="' + t.id + '">' +
                previewSvg(t) +
                '<span class="theme-option-text"><strong>' + t.name + '</strong><small>' + t.tagline + '</small></span></button>'
            ).join('') + '</div>';
        bar.appendChild(wrap);

        const btn = wrap.querySelector('#btn-theme-picker');
        const menu = wrap.querySelector('#theme-menu');
        const opts = () => Array.from(menu.querySelectorAll('.theme-option'));

        function place() {
            menu.style.transform = '';
            menu.style.animation = 'none'; // Einblend-Animation (scale) würde die Messung verfälschen
            const r = menu.getBoundingClientRect();
            menu.style.animation = '';
            const vw = document.documentElement.clientWidth;
            let dx = 0;
            if (r.left < 8) dx = 8 - r.left;
            else if (r.right > vw - 8) dx = vw - 8 - r.right;
            if (dx) menu.style.transform = 'translateX(' + dx + 'px)';
        }
        function open() {
            menu.hidden = false;
            btn.setAttribute('aria-expanded', 'true');
            place();
            (opts().find(o => o.dataset.themeId === current) || opts()[0]).focus();
        }
        function close(refocus) {
            if (menu.hidden) return;
            menu.hidden = true;
            btn.setAttribute('aria-expanded', 'false');
            if (refocus) btn.focus();
        }
        btn.addEventListener('click', () => (menu.hidden ? open() : close(true)));
        menu.addEventListener('click', e => {
            const o = e.target.closest('.theme-option');
            if (!o) return;
            setTheme(o.dataset.themeId);
            close(true);
        });
        document.addEventListener('click', e => { if (!wrap.contains(e.target)) close(false); });
        window.addEventListener('resize', () => { if (!menu.hidden) place(); });
        // Capture-Phase: vor dem globalen Tastenkürzel-Handler in app.js
        wrap.addEventListener('keydown', e => {
            const list = opts();
            const i = list.indexOf(document.activeElement);
            let handled = true;
            if (e.key === 'Escape') { if (menu.hidden) return; close(true); }
            else if (menu.hidden) {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') open();
                else handled = false;
            }
            else if (e.key === 'ArrowRight') list[(i + 1) % list.length].focus();
            else if (e.key === 'ArrowLeft') list[(i - 1 + list.length) % list.length].focus();
            else if (e.key === 'ArrowDown') list[Math.min(i + 2, list.length - 1)].focus();
            else if (e.key === 'ArrowUp') list[Math.max(i - 2, 0)].focus();
            else if (e.key === 'Home') list[0].focus();
            else if (e.key === 'End') list[list.length - 1].focus();
            else if (e.key === 'Tab') close(false);
            else if (e.key === 'Enter' || e.key === ' ') {
                const o = document.activeElement.closest?.('.theme-option');
                if (!o) { handled = false; } else { e.preventDefault(); setTheme(o.dataset.themeId); close(true); }
            }
            else handled = false;
            if (handled) { e.stopPropagation(); if (e.key !== 'Enter' && e.key !== ' ') e.preventDefault(); }
            else if (!menu.hidden) e.stopPropagation();
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildPicker);
    else buildPicker();

    window.AfterlifeThemes = { THEMES, getTheme: () => current, setTheme };
})();
