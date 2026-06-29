import { strict as assert } from "node:assert";
import { describe, it, before, after } from "node:test";
import { execFileSync } from "node:child_process";
import {
  readFileSync, readdirSync, existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ADDONS = "addons";
const PKG = "electron-to-tauri";
const PKG_DIR = `${ADDONS}/${PKG}`;
const SCRIPT = "scripts/addon.sh";

const run = (args, env = {}) =>
  execFileSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });

describe("addons catalog", () => {
  it("has an addons/README.md describing the package system", () => {
    const src = readFileSync(`${ADDONS}/README.md`, "utf8");
    assert.match(src, /addon package/i);
    assert.match(src, /\.claude\//);
  });
});

describe("electron-to-tauri manifest", () => {
  const manifest = () =>
    JSON.parse(readFileSync(`${PKG_DIR}/addon.json`, "utf8"));

  it("is valid JSON with required metadata", () => {
    const m = manifest();
    assert.equal(m.name, "electron-to-tauri");
    assert.ok(m.title && m.description);
    assert.match(m.version, /^\d+\.\d+\.\d+$/);
    assert.equal(m.primaryRole, "tauri-engineer");
    assert.equal(m.estimatedTimeline, "4-6 months");
  });

  it("declares the three roles and the primary among them", () => {
    const names = manifest().roles.map((r) => r.name);
    for (const r of ["migration-lead", "tauri-engineer", "qa-engineer"]) {
      assert.ok(names.includes(r), `missing role ${r}`);
    }
    assert.ok(names.includes(manifest().primaryRole));
  });

  it("declares the four migration phases", () => {
    const ids = manifest().phases.map((p) => p.id);
    for (const p of [
      "phase-1-foundation", "phase-2-noncritical-features",
      "phase-3-core-features", "phase-4-final-cutover",
    ]) {
      assert.ok(ids.includes(p), `missing phase ${p}`);
    }
  });

  it("every declared component file/dir exists on disk", () => {
    const m = manifest();
    for (const a of m.components.agents) assert.ok(existsSync(`${PKG_DIR}/${a}`), a);
    for (const s of m.components.skills) {
      assert.ok(existsSync(`${PKG_DIR}/${s}/SKILL.md`), `${s}/SKILL.md`);
    }
    for (const c of m.components.commands) assert.ok(existsSync(`${PKG_DIR}/${c}`), c);
  });

  it("the entry skill exists and is the orchestrator", () => {
    const m = manifest();
    assert.equal(m.entrySkill, "electron-to-tauri");
    assert.ok(existsSync(`${PKG_DIR}/skills/${m.entrySkill}/SKILL.md`));
  });
});

describe("electron-to-tauri personas", () => {
  it("each agent has name + description frontmatter and no glm/proxy dependency", () => {
    for (const f of readdirSync(`${PKG_DIR}/agents`).filter((n) => n.endsWith(".md"))) {
      const src = readFileSync(`${PKG_DIR}/agents/${f}`, "utf8");
      assert.ok(src.startsWith("---"), `${f} missing frontmatter`);
      assert.match(src, /\nname:\s*\S+/, `${f} missing name`);
      assert.match(src, /\ndescription:\s*\S+/, `${f} missing description`);
      // standalone personas: must not pin a glm-* model (those need cc-proxy)
      assert.doesNotMatch(src, /\nmodel:\s*glm-/, `${f} should not pin a glm model`);
    }
  });
});

describe("electron-to-tauri phase skills", () => {
  const phases = [
    "phase-1-foundation", "phase-2-noncritical-features",
    "phase-3-core-features", "phase-4-final-cutover",
  ];
  it("each phase skill has frontmatter and exit criteria", () => {
    for (const p of phases) {
      const src = readFileSync(`${PKG_DIR}/skills/${p}/SKILL.md`, "utf8");
      assert.match(src, /\nname:\s*/, `${p} missing name`);
      assert.match(src, /\ndescription:\s*\S+/, `${p} missing description`);
      assert.match(src, /Exit criteria/i, `${p} missing exit criteria`);
    }
  });
  it("the orchestrator names all three personas and the side-by-side strategy", () => {
    const s = readFileSync(`${PKG_DIR}/skills/${PKG}/SKILL.md`, "utf8");
    for (const r of ["migration-lead", "tauri-engineer", "qa-engineer"]) {
      assert.match(s, new RegExp(r), `orchestrator missing ${r}`);
    }
    assert.match(s, /side-by-side/i);
  });
});

describe("addon.sh installer", () => {
  let target;
  before(() => { target = mkdtempSync(join(tmpdir(), "cc-addon-")); });
  after(() => { rmSync(target, { recursive: true, force: true }); });

  const env = () => ({ CC_AGENTS_TARGET: target });

  it("list shows the electron-to-tauri package", () => {
    assert.match(run(["list"], env()), /electron-to-tauri/);
  });

  it("install copies components into <target>/.claude and writes a manifest", () => {
    const out = run(["install", PKG], env());
    assert.match(out, /installed 'electron-to-tauri'/);
    const cd = join(target, ".claude");
    assert.ok(existsSync(join(cd, "agents", "tauri-engineer.md")));
    assert.ok(existsSync(join(cd, "skills", PKG, "SKILL.md")));
    assert.ok(existsSync(join(cd, "skills", "phase-3-core-features", "SKILL.md")));
    assert.ok(existsSync(join(cd, "commands", "migrate.md")));
    assert.ok(existsSync(join(cd, ".cc-agents-addons", `${PKG}.files`)));
  });

  it("list marks the package installed afterward", () => {
    assert.match(run(["list"], env()), /electron-to-tauri.*\[installed\]/);
  });

  it("install refuses to overwrite without --force", () => {
    let threw = false;
    try { run(["install", PKG], env()); }
    catch (e) { threw = true; assert.match(e.stderr || "", /refusing to overwrite/); }
    assert.ok(threw, "expected non-zero exit on conflict");
  });

  it("install --force overwrites existing files", () => {
    assert.match(run(["install", PKG, "--force"], env()), /installed 'electron-to-tauri'/);
  });

  it("remove deletes every installed file and the manifest", () => {
    const out = run(["remove", PKG], env());
    assert.match(out, /removed 'electron-to-tauri'/);
    const cd = join(target, ".claude");
    assert.ok(!existsSync(join(cd, "agents", "tauri-engineer.md")));
    assert.ok(!existsSync(join(cd, "skills", PKG)));
    assert.ok(!existsSync(join(cd, ".cc-agents-addons", `${PKG}.files`)));
  });

  it("info prints the manifest JSON", () => {
    assert.match(run(["info", PKG], env()), /"name":\s*"electron-to-tauri"/);
  });

  it("rejects an unknown package", () => {
    let threw = false;
    try { run(["install", "does-not-exist"], env()); }
    catch (e) { threw = true; assert.match(e.stderr || "", /no such package/); }
    assert.ok(threw);
  });
});

describe("addon.sh central catalog resolution", () => {
  let cache, target;
  before(() => {
    cache = mkdtempSync(join(tmpdir(), "cc-cat-"));
    target = mkdtempSync(join(tmpdir(), "cc-tgt-"));
    // A fake central catalog with packages under addons/ (like a cloned repo).
    const pkg = join(cache, "fakecat", "addons", "demo-pkg");
    mkdirSync(join(pkg, "agents"), { recursive: true });
    writeFileSync(join(pkg, "addon.json"), '{ "name": "demo-pkg" }\n');
    writeFileSync(join(pkg, "agents", "demo.md"), "---\nname: demo\ndescription: d\n---\n");
  });
  after(() => {
    rmSync(cache, { recursive: true, force: true });
    rmSync(target, { recursive: true, force: true });
  });
  const env = () => ({ CC_AGENTS_CATALOG_CACHE: cache, CC_AGENTS_TARGET: target });

  it("list shows both central and bundled packages with their source", () => {
    const out = run(["list"], env());
    assert.match(out, /demo-pkg\s+\(fakecat\)/);
    assert.match(out, /electron-to-tauri\s+\(bundled\)/);
  });

  it("installs a package resolved from the central catalog", () => {
    const out = run(["install", "demo-pkg"], env());
    assert.match(out, /installed 'demo-pkg'/);
    assert.match(out, /from .*fakecat/);
    assert.ok(existsSync(join(target, ".claude", "agents", "demo.md")));
  });

  it("catalog list reports the bundled root", () => {
    assert.match(run(["catalog", "list"], env()), /bundled:/);
  });
});
