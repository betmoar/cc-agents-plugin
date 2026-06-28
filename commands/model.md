---
description: Set the GLM model for the four review-panel reviewer agents (transactional — shape check, live probe, last-known-good revert).
argument-hint: "<glm-model-id> | --no-probe <id> | --revert"
allowed-tools: Bash(bash "${CLAUDE_PLUGIN_ROOT}/scripts/set-model.sh":*)
---

Run the transactional model-rewrite for the reviewer agents. Pass the user's arguments straight through; the script does shape-check → probe → last-known-good → write and prints the outcome. Do not edit agent files yourself — the script owns that.

Run exactly:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/set-model.sh" $ARGUMENTS
```

Then report the script's stdout/stderr verbatim to the user, including which files changed or why it aborted.
