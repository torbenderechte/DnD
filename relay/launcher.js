'use strict';

// Ein-Klick-Start für Afterlife:
//   1. installiert bei Bedarf die Relay-Abhängigkeiten (npm install)
//   2. startet den Relay (App + WebSocket) auf einem freien Port
//   3. öffnet – falls cloudflared installiert ist – einen öffentlichen Tunnel für Spieler
//   4. öffnet die App in Google Chrome
//
// Aufruf: node relay/launcher.js [--port 8080] [--lan] [--no-tunnel] [--no-browser] [--no-caffeinate]
// (oder einfach start.command / start.bat doppelklicken)

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const RELAY_DIR = __dirname;
const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';

// --- Argumente -------------------------------------------------------------

const TUNNEL_ALIASES = {
    cloudflare: 'cloudflare', cloudflared: 'cloudflare', cf: 'cloudflare',
    localhostrun: 'localhostrun', 'localhost.run': 'localhostrun', lhr: 'localhostrun', ssh: 'localhostrun',
    ngrok: 'ngrok',
    tailscale: 'tailscale', funnel: 'tailscale',
    none: null, off: null, no: null, '0': null, false: null
};

function parseTunnel(value) {
    const key = String(value || '').trim().toLowerCase();
    if (!(key in TUNNEL_ALIASES)) {
        console.error(`Unbekannter Tunnel „${value}“. Erlaubt: cloudflare, localhostrun, ngrok, tailscale, none`);
        process.exit(1);
    }
    return TUNNEL_ALIASES[key];
}

function parseArgs(argv) {
    const opts = {
        port: Number(process.env.PORT) || 8080,
        host: process.env.HOST || '127.0.0.1',
        // Ohne Angabe: Cloudflare, falls installiert (sonst nur ein Hinweis).
        tunnel: process.env.TUNNEL ? parseTunnel(process.env.TUNNEL) : 'cloudflare',
        tunnelExplicit: !!process.env.TUNNEL,
        browser: process.env.OPEN_BROWSER !== '0',
        caffeinate: true
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--port' || arg === '-p') opts.port = Number(argv[++i]) || opts.port;
        else if (arg.startsWith('--port=')) opts.port = Number(arg.slice(7)) || opts.port;
        else if (arg === '--lan') opts.host = '0.0.0.0';
        else if (arg === '--tunnel' || arg === '-t') { opts.tunnel = parseTunnel(argv[++i]); opts.tunnelExplicit = true; }
        else if (arg.startsWith('--tunnel=')) { opts.tunnel = parseTunnel(arg.slice(9)); opts.tunnelExplicit = true; }
        else if (arg === '--no-tunnel') { opts.tunnel = null; opts.tunnelExplicit = true; }
        else if (arg === '--no-browser') opts.browser = false;
        else if (arg === '--no-caffeinate') opts.caffeinate = false;
        else if (arg === '--help' || arg === '-h') {
            console.log([
                'Afterlife starten',
                '',
                '  --port <n>        Port (Standard 8080, sonst nächster freier)',
                '  --lan             Auch im lokalen Netzwerk (WLAN) erreichbar machen',
                '  --tunnel <name>   Öffentlicher Tunnel: cloudflare (Standard), localhostrun,',
                '                    ngrok, tailscale oder none',
                '  --no-tunnel       Keinen Tunnel öffnen (= --tunnel none)',
                '  --no-browser      Chrome nicht automatisch öffnen',
                '  --no-caffeinate   Mac darf während des Spiels einschlafen'
            ].join('\n'));
            process.exit(0);
        }
    }
    return opts;
}

// --- Ausgabe ---------------------------------------------------------------

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code) => (text) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : String(text));
const bold = c('1');
const dim = c('2');
const red = c('31');
const green = c('32');
const yellow = c('33');
const cyan = c('36');

function stamp() {
    return dim(new Date().toLocaleTimeString('de-DE', { hour12: false }));
}

function log(...args) {
    console.log(stamp(), ...args);
}

