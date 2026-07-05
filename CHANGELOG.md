# Changelog

All notable changes to the **cc-agents** plugin are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.2.0] — 2026-07-05

Hardening + handoff release: every fix below is pinned by a new drift-lock test.

### Security
- **Frontmatter injection closed in `set-model.sh`:** the model id is written
  into agent YAML via `awk -v`, which interprets backslash escapes — an id
  containing a real newline **or a literal `\n`** injected an arbitrary extra
  frontmatter line (demonstrated: adding `tools: Bash` to a least-privilege
  reviewer), reachable via `/cc-agents:model --no-probe <id>`. The shape check
  is now a whole-string bash `case` charset whitelist (`[A-Za-z0-9._:/[]-]`);
  the old `grep` check matched per-line, so a multi-line id passed if its
  first line looked valid. Quotes/backslashes are also rejected, which keeps
  the probe's JSON body well-formed.

### Fixed
- **`--revert` snapshot no longer destructible:** a failed run (e.g. an agent
  file missing its `model:` line) used to abort *mid-write* of
  `.claude/cc-agents.lastgood`, truncating the previous good snapshot —
  destroying `--revert` exactly when it was needed. All target files are now
  pre-validated before the probe, and the snapshot is rendered to a temp file
  and `mv`ed into place. `--revert` also now refuses an empty/corrupt snapshot
  instead of "reverting" zero files and reporting success.
- **`proxy-ready.sh` fails closed without curl:** `curl: command not found`
  (exit 127) is neither 7 nor 28, so the preflight reported the proxy UP on a
  system that cannot probe at all. Missing curl now exits 1 with a clear
  message.
- **`spec-plan-suggest.sh` honors its never-errors contract:** if `node` is
  absent the hook now exits 0 silently instead of failing every Write/Edit in
  the session.
- **bash 3.2 (stock macOS) portability in `set-model.sh`:** empty-array
  expansions under `set -u` (fatal on bash 3.2) in the error-cleanup and
  revert paths now use the `${arr[@]+"${arr[@]}"}` guard idiom.

### Changed
- **Run-report marker moved next to the artifact:**
  `<artifact-dir>/.review-panel/<artifact-basename>.md` replaces the
  hardcoded `docs/superpowers/specs/.review-panel/` path (an author-specific
  layout baked into a generic plugin). The `**/.review-panel/**` gitignore
  advice and the hook's `*/.review-panel/*` self-review guard already worked
  path-agnostically, so they are unchanged.
- **Marker-aware hook (feedback-loop breaker):** the panel appends
  `## Clarifications` to the reviewed artifact, which re-fires the PostToolUse
  hook and used to re-suggest a fresh panel on the artifact it just reviewed.
  The hook now checks the marker path and downgrades to "re-convene only if
  the substance changed". The `review-panel` skill was reordered to write the
  run report **before** appending clarifications so the marker exists when the
  hook re-fires.
- **Skill preflight fallback note:** both skills now explain where
  `proxy-ready.sh` lives if `${CLAUDE_PLUGIN_ROOT}` is unset in the shell, so
  a "No such file or directory" is not misread as "proxy down".

### Added
- **CI:** GitHub Actions workflow running `node --test` + shellcheck on every
  push/PR — the suite previously ran only when someone remembered to.
- **`CLAUDE.md` maintainer handoff:** mental model, load-bearing inventory,
  touch-X-update-Y coupling table, landmines with rationale, playbooks
  (add an agent / tune the panel / release / debug), prioritized backlog.
- **New drift-locks:** version sync between `plugin.json` and `package.json`
  (this drifted at 0.1.1); marker-path coupling across hook, skill, and
  README; injection-payload rejection; lastgood preservation on failed runs;
  fail-closed preflight; hook silence without node.

### Tests
- Gate: `node --test` → **45 pass / 0 fail** (was 32) · `shellcheck` clean.

[0.2.0]: https://github.com/betmoar/cc-agents-plugin/compare/v0.1.2...v0.2.0

## [0.1.2] — 2026-06-28

