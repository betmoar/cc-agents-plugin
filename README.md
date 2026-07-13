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
2. Add this plugin to your Claude Code installation:
   ```
   /plugins add cc-agents
   ```

---

## Auto review panel

After every file write or edit, the `spec-plan-suggest.sh` PostToolUse hook inspects the written path:

- A `*-design.md` file anywhere under a `specs/` directory segment → **spec**
- A `*-plan.md` file anywhere under a `specs/` or `plans/` directory segment → **plan**

When a match fires, the hook injects an **advisory** `additionalContext` message suggesting the main model convene the `review-panel` skill on the written file. This is best-effort — the hook never blocks execution, never errors fatally, and the suggestion can be overridden by the user.

When the panel runs, it writes a per-run report at `docs/superpowers/specs/.review-panel/<artifact-basename>.md` (see [Skills](#skills) below). That file doubles as the panel-ran marker: no file means the panel was never convened.

---

## Commands

All three commands are transactional: they shape-check the model id, live-probe the proxy (unless `--no-probe`), save a last-known-good snapshot, and only then rewrite the agent files. Any failure before the write leaves every file untouched.

### `/cc-agents:model <id>`

Rewrite the `model:` frontmatter in the two reviewer agents (`glm-review-code`, `glm-review-design`).

**Default:** `glm-5.2[1m]`

```
/cc-agents:model glm-5.2[1m]          # set to a specific model
/cc-agents:model --no-probe glm-4     # skip the live probe (shape check only)
/cc-agents:model --revert             # restore from last-known-good
```

### `/cc-agents:crawler-model <id>`

Rewrite the `model:` frontmatter in the `glm-code-crawler` agent only.

**Default:** `glm-5-turbo`

```
/cc-agents:crawler-model glm-5-turbo  # set to a specific model
/cc-agents:crawler-model --no-probe glm-5-turbo
/cc-agents:crawler-model --revert
```

### `/cc-agents:implementer-model <id>`

Rewrite the `model:` frontmatter in the `glm-implementer` agent only.

**Default:** `glm-5.2[1m]`

```
/cc-agents:implementer-model glm-5.2[1m]  # set to a specific model
/cc-agents:implementer-model --no-probe glm-5.2[1m]
/cc-agents:implementer-model --revert
```

**Flags (all three commands):**
- `--no-probe` — skip the liveness probe; accept any shape-valid id without contacting the proxy.
- `--revert` — restore the last-known-good model id from `.claude/cc-agents.lastgood`.

---

## Skills

### `review-panel`

Convenes N parallel GLM reviewers (default N=3), one per distinct lens, then synthesizes their findings into one scored report:

- **Lens A** — ambiguity & completeness
- **Lens B** — contradictions & feasibility (checks claims against code)
- **Lens C** — testability & observable acceptance criteria

Findings below a score of 50 are dropped. Survivors are grouped as `must-resolve` (≥75) / `should-clarify` (60–74) / `consider` (50–59). The synthesized report is a GLM first-pass — confirm before acting.

**Clarifying questions.** The `should-clarify` findings — the genuinely open/ambiguous items — are posed back to you as interactive `AskUserQuestion` prompts (up to 4 per run, top-scored first). Your answers are appended to the reviewed artifact as a non-destructive `## Clarifications (date)` section; the original prose is never rewritten. `must-resolve` (contradictions/bugs to fix) and `consider` items are reported, not asked.

**Per-run report.** Each panel run writes a full record at `docs/superpowers/specs/.review-panel/<artifact-basename>.md` — which lenses ran, every finding with its score and bucket, what was asked and how you answered, the verdict, and per-agent token cost (when reported). This file is also the panel-ran marker: no file means the panel never ran on that artifact.

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
```

`.review-panel/` directories hold panel-ran markers and should not be committed.

The `--revert` last-known-good snapshot (`cc-agents.lastgood`) is written to `.claude/cc-agents.lastgood` **inside the plugin repository itself** (resolved relative to the script's location, not the consuming project). If you are developing the plugin from source and want to keep it out of the plugin repo's git history, add the following to the plugin repo's `.gitignore`:

```gitignore
.claude/cc-agents.lastgood
```

---

## Duplicate agents with cc-proxy (resolved in 0.3.0)

cc-proxy versions **0.1.1 through 0.2.2** shipped their own `agents/` directory that duplicated six of these `glm-*` agents (the four pre-0.2.0 reviewers plus `glm-brainstorm` and the bulk-reader — renamed `glm-scout` in cc-agents 0.2.0; note `glm-code-crawler` was never duplicated). **cc-proxy 0.3.0 moved those agents into this plugin**, so on the current cc-proxy there is no duplication. If you pin an older cc-proxy and also run cc-agents, you will see those six agents registered twice — disable one copy (rename the agents in one plugin, or remove the `agents/` directory from the cc-proxy installation you are using) to avoid the duplicate registrations.
