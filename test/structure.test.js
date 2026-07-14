import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { readFileSync, readdirSync, existsSync } from "node:fs";

describe("plugin manifest", () => {
  it("is valid JSON with required fields", () => {
    const m = JSON.parse(readFileSync(".claude-plugin/plugin.json", "utf8"));
    assert.equal(m.name, "cc-agents");
    assert.match(m.version, /^\d+\.\d+\.\d+$/);
    assert.ok(m.description && m.description.length > 0);
    assert.ok(m.author && m.author.name);
  });

  // VERSION-SYNC drift-lock: 0.1.1 bumped plugin.json but not package.json and
  // the drift shipped. The two versions must move together.
  it("plugin.json and package.json versions match", () => {
    const plugin = JSON.parse(readFileSync(".claude-plugin/plugin.json", "utf8"));
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    assert.equal(plugin.version, pkg.version,
      "plugin.json and package.json versions have drifted — bump both together");
  });
});

describe("marketplace manifest", () => {
  // COUPLING drift-lock: the standalone-install marketplace advertises the
  // plugin at repo root. Its plugin entry name and source must stay in sync
  // with plugin.json so `/plugin install cc-agents@cc-agents-plugin` resolves.
  it("advertises cc-agents at source ./ matching plugin.json", () => {
    const mk = JSON.parse(readFileSync(".claude-plugin/marketplace.json", "utf8"));
    const plugin = JSON.parse(readFileSync(".claude-plugin/plugin.json", "utf8"));
    assert.ok(Array.isArray(mk.plugins) && mk.plugins.length >= 1);
    const entry = mk.plugins.find((p) => p.name === plugin.name);
    assert.ok(entry, `marketplace has no entry named ${plugin.name}`);
    assert.equal(entry.source, "./", "plugin lives at repo root — source must be ./");
    assert.ok(mk.name && mk.owner && mk.owner.name, "marketplace missing name/owner");
  });
});

describe("agents", () => {
  const reviewers = ["glm-review-code", "glm-review-design"];
  it("all agent files have a name/description/model frontmatter", () => {
    for (const f of readdirSync("agents").filter((n) => n.endsWith(".md"))) {
      const src = readFileSync(`agents/${f}`, "utf8");
      assert.ok(src.startsWith("---"), `${f} missing frontmatter`);
      assert.match(src, /\nname:\s*\S+/, `${f} missing name`);
      assert.match(src, /\ndescription:\s*\S+/, `${f} missing description`);
      assert.match(src, /\nmodel:\s*\S+/, `${f} missing model`);
    }
  });
  it("the two reviewers default to glm-5.2[1m]", () => {
    for (const r of reviewers) {
      const src = readFileSync(`agents/${r}.md`, "utf8");
      assert.match(src, /\nmodel:\s*glm-5\.2\[1m\]/, `${r} wrong default model`);
    }
  });
  it("the two reviewers carry no Bash (read-only least privilege)", () => {
    for (const r of reviewers) {
      const src = readFileSync(`agents/${r}.md`, "utf8");
      const tools = (src.match(/\ntools:\s*(.+)/) || [])[1] || "";
      assert.ok(!/\bBash\b/.test(tools), `${r} must not grant Bash`);
      assert.ok(!/Write|Edit/.test(tools), `${r} must not grant Write/Edit`);
    }
  });
});

describe("glm-code-crawler agent", () => {
  it("exists, is read-only, defaults to glm-5-turbo", () => {
    const src = readFileSync("agents/glm-code-crawler.md", "utf8");
    assert.match(src, /\nname:\s*glm-code-crawler/);
    assert.match(src, /\nmodel:\s*glm-5-turbo/);
    // read-only: no Write/Edit in the tools line
    const tools = (src.match(/\ntools:\s*(.+)/) || [])[1] || "";
    assert.ok(!/Write|Edit/.test(tools), "crawler must be read-only");
  });
});

describe("hooks.json", () => {
  it("registers a PostToolUse Write|Edit hook to the suggest script", () => {
    const h = JSON.parse(readFileSync("hooks/hooks.json", "utf8"));
    const post = h.hooks.PostToolUse;
    assert.ok(Array.isArray(post) && post.length >= 1);
    const entry = post[0];
    assert.equal(entry.matcher, "Write|Edit");
    const cmd = entry.hooks[0].command;
    assert.match(cmd, /\$\{CLAUDE_PLUGIN_ROOT\}/);
    assert.match(cmd, /spec-plan-suggest\.sh/);
  });
});

