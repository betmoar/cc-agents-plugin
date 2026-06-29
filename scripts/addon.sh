#!/usr/bin/env bash
# Install / remove cc-agents addon packages into a project's .claude/ directory,
# resolving packages from a CENTRAL catalog (a separate git repo) with the
# plugin-bundled addons/ directory as an offline fallback / seed.
#
# An addon package is a project/type-specific dev team — role personas (agents/),
# phase workflows (skills/), and orchestration commands (commands/). Installing
# one COPIES those components into the consuming project's .claude/ so Claude
# Code auto-discovers them for that project only ("skills from a central
# catalog"). A native plugin-marketplace path is planned as a later addition.
#
#   addon.sh list                        list packages across all catalogs
#   addon.sh info    <name>              print a package's manifest
#   addon.sh install <name> [--force]    copy a package into <target>/.claude/
#   addon.sh remove  <name>              remove a previously installed package
#
#   addon.sh catalog add  [<repo>] [--name <n>]   clone a central catalog repo
#   addon.sh catalog update [<name>]              git-pull catalog(s)
#   addon.sh catalog list                         show configured catalogs
#   addon.sh catalog remove <name>                drop a cloned catalog
#
# Package resolution precedence: central catalogs (cache) first, then the
# bundled addons/ — so a centrally-published package overrides the local seed.
#
# Env: CC_AGENTS_ADDONS_DIR (bundled catalog), CC_AGENTS_CATALOG_CACHE (where
# central catalogs are cloned), CC_AGENTS_TARGET (project receiving the files).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(dirname "$SCRIPT_DIR")"

BUNDLED_DIR="${CC_AGENTS_ADDONS_DIR:-"$PLUGIN_ROOT/addons"}"
CATALOG_CACHE="${CC_AGENTS_CATALOG_CACHE:-"${XDG_CACHE_HOME:-$HOME/.cache}/cc-agents/catalogs"}"
DEFAULT_CATALOG="betmoar/cc-agents-addons"
TARGET_ROOT="${CC_AGENTS_TARGET:-"${CLAUDE_PROJECT_DIR:-$PWD}"}"
CLAUDE_DIR="$TARGET_ROOT/.claude"
COMPONENTS=(agents skills commands)

die() { echo "$1" >&2; exit "${2:-1}"; }

# A catalog "root" is a dir whose immediate subdirs (with an addon.json) are
# packages. For a cloned repo that keeps packages under addons/, that subdir is
# the root; otherwise the repo top level is.
catalog_root_of() {
  if [ -d "$1/addons" ]; then echo "$1/addons"; else echo "$1"; fi
}

# Echo every active catalog root, highest precedence first:
# cloned central catalogs (alphabetical), then the bundled dir.
catalog_roots() {
  if [ -d "$CATALOG_CACHE" ]; then
    for d in "$CATALOG_CACHE"/*/; do
      [ -d "$d" ] || continue
      catalog_root_of "${d%/}"
    done
  fi
  [ -d "$BUNDLED_DIR" ] && echo "$BUNDLED_DIR"
}

# Path to a package dir by name (first matching root wins), or empty.
find_package() {
  local name="$1" root
  while IFS= read -r root; do
    [ -n "$root" ] || continue
    if [ -f "$root/$name/addon.json" ]; then
      echo "$root/$name"
      return 0
    fi
  done < <(catalog_roots)
  return 1
}

# Path to a package's install record, relative to the target .claude/.
manifest_path() { printf '%s/.cc-agents-addons/%s.files' "$CLAUDE_DIR" "$1"; }

# Normalize a catalog ref to a clonable URL: pass through URLs / scp / local
# paths; expand owner/repo to a GitHub HTTPS URL.
catalog_url() {
  case "$1" in
    *://*|git@*|/*|.*|~*) echo "$1" ;;
    */*) echo "https://github.com/$1.git" ;;
    *) die "not a recognizable repo: $1 (use owner/repo or a git URL)" 2 ;;
  esac
}

