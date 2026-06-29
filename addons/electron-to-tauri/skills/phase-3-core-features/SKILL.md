---
name: phase-3-core-features
description: Phase 3 (Months 3-4) of the Electron→Tauri migration — Core features. Use to migrate ~80% of functionality — file system operations, system tray, notifications — including the full Node.js→Rust rewrite and the LevelDB→SQLite local-data migration. The heaviest phase. Executed by tauri-engineer, verified by qa-engineer.
---

# Phase 3 — Core features (Months 3-4)

Migrate **file system operations, system tray, and notifications** — about **80% of the app's functionality**. This is the heaviest phase: it contains the bulk of the Node.js→Rust rewrite and the local-data migration. Hands-on: **tauri-engineer**; verification: **qa-engineer**.

## Node.js → Rust rewrite (the four mappings)
- **`ipcRenderer.invoke` → Tauri command** — Rust `#[tauri::command]` fn, registered in `tauri::generate_handler!`, called from the frontend via `invoke`. The most time-consuming work is moving Node-on-frontend logic behind `invoke`; after that it's mostly mechanical.
- **Node.js `fs` → `std::fs` or `tokio::fs`** — sync → `std::fs`, async → `tokio::fs`. (File system ops are a known top pain point — expect volume here.)
- **Node.js native modules → Rust crates** — same or better functionality; for modules with no equivalent, write Rust bindings to the system API (highest risk — surface early to migration-lead).
- **Event emitter → Tauri emit/listen** — replace `EventEmitter` / `ipcRenderer.on` with Tauri's event system.

System tray and notifications become Rust commands / Tauri APIs (system tray is the other known pain point — Tauri's model differs from Electron's).

## Local data migration (LevelDB → SQLite)
Electron used LevelDB; Tauri uses SQLite. Migrate **automatically on first Tauri launch**:
1. Detect existing Electron data.
2. Design a SQLite schema (LevelDB key-value → relational).
3. Validate after migration with **checksum verification**.
4. Keep the Electron data as a backup for **30 days**.

## Security
Every new command goes through Tauri's **allowlist** and is **scoped** — file system, tray, and notification commands must not be globally exposed.

## Steps
1. **tauri-engineer** ports file system ops, system tray, and notifications using the four mappings; rewrite native-module functionality in Rust *before* wiring it in.
2. Implement the LevelDB→SQLite first-launch migration with checksum validation + 30-day backup.
3. Run everything side-by-side so users can fall back during the port.
4. **qa-engineer** verifies on Windows/macOS/Linux: functional parity (same inputs→outputs), data-migration checksums, and the benchmark trend (memory/launch/size).

## Exit criteria
- File system ops, system tray, notifications work in Tauri with parity on all three OSes.
- Data migrates correctly on first launch (checksums pass; backup retained).
- No native Node module is loaded directly in Tauri (all rewritten in Rust).
- ~80% of functionality now runs on Tauri; rollbacks remain at zero.