describe("model command (consolidated, single switchable command)", () => {
  it("model.md wraps set-model.sh and allows only that bash call", () => {
    const src = readFileSync("commands/model.md", "utf8");
    assert.match(src, /set-model\.sh/);
    assert.match(src, /allowed-tools:/);
    assert.match(src, /\$\{CLAUDE_PLUGIN_ROOT\}/);
  });
  it("model.md passes $ARGUMENTS through so the type flag is user-selectable", () => {
    const src = readFileSync("commands/model.md", "utf8");
    assert.match(src, /set-model\.sh" \$ARGUMENTS/,
      "model.md must forward args verbatim (no hardcoded group flag) so one command switches groups");
  });
  it("names every selectable group so the command is self-documenting", () => {
    const src = readFileSync("commands/model.md", "utf8");
    for (const flag of ["--crawler", "--implementer", "--scout", "--brainstorm", "--all"]) {
      assert.match(src, new RegExp(flag.replace(/-/g, "\\-")), `model.md missing ${flag}`);
    }
  });
  it("the old per-agent command files are gone (consolidated away)", () => {
    for (const f of ["commands/crawler-model.md", "commands/implementer-model.md"]) {
      assert.ok(!existsSync(f), `${f} should have been removed in the consolidation`);
    }
  });
});