function banner(lines) {
    const width = Math.max(...lines.map(l => l.replace(/\x1b\[[0-9;]*m/g, '').length)) + 4;
    const bar = '─'.repeat(width);
    console.log('\n' + cyan(`╭${bar}╮`));
    for (const line of lines) {
        const pad = width - 2 - line.replace(/\x1b\[[0-9;]*m/g, '').length;
        console.log(cyan('│') + '  ' + line + ' '.repeat(Math.max(0, pad)) + cyan('│'));
    }
    console.log(cyan(`╰${bar}╯`) + '\n');
}

// --- Abhängigkeiten --------------------------------------------------------

function ensureDependencies() {
    const wsPath = path.join(RELAY_DIR, 'node_modules', 'ws', 'package.json');
    if (fs.existsSync(wsPath)) return;
    log('Installiere Abhängigkeiten (einmalig) …');
    const result = spawnSync(IS_WIN ? 'npm.cmd' : 'npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], {
        cwd: RELAY_DIR,
        stdio: 'inherit',
        shell: IS_WIN
    });
    if (result.status !== 0 || !fs.existsSync(wsPath)) {
        console.error(red('\nnpm install ist fehlgeschlagen. Prüfe deine Internetverbindung und versuche es erneut.'));
        process.exit(1);
    }
}

// --- Hilfen ----------------------------------------------------------------

function getJson(url, timeoutMs = 1500) {
    return new Promise((resolve) => {
        const req = http.get(url, { timeout: timeoutMs }, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => { body += chunk; if (body.length > 65536) req.destroy(); });
            res.on('end', () => {
                try { resolve(JSON.parse(body)); } catch (e) { resolve(null); }
            });
        });
        req.on('timeout', () => req.destroy());
        req.on('error', () => resolve(null));
    });
}

async function findRunningRelay(port) {
    const health = await getJson(`http://127.0.0.1:${port}/health`);
    return health && health.ok && 'rooms' in health ? health : null;
}

function which(cmd) {
    const result = spawnSync(IS_WIN ? 'where' : 'which', [cmd], { encoding: 'utf8' });
    if (result.status === 0 && result.stdout) {
        const first = result.stdout.split(/\r?\n/).find(Boolean);
        if (first && fs.existsSync(first.trim())) return first.trim();
    }
    return null;
}

function copyToClipboard(text) {
    try {
        if (IS_MAC) return spawnSync('pbcopy', { input: text }).status === 0;
        if (IS_WIN) return spawnSync('clip', { input: text, shell: true }).status === 0;
    } catch (e) { /* egal */ }
    return false;
}

function openInChrome(url) {
    const attempts = [];
    if (IS_MAC) {
        attempts.push(['open', ['-a', 'Google Chrome', url]]);
        attempts.push(['open', [url]]);
    } else if (IS_WIN) {
        attempts.push(['cmd', ['/c', 'start', '""', 'chrome', url]]);
        attempts.push(['cmd', ['/c', 'start', '""', url]]);
    } else {
        for (const bin of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
            attempts.push([bin, [url]]);
        }
        attempts.push(['xdg-open', [url]]);
    }

    for (const [cmd, args] of attempts) {
        if (!IS_MAC && !IS_WIN && cmd !== 'xdg-open' && !which(cmd)) continue;
        const result = spawnSync(cmd, args, { stdio: 'ignore', timeout: 10000, windowsVerbatimArguments: IS_WIN });
        if (result.status === 0) {
            // Unter Linux blockiert der Browser-Prozess nicht, weil er sich selbst abkoppelt.
            return true;
        }
    }
    return false;
}

// Verhindert, dass der Mac während der Session in den Ruhezustand geht
// (der Laptop IST der Server). Endet automatisch mit diesem Prozess.
function keepAwake() {
    if (!IS_MAC || !which('caffeinate')) return null;
    try {
        const child = spawn('caffeinate', ['-i', '-s', '-w', String(process.pid)], { stdio: 'ignore' });
        child.on('error', () => {});
        return child;
    } catch (e) {
        return null;
    }
}

// --- Tunnel-Anbieter -------------------------------------------------------
//
// Jeder Anbieter startet ein Hilfsprogramm, das den lokalen Port öffentlich macht,
// und schreibt die öffentliche https-URL irgendwo in seine Ausgabe.

