# Changelog

All notable changes to the **cc-agents** plugin are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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

> Note: 0.1.1 bumped `plugin.json` to `0.1.1` but left `package.json` at `0.1.0`. This drift is reconciled in 0.1.2. 0.1.1 was not published as a git tag/release.

## [0.1.2]: https://github.com/betmoar/cc-agents-plugin/compare/v0.1.1...v0.1.2
## [0.1.1]: https://github.com/betmoar/cc-agents-plugin/compare/v0.1.0...v0.1.1

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
