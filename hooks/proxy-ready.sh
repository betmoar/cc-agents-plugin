#!/usr/bin/env bash
# Exit 0 if the cc-proxy is reachable on 127.0.0.1:${PROXY_PORT:-4000}, else 1.
# Used by cc-agents skills as a preflight before fanning out GLM calls, so a
# down proxy fails fast with a clear message instead of opaque per-call errors.
set -uo pipefail
PORT="${PROXY_PORT:-4000}"
# Fail CLOSED if curl itself is missing: without this, `curl: command not
# found` (exit 127) is neither 7 nor 28 below and the probe would report the
# proxy UP on a system that cannot probe at all.
if ! command -v curl >/dev/null 2>&1; then
  echo "proxy preflight cannot run: curl not found on PATH — install curl, then retry." >&2
  exit 1
fi
# Probe the models route specifically: a 200 from GET /v1/models is a stronger
# readiness signal than "any response at /". cc-proxy documents this route as
# no-auth, so 200 is the honest "up and serving" answer. curl exit 7/28 (refused/
# timeout) and any non-200 status both mean not-ready. --max-time bounds the wait
# (no external `timeout`, absent on macOS).
code="$(curl -sS -o /dev/null -m 2 -w '%{http_code}' "http://127.0.0.1:${PORT}/v1/models" 2>/dev/null)"
rc=$?
if [ "$rc" -eq 7 ] || [ "$rc" -eq 28 ] || [ "$code" != "200" ]; then
  echo "cc-proxy not ready on 127.0.0.1:${PORT}/v1/models (curl rc=$rc http=$code) — start cc-proxy first." >&2
  exit 1
fi
exit 0