### Changed
- **Least-privilege tools:** removed `Bash` from the four `glm-review-*` agents (`spec`, `plan`, `code`, `implementation`). They review read-only via Read/Grep/Glob; `Bash` was granted but never constrained. `glm-bulk-reader` and `glm-code-crawler` keep `Bash` (they intentionally run read-only shell). Agent system-prompt bodies are otherwise byte-identical.
- **Versions reconciled:** `package.json` bumped `0.1.0` → `0.1.2` and `plugin.json` `0.1.1` → `0.1.2`. They were previously out of sync (the 0.1.1 release bumped `plugin.json` only).

### Fixed
- **Manifest test:** dropped the `author.email` assertion from the manifest structure test — no email ships in `plugin.json`. The manifest subtest was red and is now green.
- **README cc-proxy dedup note:** corrected to reflect that the six duplicated `glm-*` agents (the four reviewers plus `glm-brainstorm`, `glm-bulk-reader`; never `glm-code-crawler`) moved into this plugin in **cc-proxy 0.3.0**. Repointed two dead `betmoar/cc-proxy` repo links to [`cc-proxy-plugin`](https://github.com/betmoar/cc-proxy-plugin).

### Added
- **Drift-lock tests:** four characterization tests pinning the shared invariants of the reviewer agents (identical `tools:` line, `CHEAP, WIDE` framing, GLM first-pass closing note, confidence rule) so the deliberate duplication cannot drift silently.

### Tests
- Gate: `node --test` → **32 pass / 0 fail** (was 25 pass / 1 fail at 0.1.1).

## [0.1.1] — 2026-06-28

### Fixed
- **Hook self-trigger:** `spec-plan-suggest.sh` (PostToolUse) no longer fires on the review-panel's own run-report marker. The marker path (`…/specs/.review-panel/<artifact>.md`) inherits the reviewed artifact's `-design.md`/`-plan.md` suffix, so it matched the spec/plan regex and re-suggested convening a panel on the panel's own output. Added a `*/.review-panel/*` early-exit guard. Covered by a new subtest.

> Note: 0.1.1 bumped `plugin.json` to `0.1.1` but left `package.json` at `0.1.0`. This drift is reconciled in 0.1.2. The `v0.1.1` git tag exists (it backs the compare link above), but no GitHub Release was published for it.

[0.1.2]: https://github.com/betmoar/cc-agents-plugin/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/betmoar/cc-agents-plugin/compare/v0.1.0...v0.1.1

## [0.1.0] — 2026-06-28

Initial release.

### Added
- **Seven `glm-*` agents** offloaded to GLM-5.2 via cc-proxy: `glm-brainstorm` (divergent idea generation), `glm-bulk-reader` (1M-context bulk reading), `glm-code-crawler` (single-shard crawl worker), and four reviewers — `glm-review-spec`, `glm-review-plan`, `glm-review-code`, `glm-review-implementation` (cheap first-pass review).
- **`review-panel` skill:** convenes N parallel GLM reviewers through distinct lenses (ambiguity, contradictions/feasibility, testability), scores findings 0–100, drops <50, poses `should-clarify` items back via `AskUserQuestion`, and writes a per-run report that doubles as the panel-ran marker.
- **`code-crawl` skill:** fans a large path/glob set across parallel `glm-code-crawler` shards (~150K chars each, max 6 concurrent) and merges digests.
- **PostToolUse hook** (`spec-plan-suggest.sh`) auto-suggests convening the review panel after a `*-design.md` (under `specs/`) or `*-plan.md` (under `specs/`/`plans/`) write. Advisory; never blocks.
- **`proxy-ready` preflight** (curl-based, macOS-safe — no `timeout` dependency) the skills run before dispatching agents.
- **Transactional model commands:** `/cc-agents:model` (four reviewers) and `/cc-agents:crawler-model` (crawler), backed by `set-model.sh` (shape-check → live probe → last-known-good → write; any pre-write failure leaves files untouched).
- **26 tests** covering structure, `set-model`, `proxy-ready`, and `spec-plan-suggest`.

[0.1.0]: https://github.com/betmoar/cc-agents-plugin/releases/tag/v0.1.0
