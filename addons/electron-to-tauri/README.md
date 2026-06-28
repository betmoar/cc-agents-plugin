# Electron to Tauri Migration

> Addon package for **cc-agents**. A project-specific dev team (role personas + phase workflows) that migrates an Electron desktop app to Tauri.
>
> **1:1 implementation** of the offline-pixel guide: <https://offline-pixel.github.io/migration-guides/electron-to-tauri-migration/>

A comprehensive guide to migrating Electron desktop apps to Tauri, reducing binary size by 90% and memory usage by 85%.

- **Estimated timeline:** 4-6 months
- **Primary role:** `tauri-engineer`

## Install into a project

```
/cc-agents:addon install electron-to-tauri
```

This copies the team into the project's `./.claude/`:

| Component | What lands in `.claude/` |
|---|---|
| Agents (personas) | `migration-lead`, `tauri-engineer`, `qa-engineer` |
| Skills (workflows) | `electron-to-tauri` (orchestrator) + `phase-1-foundation` · `phase-2-noncritical-features` · `phase-3-core-features` · `phase-4-final-cutover` |
| Command | `/migrate` |

Start with `/migrate` or the `electron-to-tauri` skill. Remove with `/cc-agents:addon remove electron-to-tauri`.

---

## Executive Summary

A productivity software company's Electron app had a 120MB installer, 250MB memory usage, and an 8-second launch time. Over 5 months, they migrated to Tauri using a **side-by-side** strategy, reducing the installer to 12MB (90% smaller), memory to 35MB (86% reduction), and launch time to 1.2 seconds (85% faster). This guide covers frontend migration (React/Svelte unchanged), backend rewrite (Node.js → Rust), and native API replacement.

- Frontend code (HTML/CSS/JS) can be reused with minimal changes.
- Node.js backend must be rewritten in Rust (IPC patterns change).
- Tauri's system WebView eliminates the Chromium bundle (90% size reduction).
- Side-by-side migration allows gradual feature porting.

## Why Migrate from Electron to Tauri

The Electron app was too heavy — users with 4GB RAM laptops experienced crashes, and the 120MB download size hurt conversion rates. Electron's bundled Chromium made optimization impossible.

- 120MB installer size (30% download abandonment on slow connections).
- 250MB baseline memory (crashes on 4GB machines, 15% of users).
- 8-second cold start (user frustration, 1-star reviews).
- Unable to reduce size further (Electron bundles Chromium).

## Electron to Tauri Readiness

The team spent 1 month preparing: auditing Electron APIs, learning Rust basics, setting up the Tauri project, and creating migration scripts for frontend assets.

- Complete inventory of Electron APIs used (`ipcRenderer`, native modules).
- Rust training for the frontend team (2 weeks).
- Tauri project setup with Vite/Rollup.
- Frontend build pipeline compatible with Tauri.
- Side-by-side launcher script (Electron + Tauri together).

## Electron App Assessment

The app had 50K lines of TypeScript, 30 renderer processes, 20 Node.js native modules, and used Electron's IPC heavily. The biggest pain points were the file system operations (Node.js `fs`) and system tray integration.

**Technical Debt**
- 120MB installer (mostly Chromium).
- 30 renderer processes (memory fragmentation).
- Node.js native modules (compilation issues on Linux).
- Electron version upgrades breaking changes.

