---
name: phase-4-final-cutover
description: Phase 4 (Month 5) of the Electron→Tauri migration — Final cutover. Use to migrate the remaining features, validate ~2 months of side-by-side running with zero rollbacks, and then remove Electron entirely. Decision owned by migration-lead; verified by qa-engineer.
---

# Phase 4 — Final cutover (Month 5)

Migrate the **remaining features** and **remove Electron entirely**. The cutover is a decision, not just code: it happens only when the evidence says Tauri is safe to stand alone. Decision: **migration-lead**; verification: **qa-engineer**; remaining ports: **tauri-engineer**.

## Steps
1. **tauri-engineer** ports the remaining features using the same four mappings (`invoke` commands, `fs`→Rust, native modules→crates, emit/listen), each scoped via the allowlist.
2. **qa-engineer** runs the final verification across Windows/macOS/Linux:
   - Functional parity for every remaining feature (same inputs → same outputs).
   - Final benchmarks: memory (~85% less), launch time (~6x faster), installer size (~90% smaller).
3. **migration-lead** confirms the **rollback gate**: the team ran side-by-side for ~2 months; remove Electron only after **2 months of zero rollbacks**.
4. **Cutover:** remove Electron from the build and the launcher. The side-by-side launcher's toggle is retired once Electron is gone.

## Rollback safety (until cutover)
Until Electron is removed, the side-by-side launcher remains the safety net: it starts both versions, shows one UI, toggles between them with shared data, and lets a user switch back to Electron if Tauri fails.

## Exit criteria
- 100% of features run on Tauri with parity on all three OSes.
- Final success metrics confirmed against targets:
  - Installer 120MB → 12MB (90%↓)
  - Idle memory 250MB → 35MB (86%↓)
  - Cold launch 8s → 1.2s (85%↓)
- 2 months of zero rollbacks recorded.
- Electron removed from the codebase, build, and launcher.

Migration complete: the app ships as Tauri-only.
