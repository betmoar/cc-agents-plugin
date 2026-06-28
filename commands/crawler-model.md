---
description: Set the GLM model for the glm-code-crawler agent (transactional — shape check, live probe, last-known-good revert).
argument-hint: "<glm-model-id> | --no-probe <id> | --revert"
allowed-tools: Bash(bash "${CLAUDE_PLUGIN_ROOT}/scripts/set-model.sh":*)
---

Run the transactional model-rewrite for the crawler agent only. Pass the user's arguments through after `--crawler`.

Run exactly:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/set-model.sh" --crawler $ARGUMENTS
```

Then report the script's output verbatim, including which file changed or why it aborted.
