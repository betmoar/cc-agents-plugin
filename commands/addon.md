---
description: Install / list / remove cc-agents addon packages (project-specific dev-team skillsets) into the current project's .claude/ directory, resolved from a central catalog.
argument-hint: "list | info <name> | install <name> [--force] | remove <name> | catalog add|update|list|remove"
allowed-tools: Bash(bash "${CLAUDE_PLUGIN_ROOT}/scripts/addon.sh":*)
---

Manage cc-agents **addon packages** — project/type-specific dev teams (role personas + phase workflow skills + orchestration commands). Packages are resolved from a **central catalog** (a separate git repo, e.g. `betmoar/cc-agents-addons`, cloned with `catalog add`), with the plugin-bundled `addons/` directory as an offline fallback. Installing one copies its components into this project's `./.claude/` so Claude Code discovers the team for this project only.

Set up the central catalog once with `catalog add` (defaults to `betmoar/cc-agents-addons`); thereafter `list`/`install` see its packages. A native plugin-marketplace path is planned as a later addition.

Pass the user's arguments straight through to the installer; the script owns listing, copying, manifest tracking, and removal. Do not copy files yourself.

Run exactly:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/addon.sh" $ARGUMENTS
```

Then report the script's stdout/stderr verbatim — which package and files were installed/removed, which catalog they resolved from, or why it aborted (e.g. overwrite conflicts → suggest `--force`; no packages → suggest `catalog add`). After a successful `install`, tell the user the new agents/skills/commands are now available in this project (e.g. for `electron-to-tauri`: the `electron-to-tauri` orchestrator skill, the `migration-lead` / `tauri-engineer` / `qa-engineer` personas, and the `/migrate` command).
