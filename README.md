# cc-agents

GLM-offload review agents with an auto-convened multi-lens review panel for specs and plans. Writing a spec or plan in the right path automatically suggests running a panel of parallel GLM reviewers; the findings are synthesized into one scored report.

---

## Hard dependency: cc-proxy

**This plugin requires the [`cc-proxy`](https://github.com/betmoar/cc-proxy) plugin to be running.** Every agent uses a `glm-*` model id, and those ids only resolve when cc-proxy is up — the proxy routes any `glm-*` id to Z.ai's Anthropic-compatible endpoint by prefix match. Without cc-proxy, all panel and crawl calls fail immediately.

This dependency is **not auto-enforced**. The skills run an HTTP preflight (`proxy-ready.sh`, a short `curl` to the proxy port) before dispatching agents, and they will halt with a clear message if the proxy is unreachable. But the plugin does not start cc-proxy for you.

---

## Install

1. Install and configure [cc-proxy](https://github.com/betmoar/cc-proxy) first. Confirm it is running (`cc-proxy` shows it listening on `127.0.0.1:4000` by default).
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

Both commands are transactional: they shape-check the model id, live-probe the proxy (unless `--no-probe`), save a last-known-good snapshot, and only then rewrite the agent files. Any failure before the write leaves every file untouched.

### `/cc-agents:model <id>`

Rewrite the `model:` frontmatter in the four reviewer agents (`glm-review-spec`, `glm-review-plan`, `glm-review-code`, `glm-review-implementation`).

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

**Flags (both commands):**
- `--no-probe` — skip the liveness probe; accept any shape-valid id without contacting the proxy.
- `--revert` — restore the last-known-good model id from `.claude/cc-agents.lastgood`.

### `/cc-agents:addon <list|info|install|remove> [name]`

Manage **addon packages** — project/type-specific dev teams shipped under the plugin's `addons/` catalog (see [Addon packages](#addon-packages)). Installing a package copies its personas/skills/commands into the current project's `./.claude/`.

```
/cc-agents:addon list                       # catalog packages (+ which are installed)
/cc-agents:addon info electron-to-tauri     # show a package's manifest
/cc-agents:addon install electron-to-tauri  # copy into ./.claude/ (--force to overwrite)
/cc-agents:addon remove electron-to-tauri   # uninstall (exact, via tracked manifest)
```

This command does not touch cc-proxy and works without it.

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

## Addon packages

Beyond the GLM review tooling, cc-agents ships **addon packages** — project/type-specific *skillsets*, each a small **dev team** of role personas (agents), phase workflows (skills), and orchestration commands that work together to carry a particular kind of project end to end.

Packages live in the [`addons/`](addons/) catalog and are **not** registered with the plugin. You install one into a consuming project with `/cc-agents:addon install <name>`, which copies its components into that project's `./.claude/` so Claude Code discovers the team **for that project only**. Removal is exact — each install records the files it wrote under `.claude/.cc-agents-addons/<name>.files`. These personas run on the **session model** (they don't depend on cc-proxy), unlike the `glm-*` review agents above.

| Package | What it does | Roles | Timeline |
|---|---|---|---|
| [`electron-to-tauri`](addons/electron-to-tauri/) | Migrate an Electron desktop app to Tauri (side-by-side, frontend kept, Node→Rust). 1:1 of the offline-pixel guide. | `migration-lead`, `tauri-engineer`, `qa-engineer` | 4-6 months |

See [`addons/README.md`](addons/README.md) for the package format and how to author a new one.

---

## Consuming-project `.gitignore`

These paths are per-project runtime state and should not be committed. Add them to the `.gitignore` in **each project** that uses cc-agents:

```gitignore
**/.review-panel/
.claude/.cc-agents-addons/
```

`.review-panel/` directories hold panel-ran markers, and `.cc-agents-addons/` holds addon install manifests; neither should be committed.

The `--revert` last-known-good snapshot (`cc-agents.lastgood`) is written to `.claude/cc-agents.lastgood` **inside the plugin repository itself** (resolved relative to the script's location, not the consuming project). If you are developing the plugin from source and want to keep it out of the plugin repo's git history, add the following to the plugin repo's `.gitignore`:

```gitignore
.claude/cc-agents.lastgood
```

---

## Follow-up: cc-proxy 0.3.0

cc-proxy 0.2.x ships its own `agents/` directory that duplicates the same `glm-review-*` agents. When cc-proxy 0.3.0 removes that directory (planned), the duplication goes away. **Until then**, if you have both plugins installed, you will see duplicate `glm-review-*` agents. Disable one copy — either rename the agents in one plugin or remove the `agents/` directory from the cc-proxy installation you are using — to avoid the duplicate registrations.
