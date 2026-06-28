---
description: Install / list / remove cc-agents addon packages (project-specific dev-team skillsets) into the current project's .claude/ directory.
argument-hint: "list | info <name> | install <name> [--force] | remove <name>"
allowed-tools: Bash(bash "${CLAUDE_PLUGIN_ROOT}/scripts/addon.sh":*)
---

Manage cc-agents **addon packages** — project/type-specific dev teams (role personas + phase workflow skills + orchestration commands) shipped under the plugin's `addons/` catalog. Installing one copies its components into this project's `./.claude/` so Claude Code discovers the team for this project only.

Pass the user's arguments straight through to the installer; the script owns listing, copying, manifest tracking, and removal. Do not copy files yourself.

Run exactly:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/addon.sh" $ARGUMENTS
```

Then report the script's stdout/stderr verbatim — which package and files were installed/removed, or why it aborted (e.g. overwrite conflicts → suggest `--force`). After a successful `install`, tell the user the new agents/skills/commands are now available in this project (e.g. for `electron-to-tauri`: the `electron-to-tauri` orchestrator skill, the `migration-lead` / `tauri-engineer` / `qa-engineer` personas, and the `/migrate` command).
