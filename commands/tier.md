---
description: Apply, revert, or show the per-group model tier from .claude/cc-agents.local.md. Declarative task-class tiering (fast/default/deep/max) driving set-model.sh transactionally.
argument-hint: "apply | revert | show"
allowed-tools: Bash(bash "${CLAUDE_PLUGIN_ROOT}/scripts/set-tier.sh":*)
---

Task-class model tiering for cc-agents. Reads `.claude/cc-agents.local.md`
(per-project, gitignored) and retunes each agent group's `model:` frontmatter to
a declared tier. This is a **persistent switch**, not a per-call override — the
harness cannot reroute a single dispatch to a glm tier (the model param is a
fixed sonnet/opus/haiku/fable enum). The tier holds until you change it.

Tiers: `fast` (glm-4.5-air) · `default` (per-group factory) · `deep` (glm-4.7) ·
`max` (glm-5.2). Set `experimental: true` in the settings file to allow raw
OpenRouter ids (`deepseek/*`, `qwen/*`); they are still membership-checked
against the proxy's `/v1/models`.

Subcommands:

- `apply` — resolve the settings file and retune each changed group (atomic:
  any bad tier/group aborts with zero writes; snapshots before writing).
- `revert` — restore the whole last apply (all groups) from the tier snapshot.
- `show` — print current vs declared tier per agent (drift view).

`set-tier.sh` owns no frontmatter writes — it drives `set-model.sh`, which does
shape-check → `/v1/models` membership probe → last-known-good → atomic write. Do
not edit agent files yourself.

Run exactly:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/set-tier.sh" $ARGUMENTS
```

Then report the script's stdout/stderr verbatim, including which groups changed,
were skipped, or why it aborted.
