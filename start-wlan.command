#!/bin/bash
# Afterlife starten – nur im eigenen WLAN/Netzwerk, ohne Internet-Tunnel
# Doppelklick im Finder. Alle Optionen: ./start.command --help
exec "$(dirname "$0")/start.command" --lan --no-tunnel "$@"
