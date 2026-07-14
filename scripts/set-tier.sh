#!/usr/bin/env bash
# Declarative task-class model tiering for cc-agents.
#
#   set-tier.sh apply    resolve .claude/cc-agents.local.md and retune each group
#   set-tier.sh revert   restore the pre-apply snapshot (delegates to set-model.sh --revert)
#   set-tier.sh show     print current vs declared tier per agent
#
# Never writes frontmatter itself: apply resolves tiers -> ids and invokes
# set-model.sh once per changed group (set-model owns shape/probe/lastgood/write).
# The only new state is a cumulative snapshot in set-model's own lastgood format,
# so `revert` can reuse set-model's hardened --revert across all groups at once.
#
# Test seams (env): CC_AGENTS_AGENTS_DIR, CC_AGENTS_SETTINGS_FILE,
# CC_AGENTS_TIER_LASTGOOD, CC_AGENTS_SET_MODEL_CMD, CC_AGENTS_MODELS_JSON.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(dirname "$SCRIPT_DIR")"

AGENTS_DIR="${CC_AGENTS_AGENTS_DIR:-"$PLUGIN_ROOT/agents"}"
SETTINGS_FILE="${CC_AGENTS_SETTINGS_FILE:-.claude/cc-agents.local.md}"
TIER_LASTGOOD="${CC_AGENTS_TIER_LASTGOOD:-.claude/cc-agents.tier.lastgood}"
# Word-split the writer command intentionally (default: bash + script path).
if [ -n "${CC_AGENTS_SET_MODEL_CMD:-}" ]; then
  # shellcheck disable=SC2206
  SET_MODEL_CMD=($CC_AGENTS_SET_MODEL_CMD)
else
  SET_MODEL_CMD=(bash "$SCRIPT_DIR/set-model.sh")
fi

# --- Static maps (parallel indexed arrays; bash-3.2, no declare -A) -----------
# NOTE: named TIER_GROUPS, not GROUPS — `GROUPS` is a bash built-in special
# array (populated from getgroups(2)); assigning to it is silently ignored in
# bash 3.2, so a plain `GROUPS=(...)` here never took effect and group_index
# matched against numeric GIDs instead of group names. Discovered at GREEN.
TIER_GROUPS=(review crawler implementer scout brainstorm)
# group -> set-model argv (review = empty = no-flag reviewers path)
GROUP_ARGV=("" "--crawler" "--implementer" "--scout" "--brainstorm")
# group -> agent file basenames (space-separated; review has two)
GROUP_FILES=("glm-review-code glm-review-design" "glm-code-crawler" \
             "glm-implementer" "glm-scout" "glm-brainstorm")
# group -> factory (default-tier) id
GROUP_FACTORY=("glm-5.2[1m]" "glm-5-turbo" "glm-5.2[1m]" "glm-5.2[1m]" "glm-5.2[1m]")

group_index() {  # echo the index of $1 in TIER_GROUPS, or -1
  local i
  for i in "${!TIER_GROUPS[@]}"; do
    [ "${TIER_GROUPS[$i]}" = "$1" ] && { echo "$i"; return 0; }
  done
  echo "-1"
}

# tier name -> id for a given group index. Echoes the resolved id. Returns 1 if
# the value is neither a known tier nor an acceptable raw id.
resolve_tier() {  # $1=value $2=group_index $3=experimental(0/1)
  local val="$1" gi="$2" exp="$3"
  case "$val" in
    fast)    echo "glm-4.5-air"; return 0 ;;
    deep)    echo "glm-4.7";     return 0 ;;
    max)     echo "glm-5.2";     return 0 ;;
    default) echo "${GROUP_FACTORY[$gi]}"; return 0 ;;
  esac
  # Not a tier name: only accept a raw id under the experimental gate, and only
  # if it passes set-model's shape rule (glm-* or vendor/model).
  if [ "$exp" -eq 1 ] && printf '%s' "$val" | grep -Eq '^glm-|/'; then
    echo "$val"; return 0
  fi
  return 1
}

