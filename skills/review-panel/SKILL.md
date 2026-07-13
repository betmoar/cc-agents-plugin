---
name: review-panel
description: Use when a spec or plan has just been written or when the user asks for a second-eyes review of one — convenes a panel of N parallel GLM reviewers, each through a distinct lens, then synthesizes their findings into one scored report. Triggered by the cc-agents PostToolUse hook after a *-design.md (under specs/) or *-plan.md write, or invoked directly. Requires cc-proxy running.
---

# Review Panel

Convene a multi-lens GLM review panel over a spec or plan and synthesize one report. You (the main model) orchestrate — GLM agents cannot fan out themselves.

## Tunable knobs (edit here to retune the panel)

- **N = 3** parallel reviewers.
- **Lenses** (one per dispatch):
  - **lens A — ambiguity & completeness:** undefined terms, missing cases, error paths, non-functional requirements.
  - **lens B — contradictions & feasibility:** internal conflicts; every load-bearing claim checked against the actual code as `path:line`.
  - **lens C — testability:** every requirement's observable acceptance criterion.
- **Synthesis drop threshold:** discard any finding scored **< 50**.
- **Clarify phase:** the `should-clarify` bucket → `AskUserQuestion` (≤4 per round, top-scored first); answers appended to the artifact as a `## Clarifications` section (append-only, never rewrite the body).
- **Run report (marker):** `docs/superpowers/specs/.review-panel/<artifact-basename>.md` — a full per-run record (lenses, per-finding scores + buckets, asked+answers, per-agent tokens, verdict). This file IS the marker; its presence means the panel ran.

## Procedure

1. **Pick the reviewer** (two-way map):
   - a spec (`*-design.md`) or a plan (`*-plan.md`) → `glm-review-design`
   - code, a diff, or an implementation-vs-spec check → `glm-review-code`

2. **Preflight: is the proxy up?** Run:

   ```bash
   bash "${CLAUDE_PLUGIN_ROOT}/hooks/proxy-ready.sh"
   ```

   If it exits non-zero, STOP and tell the user "cc-proxy is not running — start it, then re-run the panel." Do not dispatch agents against a down proxy.

3. **Dispatch N reviewers in parallel**, one Agent call per lens, in a single message. Each call uses the matching reviewer agent and a prompt of the form:

   > Review ONLY through **lens B — contradictions & feasibility**. Ignore the other dimensions your instructions mention; another reviewer covers them. Target: `<artifact path>`. [paste or point to the artifact]. Check every load-bearing claim against the actual code and cite `path:line`.

   Use the lens A / B / C definitions above verbatim so the three passes are genuinely distinct. (If a reviewer ignores the narrowing and returns its full default review, that is acceptable — worst case is overlap the synthesis dedups — but prefer the narrowed prompt.)

4. **Synthesize (you, the strong model).** Collect the three reports. For each distinct finding, score 0–100 for "is this real": 0 = false positive · 25 = maybe · 50 = real but minor · 75 = real and important · 100 = certain. **Drop everything below 50.** Dedup overlapping findings across lenses. Group the survivors:
   - **must-resolve** (≥ 75)
   - **should-clarify** (60–74)
   - **consider** (50–59)

5. **Clarify (interactive).** The `should-clarify` (60–74) findings ARE the open questions — they are the ambiguous/underspecified items by definition. (`must-resolve` are contradictions/bugs to *fix*, not "what do you want?" choices; `consider` are minor. Neither is asked.)

   - If the `should-clarify` bucket is **empty**, skip this step entirely — go to step 6.
   - Otherwise turn each `should-clarify` finding into an `AskUserQuestion` item: the finding's open question as the `question`, plus 2–4 concrete options derived from the finding's own suggested directions (the tool always adds "Other"). Carry the finding's lens in the question text.
   - **Cap: ≤4 questions per round.** `AskUserQuestion` allows at most 4. Ask the top 4 by score in **one** call. If more remain, do not chain rounds — note the leftover count in the step-6 report. One round, not an interrogation.
   - After answers return, **append** (never rewrite) to the **reviewed artifact** (its own path, at end of file):

     ```
     ## Clarifications (YYYY-MM-DD)
     - **Q (lens A):** <question> → **A:** <user's answer>
     ```

6. **Write the run report** (this file IS the panel-ran marker — its presence means the panel ran). Create `docs/superpowers/specs/.review-panel/<artifact-basename>.md`:

   ```
   # Panel run — <artifact-basename>  (<YYYY-MM-DD HH:MM>)
   - **artifact:** <path>     **reviewer:** <reviewer>     **N:** 3
   - **lenses:** A ambiguity · B contradictions/feasibility · C testability
   - **per-lens:** A → 4 findings · B → 2 · C → 3   (tokens: A ~Xk · B ~Yk · C ~Zk)
   - **buckets:** must-resolve 1 · should-clarify 3 · consider 2 · dropped <50: 4
   - **asked:** 3 should-clarify → answers in the artifact's Clarifications section
   - **verdict:** <one line>

   ## Findings
   ### must-resolve
   - [score] <finding> (lens B)
   ### should-clarify  (→ asked)
   - [score] <finding> → **A:** <answer>
   ### consider
   - [score] <finding>
   ```

   Per-agent token counts come from each Agent result's `<usage>subagent_tokens</usage>` block (the main agent receives it). Record them if present; **omit the tokens line if not — never fabricate**.

7. **Report** to the user: the must-resolve + consider findings (and any un-asked should-clarify, with the leftover count), then a one-line pointer — "N clarifications recorded → `<artifact>`; full run report → `<marker path>`". Note this was a GLM first pass — confirm before acting.
