# Afterlife – Start & Relay

## Ein-Klick-Start

| System | Datei |
| --- | --- |
| macOS | `start.command` im Projektordner doppelklicken |
| Windows | `start.bat` doppelklicken |
| Terminal | `node relay/launcher.js` (oder `cd relay && npm start`) |

Der Launcher …

1. installiert beim ersten Start automatisch die Abhängigkeiten (`npm install`),
2. startet den Relay (App + WebSocket) auf Port 8080 – ist der belegt, auf dem nächsten freien,
3. öffnet einen **Cloudflare-Tunnel**, falls `cloudflared` installiert ist, zeigt den
   Spieler-Link an und kopiert ihn in die Zwischenablage,
4. öffnet die App in **Google Chrome**,
5. hält den Mac während der Session wach (`caffeinate`).

Läuft Afterlife bereits, öffnet ein zweiter Doppelklick nur den Browser.
Beenden: Terminal-Fenster schließen oder `Strg+C`.

Voraussetzung: [Node.js](https://nodejs.org) ab Version 18.
Für Spieler über das Internet einmalig: `brew install cloudflared`.

### Start-Varianten (macOS, Doppelklick)

| Datei | Wer kann beitreten | Voraussetzung |
| --- | --- | --- |
| `start.command` | Internet via Cloudflare, falls installiert – sonst nur lokal | – |
| `start-online-cloudflare.command` | Alle über das Internet (`…trycloudflare.com`) | `brew install cloudflared` |
| `start-online-localhostrun.command` | Alle über das Internet (`…lhr.life`) | nichts – nutzt SSH |
| `start-online-ngrok.command` | Alle über das Internet (`…ngrok-free.app`) | `brew install ngrok` + `ngrok config add-authtoken <TOKEN>` |
| `start-online-tailscale.command` | Alle über das Internet, **feste URL** (`…ts.net`) | Tailscale-App, eingeloggt, Funnel freigeschaltet |
| `start-wlan.command` | Nur Geräte im selben WLAN | – (macOS fragt evtl. nach Firewall-Freigabe für Node) |
| `start-lokal.command` | Nur dieser Rechner (`localhost`) | – |

Hinweise: Cloudflare-, localhost.run- und ngrok-Links ändern sich bei jedem Start.
ngrok zeigt Spielern beim ersten Öffnen eine Warnseite („Visit Site“ klicken).

### Optionen

```bash
./start.command --port 9000      # anderer Port
./start.command --lan            # zusätzlich im WLAN erreichbar
./start.command --tunnel ngrok   # Tunnel: cloudflare | localhostrun | ngrok | tailscale | none
./start.command --no-tunnel      # kein Tunnel
./start.command --no-browser     # Chrome nicht öffnen
./start.command --no-caffeinate  # Ruhezustand erlauben
```

## Spieler einladen

Sobald der Tunnel steht, erscheint beim DM oben rechts der Button **Einladungslink**.
Der Link enthält den Raum-Code (`…trycloudflare.com/?room=1234`), Spieler müssen nur
noch ihren Namen eingeben. Achtung: Der Quick-Tunnel-Link ändert sich bei jedem Start.

## Spieler-Konten (Datenbank)

Statt (oder zusätzlich zu) `.json`-Dateien können Spieler ihren Charakter in der Datenbank
des Relays speichern:

- Im Hauptmenü **Name + Passwort** eingeben. Gibt es den Namen noch nicht, wird nach
  Rückfrage ein Konto angelegt; sonst wird der gespeicherte Charakter geladen.
- Namen und Passwörter gelten **global** – für alle Räume und Sessions dieses Servers.
  Groß-/Kleinschreibung zählt beim Namen nicht.
- Solange der Spieler angemeldet ist, wird sein Charakter automatisch gespeichert
  (wenige Sekunden nach jeder Änderung – auch nach Änderungen durch den DM). Der Stand
  steht oben rechts im Header.
- Eine hineingezogene `.json`-Datei hat beim Beitritt Vorrang und wird danach ins Konto übernommen.
- Ohne Passwort funktioniert alles wie bisher (nur Datei-Speichern).

**DM:** Im Hauptmenü unter „Mit Konto (Datenbank)“ anmelden (gleiche Konten wie für Spieler).
Danach erscheinen alle gespeicherten Sessions (Raum-Code, Spielerzahl, letzter Stand) zum
Fortsetzen oder Löschen. Eine neue Session oder eine hineingezogene Session-Datei wird ab dann
automatisch im Konto gespeichert (nach Änderungen und spätestens alle 15 s). Max. 50 Sessions pro Konto.

Die Datenbank ist eine SQLite-Datei unter `relay/data/afterlife.db` (in Node ≥ 22.13 eingebaut,
keine zusätzliche Installation). Passwörter werden mit scrypt gehasht. Zum Sichern einfach den
Ordner `relay/data/` kopieren (bei laufendem Server inkl. der `-wal`-Datei). Mit älteren
Node-Versionen sind Konten deaktiviert, der Rest läuft normal.

## Verbindungsstabilität

- DM und Spieler verbinden sich nach einem Abbruch automatisch neu
  (exponentielles Backoff 0,5–8 s mit Zufallsanteil).
- **Tab neu geladen?** DM und Spieler landen automatisch wieder in ihrer Session
  (gespeichert pro Tab im `sessionStorage`; ein neuer Tab startet bewusst frisch).
- Der Relay hält einen Raum nach einem DM-Abbruch **2 Minuten** offen; Spieler bleiben
  verbunden und bekommen danach automatisch den aktuellen Stand.
- Wird der Relay neu gestartet, baut der DM den Raum wieder auf; Spieler warten bis
  zu 3 Minuten automatisch darauf.
- Tote Verbindungen werden per Heartbeat erkannt (PING alle 15 s) – auch in
  Hintergrund-Tabs, deren Timer Chrome drosselt.
- Nach Standby, Netzwechsel oder Rückkehr in den Tab wird sofort geprüft/neu verbunden.
- Zwei Spieler mit gleichem Namen werfen sich nicht mehr gegenseitig raus – der zweite
  bekommt eine Meldung. Ist dieselbe Session in zwei Tabs offen, gibt der ältere Tab auf,
  statt endlos um die Verbindung zu kämpfen.
- Der DM sieht im Header, wie viele Spieler gerade online sind.

## Sicherheit

- Ein Raum gehört dem DM-Token, mit dem er eröffnet wurde – auch während der DM kurz
  getrennt ist. Ohne Token lässt er sich erst übernehmen, wenn das Gnadenfenster abgelaufen ist.
- DM- und Spieler-Tokens merkt sich der Browser pro Raum (`localStorage`), damit derselbe
  Browser auch nach dem Schließen des Tabs wieder als derselbe DM/Spieler erkannt wird.
- Bewusster Kompromiss: Ist ein Spieler offline, kann ein anderer Browser unter demselben
  Namen beitreten und dessen Charakter übernehmen (sonst käme ein Spieler nach Gerätewechsel
  nie wieder an seinen Charakter). Wer den Tunnel-Link nicht kennt, kommt gar nicht erst rein.

## Relay ohne Launcher

```bash
cd relay
npm run relay          # nur Server, ohne Browser/Tunnel
npm test               # Protokoll-Tests
```

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `PORT` | `8080` | HTTP- und WebSocket-Port |
| `HOST` | `127.0.0.1` | Bind-Adresse; `0.0.0.0` für LAN (bewusst opt-in) |
| `SERVE_STATIC` | `1` | `0` deaktiviert das Ausliefern der App |
| `STATIC_ROOT` | Projektordner | Wurzel für statische Dateien |
| `HOST_GRACE_MS` | `120000` | Gnadenfenster für DM-Reconnects |
| `HEARTBEAT_MS` | `30000` | Server-Heartbeat-Intervall |
| `PUBLIC_URL` | – | Öffentliche Adresse, falls der Tunnel extern betrieben wird |
| `CLOUDFLARED` | – | Pfad zu einer bestimmten `cloudflared`-Binary |
| `NGROK` / `TAILSCALE` | – | Pfad zu einer bestimmten `ngrok`- bzw. `tailscale`-Binary |
| `TUNNEL` | `cloudflare` | Tunnel-Anbieter für den Launcher (`0`/`none` = aus) |
| `DB_PATH` | `relay/data/afterlife.db` | Speicherort der Konten-Datenbank |

## Endpunkte

- `GET /` – App (`index.html`)
- `GET /health` – Status als JSON (Räume, Spieler, Clients, Uptime)
- `GET /info` – Einladungs-Adressen (Tunnel-URL, LAN-URLs)
- `GET /api/status`, `POST /api/register`, `POST /api/login`, `GET`/`PUT /api/character`, `GET /api/sessions`, `GET`/`PUT`/`DELETE /api/sessions/<id>`, `POST /api/logout` – Konten
- `ws://…/` – WebSocket-Relay

## Protokoll (Kurzfassung)

| Nachricht | Richtung | Zweck |
| --- | --- | --- |
| `HOST { roomCode, hostToken? }` | Client → Relay | Raum hosten / reconnecten |
| `JOIN { roomCode, playerId, playerToken }` | Client → Relay | Raum betreten / reconnecten |
| `PAYLOAD { data, to? }` | beide | Host → Spieler (optional gezielt) bzw. Spieler → Host |
| `PING` / `PONG` | beide | Heartbeat |
| `PLAYERS { playerIds }` | Relay → Host | Wer gerade verbunden ist |
| `HOST_LEFT` / `HOST_BACK` | Relay → Spieler | DM kurz weg / wieder da |
| `SESSION_CLOSED` | Relay → Spieler | Gnadenfenster abgelaufen |
| `ERROR { code }` | Relay → Client | `ROOM_TAKEN`, `ROOM_NOT_FOUND`, `PLAYER_TAKEN`, `ROOM_FULL`, … |

Close-Codes: `4000` DM nicht zurück · `4001`/`4002` Session anderswo übernommen
(kein Auto-Reconnect) · `4003` Raum abgelaufen · `4004` Client zu langsam · `1012` Relay-Neustart.

Der Relay stempelt bei Spieler-Nachrichten die verbindliche `_playerId`, damit
niemand eine fremde Identität vortäuschen kann.
