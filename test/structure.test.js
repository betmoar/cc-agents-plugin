import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { readFileSync, readdirSync } from "node:fs";

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
  const reviewers = [
    "glm-review-spec", "glm-review-plan",
    "glm-review-code", "glm-review-implementation",
  ];
  it("all agent files have a name/description/model frontmatter", () => {
    for (const f of readdirSync("agents").filter((n) => n.endsWith(".md"))) {
      const src = readFileSync(`agents/${f}`, "utf8");
      assert.ok(src.startsWith("---"), `${f} missing frontmatter`);
      assert.match(src, /\nname:\s*\S+/, `${f} missing name`);
      assert.match(src, /\ndescription:\s*\S+/, `${f} missing description`);
      assert.match(src, /\nmodel:\s*\S+/, `${f} missing model`);
    }
  });
  it("the four reviewers default to glm-5.2[1m]", () => {
    for (const r of reviewers) {
      const src = readFileSync(`agents/${r}.md`, "utf8");
      assert.match(src, /\nmodel:\s*glm-5\.2\[1m\]/, `${r} wrong default model`);
    }
  });
  it("the four reviewers carry no Bash (read-only least privilege)", () => {
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

describe("reviewer shared invariants (drift locks)", () => {
  const reviewers = [
    "glm-review-spec", "glm-review-plan",
    "glm-review-code", "glm-review-implementation",
  ];
  const src = (r) => readFileSync(`agents/${r}.md`, "utf8");
  // Fails with a readable assertion instead of throwing if a `tools:` line is
  // missing or the regex drifts (the old `(…||[])[1].trim()` threw TypeError).
  const toolsLine = (r) => {
    const m = src(r).match(/\ntools:\s*(.+)/);
    assert.ok(m, `${r}: no \`tools:\` line found`);
    return m[1].trim();
  };

  it("all four share one identical read-only tools line", () => {
    const lines = reviewers.map(toolsLine);
    const uniq = [...new Set(lines)];
    assert.equal(uniq.length, 1, `tools lines diverge: ${uniq.join(" | ")}`);
    assert.equal(uniq[0], "Read, Grep, Glob");
  });

  it("all four frame themselves as the CHEAP, WIDE pass", () => {
    for (const r of reviewers) {
      assert.match(src(r), /CHEAP, WIDE pass/i, `${r} missing cheap-wide framing`);
    }
  });

  it("all four close with the GLM first-pass confirm note", () => {
    for (const r of reviewers) {
      assert.match(src(r), /GLM first-pass — confirm before acting/, `${r} missing confirm note`);
    }
  });

  it("all four require a confidence rating", () => {
    for (const r of reviewers) {
      assert.match(src(r), /confidence/i, `${r} missing confidence rule`);
    }
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
