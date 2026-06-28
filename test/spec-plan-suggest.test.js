import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { execFileSync } from "node:child_process";

function runHook(filePath) {
  const payload = JSON.stringify({
    hook_event_name: "PostToolUse",
    tool_name: "Write",
    tool_input: { file_path: filePath, content: "x" },
    tool_response: { success: true },
  });
  return execFileSync("bash", ["hooks/spec-plan-suggest.sh"], {
    input: payload,
    encoding: "utf8",
  });
}

describe("spec-plan-suggest hook", () => {
  it("emits a spec-panel suggestion for a design doc under specs/", () => {
    const out = runHook("docs/superpowers/specs/2026-06-27-x-design.md");
    const j = JSON.parse(out);
    assert.equal(j.hookSpecificOutput.hookEventName, "PostToolUse");
    assert.match(j.hookSpecificOutput.additionalContext, /spec/i);
    assert.match(j.hookSpecificOutput.additionalContext, /x-design\.md/);
  });

  it("emits a plan-panel suggestion for a plan doc under plans/", () => {
    const out = runHook("docs/superpowers/plans/2026-06-27-x-plan.md");
    const j = JSON.parse(out);
    assert.match(j.hookSpecificOutput.additionalContext, /plan/i);
  });

  it("emits nothing for a non-matching path", () => {
    const out = runHook("src/foo.ts");
    assert.equal(out.trim(), "");
  });

  it("emits nothing for a design doc NOT under specs/ (over-match guard)", () => {
    const out = runHook("docs/ui/button-design.md");
    assert.equal(out.trim(), "");
  });
});
