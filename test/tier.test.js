import { strict as assert } from "node:assert";
import { describe, it, beforeEach, afterEach } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MODELS_OK = JSON.stringify({
  data: ["glm-4.5-air", "glm-4.7", "glm-5.2", "glm-5-turbo", "deepseek/deepseek-v4-flash"]
    .map((id) => ({ id })),
  _errors: [],
});

const GROUP_FILES = {
  review: ["glm-review-code", "glm-review-design"],
  crawler: ["glm-code-crawler"],
  implementer: ["glm-implementer"],
  scout: ["glm-scout"],
  brainstorm: ["glm-brainstorm"],
};
const FACTORY = {
  "glm-review-code": "glm-5.2[1m]", "glm-review-design": "glm-5.2[1m]",
  "glm-code-crawler": "glm-5-turbo", "glm-implementer": "glm-5.2[1m]",
  "glm-scout": "glm-5.2[1m]", "glm-brainstorm": "glm-5.2[1m]",
};

let dir;
function agent(name, model) {
  return `---\nname: ${name}\ntools: Read, Grep\nmodel: ${model}\n---\nbody\n`;
}
function settings(body) {
  writeFileSync(join(dir, "cc-agents.local.md"), body);
}
// A stub set-model: records each invocation's argv (one line per call) to a log
// so `apply` dispatch can be asserted by captured argv, WITHOUT running the real
// probe/write chain. It deliberately does NOT mutate frontmatter — tests that
// need real post-apply state omit the stub and use the real set-model.sh (see
// the "real integration" and revert tests). So snapshot-vs-argv tests assert
// the PRE-apply state the snapshot records, and integration tests assert the
// POST-apply frontmatter — two different, intentional faithfulness levels.
function stubSetModel() {
  const p = join(dir, "fake-set-model.sh");
  writeFileSync(
    p,
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "${join(dir, "argv.log")}"\nexit 0\n`,
    { mode: 0o755 },
  );
  return `bash ${p}`;
}
function run(args, env = {}) {
  return spawnSync("bash", ["scripts/set-tier.sh", ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      CC_AGENTS_AGENTS_DIR: join(dir, "agents"),
      CC_AGENTS_SETTINGS_FILE: join(dir, "cc-agents.local.md"),
      CC_AGENTS_TIER_LASTGOOD: join(dir, "tier.lastgood"),
      CC_AGENTS_MODELS_JSON: MODELS_OK,
      ...env,
    },
  });
}
function argvLog() {
  try { return readFileSync(join(dir, "argv.log"), "utf8").trim().split("\n").filter(Boolean); }
  catch { return []; }
}
function modelOf(name) {
  const src = readFileSync(join(dir, "agents", `${name}.md`), "utf8");
  return (src.match(/\nmodel:\s*(.+)/) || [])[1];
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cctier-"));
  mkdirSync(join(dir, "agents"));
  for (const [g, files] of Object.entries(GROUP_FILES)) {
    void g;
    for (const f of files) writeFileSync(join(dir, "agents", `${f}.md`), agent(f, FACTORY[f]));
  }
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("set-tier.sh apply — resolution & dispatch (stubbed writer)", () => {
  it("dispatches the group→argv map with resolved ids for changed groups", () => {
    settings(`---\nscout: fast\ncrawler: max\n---\n`);
    const res = run(["apply"], { CC_AGENTS_SET_MODEL_CMD: stubSetModel() });
    assert.equal(res.status, 0, res.stderr);
    const log = argvLog();
    assert.ok(log.includes("--scout glm-4.5-air"), `missing scout dispatch: ${log}`);
    assert.ok(log.includes("--crawler glm-5.2"), `missing crawler dispatch: ${log}`);
  });

  it("review maps to the no-flag reviewers invocation (bare id, no --review)", () => {
    settings(`---\nreview: deep\n---\n`);
    run(["apply"], { CC_AGENTS_SET_MODEL_CMD: stubSetModel() });
    const log = argvLog();
    // Exact bare-id line — NOT a substring match, which `--review glm-4.7` would
    // also satisfy. And assert no flag form leaked in.
    assert.ok(log.some((l) => l === "glm-4.7"), `review must dispatch bare id: ${log}`);
    assert.ok(!log.some((l) => /^--review\b/.test(l)), `no --review flag may be sent: ${log}`);
  });

  it("skips a group already at its resolved id (no dispatch)", () => {
    // crawler factory is glm-5-turbo; `default` resolves to that → skip.
    settings(`---\ncrawler: default\nscout: fast\n---\n`);
    const res = run(["apply"], { CC_AGENTS_SET_MODEL_CMD: stubSetModel() });
    assert.match(res.stdout, /applied 1 group\(s\), skipped 1/);
    assert.ok(!argvLog().some((l) => l.startsWith("--crawler")), "crawler should be skipped");
  });

  it("writes a snapshot of every changed group's files in set-model lastgood format", () => {
    settings(`---\nreview: deep\nscout: fast\n---\n`);
    run(["apply"], { CC_AGENTS_SET_MODEL_CMD: stubSetModel() });
    const snap = readFileSync(join(dir, "tier.lastgood"), "utf8");
    assert.match(snap, /^tier\n/); // header line
    for (const f of ["glm-review-code", "glm-review-design", "glm-scout"]) {
      assert.ok(snap.includes(`${join(dir, "agents", `${f}.md`)}\t${FACTORY[f]}`),
        `snapshot missing ${f}`);
    }
  });

  it("real integration: no stub → drives set-model.sh and rewrites frontmatter", () => {
    settings(`---\nscout: fast\n---\n`);
    const res = run(["apply"], { CC_AGENTS_LASTGOOD: join(dir, "sm.lastgood") });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(modelOf("glm-scout"), "glm-4.5-air");
    assert.equal(modelOf("glm-review-code"), "glm-5.2[1m]"); // untouched
  });
});

describe("set-tier.sh apply — validation (zero-write on error)", () => {
  it("unknown tier → exit 1, nothing dispatched", () => {
    settings(`---\nscout: turbo\n---\n`);
    const res = run(["apply"], { CC_AGENTS_SET_MODEL_CMD: stubSetModel() });
    assert.equal(res.status, 1, res.stderr);
    assert.match(res.stderr, /unknown tier 'turbo'/);
    assert.equal(argvLog().length, 0);
  });

  it("unknown group key → exit 2", () => {
    settings(`---\nscoutt: fast\n---\n`);
    const res = run(["apply"], { CC_AGENTS_SET_MODEL_CMD: stubSetModel() });
    assert.equal(res.status, 2, res.stderr);
    assert.match(res.stderr, /unknown group key 'scoutt'/);
    assert.equal(argvLog().length, 0);
  });

  it("malformed frontmatter (no fence) → exit 2", () => {
    settings(`scout: fast\n`); // no --- fences
    const res = run(["apply"], { CC_AGENTS_SET_MODEL_CMD: stubSetModel() });
    assert.equal(res.status, 2, res.stderr);
    assert.match(res.stderr, /malformed settings/);
  });

  it("missing settings file → no-op exit 0", () => {
    // no settings() call → file absent
    const res = run(["apply"], { CC_AGENTS_SET_MODEL_CMD: stubSetModel() });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /applied 0 group\(s\)/);
    assert.equal(argvLog().length, 0);
  });

  it("empty value is treated as unchanged (missing key)", () => {
    settings(`---\nscout:\ncrawler: fast\n---\n`);
    const res = run(["apply"], { CC_AGENTS_SET_MODEL_CMD: stubSetModel() });
    assert.equal(res.status, 0, res.stderr);
    assert.ok(!argvLog().some((l) => l.startsWith("--scout")), "empty scout must be skipped");
    assert.ok(argvLog().includes("--crawler glm-4.5-air"));
  });

  it("value normalization: quotes and inline comments are stripped", () => {
    settings(`---\nscout: "fast"  # cheap tier\n---\n`);
    run(["apply"], { CC_AGENTS_SET_MODEL_CMD: stubSetModel() });
    assert.ok(argvLog().includes("--scout glm-4.5-air"), `normalization failed: ${argvLog()}`);
  });

  it("experimental gate OFF → raw OpenRouter id rejected (exit 1), nothing dispatched", () => {
    settings(`---\nscout: deepseek/deepseek-v4-flash\nexperimental: false\n---\n`);
    const res = run(["apply"], { CC_AGENTS_SET_MODEL_CMD: stubSetModel() });
    assert.equal(res.status, 1, res.stderr);
    assert.equal(argvLog().length, 0);
  });

  it("experimental gate ON → raw id accepted at the settings layer (argv dispatched)", () => {
    settings(`---\nscout: deepseek/deepseek-v4-flash\nexperimental: true\n---\n`);
    const res = run(["apply"], { CC_AGENTS_SET_MODEL_CMD: stubSetModel() });
    assert.equal(res.status, 0, res.stderr);
    assert.ok(argvLog().includes("--scout deepseek/deepseek-v4-flash"));
  });

  // The stub above bypasses the membership probe, so it only proves the SETTINGS
  // layer accepts the raw id. This pair drives the REAL set-model.sh to prove the
  // "once accepted, still membership-checked" half of §6 — listed passes, an
  // unlisted OpenRouter id aborts exit 1 even under experimental: true.
  it("experimental id still membership-checked: listed → applied", () => {
    settings(`---\nscout: deepseek/deepseek-v4-flash\nexperimental: true\n---\n`);
    const res = run(["apply"], { CC_AGENTS_LASTGOOD: join(dir, "sm.lastgood") }); // real set-model, MODELS_OK lists it
    assert.equal(res.status, 0, res.stderr);
    assert.equal(modelOf("glm-scout"), "deepseek/deepseek-v4-flash");
  });

  it("experimental id still membership-checked: unlisted → exit 1, no write", () => {
    settings(`---\nscout: deepseek/not-a-real-model\nexperimental: true\n---\n`);
    const res = run(["apply"], { CC_AGENTS_LASTGOOD: join(dir, "sm.lastgood") });
    assert.equal(res.status, 1, `expected membership abort, got ${res.status}: ${res.stderr}`);
    assert.equal(modelOf("glm-scout"), "glm-5.2[1m]"); // untouched
  });
});

