#!/bin/bash
# Afterlife starten – öffentlich über ngrok (brew install ngrok + kostenloser Account-Token)
# Doppelklick im Finder. Alle Optionen: ./start.command --help
exec "$(dirname "$0")/start.command" --tunnel ngrok "$@"
