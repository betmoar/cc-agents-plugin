---
description: Start or continue the Electron→Tauri migration — convene the dev team (migration-lead, tauri-engineer, qa-engineer) and run the side-by-side, 4-phase plan via the electron-to-tauri orchestrator skill.
argument-hint: "[assess | phase-1 | phase-2 | phase-3 | phase-4 | status]"
---

Drive the **Electron → Tauri migration** for this project. Use the `electron-to-tauri` orchestrator skill as the entry point and the `phase-*` skills for per-phase detail. Convene the team personas as subagents for the work each owns:

- **migration-lead** — assessment, plan/sequencing, target architecture, cutover go/no-go, rollback decision, metric tracking.
- **tauri-engineer** — Node.js→Rust rewrite (`invoke` commands, `fs`, native modules, emit/listen), LevelDB→SQLite data migration, security allowlist.
- **qa-engineer** — cross-platform CI, parity tests, memory/launch/installer benchmarks, rollback verification.

Interpret `$ARGUMENTS`:
- *(empty)* or `status` → summarize where the migration stands and what the next phase is.
- `assess` → run the migration-lead's assessment (API inventory, risk register, target architecture).
- `phase-1`..`phase-4` → run that phase's skill, gate on its exit criteria, and report metrics vs targets.

Hold the non-negotiables: keep the frontend unchanged, rewrite only the backend, migrate side-by-side, test on Windows/macOS/Linux, and honor Tauri's security model. Confirm scope and cutover go/no-go with the user before irreversible steps (e.g. removing Electron).
