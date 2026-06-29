---
name: phase-2-noncritical-features
description: Phase 2 (Month 2) of the Electron→Tauri migration — Non-critical features. Use to migrate low-risk features (settings page, about page) first to prove Tauri works end-to-end at zero risk before touching core functionality. Executed by tauri-engineer, verified by qa-engineer.
---

# Phase 2 — Non-critical features (Month 2)

Migrate **settings and the about page** — low-stakes features whose only job here is to **prove Tauri works** end-to-end (frontend ↔ Rust command ↔ data) at **zero risk**. Hands-on: **tauri-engineer**; verification: **qa-engineer**.

## Why these features
Settings and about are non-critical: if they break during the side-by-side period, users simply toggle back to Electron. They exercise the full Tauri path (frontend, an `invoke` command, persisted state) without risking core functionality.

## Steps
1. **tauri-engineer** ports the settings + about features:
   - Replace any `ipcRenderer.invoke` calls with Tauri commands (`#[tauri::command]` registered in `tauri::generate_handler!`, called via `invoke`).
   - Replace any Node `fs` reads/writes with `std::fs` / `tokio::fs`.
   - Keep the frontend components unchanged — only the backend calls change.
   - Scope each new command via Tauri's allowlist; do not expose globally.
2. Run both features through the side-by-side launcher so users can compare and fall back.
3. **qa-engineer** verifies:
   - **Functional parity** — same inputs → same outputs vs Electron, on Windows, macOS, and Linux.
   - First read on the benchmarks (memory / launch / size) to confirm the trend.

## Exit criteria
- Settings + about work in Tauri with parity to Electron on all three OSes.
- The full frontend→command→data round trip is proven.
- Zero rollbacks attributable to these features.

This phase de-risks everything after it: once Tauri is proven on real (if minor) features, Phase 3 takes on the core.