describe("set-tier.sh revert — multi-group, delegated to set-model --revert", () => {
  it("restores every agent from the last apply (both reviewers AND scout)", () => {
    // Real writer so the snapshot + revert exercise the true path. apply
    // dispatches review then scout; each set-model call OVERWRITES sm.lastgood,
    // so it ends holding ONLY scout — the exact reason tier revert must use its
    // OWN cumulative snapshot instead of set-model's lastgood.
    settings(`---\nreview: deep\nscout: fast\n---\n`);
    const smLastgood = join(dir, "sm.lastgood");
    let res = run(["apply"], { CC_AGENTS_LASTGOOD: smLastgood });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(modelOf("glm-review-code"), "glm-4.7");
    assert.equal(modelOf("glm-review-design"), "glm-4.7");
    assert.equal(modelOf("glm-scout"), "glm-4.5-air");
    // Proof of the overwrite hazard: set-model's own lastgood lost the reviewers.
    const sm = readFileSync(smLastgood, "utf8");
    assert.ok(sm.includes("glm-scout.md"), "sm.lastgood should hold the last group");
    assert.ok(!sm.includes("glm-review-code.md"),
      "set-model lastgood only keeps the LAST group — hence the separate tier snapshot");

    // revert takes NO CC_AGENTS_LASTGOOD: cmd_revert points set-model at the
    // TIER snapshot itself, which covers all groups.
    res = run(["revert"]);
    assert.equal(res.status, 0, res.stderr);
    // The whole apply is undone — not just the last group.
    assert.equal(modelOf("glm-review-code"), "glm-5.2[1m]");
    assert.equal(modelOf("glm-review-design"), "glm-5.2[1m]");
    assert.equal(modelOf("glm-scout"), "glm-5.2[1m]");
  });

  it("exits 1 when there is no tier snapshot", () => {
    const res = run(["revert"]);
    assert.equal(res.status, 1, res.stderr);
    assert.match(res.stderr, /no tier snapshot/);
  });
});

