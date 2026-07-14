import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function runHook(filePath, opts = {}) {
  const payload = JSON.stringify({
    hook_event_name: "PostToolUse",
    tool_name: "Write",
    tool_input: { file_path: filePath, content: "x" },
    tool_response: { success: true },
  });
  return execFileSync("bash", ["hooks/spec-plan-suggest.sh"], {
    input: payload,
    encoding: "utf8",
    ...opts,
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

  it("emits nothing for the panel's own run-report marker (self-review guard)", () => {
    // The marker basename inherits the reviewed artifact's suffix, so
    // .../specs/.review-panel/auth-design.md looks like a nested spec.
    // The panel must not be told to review its own marker.
    const out = runHook("docs/superpowers/specs/.review-panel/auth-design.md");
    assert.equal(out.trim(), "");
  });

  // LOOP-BREAKER drift-lock: the panel appends "## Clarifications" to the
  // reviewed artifact, which re-fires this hook. When the run-report marker
  // (<dir>/.review-panel/<basename>) already exists, the hook must switch to
  // the "already reviewed" advisory instead of re-suggesting a fresh panel.
  it("softens the suggestion when the run-report marker already exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "ccagents-marker-"));
    try {
      const specsDir = join(dir, "specs");
      mkdirSync(join(specsDir, ".review-panel"), { recursive: true });
      const artifact = join(specsDir, "auth-design.md");
      writeFileSync(artifact, "# spec\n");
      writeFileSync(join(specsDir, ".review-panel", "auth-design.md"), "# Panel run\n");

      const j = JSON.parse(runHook(artifact));
      const msg = j.hookSpecificOutput.additionalContext;
      assert.match(msg, /already exists/i);
      assert.match(msg, /ONLY if/);
      assert.doesNotMatch(msg, /^A spec was written/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("still emits the full suggestion when no marker exists (absolute path)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ccagents-nomarker-"));
    try {
      mkdirSync(join(dir, "specs"), { recursive: true });
      const artifact = join(dir, "specs", "auth-design.md");
      writeFileSync(artifact, "# spec\n");
      const j = JSON.parse(runHook(artifact));
      assert.match(j.hookSpecificOutput.additionalContext, /Convene the review-panel skill/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // ADVISORY-CONTRACT drift-lock: the hook runs on EVERY Write/Edit; if node
  // is missing it must exit 0 silently, not fail every file write in a session.
  it("exits 0 and emits nothing when node is not on PATH", () => {
    const fakebin = mkdtempSync(join(tmpdir(), "ccagents-nonode-"));
    try {
      for (const bin of ["bash", "cat", "grep"]) {
        const real = execFileSync("bash", ["-c", `command -v ${bin}`], { encoding: "utf8" }).trim();
        symlinkSync(real, join(fakebin, bin));
      }
      const out = runHook("docs/superpowers/specs/x-design.md", { env: { PATH: fakebin } });
      assert.equal(out.trim(), "");
    } finally {
      rmSync(fakebin, { recursive: true, force: true });
    }
  });
});
