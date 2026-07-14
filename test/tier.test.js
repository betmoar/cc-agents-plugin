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
