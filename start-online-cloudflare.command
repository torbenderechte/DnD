#!/bin/bash
# Afterlife starten – öffentlich über Cloudflare Quick Tunnel (brew install cloudflared)
# Doppelklick im Finder. Alle Optionen: ./start.command --help
exec "$(dirname "$0")/start.command" --tunnel cloudflare "$@"
