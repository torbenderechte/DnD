#!/bin/bash
# Afterlife starten – öffentlich über localhost.run (nur SSH nötig, nichts zu installieren)
# Doppelklick im Finder. Alle Optionen: ./start.command --help
exec "$(dirname "$0")/start.command" --tunnel localhostrun "$@"
