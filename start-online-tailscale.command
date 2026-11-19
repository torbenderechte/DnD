#!/bin/bash
# Afterlife starten – öffentlich über Tailscale Funnel (feste URL, Tailscale-App nötig)
# Doppelklick im Finder. Alle Optionen: ./start.command --help
exec "$(dirname "$0")/start.command" --tunnel tailscale "$@"
