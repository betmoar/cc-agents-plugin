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

describe("model commands", () => {
  it("model.md wraps set-model.sh and allows only that bash call", () => {
    const src = readFileSync("commands/model.md", "utf8");
    assert.match(src, /set-model\.sh/);
    assert.match(src, /allowed-tools:/);
    assert.match(src, /\$\{CLAUDE_PLUGIN_ROOT\}/);
  });
  it("crawler-model.md passes --crawler", () => {
    const src = readFileSync("commands/crawler-model.md", "utf8");
    assert.match(src, /set-model\.sh" --crawler/);
  });
  it("implementer-model.md passes --implementer", () => {
    const src = readFileSync("commands/implementer-model.md", "utf8");
    assert.match(src, /set-model\.sh" --implementer/);
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

  it("documents the implementer-model command", () => {
    assert.ok(s().includes("/cc-agents:implementer-model"), "README missing implementer-model section");
  });
});

describe("CHANGELOG 0.2.0 entry (append-only carve-out: old names allowed in history)", () => {
  it("has a 0.2.0 entry naming all four removed/renamed agents", () => {
    const s = readFileSync("CHANGELOG.md", "utf8");
    const start = s.indexOf("## [0.2.0]");
    assert.ok(start >= 0, "no 0.2.0 entry");
    const rest = s.slice(start);
    const end = rest.indexOf("\n## [", 1);
    const entry = end === -1 ? rest : rest.slice(0, end);
    for (const a of ["glm-review-spec", "glm-review-plan", "glm-review-implementation", "glm-bulk-reader"]) {
      assert.ok(entry.includes(a), `0.2.0 entry missing ${a}`);
    }
  });

  it("plugin.json and package.json agree on 0.2.0", () => {
    const plugin = JSON.parse(readFileSync(".claude-plugin/plugin.json", "utf8"));
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    assert.equal(plugin.version, "0.2.0");
    assert.equal(pkg.version, "0.2.0");
  });
});
