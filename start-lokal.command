#!/bin/bash
# Afterlife starten – nur auf diesem Rechner (localhost), ohne WLAN und Tunnel
# Doppelklick im Finder. Alle Optionen: ./start.command --help
exec "$(dirname "$0")/start.command" --no-tunnel "$@"
