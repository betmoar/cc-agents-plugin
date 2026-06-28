import { strict as assert } from "node:assert";
import { describe, it, beforeEach, afterEach } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

let dir;
function agent(name, model) {
  return `---\nname: ${name}\ntools: Read, Grep\nmodel: ${model}\n---\nbody\n`;
}
function run(args, env = {}) {
  return execFileSync("bash", ["scripts/set-model.sh", ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      CC_AGENTS_AGENTS_DIR: join(dir, "agents"),
      CC_AGENTS_LASTGOOD: join(dir, "lastgood"),
      ...env,
    },
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ccagents-"));
  mkdirSync(join(dir, "agents"));
  for (const r of ["glm-review-spec", "glm-review-plan", "glm-review-code", "glm-review-implementation"]) {
    writeFileSync(join(dir, "agents", `${r}.md`), agent(r, "glm-5.2[1m]"));
  }
  writeFileSync(join(dir, "agents", "glm-code-crawler.md"), agent("glm-code-crawler", "glm-5-turbo"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function modelOf(name) {
  const src = readFileSync(join(dir, "agents", `${name}.md`), "utf8");
  return (src.match(/\nmodel:\s*(.+)/) || [])[1];
}

const REVIEWERS = ["glm-review-spec", "glm-review-plan", "glm-review-code", "glm-review-implementation"];

describe("set-model.sh", () => {
  it("rewrites all four reviewers on a good id (probe stubbed to pass)", () => {
    run(["glm-4.6"], { CC_AGENTS_PROBE_CMD: "true" });
    for (const r of REVIEWERS) {
      assert.equal(modelOf(r), "glm-4.6");
    }
    // crawler untouched
    assert.equal(modelOf("glm-code-crawler"), "glm-5-turbo");
  });

  it("rejects a bad-shape id without writing", () => {
    assert.throws(() => run(["garbage"], { CC_AGENTS_PROBE_CMD: "true" }));
    // Transactional guarantee: ALL four reviewer files must be untouched.
    for (const r of REVIEWERS) {
      assert.equal(modelOf(r), "glm-5.2[1m]");
    }
  });

  it("aborts on probe failure without writing", () => {
    assert.throws(() => run(["glm-nope"], { CC_AGENTS_PROBE_CMD: "false" }));
    // Transactional guarantee: ALL four reviewer files must be untouched.
    for (const r of REVIEWERS) {
      assert.equal(modelOf(r), "glm-5.2[1m]");
    }
  });

  it("--revert restores the prior value", () => {
    run(["glm-4.6"], { CC_AGENTS_PROBE_CMD: "true" });
    run(["--revert"]);
    assert.equal(modelOf("glm-review-spec"), "glm-5.2[1m]");
  });

  it("--crawler targets only the crawler", () => {
    run(["--crawler", "glm-4.6"], { CC_AGENTS_PROBE_CMD: "true" });
    assert.equal(modelOf("glm-code-crawler"), "glm-4.6");
    assert.equal(modelOf("glm-review-spec"), "glm-5.2[1m]");
  });

  it("--no-probe skips the probe and still writes a good-shape id", () => {
    run(["--no-probe", "glm-4.6"], { CC_AGENTS_PROBE_CMD: "false" });
    assert.equal(modelOf("glm-review-spec"), "glm-4.6");
  });
});

// Production-path regression: no CC_AGENTS_AGENTS_DIR — BASH_SOURCE resolution must work.
// Sets up a fake plugin root with agent fixtures, invokes the script BY PATH from a
// foreign cwd (/tmp), and asserts the fixture files are rewritten.
describe("set-model.sh — production path (BASH_SOURCE resolution, no CC_AGENTS_AGENTS_DIR)", () => {
  let fakePluginRoot;

  beforeEach(() => {
    // Build a temp "plugin root" that mirrors the real plugin structure.
    fakePluginRoot = mkdtempSync(join(tmpdir(), "ccagents-prodpath-"));
    mkdirSync(join(fakePluginRoot, "agents"));
    mkdirSync(join(fakePluginRoot, "scripts"));
    mkdirSync(join(fakePluginRoot, ".claude"), { recursive: true });

    // Copy the real script into the fake plugin root so BASH_SOURCE[0] points
    // to fakePluginRoot/scripts/set-model.sh → PLUGIN_ROOT resolves to fakePluginRoot.
    cpSync(join(REPO_ROOT, "scripts", "set-model.sh"),
           join(fakePluginRoot, "scripts", "set-model.sh"));

    // Write fixture agent files with the default model.
    for (const r of ["glm-review-spec", "glm-review-plan", "glm-review-code", "glm-review-implementation"]) {
      writeFileSync(join(fakePluginRoot, "agents", `${r}.md`), agent(r, "glm-5.2[1m]"));
    }
  });

  afterEach(() => rmSync(fakePluginRoot, { recursive: true, force: true }));

  function modelOfProd(name) {
    const src = readFileSync(join(fakePluginRoot, "agents", `${name}.md`), "utf8");
    return (src.match(/\nmodel:\s*(.+)/) || [])[1];
  }

  it("rewrites reviewer files when invoked by path from a foreign cwd (no CC_AGENTS_AGENTS_DIR)", () => {
    // Invoke from /tmp — a completely unrelated directory — with NO CC_AGENTS_AGENTS_DIR.
    // Probe is stubbed to pass via CC_AGENTS_PROBE_CMD.
    execFileSync(
      "bash",
      [join(fakePluginRoot, "scripts", "set-model.sh"), "--no-probe", "glm-4.6"],
      {
        encoding: "utf8",
        cwd: "/tmp",
        env: {
          ...process.env,
          CC_AGENTS_PROBE_CMD: "true",
          // Explicitly unset the test seam so BASH_SOURCE resolution is exercised.
          CC_AGENTS_AGENTS_DIR: "",
          CC_AGENTS_LASTGOOD: "",
        },
      }
    );

    for (const r of ["glm-review-spec", "glm-review-plan", "glm-review-code", "glm-review-implementation"]) {
      assert.equal(
        modelOfProd(r),
        "glm-4.6",
        `Expected ${r} model to be rewritten to glm-4.6 via BASH_SOURCE resolution`
      );
    }
  });
});