function firstExisting(candidates) {
    return candidates.find(p => p && fs.existsSync(p)) || null;
}

const TUNNELS = {
    cloudflare: {
        label: 'Cloudflare-Tunnel',
        program: 'cloudflared',
        find: () => firstExisting([
            process.env.CLOUDFLARED,
            path.join(RELAY_DIR, 'bin', IS_WIN ? 'cloudflared.exe' : 'cloudflared'),
            which('cloudflared'),
            '/opt/homebrew/bin/cloudflared',
            '/usr/local/bin/cloudflared'
        ]),
        args: (port) => ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`],
        urlPattern: /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i,
        warnings: [
            [/failed to (?:request|unmarshal) quick Tunnel|429 Too Many Requests/i,
                'Cloudflare hat den Tunnel abgelehnt (evtl. Rate-Limit). Neuer Versuch folgt …']
        ],
        install: IS_MAC
            ? 'brew install cloudflared'
            : 'https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/',
        note: 'Der Link ändert sich bei jedem Start.'
    },

    // Braucht nur SSH (auf jedem Mac vorinstalliert) – kein Konto, keine Installation.
    localhostrun: {
        label: 'localhost.run-Tunnel (SSH)',
        program: 'ssh',
        find: () => firstExisting([which('ssh'), '/usr/bin/ssh', IS_WIN ? 'C:\\Windows\\System32\\OpenSSH\\ssh.exe' : null]),
        args: (port) => [
            '-T',
            '-o', 'StrictHostKeyChecking=accept-new',
            '-o', 'BatchMode=yes',
            '-o', 'ExitOnForwardFailure=yes',
            '-o', 'ServerAliveInterval=30',
            '-o', 'ServerAliveCountMax=3',
            '-R', `80:127.0.0.1:${port}`,
            'nokey@localhost.run'
        ],
        urlPattern: /https:\/\/[a-z0-9-]+\.(?:lhr\.life|localhost\.run)\b/i,
        ignoreUrls: /admin\.localhost\.run|localhost\.run\/docs/i,
        install: IS_WIN ? 'Einstellungen → Apps → Optionale Features → „OpenSSH-Client“' : 'ssh ist normalerweise vorinstalliert',
        note: 'Kostenlose localhost.run-Links ändern sich bei jedem Start und gelegentlich auch zwischendurch.'
    },

    ngrok: {
        label: 'ngrok-Tunnel',
        program: 'ngrok',
        find: () => firstExisting([
            process.env.NGROK,
            path.join(RELAY_DIR, 'bin', IS_WIN ? 'ngrok.exe' : 'ngrok'),
            which('ngrok'),
            '/opt/homebrew/bin/ngrok',
            '/usr/local/bin/ngrok'
        ]),
        args: (port) => ['http', `http://127.0.0.1:${port}`, '--log', 'stdout', '--log-format', 'logfmt'],
        urlPattern: /https:\/\/[a-z0-9.-]+\.ngrok(?:-free)?\.(?:app|dev|io)/i,
        fatal: [
            [/ERR_NGROK_4018|authtoken/i,
                'ngrok braucht einmalig einen (kostenlosen) Account-Token:\n' +
                '    1. https://dashboard.ngrok.com/get-started/your-authtoken\n' +
                '    2. ngrok config add-authtoken <TOKEN>'],
            [/ERR_NGROK_108/i, 'Es läuft schon ein anderer ngrok-Tunnel mit diesem Account. Beende ihn zuerst.']
        ],
        install: IS_MAC ? 'brew install ngrok' : 'https://ngrok.com/download',
        note: 'Spieler sehen beim ersten Öffnen eine ngrok-Warnseite → „Visit Site“ klicken.'
    },

    // Tailscale Funnel: feste URL (…ts.net), braucht aber ein eingerichtetes Tailscale.
    tailscale: {
        label: 'Tailscale Funnel',
        program: 'tailscale',
        find: () => firstExisting([
            process.env.TAILSCALE,
            which('tailscale'),
            '/opt/homebrew/bin/tailscale',
            '/usr/local/bin/tailscale',
            IS_MAC ? '/Applications/Tailscale.app/Contents/MacOS/Tailscale' : null
        ]),
        args: (port) => ['funnel', String(port)],
        urlPattern: /https:\/\/[a-z0-9.-]+\.ts\.net/i,
        fatal: [
            [/not enabled|funnel.*not (?:allowed|available)|requires.*(?:https|funnel)|admin console/i,
                'Funnel ist für deinen Tailnet noch nicht freigeschaltet.\n' +
                '    Einmalig im Terminal: tailscale funnel ' + '<port>' + ' – und dem Link zur Freischaltung folgen.'],
            [/NeedsLogin|not logged in|logged out|is stopped|failed to connect to local Tailscale/i,
                'Tailscale läuft nicht oder du bist nicht angemeldet. Tailscale-App öffnen und einloggen.']
        ],
        install: IS_MAC ? 'https://tailscale.com/download/mac (danach in der App einloggen)' : 'https://tailscale.com/download',
        note: 'Der Funnel-Link bleibt bei jedem Start gleich.'
    }
};

