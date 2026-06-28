#!/usr/bin/env bash
# PostToolUse hook for cc-agents. Reads a tool-call payload on stdin; if the
# written file is a spec (*-design.md under specs/) or a plan (*-plan.md under
# specs/ or plans/), prints an ADVISORY additionalContext suggestion to convene
# the review-panel skill. Otherwise prints nothing. Never blocks. node -e parses
# the JSON (no jq dependency).
set -euo pipefail

PAYLOAD="$(cat)"

# Extract tool_input.file_path with node (guaranteed; jq is not a dependency).
FILE_PATH="$(printf '%s' "$PAYLOAD" | node -e '
  let s = "";
  process.stdin.on("data", (d) => (s += d));
  process.stdin.on("end", () => {
    try {
      const j = JSON.parse(s);
      process.stdout.write((j.tool_input && j.tool_input.file_path) || "");
    } catch { process.stdout.write(""); }
  });
')"

[ -n "$FILE_PATH" ] || exit 0

KIND=""
# spec: *-design.md with a /specs/ segment in the path
if printf '%s' "$FILE_PATH" | grep -Eq '(^|/)specs/.*-design\.md$'; then
  KIND="spec"
# plan: *-plan.md with a /specs/ or /plans/ segment in the path
elif printf '%s' "$FILE_PATH" | grep -Eq '(^|/)(specs|plans)/.*-plan\.md$'; then
  KIND="plan"
fi

[ -n "$KIND" ] || exit 0

MSG="A ${KIND} was written at ${FILE_PATH}. Convene the review-panel skill — it will review it and ask any clarifying questions — unless the user directed otherwise."

# Emit the advisory contract. node builds the JSON so the message is escaped safely.
KIND="$KIND" FILE_PATH="$FILE_PATH" MSG="$MSG" node -e '
  const out = {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: process.env.MSG,
    },
  };
  process.stdout.write(JSON.stringify(out));
'
exit 0
