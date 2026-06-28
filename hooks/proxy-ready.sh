#!/usr/bin/env bash
# Exit 0 if the cc-proxy is reachable on 127.0.0.1:${PROXY_PORT:-4000}, else 1.
# Used by cc-agents skills as a preflight before fanning out GLM calls, so a
# down proxy fails fast with a clear message instead of opaque per-call errors.
set -uo pipefail
PORT="${PROXY_PORT:-4000}"
# Probe with curl (already a plugin dependency via set-model.sh). We only care
# whether the proxy is LISTENING, not what it returns — any HTTP response (200,
# 404, 401, ...) proves it's up. curl exit 7 = connection refused, 28 = timeout
# → down; everything else means we reached a server. curl's own --max-time
# bounds the wait, so no external `timeout` is needed (it isn't on macOS).
curl -sS -o /dev/null -m 2 "http://127.0.0.1:${PORT}/" 2>/dev/null
rc=$?
if [ "$rc" -eq 7 ] || [ "$rc" -eq 28 ]; then
  echo "cc-proxy not reachable on 127.0.0.1:${PORT} — start cc-proxy first." >&2
  exit 1
fi
exit 0