describe("set-tier.sh show — drift view", () => {
  function rows(stdout) {
    return Object.fromEntries(
      stdout.trim().split("\n").filter(Boolean).map((l) => {
        const c = l.split("\t");
        return [c[0], c];
      }),
    );
  }

  it("marks DRIFT where current != resolved, ok/-- otherwise", () => {
    settings(`---\nscout: deep\n---\n`); // scout factory glm-5.2[1m] vs deep glm-4.7 → DRIFT
    const res = run(["show"]);
    assert.equal(res.status, 0, res.stderr);
    const r = rows(res.stdout);
    assert.deepEqual(r["glm-scout"], ["glm-scout", "glm-5.2[1m]", "deep", "glm-4.7", "DRIFT"]);
    // undeclared group → tier/resolved '--', status ok
    assert.equal(r["glm-brainstorm"][2], "--");
    assert.equal(r["glm-brainstorm"][4], "ok");
  });

  it("declared but already-at-target shows ok, not DRIFT", () => {
    settings(`---\ncrawler: default\n---\n`); // crawler already glm-5-turbo
    const r = run(["show"]).stdout;
    const line = r.trim().split("\n").find((l) => l.startsWith("glm-code-crawler"));
    assert.match(line, /\tok$/);
  });

  it("missing settings file → current-only columns, note on stderr, exit 0", () => {
    const res = run(["show"]);
    assert.equal(res.status, 0);
    assert.match(res.stderr, /no settings file/);
    const line = res.stdout.trim().split("\n").find((l) => l.startsWith("glm-scout"));
    assert.match(line, /^glm-scout\tglm-5\.2\[1m\]\t--\t--\tok$/);
  });
});
