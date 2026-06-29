---
name: phase-1-foundation
description: Phase 1 (Month 1) of the Electron→Tauri migration — Foundation. Use to do the 1-month prep + foundation work: inventory Electron APIs, Rust training, Tauri project setup (Vite/Rollup), a Tauri-compatible frontend build pipeline, and the side-by-side launcher. Led by migration-lead, executed with tauri-engineer.
---

# Phase 1 — Foundation (Month 1)

Set up the Tauri project, migrate the frontend build pipeline, and train the team on Rust. This phase also covers the **1 month of preparation** that precedes the rest of the migration. Lead: **migration-lead**; hands-on: **tauri-engineer**.

## Goal
A working Tauri shell that loads the **unchanged** frontend, a build pipeline that produces it, a team that can write basic Rust, and a side-by-side launcher — all at **zero risk** to the shipping Electron app.

## Readiness checklist (the prep)
- [ ] **Complete inventory of Electron APIs used** — every `ipcRenderer` channel and every Node.js native module. This is the migration surface area.
- [ ] **Rust training for the frontend team (2 weeks)** — enough Rust to write `#[tauri::command]` functions; Tauri keeps Rust exposure to small functions, so 2-4 weeks suffices.
- [ ] **Tauri project setup with Vite/Rollup.**
- [ ] **Frontend build pipeline compatible with Tauri** — the same frontend, built to load in Tauri's WebView.
- [ ] **Side-by-side launcher script** — runs Electron + Tauri together (foundation for gradual porting and rollback).

## Assessment to produce (migration-lead)
Quantify the app: lines of TypeScript, renderer-process count, Node.js native modules, IPC usage. Record the **technical debt** (Chromium-heavy installer, renderer memory fragmentation, native-module compilation issues on Linux, Electron upgrade breakage) and the **risk register** (Rust learning curve, `ipcRenderer` vs `invoke`, native modules with no equivalent, Tauri's different window model).

## Target architecture to lock in
Tauri core (Rust, ~5MB) · system WebView (provided by OS, no bundle) · existing frontend unchanged · Rust commands (file system, system tray, notifications) · Tauri emit/listen events · SQLite for local data.

## Steps
1. **migration-lead** runs the assessment and writes the API inventory + risk register.
2. **tauri-engineer** scaffolds the Tauri project (Vite/Rollup) and wires the existing frontend to build into Tauri's WebView — no frontend rewrites.
3. Stand up the **side-by-side launcher** (Electron + Tauri together, one visible UI, shared data).
4. Kick off Rust training in parallel.

## Exit criteria
- Tauri shell launches the existing frontend on Windows, macOS, and Linux.
- Build pipeline produces the Tauri app reproducibly.
- Side-by-side launcher runs both apps and can toggle the visible UI.
- API inventory + risk register reviewed by the team.

Do not migrate any real feature yet — that starts in Phase 2.
