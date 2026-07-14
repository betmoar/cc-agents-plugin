---
description: Set the GLM model for any cc-agents agent group (reviewers by default; --crawler/--implementer/--scout/--brainstorm/--all). Transactional — shape check, live probe, last-known-good revert.
argument-hint: "[--crawler|--implementer|--scout|--brainstorm|--all] <glm-model-id> | --no-probe <id> | --revert"
allowed-tools: Bash(bash "${CLAUDE_PLUGIN_ROOT}/scripts/set-model.sh":*)
---

One switchable command for retuning the model of any cc-agents agent group. Pass the user's arguments straight through — the group flag is theirs to choose:

- (no flag) → the two reviewers (`glm-review-code`, `glm-review-design`)
- `--crawler` → `glm-code-crawler`
- `--implementer` → `glm-implementer`
- `--scout` → `glm-scout`
- `--brainstorm` → `glm-brainstorm`
- `--all` → every tunable agent at once
- `--revert` → restore the last successful write
- `--no-probe` → skip the live probe (shape-check only)

The script owns all file edits and does shape-check → probe → last-known-good → transactional write. Do not edit agent files yourself.

Run exactly:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/set-model.sh" $ARGUMENTS
```

Then report the script's stdout/stderr verbatim to the user, including which files changed or why it aborted.