function startTunnel(provider, binary, port, onUrl) {
    let child = null;
    let stopped = false;
    let restarts = 0;
    let restartTimer = null;

    const launch = () => {
        if (stopped) return;
        let announced = false;
        let fatalHint = null;
        child = spawn(binary, provider.args(port), { stdio: ['ignore', 'pipe', 'pipe'] });

        const scan = (chunk) => {
            const text = chunk.toString();
            if (!announced) {
                const urls = text.match(new RegExp(provider.urlPattern.source, 'gi')) || [];
                const url = urls.find(u => !(provider.ignoreUrls && provider.ignoreUrls.test(u)));
                if (url) {
                    announced = true;
                    restarts = 0;
                    onUrl(url.replace(/\/+$/, ''));
                }
            }
            for (const [pattern, message] of provider.warnings || []) {
                if (pattern.test(text)) log(yellow(message));
            }
            if (!fatalHint) {
                for (const [pattern, message] of provider.fatal || []) {
                    if (pattern.test(text)) { fatalHint = message; break; }
                }
            }
        };
        child.stdout.on('data', scan);
        child.stderr.on('data', scan);

        child.on('error', (err) => {
            log(red(`${provider.program} konnte nicht gestartet werden: ${err.message}`));
        });
        child.on('exit', (code) => {
            child = null;
            if (stopped) return;
            onUrl(null);
            if (fatalHint) {
                log(red(`${provider.label} konnte nicht geöffnet werden:`));
                log(yellow(fatalHint.replace('<port>', String(port))));
                log(dim('Lokales Spielen funktioniert weiter.'));
                return;
            }
            restarts += 1;
            if (restarts > 8) {
                log(red('Der Tunnel ist wiederholt abgestürzt – Spieler über das Internet sind nicht mehr möglich.'));
                log(red('Lokales Spielen funktioniert weiter. Starte Afterlife neu, um es nochmal zu versuchen.'));
                return;
            }
            const delay = Math.min(30000, 2000 * restarts);
            log(yellow(`Tunnel beendet (Code ${code}). Neustart in ${Math.round(delay / 1000)} s – der Link ändert sich danach evtl.!`));
            restartTimer = setTimeout(launch, delay);
        });
    };

    launch();

    return {
        stop() {
            stopped = true;
            clearTimeout(restartTimer);
            if (child) {
                try { child.kill(); } catch (e) { /* egal */ }
            }
        }
    };
}

// --- Hauptablauf -----------------------------------------------------------

