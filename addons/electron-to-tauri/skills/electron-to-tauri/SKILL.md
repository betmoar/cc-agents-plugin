---
name: electron-to-tauri
description: Orchestrate a full Electron→Tauri migration as a dev team — the entry point for the electron-to-tauri addon package. Use when migrating an Electron desktop app to Tauri, or when the user asks to plan/run the migration. Convenes the migration-lead, tauri-engineer, and qa-engineer personas across a 1-month prep + 4-phase, ~5-month side-by-side plan. 1:1 implementation of the offline-pixel Electron-to-Tauri migration guide.
---

# Electron → Tauri Migration (team orchestrator)

This is the entry skill for the **electron-to-tauri** addon package: a project-specific dev team that migrates an Electron app to Tauri using a **side-by-side** strategy. You (the main model) orchestrate the team and walk the phases; the per-phase detail lives in the four `phase-*` skills.

**Outcome targets (reference, from the source migration):** installer 120MB→12MB (90%↓), idle memory 250MB→35MB (86%↓), cold launch 8s→1.2s (85%↓), over ~5 months with 3 engineers.

## The team (personas / roles)
- **migration-lead** — Lead Desktop Engineer. Plan, assessment, target architecture, side-by-side strategy, go/no-go cutover, rollback decision, cost & metric tracking.
- **tauri-engineer** — *primary role*; Rust Developer. Node.js→Rust rewrite (`invoke` commands, `fs`, native modules, emit/listen), LevelDB→SQLite data migration, security allowlist.
- **qa-engineer** — QA Engineer. Cross-platform CI (Win/macOS/Linux), parity tests, memory/launch/installer benchmarks, rollback verification, success metrics.

Dispatch these as subagents (one per role) for the work each owns; the migration-lead sequences and gates.

## Non-negotiable principles
1. **Keep the frontend.** React/Svelte/Vue/Angular + HTML/CSS/JS are reused with minimal changes. Rewriting the frontend = 6-month delay + burnout. **Forbidden.**
2. **Rewrite only the backend** (Node.js → Rust); IPC changes from `ipcRenderer` to `invoke`.
3. **Side-by-side, gradual.** One launcher runs both; a toggle picks the visible UI; data is shared. Remove Electron only after **2 months of zero rollbacks**.
4. **Cross-platform always.** Test on Windows, macOS, Linux — WebView differs per OS.
5. **Respect Tauri's security model** — allowlist + command scoping; never expose commands globally.

## The plan (run in order)
- **Prep (Month 1):** API inventory (`ipcRenderer`, native modules), Rust training (2 weeks), Tauri project setup (Vite/Rollup), Tauri-compatible build pipeline, side-by-side launcher. → folded into `phase-1-foundation`.
- **Phase 1 — Foundation (Month 1):** `phase-1-foundation` skill.
- **Phase 2 — Non-critical features (Month 2):** `phase-2-noncritical-features` skill.
- **Phase 3 — Core features (Months 3-4):** `phase-3-core-features` skill.
- **Phase 4 — Final cutover (Month 5):** `phase-4-final-cutover` skill.

## Procedure
1. **Assess (migration-lead).** Inventory: LOC, renderer count, Node native modules, IPC usage. Flag the usual pain points — file system ops (Node `fs`) and system tray. Build the risk register: Rust learning curve, IPC differences, native-module replacement, window-management model. Define the target architecture (Tauri core ~5MB · system WebView · unchanged frontend · Rust commands · emit/listen · SQLite).
2. **Walk the phases.** For each phase, invoke its skill, gate on its exit criteria, and do not advance until met.
3. **Verify continuously (qa-engineer).** Parity + benchmarks on all three OSes at every milestone; track the rollback count.
4. **Report against metrics.** At each phase boundary, report Electron baseline vs Tauri actual vs target.

## Avoid the common mistakes
- Using Node.js modules directly in Tauri → build fails. Rewrite in Rust first.
- Not testing on all three OSes → WebView differences bite. CI on Win/macOS/Linux.
- Ignoring Tauri's security model → global command exposure. Use the allowlist + scoping.
- Rewriting the frontend → unnecessary 6-month delay. Keep it unchanged.

End each phase with a status line: phase, exit criteria met (evidence), metrics trend, rollback count. This is a guided migration — confirm scope and cutover go/no-go with the user.