describe("review-panel skill", () => {
  const src = () => readFileSync("skills/review-panel/SKILL.md", "utf8");
  it("has skill frontmatter with name + description", () => {
    assert.match(src(), /\nname:\s*review-panel/);
    assert.match(src(), /\ndescription:\s*\S+/);
  });
  it("declares N, the three lenses, the rubric threshold, and the marker", () => {
    const s = src();
    assert.match(s, /N\s*=\s*3/);
    assert.match(s, /lens A/i);
    assert.match(s, /lens B/i);
    assert.match(s, /lens C/i);
    assert.match(s, /\b50\b/);                 // drop threshold
    assert.match(s, /\.review-panel\//);       // marker path
    assert.match(s, /proxy-ready\.sh/);        // preflight
  });
  it("declares the interactive clarify phase", () => {
    const s = src();
    assert.match(s, /AskUserQuestion/);            // poses questions
    assert.match(s, /##\s*Clarifications/);        // append-only write-back header
    assert.match(s, /should-clarify/);             // the question source bucket
  });
  it("declares the per-run report structure", () => {
    const s = src();
    assert.match(s, /Panel run/);                  // report heading
    assert.match(s, /per-lens/);                   // per-lens breakdown
    assert.match(s, /subagent_tokens/);            // per-agent token source
  });
});

describe("code-crawl skill", () => {
  const src = () => readFileSync("skills/code-crawl/SKILL.md", "utf8");
  it("has skill frontmatter", () => {
    assert.match(src(), /\nname:\s*code-crawl/);
    assert.match(src(), /\ndescription:\s*\S+/);
  });
  it("declares per-shard size, the wave cap of 6, and proxy preflight", () => {
    const s = src();
    assert.match(s, /150K|150,000|150000/);
    assert.match(s, /\b6\b/);                  // wave cap
    assert.match(s, /glm-code-crawler/);
    assert.match(s, /proxy-ready\.sh/);
  });
});

describe("marker-path coupling (hook ↔ skill ↔ README)", () => {
  // The run-report marker directory name `.review-panel` is hardcoded in three
  // places that MUST agree: the skill (writes the marker), the hook (checks it
  // to break the clarifications feedback loop AND early-exits on paths inside
  // it), and the README's .gitignore advice. If you rename it, rename it
  // everywhere — this test is the tripwire.
  it("hook, skill, and README all use the same .review-panel dirname", () => {
    const hook = readFileSync("hooks/spec-plan-suggest.sh", "utf8");
    const skill = readFileSync("skills/review-panel/SKILL.md", "utf8");
    const readme = readFileSync("README.md", "utf8");
    assert.match(hook, /\*\/\.review-panel\/\*/, "hook lost its self-review path guard");
    assert.match(hook, /\/\.review-panel\//, "hook lost the marker-exists check");
    assert.match(skill, /<artifact-dir>\/\.review-panel\/<artifact-basename>\.md/,
      "skill marker path changed — update hook + README + this test together");
    assert.match(readme, /\*\*\/\.review-panel\//, "README .gitignore advice lost");
  });

  it("the hook derives the marker as <dir>/.review-panel/<basename>", () => {
    const hook = readFileSync("hooks/spec-plan-suggest.sh", "utf8");
    assert.match(hook, /\$\{FILE_PATH%\/\*\}\/\.review-panel\/\$\{FILE_PATH##\*\/\}/,
      "marker derivation in the hook no longer matches the skill's marker layout");
  });
});

describe("reviewer locked schema (drift locks)", () => {
  const reviewers = ["glm-review-design", "glm-review-code"];
  const src = (r) => readFileSync(`agents/${r}.md`, "utf8");

  it("tools line is exactly `Read, Grep, Glob` (no Bash)", () => {
    for (const r of reviewers) {
      assert.match(src(r), /tools: Read, Grep, Glob$/m, `${r} tools line drifted`);
    }
  });

  it("defaults to glm-5.2[1m]", () => {
    for (const r of reviewers) {
      assert.match(src(r), /\nmodel:\s*glm-5\.2\[1m\]/, `${r} wrong default model`);
    }
  });

  it("body carries the five locked schema headings", () => {
    for (const r of reviewers) {
      assert.match(src(r), /## must-resolve/, `${r} missing must-resolve`);
      assert.match(src(r), /## should-clarify/, `${r} missing should-clarify`);
      assert.match(src(r), /## consider/, `${r} missing consider`);
      assert.match(src(r), /## gaps/, `${r} missing gaps`);
      assert.match(src(r), /## non-applicable-axes/, `${r} missing non-applicable-axes`);
    }
  });

  it("finding lines carry the [h/m/l] confidence prefix", () => {
    for (const r of reviewers) {
      assert.match(src(r), /^- \[[hml]\] /m, `${r} missing confidence-prefixed finding line`);
    }
  });

  it("frames as the CHEAP, WIDE pass and closes with the confirm note", () => {
    for (const r of reviewers) {
      assert.match(src(r), /CHEAP, WIDE pass/, `${r} missing cheap-wide framing`);
      assert.match(src(r), /GLM first-pass — confirm before acting/, `${r} missing confirm note`);
      assert.match(src(r), /confidence/i, `${r} missing confidence rule`);
    }
  });
});

describe("removed agents stay gone (negative existence)", () => {
  it("the three deleted reviewers and the renamed bulk-reader do not exist", () => {
    for (const f of ["glm-review-implementation", "glm-review-plan", "glm-review-spec", "glm-bulk-reader"]) {
      assert.ok(!existsSync(`agents/${f}.md`), `agents/${f}.md should not exist`);
    }
  });
});

describe("glm-review-design axes (8 greps for 7 axes, by design)", () => {
  const src = () => readFileSync("agents/glm-review-design.md", "utf8");
  const axes = [
    /Ambiguity/, /Completeness/, /Gaps/, /Contradictions/,
    /Testability/, /Sequencing/, /Risk & blast radius/, /Assumptions/,
  ];
  it("body names all seven axes (Completeness and Gaps asserted separately)", () => {
    for (const rx of axes) {
      assert.match(src(), rx, `glm-review-design missing axis ${rx}`);
    }
  });
});

describe("review-panel reviewer-selection map (drift locks)", () => {
  const s = () => readFileSync("skills/review-panel/SKILL.md", "utf8");

  it("names both doc globs", () => {
    assert.match(s(), /\*-design\.md/);
    assert.match(s(), /\*-plan\.md/);
  });

  it("routes spec and plan docs to glm-review-design", () => {
    assert.match(s(), /spec.*glm-review-design/);
    assert.match(s(), /plan.*glm-review-design/);
  });

  it("routes code and implementation checks to glm-review-code", () => {
    assert.match(s(), /code.*glm-review-code/);
    assert.match(s(), /implementation.*glm-review-code/);
  });

  it("run-report template uses a <reviewer> placeholder, not a hardcoded agent", () => {
    assert.match(s(), /<reviewer>/);
    assert.doesNotMatch(s(), /reviewer:\*\* glm-review-spec/);
  });
});

describe("glm-scout agent (drift locks)", () => {
  const src = () => readFileSync("agents/glm-scout.md", "utf8");

  it("carries the discovery mandate literally", () => {
    assert.match(src(), /discover with Grep\/Glob before reading/);
  });

  it("keeps the read-only shell restriction", () => {
    assert.match(src(), /Read-only shell \(ls, grep, cat\) only/);
  });

  it("is discovery-tier: exact tools line with Bash, no Edit/Write", () => {
    assert.match(src(), /tools: Read, Grep, Glob, Bash$/m);
  });
});

describe("glm-implementer agent (drift locks)", () => {
  const src = () => readFileSync("agents/glm-implementer.md", "utf8");

  it("is the only write-capable shape: exact tools line + model", () => {
    assert.match(src(), /tools: Read, Grep, Glob, Bash, Edit, Write$/m);
    assert.match(src(), /model: glm-5.2\[1m\]/);
  });

  it("carries the stop signal and the one-task scope delimiter", () => {
    assert.match(src(), /STATUS:/);
    assert.match(src(), /exactly one task/);
  });
});

describe("README roster invariant (README.md only — CHANGELOG exempt)", () => {
  const s = () => readFileSync("README.md", "utf8");
  const CURRENT = [
    "glm-brainstorm", "glm-scout", "glm-code-crawler",
    "glm-implementer", "glm-review-code", "glm-review-design",
  ];
  const REMOVED = [
    "glm-review-spec", "glm-review-plan",
    "glm-review-implementation", "glm-bulk-reader",
  ];

  it("names all six current agents", () => {
    for (const a of CURRENT) {
      assert.ok(s().includes(a), `README missing ${a}`);
    }
  });

  it("names none of the four removed/renamed agents", () => {
    for (const a of REMOVED) {
      assert.ok(!s().includes(a), `README still names ${a}`);
    }
  });

  it("still documents the synthesis buckets (spec: README:84 unchanged but verified)", () => {
    assert.ok(s().includes("must-resolve"), "README missing must-resolve bucket");
    assert.ok(s().includes("should-clarify"), "README missing should-clarify bucket");
    assert.ok(s().includes("consider"), "README missing consider bucket");
  });

  it("documents the consolidated model command with its group flags", () => {
    assert.ok(s().includes("/cc-agents:model"), "README missing /cc-agents:model section");
    for (const flag of ["--implementer", "--crawler", "--scout", "--brainstorm", "--all"]) {
      assert.ok(s().includes(flag), `README missing ${flag} in the model command docs`);
    }
  });

  it("no longer documents the removed per-agent command names", () => {
    for (const cmd of ["/cc-agents:crawler-model", "/cc-agents:implementer-model"]) {
      assert.ok(!s().includes(cmd), `README still documents removed command ${cmd}`);
    }
  });
});

describe("CHANGELOG 0.2.1 entry (append-only carve-out: old names allowed in history)", () => {
  it("has a 0.2.1 entry naming all four removed/renamed agents", () => {
    const s = readFileSync("CHANGELOG.md", "utf8");
    const start = s.indexOf("## [0.2.1]");
    assert.ok(start >= 0, "no 0.2.1 entry");
    const rest = s.slice(start);
    const end = rest.indexOf("\n## [", 1);
    const entry = end === -1 ? rest : rest.slice(0, end);
    for (const a of ["glm-review-spec", "glm-review-plan", "glm-review-implementation", "glm-bulk-reader"]) {
      assert.ok(entry.includes(a), `0.2.1 entry missing ${a}`);
    }
  });

  it("plugin.json and package.json agree, and match the newest CHANGELOG heading", () => {
    const plugin = JSON.parse(readFileSync(".claude-plugin/plugin.json", "utf8"));
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    // Track the newest CHANGELOG heading instead of a hardcoded version, so this
    // drift-lock stops going stale on every release (it needed a manual bump at
    // 0.2.0→0.2.1). The release-gate re-checks the same coupling at tag time.
    const changelog = readFileSync("CHANGELOG.md", "utf8");
    const newest = (changelog.match(/^## \[(\d+\.\d+\.\d+)\]/m) || [])[1];
    assert.ok(newest, "no semver heading in CHANGELOG");
    assert.equal(plugin.version, pkg.version, "plugin.json and package.json disagree");
    assert.equal(plugin.version, newest, `plugin.json ${plugin.version} != newest CHANGELOG ${newest}`);
  });
});
