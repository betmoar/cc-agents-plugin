import { strict as assert } from "node:assert";
import { describe, it, beforeEach, afterEach } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

const REVIEWERS = ["glm-review-code", "glm-review-design"];

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
  for (const r of REVIEWERS) {
    writeFileSync(join(dir, "agents", `${r}.md`), agent(r, "glm-5.2[1m]"));
  }
  writeFileSync(join(dir, "agents", "glm-code-crawler.md"), agent("glm-code-crawler", "glm-5-turbo"));
  writeFileSync(join(dir, "agents", "glm-implementer.md"), agent("glm-implementer", "glm-5.2[1m]"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function modelOf(name) {
  const src = readFileSync(join(dir, "agents", `${name}.md`), "utf8");
  return (src.match(/\nmodel:\s*(.+)/) || [])[1];
}

describe("set-model.sh", () => {
  it("rewrites both reviewers on a good id (probe stubbed to pass)", () => {
    run(["glm-4.6"], { CC_AGENTS_PROBE_CMD: "true" });
    for (const r of REVIEWERS) {
      assert.equal(modelOf(r), "glm-4.6");
    }
    // crawler and implementer untouched
    assert.equal(modelOf("glm-code-crawler"), "glm-5-turbo");
    assert.equal(modelOf("glm-implementer"), "glm-5.2[1m]");
  });

  it("rejects a bad-shape id without writing", () => {
    assert.throws(() => run(["garbage"], { CC_AGENTS_PROBE_CMD: "true" }));
    // Transactional guarantee: BOTH reviewer files must be untouched.
    for (const r of REVIEWERS) {
      assert.equal(modelOf(r), "glm-5.2[1m]");
    }
    assert.equal(modelOf("glm-implementer"), "glm-5.2[1m]");
  });

  it("aborts on probe failure without writing", () => {
    assert.throws(() => run(["glm-nope"], { CC_AGENTS_PROBE_CMD: "false" }));
    for (const r of REVIEWERS) {
      assert.equal(modelOf(r), "glm-5.2[1m]");
    }
    assert.equal(modelOf("glm-implementer"), "glm-5.2[1m]");
  });

  it("--revert restores the prior value", () => {
    run(["glm-4.6"], { CC_AGENTS_PROBE_CMD: "true" });
    run(["--revert"]);
    assert.equal(modelOf("glm-review-code"), "glm-5.2[1m]");
    assert.equal(modelOf("glm-review-design"), "glm-5.2[1m]");
  });

  it("--crawler targets only the crawler", () => {
    run(["--crawler", "glm-4.6"], { CC_AGENTS_PROBE_CMD: "true" });
    assert.equal(modelOf("glm-code-crawler"), "glm-4.6");
    assert.equal(modelOf("glm-review-code"), "glm-5.2[1m]");
    assert.equal(modelOf("glm-review-design"), "glm-5.2[1m]");
    assert.equal(modelOf("glm-implementer"), "glm-5.2[1m]");
  });

  it("--no-probe skips the probe and still writes a good-shape id", () => {
    run(["--no-probe", "glm-4.6"], { CC_AGENTS_PROBE_CMD: "false" });
    assert.equal(modelOf("glm-review-code"), "glm-4.6");
  });
});

describe("set-model.sh --implementer", () => {
  it("targets only the implementer", () => {
    run(["--implementer", "glm-4.6"], { CC_AGENTS_PROBE_CMD: "true" });
    assert.equal(modelOf("glm-implementer"), "glm-4.6");
    assert.equal(modelOf("glm-review-code"), "glm-5.2[1m]");
    assert.equal(modelOf("glm-review-design"), "glm-5.2[1m]");
    assert.equal(modelOf("glm-code-crawler"), "glm-5-turbo");
  });
});

// spawnSync variant: captures stderr on success (execFileSync only exposes it on throw).
function runRaw(args, env = {}) {
  return spawnSync("bash", ["scripts/set-model.sh", ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      CC_AGENTS_AGENTS_DIR: join(dir, "agents"),
      CC_AGENTS_LASTGOOD: join(dir, "lastgood"),
      ...env,
    },
  });
}

describe("set-model.sh --revert with a stale last-known-good", () => {
  it("skips entries whose file no longer exists, warns on stderr, reverts the rest, exits 0", () => {
    run(["glm-4.6"], { CC_AGENTS_PROBE_CMD: "true" });   // lastgood now records both reviewers
    rmSync(join(dir, "agents", "glm-review-design.md")); // simulate a pre-0.2.0 deleted agent
    const res = runRaw(["--revert"]);
    assert.equal(res.status, 0, `revert failed: ${res.stderr}`);
    assert.match(res.stderr, /glm-review-design\.md no longer exists — skipped/);
    assert.equal(modelOf("glm-review-code"), "glm-5.2[1m]"); // surviving file reverted
  });

  it("exits 0 with a note when every recorded file is gone", () => {
    const lastgood = join(dir, "lastgood");
    writeFileSync(
      lastgood,
      `reviewers\n${join(dir, "agents", "glm-review-spec.md")}\tglm-5.2[1m]\n`
    );
    const res = runRaw(["--revert"]);
    assert.equal(res.status, 0, `revert failed: ${res.stderr}`);
    assert.match(res.stderr, /glm-review-spec\.md no longer exists — skipped/);
    assert.match(res.stdout, /nothing left to revert/);
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
    assert.equal(modelOf("glm-review-code"), "glm-5.2[1m]");
  });

  it("still accepts the bracketed default id glm-5.2[1m]", () => {
    run(["--no-probe", "glm-5.2[1m]"], {});
    assert.equal(modelOf("glm-review-code"), "glm-5.2[1m]");
  });

  // Transactional drift-lock: a target file missing its `model:` line must
  // abort BEFORE the last-known-good record is touched. It used to abort
  // mid-write, truncating the previous record and destroying --revert.
  it("a corrupt agent file aborts without clobbering the previous lastgood", () => {
    const lastgood = join(dir, "lastgood");
    const design = join(dir, "agents", "glm-review-design.md");
    writeFileSync(lastgood, `reviewers\n${design}\tglm-OLD\n`);
    // Strip the model: line from one reviewer.
    const code = join(dir, "agents", "glm-review-code.md");
    writeFileSync(code, readFileSync(code, "utf8").replace(/^model:.*\n/m, ""));

    assert.throws(() => run(["glm-4.6"], { CC_AGENTS_PROBE_CMD: "true" }));
    // Previous lastgood intact, byte for byte…
    assert.equal(readFileSync(lastgood, "utf8"), `reviewers\n${design}\tglm-OLD\n`);
    // …and --revert still works off it.
    run(["--revert"]);
    assert.equal(modelOf("glm-review-design"), "glm-OLD");
  });

  it("--revert refuses an empty/truncated lastgood instead of reporting success", () => {
    writeFileSync(join(dir, "lastgood"), "reviewers\n");
    assert.throws(
      () => run(["--revert"]),
      (e) => /empty or header-only/.test(String(e.stderr ?? e.message)),
    );
  });
});

// Hardening (issue #8): a non-empty lastgood whose records are MALFORMED — not
// just naming deleted files — must be refused, never bucketed as "all deleted"
// and reported as a benign no-op. A malformed record is any post-header line
// that is not exactly `<abspath>\t<non-empty-model>`.
describe("set-model.sh --revert refuses a malformed (non-empty) lastgood", () => {
  const lg = () => join(dir, "lastgood");

  it("rejects a record line with no tab (garbage), does not report all-deleted", () => {
    writeFileSync(lg(), "reviewers\nthis is a corrupted line with no tab\nmore garbage\n");
    const res = runRaw(["--revert"]);
    assert.equal(res.status, 1, `expected refusal, got exit ${res.status}: ${res.stdout}`);
    assert.match(res.stderr, /unparseable|malformed/i);
    assert.doesNotMatch(res.stdout, /nothing left to revert/);
    assert.doesNotMatch(res.stdout, /reverted to last-known-good/);
  });

  it("rejects a column-shifted record (target\\tfile\\tmodel — extra field)", () => {
    const code = join(dir, "agents", "glm-review-code.md");
    // Simulate a future 3-column format read by the 2-var reader: the real
    // model ends up in a trailing field the current parser drops. Must refuse,
    // not silently treat the shifted path token as a "deleted file".
    writeFileSync(lg(), `reviewers\nreviewers\t${code}\tglm-OLD\n`);
    const res = runRaw(["--revert"]);
    assert.equal(res.status, 1, `expected refusal, got exit ${res.status}: ${res.stdout}`);
    assert.match(res.stderr, /unparseable|malformed/i);
    // The real agent file must be untouched.
    assert.equal(modelOf("glm-review-code"), "glm-5.2[1m]");
  });

  it("rejects a surviving file with an empty model column (no `model: ` write)", () => {
    const code = join(dir, "agents", "glm-review-code.md");
    writeFileSync(lg(), `reviewers\n${code}\t\n`); // path present, model empty
    const res = runRaw(["--revert"]);
    assert.equal(res.status, 1, `expected refusal, got exit ${res.status}: ${res.stdout}`);
    assert.match(res.stderr, /unparseable|malformed|empty model/i);
    // Frontmatter must NOT have been rewritten to a blank `model: ` line.
    const src = readFileSync(code, "utf8");
    assert.doesNotMatch(src, /^model:\s*$/m, "wrote a blank model: line");
    assert.equal(modelOf("glm-review-code"), "glm-5.2[1m]");
  });

  it("still reverts a well-formed record whose final line lacks a trailing newline", () => {
    const code = join(dir, "agents", "glm-review-code.md");
    const design = join(dir, "agents", "glm-review-design.md");
    // Two records; the last has NO trailing \n. The last record must still be
    // reverted, not silently dropped by the read-loop condition.
    writeFileSync(lg(), `reviewers\n${code}\tglm-A\n${design}\tglm-B`);
    const res = runRaw(["--revert"]);
    assert.equal(res.status, 0, `revert failed: ${res.stderr}`);
    assert.equal(modelOf("glm-review-code"), "glm-A");
    assert.equal(modelOf("glm-review-design"), "glm-B", "last (unterminated) record was dropped");
  });

  it("discloses the skipped count in the success message on a partial revert", () => {
    run(["glm-4.6"], { CC_AGENTS_PROBE_CMD: "true" }); // records both reviewers at glm-4.6
    rmSync(join(dir, "agents", "glm-review-design.md")); // one deleted, one survives
    const res = runRaw(["--revert"]);
    assert.equal(res.status, 0, `revert failed: ${res.stderr}`);
    // Success line names how many of M were reverted and how many skipped.
    assert.match(res.stdout, /reverted 1 of 2 .*1 skipped/i);
    assert.equal(modelOf("glm-review-code"), "glm-5.2[1m]");
  });
});

// Production-path regression: no CC_AGENTS_AGENTS_DIR — BASH_SOURCE resolution must work.
// Sets up a fake plugin root with agent fixtures, invokes the script BY PATH from a
// foreign cwd (/tmp), and asserts the fixture files are rewritten.
describe("set-model.sh — production path (BASH_SOURCE resolution, no CC_AGENTS_AGENTS_DIR)", () => {
  let fakePluginRoot;

  beforeEach(() => {
    fakePluginRoot = mkdtempSync(join(tmpdir(), "ccagents-prodpath-"));
    mkdirSync(join(fakePluginRoot, "agents"));
    mkdirSync(join(fakePluginRoot, "scripts"));
    mkdirSync(join(fakePluginRoot, ".claude"), { recursive: true });

    cpSync(join(REPO_ROOT, "scripts", "set-model.sh"),
           join(fakePluginRoot, "scripts", "set-model.sh"));

    for (const r of REVIEWERS) {
      writeFileSync(join(fakePluginRoot, "agents", `${r}.md`), agent(r, "glm-5.2[1m]"));
    }
  });

  afterEach(() => rmSync(fakePluginRoot, { recursive: true, force: true }));

  function modelOfProd(name) {
    const src = readFileSync(join(fakePluginRoot, "agents", `${name}.md`), "utf8");
    return (src.match(/\nmodel:\s*(.+)/) || [])[1];
  }

  it("rewrites reviewer files when invoked by path from a foreign cwd (no CC_AGENTS_AGENTS_DIR)", () => {
    execFileSync(
      "bash",
      [join(fakePluginRoot, "scripts", "set-model.sh"), "--no-probe", "glm-4.6"],
      {
        encoding: "utf8",
        cwd: "/tmp",
        env: {
          ...process.env,
          CC_AGENTS_PROBE_CMD: "true",
          CC_AGENTS_AGENTS_DIR: "",
          CC_AGENTS_LASTGOOD: "",
        },
      }
    );

    for (const r of REVIEWERS) {
      assert.equal(
        modelOfProd(r),
        "glm-4.6",
        `Expected ${r} model to be rewritten to glm-4.6 via BASH_SOURCE resolution`
      );
    }
  });
});