current_model() {  # $1=agent file basename -> current model line
  grep -E '^model:' "$AGENTS_DIR/$1.md" | head -1 | sed 's/^model:[[:space:]]*//'
}

# --- Settings parser (frontmatter only; bash-3.2) -----------------------------
# Fills parallel arrays SEL_GROUP[] / SEL_VALUE[] with declared group:value pairs
# and sets EXPERIMENTAL. Exits 1/2 on bad tier/group/malformed per the contract.
parse_settings() {
  SEL_GROUP=(); SEL_VALUE=(); EXPERIMENTAL=0
  [ -f "$SETTINGS_FILE" ] || return 0   # missing file -> no selections (no-op)

  # Malformed unless there are at least TWO fence lines (open + close). A file
  # with zero fences, or only an opening `---` and no closing one, is rejected
  # per spec §4 ("no closing fence" = malformed). Count real fence lines.
  local fences
  # `grep -c` exits 1 when the count is zero (no match) — under `set -e` that
  # would abort the whole script right here instead of falling through to the
  # `-lt 2` check below, turning a "malformed settings" (exit 2) into a raw
  # `set -e` abort (exit 1). `|| true` keeps zero-fence files on the intended
  # error path.
  fences="$(grep -cE '^---[[:space:]]*$' "$SETTINGS_FILE" || true)"
  if [ "$fences" -lt 2 ]; then
    echo "malformed settings: need an opening and closing '---' fence in $SETTINGS_FILE" >&2
    exit 2
  fi
  # Extract the region between the first two `---` fences.
  local fm
  fm="$(awk '/^---[[:space:]]*$/{f++; next} f==1{print} f>=2{exit}' "$SETTINGS_FILE")"

  local line key val
  # `|| [ -n "$line" ]` keeps a final line that lacks a trailing newline: `read`
  # returns non-zero at EOF but still populates $line (same idiom as
  # scripts/set-model.sh:108). Without it a hand-edited last key is dropped.
  while IFS= read -r line || [ -n "$line" ]; do
    # blank / comment lines inside frontmatter are ignored (comment = leading #,
    # optionally indented — a `#` anywhere-at-start after trim).
    case "$(printf '%s' "$line" | sed -E 's/^[[:space:]]+//')" in ""|"#"*) continue ;; esac
    case "$line" in
      *:*) : ;;
      *) echo "malformed settings line (no key:value): '$line' in $SETTINGS_FILE" >&2; exit 2 ;;
    esac
    key="${line%%:*}"
    val="${line#*:}"
    # normalize value: strip inline comment FIRST (so `"fast"  # note` survives),
    # then surrounding whitespace, then one surrounding quote pair. (A `#` inside
    # a would-be model id is a pathological input set-model's charset check would
    # reject anyway.)
    val="${val%%#*}"
    val="$(printf '%s' "$val" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
    val="$(printf '%s' "$val" | sed -E 's/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/')"
    key="$(printf '%s' "$key" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"

    if [ "$key" = "experimental" ]; then
      [ "$val" = "true" ] && EXPERIMENTAL=1 || EXPERIMENTAL=0
      continue
    fi
    if [ "$(group_index "$key")" = "-1" ]; then
      echo "unknown group key '$key' in $SETTINGS_FILE (valid: ${TIER_GROUPS[*]})" >&2; exit 2
    fi
    [ -z "$val" ] && continue   # empty value == missing key (unchanged)
    SEL_GROUP+=("$key")
    SEL_VALUE+=("$val")
  done <<EOF
$fm
EOF
}

