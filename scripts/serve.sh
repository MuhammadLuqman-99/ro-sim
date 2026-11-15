#!/usr/bin/env bash
# Serve the page on http://localhost:8790 (fetches data first if missing).
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f web/data/refine.json ] || ./scripts/fetch-data.sh
PORT="${PORT:-8790}"
echo "Open http://localhost:$PORT"
exec python3 -m http.server "$PORT" --bind 127.0.0.1 -d web
