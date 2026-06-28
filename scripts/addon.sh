#!/usr/bin/env bash
# Install / remove cc-agents addon packages into a project's .claude/ directory.
#
# An addon package is a project/type-specific dev team — a set of role personas
# (agents/), phase workflows (skills/), and orchestration commands (commands/) —
# shipped under the plugin's addons/<name>/ catalog. Installing one COPIES those
# components into the consuming project's .claude/ so Claude Code auto-discovers
# them for that project only.
#
#   addon.sh list                       list catalog packages (+ installed marker)
#   addon.sh info    <name>             print a package's manifest summary
#   addon.sh install <name> [--force]   copy a package into <target>/.claude/
#   addon.sh remove  <name>             remove a previously installed package
#
# Target: $CC_AGENTS_TARGET, else $CLAUDE_PROJECT_DIR, else $PWD — the project
# whose .claude/ receives the files. Installs are tracked by a per-package
# manifest under .claude/.cc-agents-addons/<name>.files so removal is exact.
#
# Test seams (env): CC_AGENTS_ADDONS_DIR (catalog), CC_AGENTS_TARGET (project).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(dirname "$SCRIPT_DIR")"

ADDONS_DIR="${CC_AGENTS_ADDONS_DIR:-"$PLUGIN_ROOT/addons"}"
TARGET_ROOT="${CC_AGENTS_TARGET:-"${CLAUDE_PROJECT_DIR:-$PWD}"}"
CLAUDE_DIR="$TARGET_ROOT/.claude"
COMPONENTS=(agents skills commands)

cmd="${1:-}"
[ $# -gt 0 ] && shift || true

die() { echo "$1" >&2; exit "${2:-1}"; }

# Path to a package's record of installed files, relative to the target .claude/.
manifest_path() { printf '%s/.cc-agents-addons/%s.files' "$CLAUDE_DIR" "$1"; }

is_package() { [ -f "$ADDONS_DIR/$1/addon.json" ]; }

list_packages() {
  [ -d "$ADDONS_DIR" ] || return 0
  for d in "$ADDONS_DIR"/*/; do
    [ -f "${d}addon.json" ] || continue
    basename "$d"
  done
}

case "$cmd" in
  list)
    found=0
    while IFS= read -r name; do
      [ -n "$name" ] || continue
      found=1
      if [ -f "$(manifest_path "$name")" ]; then
        echo "$name  [installed]"
      else
        echo "$name"
      fi
    done < <(list_packages)
    [ "$found" -eq 1 ] || echo "no addon packages found under $ADDONS_DIR"
    ;;

  info)
    name="${1:-}"
    [ -n "$name" ] || die "usage: addon.sh info <name>"
    is_package "$name" || die "no such package: $name"
    cat "$ADDONS_DIR/$name/addon.json"
    ;;

  install)
    force=0
    name=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --force) force=1 ;;
        -*) die "unknown flag: $1" 2 ;;
        *)  name="$1" ;;
      esac
      shift
    done
    [ -n "$name" ] || die "usage: addon.sh install <name> [--force]" 2
    is_package "$name" || die "no such package: $name (try: addon.sh list)"

    src="$ADDONS_DIR/$name"

    # Collect (relative path) of every component file the package would install.
    rels=()
    for c in "${COMPONENTS[@]}"; do
      [ -d "$src/$c" ] || continue
      while IFS= read -r -d '' f; do
        rels+=("$c/${f#"$src/$c/"}")
      done < <(find "$src/$c" -type f -print0)
    done
    [ "${#rels[@]}" -gt 0 ] || die "package '$name' has no installable components"

    # Pass 1: detect conflicts (existing files) unless --force.
    if [ "$force" -eq 0 ]; then
      conflicts=()
      for r in "${rels[@]}"; do
        [ -e "$CLAUDE_DIR/$r" ] && conflicts+=("$r")
      done
      if [ "${#conflicts[@]}" -gt 0 ]; then
        echo "refusing to overwrite ${#conflicts[@]} existing file(s) in $CLAUDE_DIR:" >&2
        for r in "${conflicts[@]}"; do echo "  $r" >&2; done
        die "re-run with --force to overwrite." 1
      fi
    fi

    # Pass 2: copy. Record each installed path in the manifest as we go.
    mf="$(manifest_path "$name")"
    mkdir -p "$(dirname "$mf")"
    {
      echo "# cc-agents addon: $name"
      echo "# installed: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    } > "$mf"
    for r in "${rels[@]}"; do
      mkdir -p "$(dirname "$CLAUDE_DIR/$r")"
      cp "$src/$r" "$CLAUDE_DIR/$r"
      echo "$r" >> "$mf"
    done

    echo "installed '$name' → $CLAUDE_DIR (${#rels[@]} file(s))."
    echo "remove with: addon.sh remove $name"
    ;;

  remove)
    name="${1:-}"
    [ -n "$name" ] || die "usage: addon.sh remove <name>" 2
    mf="$(manifest_path "$name")"
    [ -f "$mf" ] || die "'$name' is not installed in $CLAUDE_DIR"

    n=0
    # Delete tracked files, then prune emptied directories.
    while IFS= read -r r; do
      case "$r" in ''|'#'*) continue ;; esac
      if [ -e "$CLAUDE_DIR/$r" ]; then
        rm -f "$CLAUDE_DIR/$r"
        n=$((n + 1))
      fi
      # Prune now-empty parent dirs up to (not including) the .claude root.
      d="$(dirname "$CLAUDE_DIR/$r")"
      while [ "$d" != "$CLAUDE_DIR" ] && [ "$d" != "/" ]; do
        rmdir "$d" 2>/dev/null || break
        d="$(dirname "$d")"
      done
    done < "$mf"

    rm -f "$mf"
    rmdir "$CLAUDE_DIR/.cc-agents-addons" 2>/dev/null || true
    echo "removed '$name' from $CLAUDE_DIR ($n file(s))."
    ;;

  ""|-h|--help|help)
    cat <<'USAGE'
cc-agents addon — install project-specific dev-team packages into .claude/

  addon.sh list                       list catalog packages (+ installed marker)
  addon.sh info    <name>             print a package's addon.json
  addon.sh install <name> [--force]   copy a package into <project>/.claude/
  addon.sh remove  <name>             remove a previously installed package

Target project defaults to $CLAUDE_PROJECT_DIR or the current directory.
USAGE
    ;;

  *)
    die "unknown command: $cmd (try: addon.sh help)" 2
    ;;
esac
