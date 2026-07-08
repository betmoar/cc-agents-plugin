# cc-agents — maintainer's handoff

Read this before changing anything. It encodes the judgment behind the code:
the invariants, the couplings, the landmines, and the procedures for the
changes people actually make here. `node --test && npm run lint` is the gate
for every change — the tests are drift-locks, not just unit tests. **If a test
goes red after your change, the default assumption is that you broke an
invariant, not that the test is stale.**

## What this is (mental model)

A Claude Code **plugin** with no runtime of its own. Everything here is either
(a) **prose executed by a model** — agents, skills, commands — or (b) **shell
executed by the Claude Code harness** — hooks, scripts. That split is the
single most important thing to understand:

- Prose files (`agents/*.md`, `skills/*/SKILL.md`, `commands/*.md`) are
  *instructions*, not code. They fail silently and probabilistically: a weaker
  model skips a step, misreads a path, ignores a constraint. So the shell
  layer exists to make the prose layer's mistakes cheap and recoverable.
- Shell files (`hooks/*.sh`, `scripts/set-model.sh`) are the only enforcement
  we have. They must be paranoid, transactional, and fail-closed, because the
  operator driving them may be a cheap model or a distracted human.

Control flow of the flagship feature:

```
main model Write/Edits specs/foo-design.md
  → PostToolUse hook (spec-plan-suggest.sh) matches the path
  → injects advisory additionalContext: "convene review-panel"
  → main model runs skills/review-panel/SKILL.md as a procedure:
      preflight (hooks/proxy-ready.sh — is cc-proxy listening?)
      → dispatch 3 parallel Agent calls (glm-review-* agents, one lens each)
      → main model synthesizes + scores findings, drops <50
      → AskUserQuestion for should-clarify items (≤4, one round)
      → writes run report to <artifact-dir>/.review-panel/<basename>.md   ← MARKER
      → appends "## Clarifications" to the artifact                        ← re-fires hook;
                                                                              marker suppresses it
```

External dependency: **cc-proxy** (separate plugin) must be listening on
`127.0.0.1:${PROXY_PORT:-4000}` and routes any `glm-*` model id to Z.ai. This
plugin never talks to Z.ai directly. Nothing enforces that cc-proxy is
installed — only the runtime preflight.

State lives in exactly two places, both files:
1. `<artifact-dir>/.review-panel/<basename>.md` — panel-ran marker + run report
   (per consuming project; gitignored via `**/.review-panel/`).
2. `.claude/cc-agents.lastgood` — set-model.sh's revert snapshot (inside the
   plugin repo itself, resolved relative to the script; gitignored).

## Load-bearing inventory (ranked by blast radius)

1. **`scripts/set-model.sh`** — the only thing here that *writes* to agent
   files. Its charset shape-check is a **security boundary**: the model id is
   spliced into YAML frontmatter via `awk -v` (which interprets `\n` escapes!)
   and into a JSON probe body. A hostile id could add a `tools: Bash` line to
   a least-privilege agent. Never weaken the `case "$id"` whitelist; never
   switch it to `grep` (grep matches per-line — a multi-line id passes).
