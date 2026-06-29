# Addon packages

**Addon packages** are project/type-specific *skillsets* — each one is a small **dev team**: a set of role **personas** (agents), **phase workflows** (skills), and **orchestration commands** that work together to carry a particular kind of project from start to finish.

Packages are distributed through a **central catalog** — a separate git repo (e.g. `betmoar/cc-agents-addons`) that you register once. Installing a package copies its components into a consuming project's `./.claude/` directory so Claude Code discovers the team **for that project only** ("skills, from a central catalog"). The `addons/` directory in *this* repo is an **offline seed / fallback** so the tooling works before any central catalog is configured; it is also where new packages are prototyped before they move to the catalog repo.

> **Roadmap.** A native Claude Code **plugin-marketplace** path (`/plugin marketplace add …` → `/plugin install …@cc-agents-addons`, with per-project `enabledPlugins`) is planned as an additional, first-class distribution channel. The copy-into-`.claude/` installer below is the current path and will coexist with it.

```
addons/
  <package-name>/
    addon.json                 # manifest: roles, phases, components, metadata
    README.md                  # the package's process / docs
    agents/<role>.md           # role personas (the dev team)
    skills/<phase>/SKILL.md     # one workflow skill per phase (+ an orchestrator)
    commands/<cmd>.md          # orchestration command(s)
```

## Using a package

Driven by the `/cc-agents:addon` command (wrapping `scripts/addon.sh`):

```
# one-time: register the central catalog (defaults to betmoar/cc-agents-addons)
/cc-agents:addon catalog add                 # or: catalog add <owner/repo | git-url>
/cc-agents:addon catalog update              # git-pull the catalog(s)
/cc-agents:addon catalog list                # show configured catalogs

# packages
/cc-agents:addon list                        # packages across all catalogs (+ source, installed)
/cc-agents:addon info electron-to-tauri      # show a package's manifest
/cc-agents:addon install electron-to-tauri   # copy into ./.claude/
/cc-agents:addon remove electron-to-tauri    # uninstall (exact, via tracked manifest)
```

- **Resolution.** Packages resolve from central catalogs first, then the bundled `addons/` fallback — so a centrally-published package overrides the local seed.
- **Catalog cache.** Central catalogs are cloned under `$XDG_CACHE_HOME/cc-agents/catalogs` (override with `CC_AGENTS_CATALOG_CACHE`). A catalog repo may keep packages at its root or under `addons/`.
- **Target.** Installs go to `$CLAUDE_PROJECT_DIR/.claude` (or `$PWD/.claude`); override with `CC_AGENTS_TARGET`.
- **Conflicts.** Install refuses to overwrite existing files; re-run with `--force` to overwrite.
- **Tracking.** Each install records the exact files it wrote (and the source catalog path) under `.claude/.cc-agents-addons/<name>.files`, so `remove` deletes precisely what it added (and prunes emptied directories).

### Consuming-project `.gitignore`

Installed addon files are copies that live in the project's `.claude/`; commit them if you want the team versioned with the project. The install-tracking manifests are runtime state — add this to the project's `.gitignore` if you'd rather not commit them:

```gitignore
.claude/.cc-agents-addons/
```

## Available packages

| Package | What it does | Roles | Timeline |
|---|---|---|---|
| [`electron-to-tauri`](electron-to-tauri/) | Migrate an Electron desktop app to Tauri (side-by-side, frontend kept, Node→Rust). 1:1 of the offline-pixel guide. | `migration-lead`, `tauri-engineer`, `qa-engineer` | 4-6 months |

## Authoring a new package

1. Create `addons/<name>/` with an `addon.json` manifest (see [`electron-to-tauri/addon.json`](electron-to-tauri/addon.json) for the shape).
2. Add the team:
   - **Personas** → `agents/*.md`. Each is a role with a focused system prompt. Required frontmatter: `name`, `description`. They inherit the session model (omit `model`) so they run on the strong model for real work — unlike the core `glm-*` review agents.
   - **Phase workflows** → `skills/<phase>/SKILL.md`. One per phase, plus an **orchestrator** skill (named after the package) that sequences them and convenes the personas. Required frontmatter: `name`, `description`.
   - **Commands** → `commands/*.md` for entry points.
3. List every component under the manifest's `components` block so it's documented and testable.
4. Add a row to the table above.

The package is then installable with `/cc-agents:addon install <name>`.
