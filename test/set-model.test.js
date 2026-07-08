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

  // SECURITY drift-lock: the id is written into agent frontmatter via `awk -v`,
  // which interprets backslash escapes. Without the charset shape check, BOTH a
  // real newline and a literal "\n" in the id inject an extra frontmatter line
  // (e.g. `tools: Bash`) — escalating a least-privilege agent. These ids must
  // be rejected before any file is touched, even with --no-probe.
  it("rejects an id containing a real newline (frontmatter injection)", () => {
    assert.throws(() => run(["--no-probe", "glm-x\ntools: Bash"]));
    for (const r of REVIEWERS) {
      assert.equal(modelOf(r), "glm-5.2[1m]");
      assert.ok(!readFileSync(join(dir, "agents", `${r}.md`), "utf8").includes("tools: Bash"));
    }
  });

  it("rejects an id containing a literal backslash-n (awk -v escape injection)", () => {
    assert.throws(() => run(["--no-probe", "glm-x\\ntools: Bash"]));
    for (const r of REVIEWERS) {
      assert.equal(modelOf(r), "glm-5.2[1m]");
    }
  });

  it("rejects ids containing quotes (would break/smuggle the probe JSON body)", () => {
    assert.throws(() => run(['--no-probe', 'vendor/mo"del']));
    assert.equal(modelOf("glm-review-spec"), "glm-5.2[1m]");
  });

  it("still accepts the bracketed default id glm-5.2[1m]", () => {
    run(["--no-probe", "glm-5.2[1m]"], {});
    assert.equal(modelOf("glm-review-spec"), "glm-5.2[1m]");
  });

  // Transactional drift-lock: a target file missing its `model:` line must
  // abort BEFORE the last-known-good record is touched. It used to abort
  // mid-write, truncating the previous record and destroying --revert.
  it("a corrupt agent file aborts without clobbering the previous lastgood", () => {
    const lastgood = join(dir, "lastgood");
    const spec = join(dir, "agents", "glm-review-spec.md");
    writeFileSync(lastgood, `reviewers\n${spec}\tglm-OLD\n`);
    // Strip the model: line from one reviewer.
    const code = join(dir, "agents", "glm-review-code.md");
    writeFileSync(code, readFileSync(code, "utf8").replace(/^model:.*\n/m, ""));

    assert.throws(() => run(["glm-4.6"], { CC_AGENTS_PROBE_CMD: "true" }));
    // Previous lastgood intact, byte for byte…
    assert.equal(readFileSync(lastgood, "utf8"), `reviewers\n${spec}\tglm-OLD\n`);
    // …and --revert still works off it.
    run(["--revert"]);
    assert.equal(modelOf("glm-review-spec"), "glm-OLD");
  });

  it("--revert refuses an empty/truncated lastgood instead of reporting success", () => {
    writeFileSync(join(dir, "lastgood"), "reviewers\n");
    assert.throws(
      () => run(["--revert"]),
      (e) => /empty or corrupt/.test(String(e.stderr ?? e.message)),
    );
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