**Risks**
- Rust learning curve (frontend team with no systems experience).
- IPC pattern differences (Electron `ipcRenderer` vs Tauri `invoke`).
- Native module replacement (no direct equivalent for some Node.js modules).
- Window management complexity (Tauri's different model).

## Target Tauri Architecture

The target was Tauri with a React frontend, a Rust backend for system operations, and a single window manager.

- Tauri core (Rust, 5MB).
- System WebView (provided by OS, no bundle).
- React frontend (same as Electron).
- Rust commands (file system, system tray, notifications).
- Event system (Tauri's emit/listen).
- SQLite for local data (Tauri's built-in).

## 5-Month Electron to Tauri Migration

1. **Phase 1: Foundation (Month 1)** — Set up Tauri project, migrated frontend build pipeline, trained team on Rust.
2. **Phase 2: Non-critical Features (Month 2)** — Migrated settings and about page — proved Tauri worked, zero risk.
3. **Phase 3: Core Features (Months 3-4)** — Migrated file system operations, system tray, notifications — 80% of functionality.
4. **Phase 4: Final Cutover (Month 5)** — Migrated remaining features, removed Electron entirely.

## Local Data Migration

Electron used LevelDB for local storage; Tauri uses SQLite. The team migrated user data automatically on first launch.

- Automatic migration on first Tauri launch (detect Electron data).
- SQLite schema design (LevelDB key-value → relational).
- Data validation after migration (checksum verification).
- Keep Electron data as backup for 30 days.

## Node.js to Rust Rewrite

Electron's Node.js backend was rewritten in Rust, focusing on IPC command equivalents for each feature.

- `ipcRenderer.invoke` → Tauri command (Rust function).
- Node.js `fs` → `std::fs` or `tokio::fs`.
- Node.js native modules → Rust crates (same or better functionality).
- Event emitter → Tauri's emit/listen API.

## Testing Tauri vs Electron

The team ran side-by-side for 2 months, comparing outputs and performance metrics.

- Functional tests (same inputs → same outputs).
- Memory usage comparison (Tauri 85% less).
- Launch time measurement (Tauri 6x faster).
- Installer size comparison (Tauri 90% smaller).

## Rollback to Electron

The side-by-side launcher allowed toggling between Electron and Tauri versions.

- Launcher starts both versions, but only shows one UI.
- Toggle switches which UI is visible (data shared).
- If Tauri fails, the user can switch back to Electron.
- Remove Electron after 2 months of zero rollbacks.

## Common Electron to Tauri Migration Mistakes

**Trying to use Node.js modules directly in Tauri**
- *Impact:* Build fails, modules not compatible.
- *Prevention:* Rewrite Node.js functionality in Rust before migration.

**Not testing on Windows/macOS/Linux**
- *Impact:* Tauri works differently per OS (WebView differences).
- *Prevention:* CI testing on all three platforms.

**Ignoring Tauri's security model**
- *Impact:* Rust commands exposed globally (security risk).
- *Prevention:* Tauri's allowlist and command scoping.

**Rewriting frontend (unnecessary)**
- *Impact:* 6-month delay, team burnout.
- *Prevention:* Keep frontend unchanged, only replace backend.

## Migration Cost Analysis

Migration cost $150K over 5 months (3 engineers × 5 months). ROI: 90% smaller installer improved conversion 25%, lower memory reduced support tickets 40%.

- Engineering: 3 engineers × 5 months = 15 person-months ($120k).
- Rust training for 5 frontend engineers ($20k).
- Testing infrastructure (3 OS platforms) ($10k).
- Migration tools and scripts ($5k).

## Migration Success Metrics

| Metric | Before | After | Change |
|---|---|---|---|
| Installer size | 120MB | 12MB | 90% reduction |
| Memory usage (idle) | 250MB | 35MB | 86% reduction |
| Launch time (cold) | 8s | 1.2s | 85% improvement |
| Download abandonment | 30% | 5% | 83% reduction |
| App store rating | 3.2 | 4.7 | — |

## Who Should Lead Electron to Tauri Migration

**Recommended Roles**
- Lead Desktop Engineer (5+ years experience) → `migration-lead`
- Rust Developer (or frontend engineer learning Rust) → `tauri-engineer` *(primary)*
- QA Engineer (cross-platform testing) → `qa-engineer`

**Required Experience**
- 2+ years Electron development.
- Basic Rust knowledge (or strong systems programming background).
- Cross-platform desktop development (Windows, macOS, Linux).
- IPC and event-driven architecture.

## Frequently Asked Questions

**Can I reuse my React/Angular/Vue frontend code?**
Yes — Tauri uses the same frontend frameworks as Electron. Your HTML/CSS/JS works unchanged.

**What about Electron-specific APIs like `desktopCapturer`?**
Tauri has equivalents for most Electron APIs. For missing ones, you can write Rust bindings to system APIs.

**How hard is Rust for frontend developers?**
2-4 weeks learning curve for basic Rust. Tauri's command pattern limits Rust exposure to small functions.
