#!/usr/bin/env bash
# Transactionally rewrite the `model:` frontmatter line in cc-agents agents.
#
#   set-model.sh <id>              rewrite the 2 reviewers
#   set-model.sh --crawler <id>    rewrite glm-code-crawler only
#   set-model.sh --revert          restore from the last-known-good file
#   --no-probe                     skip the liveness probe (shape-check only)
#
# Guard order: shape check -> probe (unless --no-probe) -> save last-known-good
# -> write. Any failure before the write leaves every file untouched.
#
# Test seams (env): CC_AGENTS_AGENTS_DIR, CC_AGENTS_LASTGOOD, CC_AGENTS_PROBE_CMD.
set -euo pipefail

# Derive the plugin root from this script's own location so paths work correctly
# when the script is invoked from any cwd (e.g. a user's project directory).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(dirname "$SCRIPT_DIR")"

AGENTS_DIR="${CC_AGENTS_AGENTS_DIR:-"$PLUGIN_ROOT/agents"}"
LASTGOOD="${CC_AGENTS_LASTGOOD:-"$PLUGIN_ROOT/.claude/cc-agents.lastgood"}"
REVIEWERS=(glm-review-code glm-review-design)
CRAWLER=(glm-code-crawler)

probe=1
target="reviewers"
id=""

while [ $# -gt 0 ]; do
  case "$1" in
    --no-probe) probe=0 ;;
    --crawler)  target="crawler" ;;
    --revert)   target="revert" ;;
    -*) echo "unknown flag: $1" >&2; exit 2 ;;
    *)  id="$1" ;;
  esac
  shift
done

# Frontmatter-scoped model rewrite: only replaces `model:` before the closing `---`.
# Counts fence markers (---); replaces only when fence==1 (inside frontmatter).
fm_rewrite() {
  local model="$1" src="$2" dst="$3"
  awk -v model="$model" '
    /^---$/ { fence++; print; next }
    fence == 1 && /^model:/ { print "model: " model; next }
    { print }
  ' "$src" > "$dst"
}

files=()
case "$target" in
  reviewers) for r in "${REVIEWERS[@]}"; do files+=("$AGENTS_DIR/$r.md"); done ;;
  crawler)   for c in "${CRAWLER[@]}";  do files+=("$AGENTS_DIR/$c.md"); done ;;
  revert)
    [ -f "$LASTGOOD" ] || { echo "no last-known-good to revert to" >&2; exit 1; }
    # Collect (file, model) pairs from the lastgood record.
    rev_files=()
    rev_models=()
    while IFS=$'\t' read -r f m; do
      [ -n "$f" ] || continue
      rev_files+=("$f")
      rev_models+=("$m")
    done < <(tail -n +2 "$LASTGOOD")
    # First pass: render every target into a temp file; abort cleanly on any failure.
    rev_tmps=()
    for i in "${!rev_files[@]}"; do
      tmp="$(mktemp)"
      if ! fm_rewrite "${rev_models[$i]}" "${rev_files[$i]}" "$tmp"; then
        rm -f "$tmp"
        for t in "${rev_tmps[@]}"; do rm -f "$t"; done
        echo "revert render failed — no files changed." >&2
        exit 1
      fi
      rev_tmps+=("$tmp")
    done
    # Second pass: atomic rename (originals untouched until all renders succeeded).
    for i in "${!rev_files[@]}"; do
      mv "${rev_tmps[$i]}" "${rev_files[$i]}"
    done
    echo "reverted to last-known-good."
    exit 0
    ;;
esac

[ -n "$id" ] || { echo "usage: set-model.sh [--crawler] [--no-probe] <model-id> | --revert" >&2; exit 2; }

# 1. Shape check: glm- prefix OR an OpenRouter-namespaced id (contains a slash).
if ! printf '%s' "$id" | grep -Eq '^glm-|/'; then
  echo "rejected: '$id' is not a routable model id (need glm-* or vendor/model)." >&2
  exit 1
fi

# 2. Liveness probe (unless skipped).
#    CC_AGENTS_PROBE_CMD is a trusted test seam — eval'd as-is (stub, not user input).
#    The production path passes $id as a literal curl argument, never through eval.
if [ "$probe" -eq 1 ]; then
  if [ -n "${CC_AGENTS_PROBE_CMD:-}" ]; then
    # Test seam: trusted stub command, safe to eval.
    if ! eval "$CC_AGENTS_PROBE_CMD"; then
      echo "probe failed for '$id' — aborting, no files changed. (use --no-probe to skip)" >&2
      exit 1
    fi
  else
    PORT="${PROXY_PORT:-4000}"
    body="$(printf '{"model":"%s","max_tokens":1,"messages":[{"role":"user","content":"hi"}]}' "$id")"
    if ! curl -fsS -m 10 -o /dev/null \
        -X POST "http://127.0.0.1:${PORT}/v1/messages" \
        -H 'content-type: application/json' \
        -d "$body"; then
      echo "probe failed for '$id' — aborting, no files changed. (use --no-probe to skip)" >&2
      exit 1
    fi
  fi
fi

# 3. Record last-known-good BEFORE writing (target + each file's current model).
mkdir -p "$(dirname "$LASTGOOD")"
{
  echo "$target"
  for f in "${files[@]}"; do
    cur="$(grep -E '^model:' "$f" | head -1 | sed 's/^model:[[:space:]]*//')"
    printf '%s\t%s\n' "$f" "$cur"
  done
} > "$LASTGOOD"

# 4. Two-pass write: first render all targets into temp files,
#    then (only after all renders succeed) rename each into place.
#    If ANY render fails, all temp files are deleted and no original is touched.
tmps=()
for f in "${files[@]}"; do
  tmp="$(mktemp)"
  if ! fm_rewrite "$id" "$f" "$tmp"; then
    rm -f "$tmp"
    for t in "${tmps[@]}"; do rm -f "$t"; done
    echo "write failed — no files changed." >&2
    exit 1
  fi
  tmps+=("$tmp")
done
for i in "${!files[@]}"; do
  mv "${tmps[$i]}" "${files[$i]}"
done
echo "set model to '$id' in ${#files[@]} file(s)."
