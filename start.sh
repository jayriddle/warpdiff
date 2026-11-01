#!/bin/bash
# Local preview. Listens on loopback port 8080 and opens a browser only after
# that exact port is serving. GitHub Pages does not use this script.
set -euo pipefail
cd "$(dirname "$0")"

PORT="${WARPDIFF_DEV_PORT:-8080}"
if ! [[ "$PORT" =~ ^[0-9]+$ ]]; then
  echo "WARPDIFF_DEV_PORT must be a TCP port from 1 to 65535." >&2
  echo "The browser was not opened." >&2
  exit 1
fi
PORT=$((10#$PORT))
if (( PORT < 1 || PORT > 65535 )); then
  echo "WARPDIFF_DEV_PORT must be a TCP port from 1 to 65535." >&2
  echo "The browser was not opened." >&2
  exit 1
fi

pid=""
cleaned=0
cleanup() {
  if (( cleaned )); then return 0; fi
  cleaned=1
  if [[ -n "$pid" ]]; then
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
  return 0
}
trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM

export WARPDIFF_DEV_PORT="$PORT"
node scripts/dev-server.mjs &
pid=$!

ready=0
attempt=0
while (( attempt < 50 )); do
  attempt=$(( attempt + 1 ))
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "WarpDiff dev server stopped before it was listening on 127.0.0.1:${PORT}." >&2
    echo "It does not switch to another port. The browser was not opened." >&2
    exit 1
  fi
  if WARPDIFF_READY_PORT="$PORT" node --input-type=module -e '
    import http from "node:http";
    const port = Number(process.env.WARPDIFF_READY_PORT);
    const req = http.get({ hostname: "127.0.0.1", port, path: "/", timeout: 400 }, res => {
      res.resume();
      process.exit(res.statusCode === 200 && res.headers["x-warpdiff-dev-server"] === "loopback" ? 0 : 1);
    });
    req.on("error", () => process.exit(1));
    req.on("timeout", () => { req.destroy(); process.exit(1); });
  '; then
    ready=1
    break
  fi
  sleep 0.1
done

if (( ready == 0 )); then
  echo "WarpDiff dev server did not accept the expected preview on http://127.0.0.1:${PORT}/." >&2
  echo "The browser was not opened." >&2
  exit 1
fi

if [[ "$(uname -s)" == "Darwin" && "${WARPDIFF_DEV_OPEN:-1}" != "0" ]]; then
  open "http://127.0.0.1:${PORT}/" || echo "WarpDiff is serving at http://127.0.0.1:${PORT}/ but the browser could not be opened." >&2
fi

wait "$pid"