cmd="${1:-}"
[ $# -gt 0 ] && shift || true

case "$cmd" in
  list)
    declare -A seen=()
    found=0
    while IFS= read -r root; do
      [ -n "$root" ] || continue
      src_label="$(basename "$(dirname "$root")")"
      [ "$root" = "$BUNDLED_DIR" ] && src_label="bundled"
      for d in "$root"/*/; do
        [ -f "${d}addon.json" ] || continue
        name="$(basename "$d")"
        [ -n "${seen[$name]:-}" ] && continue
        seen[$name]=1
        found=1
        line="$name  ($src_label)"
        [ -f "$(manifest_path "$name")" ] && line="$line  [installed]"
        echo "$line"
      done
    done < <(catalog_roots)
    [ "$found" -eq 1 ] || echo "no addon packages found (add one: addon.sh catalog add)"
    ;;

  info)
    name="${1:-}"
    [ -n "$name" ] || die "usage: addon.sh info <name>" 2
    pkg="$(find_package "$name")" || die "no such package: $name"
    cat "$pkg/addon.json"
    ;;

  install)
    force=0; name=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --force) force=1 ;;
        -*) die "unknown flag: $1" 2 ;;
        *)  name="$1" ;;
      esac
      shift
    done
    [ -n "$name" ] || die "usage: addon.sh install <name> [--force]" 2
    src="$(find_package "$name")" || die "no such package: $name (try: addon.sh list)"

    rels=()
    for c in "${COMPONENTS[@]}"; do
      [ -d "$src/$c" ] || continue
      while IFS= read -r -d '' f; do
        rels+=("$c/${f#"$src/$c/"}")
      done < <(find "$src/$c" -type f -print0)
    done
    [ "${#rels[@]}" -gt 0 ] || die "package '$name' has no installable components"

    if [ "$force" -eq 0 ]; then
      conflicts=()
      for r in "${rels[@]}"; do [ -e "$CLAUDE_DIR/$r" ] && conflicts+=("$r"); done
      if [ "${#conflicts[@]}" -gt 0 ]; then
        echo "refusing to overwrite ${#conflicts[@]} existing file(s) in $CLAUDE_DIR:" >&2
        for r in "${conflicts[@]}"; do echo "  $r" >&2; done
        die "re-run with --force to overwrite." 1
      fi
    fi

    mf="$(manifest_path "$name")"
    mkdir -p "$(dirname "$mf")"
    {
      echo "# cc-agents addon: $name"
      echo "# source: $src"
      echo "# installed: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    } > "$mf"
    for r in "${rels[@]}"; do
      mkdir -p "$(dirname "$CLAUDE_DIR/$r")"
      cp "$src/$r" "$CLAUDE_DIR/$r"
      echo "$r" >> "$mf"
    done

    echo "installed '$name' → $CLAUDE_DIR (${#rels[@]} file(s)) from $src"
    echo "remove with: addon.sh remove $name"
    ;;

  remove)
    name="${1:-}"
    [ -n "$name" ] || die "usage: addon.sh remove <name>" 2
    mf="$(manifest_path "$name")"
    [ -f "$mf" ] || die "'$name' is not installed in $CLAUDE_DIR"

    n=0
    while IFS= read -r r; do
      case "$r" in ''|'#'*) continue ;; esac
      if [ -e "$CLAUDE_DIR/$r" ]; then rm -f "$CLAUDE_DIR/$r"; n=$((n + 1)); fi
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

  catalog)
    sub="${1:-}"
    [ $# -gt 0 ] && shift || true
    case "$sub" in
      add)
        ref=""; cname=""
        while [ $# -gt 0 ]; do
          case "$1" in
            --name) shift; cname="${1:-}" ;;
            -*) die "unknown flag: $1" 2 ;;
            *)  ref="$1" ;;
          esac
          shift
        done
        [ -n "$ref" ] || ref="$DEFAULT_CATALOG"
        url="$(catalog_url "$ref")"
        if [ -z "$cname" ]; then
          cname="$(basename "$ref")"; cname="${cname%.git}"
        fi
        command -v git >/dev/null 2>&1 || die "git is required for 'catalog add'"
        mkdir -p "$CATALOG_CACHE"
        dest="$CATALOG_CACHE/$cname"
        if [ -d "$dest/.git" ]; then
          echo "catalog '$cname' already present — updating."
          git -C "$dest" pull --ff-only
        else
          git clone --depth 1 "$url" "$dest"
        fi
        echo "catalog '$cname' ready at $dest"
        ;;
      update)
        target="${1:-}"
        [ -d "$CATALOG_CACHE" ] || die "no catalogs cloned yet (addon.sh catalog add)"
        command -v git >/dev/null 2>&1 || die "git is required for 'catalog update'"
        for d in "$CATALOG_CACHE"/*/; do
          [ -d "$d/.git" ] || continue
          nm="$(basename "$d")"
          [ -n "$target" ] && [ "$target" != "$nm" ] && continue
          echo "updating '$nm'…"; git -C "$d" pull --ff-only
        done
        ;;
      list)
        echo "bundled: $BUNDLED_DIR"
        if [ -d "$CATALOG_CACHE" ]; then
          for d in "$CATALOG_CACHE"/*/; do
            [ -d "$d/.git" ] || continue
            echo "central: $(basename "$d")  →  $d"
          done
        fi
        ;;
      remove)
        nm="${1:-}"
        [ -n "$nm" ] || die "usage: addon.sh catalog remove <name>" 2
        dest="$CATALOG_CACHE/$nm"
        [ -d "$dest" ] || die "no such catalog: $nm"
        rm -rf "$dest"
        echo "removed catalog '$nm'."
        ;;
      *)
        die "usage: addon.sh catalog <add|update|list|remove> [...]" 2 ;;
    esac
    ;;

  ""|-h|--help|help)
    cat <<'USAGE'
cc-agents addon — install project-specific dev-team packages into .claude/

  addon.sh list                        list packages across all catalogs
  addon.sh info    <name>              print a package's addon.json
  addon.sh install <name> [--force]    copy a package into <project>/.claude/
  addon.sh remove  <name>              remove a previously installed package

  addon.sh catalog add [<repo>]        clone a central catalog (default: betmoar/cc-agents-addons)
  addon.sh catalog update [<name>]     git-pull catalog(s)
  addon.sh catalog list                show configured catalogs
  addon.sh catalog remove <name>       drop a cloned catalog

Packages resolve from central catalogs first, then the plugin-bundled addons/.
Target project defaults to $CLAUDE_PROJECT_DIR or the current directory.
USAGE
    ;;

  *)
    die "unknown command: $cmd (try: addon.sh help)" 2 ;;
esac