2. **`hooks/spec-plan-suggest.sh`** — runs on *every* Write/Edit in every
   consuming project. Contract: advisory only, never blocks, never errors
   (missing `node` → silent exit 0). Its `*/.review-panel/*` guard and its
   marker-exists check are both loop-breakers (see Landmines #1).
3. **The marker path convention** `<artifact-dir>/.review-panel/<basename>.md`
   — hardcoded in three places that must agree (see Couplings). The hook
   *derives* it (`${FILE_PATH%/*}/.review-panel/${FILE_PATH##*/}`); the skill
   *writes* it; the README tells users to gitignore it.
4. **`hooks/proxy-ready.sh`** — the fail-fast preflight. Must fail CLOSED:
   only curl exit 7/28 means "down", but missing curl (exit 127) must also
   mean "not ready". If this fails open, every panel run turns into N opaque
   per-agent errors.
5. **The four `glm-review-*` agents' shared shape** — identical
   `tools: Read, Grep, Glob` line, "CHEAP, WIDE pass" framing, confidence
   rule, "GLM first-pass — confirm before acting" closer. The duplication is
   deliberate (see Landmines #4); drift-lock tests pin it.
6. **`hooks/hooks.json`** — one entry. If the matcher drifts from
   `Write|Edit`, the whole auto-panel feature silently stops firing.
7. **`scripts/release-gate.mjs` + `.github/workflows/release.yml`** — the
   release boundary. The gate refuses to ship unless
   `tag == plugin.json == package.json == newest CHANGELOG heading`, and emits
   the tag's CHANGELOG section as the release body (`--notes-out`). `release.yml`
   is the *only* place `gh release create` runs; it fires on `v*` tag push only.
   Note `.github/workflows/` is often write-protected for agents — expect to
   place workflow files by hand. Gate logic is drift-locked by
   `test/release-gate.test.js` against throwaway fixtures (so it survives every
   version bump); its `CHANGELOG_HEADING_RE`/`TAG_RE` are the single source of
   truth for both halves of the coupling.
8. **`.claude-plugin/marketplace.json`** — standalone-install fallback. Its
   plugin entry (`name` + `source: "./"`) must match `plugin.json`'s name, or
   `/plugin install cc-agents@cc-agents-plugin` won't resolve. Coupled by a
   `test/structure.test.js` drift-lock.

## Couplings — if you touch X, update Y

| You changed | You must also change |
|---|---|
| Marker dirname `.review-panel` | hook guard + hook marker-derivation, `skills/review-panel/SKILL.md`, README (2 mentions + gitignore advice), `test/structure.test.js` coupling tests, this file |
| Reviewer default model `glm-5.2[1m]` | README default, `test/structure.test.js` default-model test — and it must survive `set-model.sh`'s charset whitelist |
| Crawler default `glm-5-turbo` | README, structure test, `code-crawl` SKILL.md (names the tier twice) |
| Reviewer agent list (add/remove) | `REVIEWERS=` in set-model.sh, reviewer arrays in structure + set-model tests, README, review-panel SKILL step 1 |
| Version | `plugin.json` AND `package.json` (test enforces) + newest `## [x.y.z]` CHANGELOG heading (release-gate enforces at tag time) |
| Plugin name / repo-root layout | `.claude-plugin/marketplace.json` entry (`name` + `source: "./"`), `test/structure.test.js` marketplace test, README install block |
| Release gate coupling (tag/version/heading semantics) | `scripts/release-gate.mjs` (the `TAG_RE`/`CHANGELOG_HEADING_RE` logic) + `test/release-gate.test.js` + `release.yml` step name + this file |
| Skill knobs (N, lenses, 50-threshold, 150K shard, wave cap 6) | structure.test.js pins the literals — update both, and README where echoed |
| proxy probe semantics | `test/proxy-ready.test.js` + README "Hard dependency" section |

## Landmines (non-obvious decisions and WHY)

1. **The panel can trigger itself — two guards, both needed.** The run report
   basename inherits `-design.md`/`-plan.md` and sits under `specs/`, so it
   regex-matches as a spec → path guard `*/.review-panel/*`. Separately, the
   panel *appends Clarifications to the artifact itself*, which legitimately
   re-fires the hook → marker-exists check downgrades the suggestion. The
   skill writes the report (step 6) **before** the append (step 7) precisely
   so the marker exists when the hook re-fires. Do not reorder those steps.
2. **`awk -v` interprets backslash escapes.** A literal `\n` in a `-v` value
   becomes a real newline. That's why the id whitelist bans backslashes and
   why it's a bash `case`, not grep. There's a regression test with a live
   injection payload; leave it.
3. **`set -u` + empty arrays is fatal on bash 3.2 (stock macOS).** The
   `${arr[@]+"${arr[@]}"}` idiom in set-model.sh is not noise — plain
   `"${arr[@]}"` on an empty array aborts the script on macOS's
   `/bin/bash` 3.2. Same family of reasoning as proxy-ready.sh avoiding
   `timeout` (absent on macOS). Test on Linux, but write for bash 3.2.
4. **Reviewer duplication is deliberate.** Four near-identical reviewer agents
   instead of one parameterized agent: each gets a distinct `description:`
   (that's how the main model picks them) and can later get distinct focus
   lists. The rejected alternative — one agent with a "review as X" prompt —
   loads the choice onto the calling model, which is exactly what this plugin
   exists to avoid. The drift-locks keep the shared parts identical.
5. **The skills' quality gate is the SYNTHESIS, not the reviewers.** GLM
   reviewers over-flag; the 0–100 scoring + drop-below-50 in the *main* model
   is what makes output usable. If panel output gets noisy, tune the
   threshold/rubric in SKILL.md — don't fatten the reviewer prompts.
6. **`lastgood` is written before the file writes, atomically (temp+mv).**
   It once got truncated mid-write on a failed run, destroying `--revert`
   exactly when it was needed. Pre-validation of all target files happens
   before the snapshot; keep that order: shape → validate → probe → snapshot
   → two-pass write.
7. **Probes cost real money.** The liveness probe POSTs a 1-token completion
   through cc-proxy to Z.ai. Cheap but not free, and it can fail for
   quota/auth reasons that don't mean the id is wrong — hence `--no-probe`.
8. **`${CLAUDE_PLUGIN_ROOT}` availability inside skill *bodies* is an
   unverified assumption** (it is documented for hooks/commands). Both skills
   carry a fallback note telling the model where the script actually lives.
   Same caveat for `allowed-tools:` expansion in `commands/*.md`. If a user
   reports the preflight "failing" with *No such file or directory*, this is
   why — the proxy is probably fine.

## Playbooks

### Add a new glm-* agent
1. Copy the closest existing agent file; keep frontmatter keys
   `name/description/tools/model`. Default read-only: `tools: Read, Grep, Glob`
   (grant `Bash` only with a written justification in the CHANGELOG — prose
   "read-only shell" rules are NOT enforcement).
2. `description:` must say *when to use it* — that's the routing signal.
3. If it's a reviewer variant, it must satisfy the drift-locks (CHEAP-WIDE
   framing, confidence rule, first-pass closer, identical tools line) — run
   the tests, they'll tell you.
4. If set-model.sh should manage it, add it to `REVIEWERS` (or give it its own
   flag like `--crawler`) + tests + README.
5. Model id must be `glm-*` (cc-proxy routes by prefix) and pass the charset
   whitelist.

### Change what the panel does
Edit only the "Tunable knobs" section of `skills/review-panel/SKILL.md` for
tuning (N, lenses, thresholds). Structural changes: re-read Landmine #1 first;
never move the report-write after the artifact-append; keep every literal the
structure tests pin in sync.

### Release
1. Bump `plugin.json` + `package.json` together (test enforces), and make the
   `## [x.y.z]` entry the newest heading in `CHANGELOG.md` (Keep-a-Changelog
   style, compare links at the bottom). All three must equal the tag you'll cut.
2. Dry-run the gate locally: `node scripts/release-gate.mjs vX.Y.Z` — it must
   print `release gate OK`. `node --test && npm run lint` must be green (CI
   repeats both).
3. Merge to `main`, then push tag `vX.Y.Z`. `release.yml` re-runs the gate +
   full suite and publishes the GitHub release with the CHANGELOG section as its
   body. Nothing else runs `gh release create`; do not publish by hand.
   - The gate is *fail-closed*: a tag whose version doesn't match all three
     sources fails the build and no release is cut. Fix the version (or the tag)
     and re-tag.
   - `.github/workflows/` may be write-locked for agents — a human places/edits
     `release.yml`.

### Debug "the panel won't run"
In order: (1) is cc-proxy up — `bash hooks/proxy-ready.sh; echo $?`;
(2) did the hook fire — was the file under a `specs/`/`plans/` segment with
the right suffix?; (3) is there already a marker next to the artifact (hook
downgrades its suggestion); (4) `PROXY_PORT` mismatch between cc-proxy config
and the preflight's default 4000.

## Backlog (prioritized, with context)

1. **`glm-code-crawler` + `glm-bulk-reader` still carry `Bash`** constrained
   only by prose ("read-only shell"). Read/Grep/Glob likely suffice — the
   orchestrating skill does the sharding, not the agent. Kept in 0.2.0 because
   0.1.2 explicitly chose to keep it ("intentionally run read-only shell") and
   reversing a documented decision deserves its own change. Recommendation:
   remove Bash, run a real crawl to confirm nothing breaks, note it in the
   CHANGELOG, extend the no-Bash drift-lock to all seven agents.
2. **No marker staleness policy.** A one-line spec edit and a rewrite look the
   same to the hook once a marker exists. Option: compare mtimes (artifact
   newer than marker by >N minutes → full re-suggest). Do it in the hook, keep
   it advisory.
3. **No integration test of the hook through the real Claude Code hook
   runner** (payload shape is hand-mocked in tests). If Claude Code changes
   the PostToolUse payload schema, tests stay green while production breaks.
   Mitigation today: the hook exits silently on parse failure.
4. **`set-model.sh --revert` doesn't validate that lastgood paths still
   exist** — a moved/renamed agent file makes revert fail with the generic
   "render failed" message. Low stakes (originals untouched), but a
   friendlier per-file error would help.
5. **Skills trust the operator model to enforce the wave cap / shard budget**
   (prose-only). If code-crawl misbehaves in practice, the fix is a small
   sharding script under `scripts/` that emits the shard lists, moving that
   judgment into shell.
