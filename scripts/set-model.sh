#!/usr/bin/env bash
# Transactionally rewrite the `model:` frontmatter line in cc-agents agents.
#
#   set-model.sh <id>                 rewrite the 2 reviewers
#   set-model.sh --crawler <id>       rewrite glm-code-crawler only
#   set-model.sh --implementer <id>   rewrite glm-implementer only
#   set-model.sh --revert             restore from the last-known-good file (skips + warns on files that no longer exist)
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
IMPLEMENTER=(glm-implementer)

probe=1
target="reviewers"
id=""

while [ $# -gt 0 ]; do
  case "$1" in
    --no-probe) probe=0 ;;
    --crawler)  target="crawler" ;;
    --implementer) target="implementer" ;;
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
  implementer) for x in "${IMPLEMENTER[@]}"; do files+=("$AGENTS_DIR/$x.md"); done ;;
  revert)
    [ -f "$LASTGOOD" ] || { echo "no last-known-good to revert to" >&2; exit 1; }
    # Collect (file, model) pairs from the lastgood record.
    rev_files=()
    rev_models=()
    # Skip files deleted since the snapshot (e.g. a pre-0.2.0 lastgood naming
    # removed reviewers): warn per file, keep going. Filtering here keeps
    # rev_files/rev_models/rev_tmps aligned by construction. `seen` counts
    # every well-formed record line so we can tell an EMPTY/corrupt snapshot
    # (0 records → refuse) apart from one whose every named file was validly
    # deleted (records existed, none survive → benign no-op).
    seen=0
    while IFS=$'\t' read -r f m; do
      [ -n "$f" ] || continue
      seen=$((seen + 1))
      if [ ! -f "$f" ]; then
        echo "$(basename "$f") no longer exists — skipped" >&2
        continue
      fi
      rev_files+=("$f")
      rev_models+=("$m")
    done < <(tail -n +2 "$LASTGOOD")
    # An empty/truncated record means the snapshot was corrupted — refuse
    # rather than "reverting" zero files and reporting success. Use element
    # COUNTs, not `${arr[*]+x}`: the `+` set/unset test on an empty array is
    # version-dependent (differs on bash 3.2, which this script targets), so it
    # could read as "set" and skip the check. `${#arr[@]}`/integer counters are
    # unambiguous everywhere and safe under `set -u`.
    if [ "$seen" -eq 0 ]; then
      echo "last-known-good record is empty or corrupt ($LASTGOOD) — nothing reverted." >&2
      exit 1
    fi
    if [ "${#rev_files[@]}" -eq 0 ]; then
      echo "nothing left to revert — every recorded file is gone."
      exit 0
    fi
    # First pass: render every target into a temp file; abort cleanly on any failure.
    # (${arr[@]+...} guards: expanding an EMPTY array under `set -u` is fatal on
    # bash 3.2, which is what stock macOS ships. Same idiom in the write path.)
    rev_tmps=()
    for i in "${!rev_files[@]}"; do
      tmp="$(mktemp)"
      if ! fm_rewrite "${rev_models[$i]}" "${rev_files[$i]}" "$tmp"; then
        rm -f "$tmp"
        for t in ${rev_tmps[@]+"${rev_tmps[@]}"}; do rm -f "$t"; done
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

[ -n "$id" ] || { echo "usage: set-model.sh [--crawler|--implementer] [--no-probe] <model-id> | --revert" >&2; exit 2; }

# 1. Shape check, two parts.
#    a) Safe charset. This is a security check, not pedantry: the id is written
#       into agent YAML frontmatter via `awk -v`, which interprets backslash
#       escapes — an id containing a newline OR a literal `\n` becomes an extra
#       frontmatter line (e.g. `tools: Bash`), silently escalating a
#       least-privilege agent. The id is also spliced into the probe's JSON
#       body, where quotes/backslashes would break or smuggle fields.
#       NOTE: this must be a whole-string match. grep matches PER LINE, so a
#       multi-line id would pass grep if its first line looked valid — bash
#       `case` matches the string as one unit, newlines included.
case "$id" in
  *[!]A-Za-z0-9._:/[-]*)
    echo "rejected: '$id' contains characters outside [A-Za-z0-9._:/[]-] (whitespace, quotes, and backslashes are never valid in a model id)." >&2
    exit 1
    ;;
esac
#    b) Routing rule: glm- prefix OR an OpenRouter-namespaced id (contains a slash).
if ! printf '%s' "$id" | grep -Eq '^glm-|/'; then
  echo "rejected: '$id' is not a routable model id (need glm-* or vendor/model)." >&2
  exit 1
fi

# 2. Pre-validate every target file BEFORE the probe and BEFORE touching the
#    last-known-good record. A missing file or missing `model:` line used to
#    abort mid-way through writing LASTGOOD, truncating the previous good
#    record — destroying --revert exactly when it was needed.
for f in "${files[@]}"; do
  if [ ! -f "$f" ]; then
    echo "missing agent file: $f — no files changed." >&2
    exit 1
  fi
  if ! grep -Eq '^model:' "$f"; then
    echo "no 'model:' frontmatter line in $f — no files changed." >&2
    exit 1
  fi
done

# 3. Liveness probe (unless skipped).
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

# 4. Record last-known-good BEFORE writing (target + each file's current model).
#    Rendered to a temp file and moved into place so a failure can never leave
#    a truncated LASTGOOD behind (the previous record survives intact).
mkdir -p "$(dirname "$LASTGOOD")"
lg_tmp="$(mktemp)"
{
  echo "$target"
  for f in "${files[@]}"; do
    cur="$(grep -E '^model:' "$f" | head -1 | sed 's/^model:[[:space:]]*//')"
    printf '%s\t%s\n' "$f" "$cur"
  done
} > "$lg_tmp"
mv "$lg_tmp" "$LASTGOOD"

# 5. Two-pass write: first render all targets into temp files,
#    then (only after all renders succeed) rename each into place.
#    If ANY render fails, all temp files are deleted and no original is touched.
tmps=()
for f in "${files[@]}"; do
  tmp="$(mktemp)"
  if ! fm_rewrite "$id" "$f" "$tmp"; then
    rm -f "$tmp"
    for t in ${tmps[@]+"${tmps[@]}"}; do rm -f "$t"; done
    echo "write failed — no files changed." >&2
    exit 1
  fi
  tmps+=("$tmp")
done
for i in "${!files[@]}"; do
  mv "${tmps[$i]}" "${files[$i]}"
done
echo "set model to '$id' in ${#files[@]} file(s)."
