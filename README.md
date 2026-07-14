# cc-agents

GLM-offload review agents with an auto-convened multi-lens review panel for specs and plans. Writing a spec or plan in the right path automatically suggests running a panel of parallel GLM reviewers; the findings are synthesized into one scored report.

See [CHANGELOG.md](CHANGELOG.md) for release history.

---

## Hard dependency: cc-proxy

**This plugin requires the [`cc-proxy`](https://github.com/betmoar/cc-proxy-plugin) plugin to be running.** Every agent uses a `glm-*` model id, and those ids only resolve when cc-proxy is up — the proxy routes any `glm-*` id to Z.ai's Anthropic-compatible endpoint by prefix match. Without cc-proxy, all panel and crawl calls fail immediately.

This dependency is **not auto-enforced**. The skills run an HTTP preflight (`proxy-ready.sh`, a short `curl` to the proxy port) before dispatching agents, and they will halt with a clear message if the proxy is unreachable. But the plugin does not start cc-proxy for you.

---

## Install

1. Install and configure [cc-proxy](https://github.com/betmoar/cc-proxy-plugin) first. Confirm it is running (`cc-proxy` shows it listening on `127.0.0.1:4000` by default).
2. Add this plugin's marketplace and install it.

   From a local checkout:
   ```
   /plugin marketplace add /path/to/cc-agents-plugin
   /plugin install cc-agents@cc-agents-plugin
   ```

   Or straight from GitHub:
   ```
   /plugin marketplace add betmoar/cc-agents-plugin
   /plugin install cc-agents@cc-agents-plugin
   ```

   Both target this repo's own `.claude-plugin/marketplace.json`. Once a central marketplace is published, `cc-agents` will also be installable from there — the plugin name (`cc-agents`) is identical, only the `@<marketplace>` suffix changes.

---

## Auto review panel

After every file write or edit, the `spec-plan-suggest.sh` PostToolUse hook inspects the written path:

- A `*-design.md` file anywhere under a `specs/` directory segment → **spec**
- A `*-plan.md` file anywhere under a `specs/` or `plans/` directory segment → **plan**

When a match fires, the hook injects an **advisory** `additionalContext` message suggesting the main model convene the `review-panel` skill on the written file. This is best-effort — the hook never blocks execution, never errors fatally, and the suggestion can be overridden by the user.

When the panel runs, it writes a per-run report at `<artifact-dir>/.review-panel/<artifact-basename>.md` — a `.review-panel/` directory next to the reviewed artifact (see [Skills](#skills) below). That file doubles as the panel-ran marker: no file means the panel was never convened.

The hook checks that marker path: if a run report already exists for the written artifact, the suggestion changes to "re-convene only if the substance changed" — this prevents a feedback loop where the panel's own append of the `## Clarifications` section re-triggers a fresh panel.

---

## Commands

### `/cc-agents:model [group] <id>`

One transactional command retunes the `model:` frontmatter of any agent group: it shape-checks the model id, live-probes the proxy (unless `--no-probe`), saves a last-known-good snapshot, and only then rewrites the agent files. Any failure before the write leaves every file untouched.

Pick the target group with a flag; with no flag it targets the two reviewers.

| Flag | Agents | Default model |
|------|--------|---------------|
| *(none)* | `glm-review-code`, `glm-review-design` | `glm-5.2[1m]` |
| `--crawler` | `glm-code-crawler` | `glm-5-turbo` |
| `--implementer` | `glm-implementer` | `glm-5.2[1m]` |
| `--scout` | `glm-scout` | `glm-5.2[1m]` |
| `--brainstorm` | `glm-brainstorm` | `glm-5.2[1m]` |
| `--all` | every agent above | — |

```
/cc-agents:model glm-5.2[1m]              # reviewers (default group)
/cc-agents:model --crawler glm-5-turbo    # one group
/cc-agents:model --implementer glm-4.6
/cc-agents:model --scout glm-4.6
/cc-agents:model --brainstorm glm-4.6
/cc-agents:model --all glm-4.6            # every tunable agent at once
/cc-agents:model --no-probe glm-4         # skip the live probe (shape check only)
/cc-agents:model --revert                 # restore from last-known-good
```

**Flags:**
- `--no-probe` — skip the liveness probe; accept any shape-valid id without contacting the proxy.
- `--revert` — restore the last-known-good model ids from `.claude/cc-agents.lastgood` (skips + warns on any recorded file that no longer exists; refuses a malformed snapshot).

> Listing the models a provider actually offers (a `get-model` companion) is pending cc-proxy exposing `/v1/models`.

### `/cc-agents:tier [apply | revert | show]`

Declarative task-class model tiering, driven by a per-project settings file at
`.claude/cc-agents.local.md` (gitignored). Instead of picking a raw model id per
group, declare a **tier** per group and let `set-tier.sh` resolve it to a real
id and dispatch `set-model.sh` for each changed group. This is a **persistent
switch, not a per-call override** — the harness can't reroute a single dispatch
to a glm tier (the model param is a fixed sonnet/opus/haiku/fable enum); the
tier holds until you change it again.

| Tier | Resolves to |
|------|-------------|
| `fast` | `glm-4.5-air` |
| `default` | per-group factory id (same defaults as `/cc-agents:model`) |
| `deep` | `glm-4.7` |
| `max` | `glm-5.2` |

Settings file template (`.claude/cc-agents.local.md`):

```markdown
---
review: deep
crawler: fast
implementer: default
scout: max
brainstorm: fast
experimental: false
---
```

Set `experimental: true` to allow raw OpenRouter ids (`deepseek/*`, `qwen/*`,
etc.) in place of a tier name — they still go through `set-model.sh`'s shape
check and the proxy's `/v1/models` membership probe, just like tier ids do.

Subcommands:

```
/cc-agents:tier apply     # resolve the settings file, retune each changed group (atomic)
/cc-agents:tier revert    # restore the whole last apply, all groups
/cc-agents:tier show      # print current vs declared tier per agent (drift view)
```

`set-tier.sh` never writes agent frontmatter itself — it snapshots the current
state to `.claude/cc-agents.tier.lastgood`, then calls `set-model.sh` once per
changed group, so every write still goes through the shape-check → probe →
last-known-good → atomic-write pipeline. `tier revert` restores every group
from that snapshot in one call by delegating to `set-model.sh --revert`.

Unlike `/cc-agents:model`'s `cc-agents.lastgood` (plugin-repo-relative), both
`.claude/cc-agents.local.md` and `.claude/cc-agents.tier.lastgood` resolve
relative to the **current working directory** — i.e. per consuming project.
See [Consuming-project `.gitignore`](#consuming-project-gitignore) below for
what to add to your project's `.gitignore`.

---

## Skills

### `review-panel`

Convenes N parallel GLM reviewers (default N=3), one per distinct lens, then synthesizes their findings into one scored report:

- **Lens A** — ambiguity & completeness
- **Lens B** — contradictions & feasibility (checks claims against code)
- **Lens C** — testability & observable acceptance criteria

Findings below a score of 50 are dropped. Survivors are grouped as `must-resolve` (≥75) / `should-clarify` (60–74) / `consider` (50–59). The synthesized report is a GLM first-pass — confirm before acting.

**Clarifying questions.** The `should-clarify` findings — the genuinely open/ambiguous items — are posed back to you as interactive `AskUserQuestion` prompts (up to 4 per run, top-scored first). Your answers are appended to the reviewed artifact as a non-destructive `## Clarifications (date)` section; the original prose is never rewritten. `must-resolve` (contradictions/bugs to fix) and `consider` items are reported, not asked.

**Per-run report.** Each panel run writes a full record at `<artifact-dir>/.review-panel/<artifact-basename>.md` — which lenses ran, every finding with its score and bucket, what was asked and how you answered, the verdict, and per-agent token cost (when reported). This file is also the panel-ran marker: no file means the panel never ran on that artifact.

Triggered automatically by the PostToolUse hook, or invoke directly:

```
/review-panel           # panel on the spec or plan in context
```

**Preflight:** runs `proxy-ready.sh` before dispatching agents. If cc-proxy is not reachable, the skill halts and tells you to start the proxy.

### `code-crawl`

Fans a large path/glob set out across parallel `glm-code-crawler` shards (~150K characters each, max 6 parallel waves) and merges the digests. The crawler runs on `glm-5-turbo` (cheap tier). Useful for reading whole subsystems or large log sets without spending main-model tokens.

```
/code-crawl             # crawl the paths given as arguments
```

**Preflight:** same proxy-ready check as `review-panel`.

---

## Consuming-project `.gitignore`

These paths are per-project runtime state and should not be committed. Add them to the `.gitignore` in **each project** that uses cc-agents:

```gitignore
**/.review-panel/
.claude/*.local.md
.claude/cc-agents.tier.lastgood
```

`.review-panel/` directories hold panel-ran markers and should not be committed.

`.claude/cc-agents.local.md` (the `/cc-agents:tier` settings file) and `.claude/cc-agents.tier.lastgood` (its multi-group revert snapshot) both resolve relative to the consuming project's working directory — unlike `/cc-agents:model`'s own snapshot below, they are not plugin-repo state.

The `--revert` last-known-good snapshot (`cc-agents.lastgood`) is written to `.claude/cc-agents.lastgood` **inside the plugin repository itself** (resolved relative to the script's location, not the consuming project). If you are developing the plugin from source and want to keep it out of the plugin repo's git history, add the following to the plugin repo's `.gitignore`:

```gitignore
.claude/cc-agents.lastgood
```

---

## Duplicate agents with cc-proxy (resolved in 0.3.0)

cc-proxy versions **0.1.1 through 0.2.2** shipped their own `agents/` directory that duplicated six of these `glm-*` agents (the four pre-0.2.0 reviewers plus `glm-brainstorm` and the bulk-reader — renamed `glm-scout` in cc-agents 0.2.0; note `glm-code-crawler` was never duplicated). **cc-proxy 0.3.0 moved those agents into this plugin**, so on the current cc-proxy there is no duplication. If you pin an older cc-proxy and also run cc-agents, you will see those six agents registered twice — disable one copy (rename the agents in one plugin, or remove the `agents/` directory from the cc-proxy installation you are using) to avoid the duplicate registrations.
