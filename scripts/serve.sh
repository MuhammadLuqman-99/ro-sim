#!/usr/bin/env bash
# Serve the page on http://localhost:8790 (fetches data first if missing).
# Sends no-cache headers so a normal refresh always shows your latest edit.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f web/data/refine.json ] || ./scripts/fetch-data.sh
PORT="${PORT:-8790}"
echo "Open http://localhost:$PORT"
exec python3 -I -c '
import functools, http.server, sys
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()
http.server.ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), functools.partial(H, directory="web")).serve_forever()
' "$PORT"
