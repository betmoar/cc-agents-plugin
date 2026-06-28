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