cmd_apply() {
  parse_settings
  # Resolve + validate the WHOLE file before any write (atomicity).
  local i gi rid exp="$EXPERIMENTAL" hint
  RES_GROUP=(); RES_ID=()
  if [ "${#SEL_GROUP[@]}" -gt 0 ]; then
    for i in "${!SEL_GROUP[@]}"; do
      gi="$(group_index "${SEL_GROUP[$i]}")"
      if ! rid="$(resolve_tier "${SEL_VALUE[$i]}" "$gi" "$exp")"; then
        # ${exp:+...} tests the STRING "0"/"1" (both non-empty) — not the
        # boolean — so it always appended the hint. Test the value instead.
        hint=""; [ "$exp" -eq 1 ] && hint=", or a raw id"
        echo "unknown tier '${SEL_VALUE[$i]}' for group '${SEL_GROUP[$i]}' (valid: fast default deep max${hint})." >&2
        exit 1
      fi
      RES_GROUP+=("${SEL_GROUP[$i]}")
      RES_ID+=("$rid")
    done
  fi

  # Compute write set (group differs from resolved on any of its file) and, in
  # the same pass, build the snapshot INTO a temp file with printf so the rows
  # carry REAL tab/newline bytes (set-model's --revert reader splits on a real
  # tab via `IFS=$'\t'`; an in-source-string tab is fragile — build the file).
  local applied=0 skipped=0 f cur differs
  mkdir -p "$(dirname "$TIER_LASTGOOD")"
  local snap_tmp; snap_tmp="$(mktemp)"
  echo "tier" > "$snap_tmp"          # header line (set-model skips it via tail -n +2)
  WRITE_GROUP=(); WRITE_ID=()
  if [ "${#RES_GROUP[@]}" -gt 0 ]; then
    for i in "${!RES_GROUP[@]}"; do
      gi="$(group_index "${RES_GROUP[$i]}")"
      differs=0
      for f in ${GROUP_FILES[$gi]}; do
        cur="$(current_model "$f")"
        [ "$cur" != "${RES_ID[$i]}" ] && differs=1
      done
      if [ "$differs" -eq 0 ]; then
        skipped=$((skipped + 1)); continue
      fi
      WRITE_GROUP+=("${RES_GROUP[$i]}")
      WRITE_ID+=("${RES_ID[$i]}")
      # Record every file of this changed group at its CURRENT model (real tab).
      for f in ${GROUP_FILES[$gi]}; do
        printf '%s\t%s\n' "$AGENTS_DIR/$f.md" "$(current_model "$f")" >> "$snap_tmp"
      done
    done
  fi

  if [ "${#WRITE_GROUP[@]}" -eq 0 ]; then
    rm -f "$snap_tmp"
    echo "applied 0 group(s), skipped $skipped (already at target)."
    exit 0
  fi

  # Publish the snapshot atomically BEFORE the first write. It covers EVERY
  # write-set file up front, so even a mid-dispatch failure (a probe/write abort
  # in some later group) is fully undoable: `set-tier.sh revert` restores all of
  # them, including any group already written before the failure. That is the
  # partial-dispatch recovery guarantee — no per-group rollback needed here.
  mv "$snap_tmp" "$TIER_LASTGOOD"

  # Dispatch per changed group. review -> no-flag; others -> --<group>.
  # A set-model failure trips `set -e` and aborts; the snapshot above makes it
  # recoverable via `set-tier.sh revert`.
  for i in "${!WRITE_GROUP[@]}"; do
    gi="$(group_index "${WRITE_GROUP[$i]}")"
    if [ -n "${GROUP_ARGV[$gi]}" ]; then
      "${SET_MODEL_CMD[@]}" "${GROUP_ARGV[$gi]}" "${WRITE_ID[$i]}"
    else
      "${SET_MODEL_CMD[@]}" "${WRITE_ID[$i]}"
    fi
    applied=$((applied + 1))
  done
  echo "applied $applied group(s), skipped $skipped (already at target)."
}

# --- dispatch -----------------------------------------------------------------
sub="${1:-}"
case "$sub" in
  apply)  cmd_apply ;;
  *) echo "usage: set-tier.sh apply|revert|show" >&2; exit 2 ;;
esac