async function main() {
    const opts = parseArgs(process.argv.slice(2));

    const [major] = process.versions.node.split('.').map(Number);
    if (major < 18) {
        console.error(red(`Node.js ${process.versions.node} ist zu alt. Bitte Node 18 oder neuer installieren: https://nodejs.org`));
        process.exit(1);
    }

    // Läuft Afterlife schon (z. B. zweimal doppelgeklickt)? Dann nur den Browser öffnen.
    const running = await findRunningRelay(opts.port);
    if (running) {
        const url = `http://localhost:${opts.port}`;
        log(green(`Afterlife läuft bereits auf ${url} – öffne nur den Browser.`));
        if (opts.browser) openInChrome(url);
        return;
    }

    ensureDependencies();
    const { createRelay } = require('./server');

    const relayLog = (...args) => console.log(stamp(), dim('relay'), ...args);
    const relay = createRelay({ log: relayLog });

    let info = null;
    for (let port = opts.port; port < opts.port + 20; port++) {
        try {
            info = await relay.listen(port, opts.host);
            break;
        } catch (err) {
            if (err.code !== 'EADDRINUSE') throw err;
            log(yellow(`Port ${port} ist belegt, versuche ${port + 1} …`));
        }
    }
    if (!info) {
        console.error(red('Kein freier Port gefunden.'));
        process.exit(1);
    }

    const localUrl = `http://localhost:${info.port}`;
    const lines = [
        bold('Afterlife läuft!'),
        '',
        `DM (dieser Rechner):  ${cyan(localUrl)}`
    ];
    const lanUrls = relay.lanUrls();
    for (const url of lanUrls) lines.push(`Spieler im WLAN:      ${cyan(url)}`);
    if (!opts.tunnel && !lanUrls.length) {
        lines.push('', dim('Nur auf diesem Rechner erreichbar (kein WLAN, kein Internet).'));
    }
    lines.push('', relay.accounts.available
        ? dim(`Spieler-Konten: ${path.relative(path.join(RELAY_DIR, '..'), relay.accounts.dbPath)}`)
        : yellow('Spieler-Konten aus – Node 22.13+ nötig (Speichern per .json geht weiterhin).'));
    lines.push('', dim('Fenster offen lassen – Strg+C beendet den Server.'));
    banner(lines);
    if (!opts.tunnel && lanUrls.length && copyToClipboard(lanUrls[0])) {
        log(dim(`WLAN-Link ${lanUrls[0]} in die Zwischenablage kopiert.`));
    }

    // Tunnel für Spieler außerhalb des eigenen Netzwerks
    let tunnel = null;
    if (opts.tunnel) {
        const provider = TUNNELS[opts.tunnel];
        const binary = provider.find();
        if (binary) {
            log(`Öffne ${provider.label} für Spieler über das Internet …`);
            tunnel = startTunnel(provider, binary, info.port, (url) => {
                relay.setPublicUrl(url);
                if (!url) return;
                const copied = copyToClipboard(url);
                banner([
                    bold(`Link für Spieler (${provider.label}):`),
                    '',
                    green(url),
                    '',
                    copied ? dim('(in die Zwischenablage kopiert)') : dim('(Link an die Spieler schicken)'),
                    dim('Der DM sieht den Link auch oben rechts in der App.'),
                    dim(provider.note)
                ]);
            });
        } else {
            const say = opts.tunnelExplicit ? red : yellow;
            log(say(`${provider.program} ist nicht installiert – Spieler können nur lokal/im WLAN beitreten.`));
            log(dim(`  Für Spieler über das Internet einmalig installieren:  ${provider.install}`));
        }
    }

    const caffeinate = opts.caffeinate ? keepAwake() : null;
    if (caffeinate) log(dim('Ruhezustand ist während der Session deaktiviert.'));

    if (opts.browser) {
        if (!openInChrome(localUrl)) {
            log(yellow(`Browser konnte nicht geöffnet werden. Öffne manuell: ${localUrl}`));
        }
    }

    let shuttingDown = false;
    const shutdown = async (signal) => {
        if (shuttingDown) process.exit(0);
        shuttingDown = true;
        console.log();
        log(`${signal} – Afterlife wird beendet …`);
        if (tunnel) tunnel.stop();
        if (caffeinate) { try { caffeinate.kill(); } catch (e) { /* egal */ } }
        await relay.close();
        log('Tschüss!');
        process.exit(0);
    };
    process.on('SIGINT', () => shutdown('Strg+C'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGHUP', () => shutdown('Fenster geschlossen'));

    process.on('uncaughtException', (err) => {
        // Der Server soll wegen eines einzelnen Fehlers nicht mitten im Spiel sterben.
        log(red(`Unerwarteter Fehler: ${err && err.stack || err}`));
    });
}

main().catch((err) => {
    console.error(red(`Start fehlgeschlagen: ${err && err.stack || err}`));
    process.exit(1);
});
