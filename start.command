#!/bin/bash
# Afterlife starten: Doppelklick im Finder (macOS) oder ./start.command im Terminal.
# Startet Relay + App, öffnet optional einen Cloudflare-Tunnel und Chrome.
cd "$(dirname "$0")" || exit 1

# Aus dem Finder gestartet ist PATH minimal – übliche Node-Orte ergänzen.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$PATH"
if ! command -v node >/dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then
    # shellcheck disable=SC1091
    . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
fi

if ! command -v node >/dev/null 2>&1; then
    echo "Node.js wurde nicht gefunden."
    echo "Installiere es von https://nodejs.org oder mit:  brew install node"
    echo
    read -n 1 -s -r -p "Taste drücken zum Schließen …"
    exit 1
fi

node relay/launcher.js "$@"
status=$?
if [ $status -ne 0 ]; then
    echo
    read -n 1 -s -r -p "Taste drücken zum Schließen …"
fi
exit $status
