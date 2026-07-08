#!/usr/bin/env bash
# PostToolUse hook for cc-agents. Reads a tool-call payload on stdin; if the
# written file is a spec (*-design.md under specs/) or a plan (*-plan.md under
# specs/ or plans/), prints an ADVISORY additionalContext suggestion to convene
# the review-panel skill. Otherwise prints nothing. Never blocks. node -e parses
# the JSON (no jq dependency).
set -euo pipefail

PAYLOAD="$(cat)"

# Advisory contract: this hook must NEVER surface an error on a routine
# Write/Edit. If node is somehow absent we cannot parse the payload — go
# silent rather than failing every file write in the session.
command -v node >/dev/null 2>&1 || exit 0

# Extract tool_input.file_path with node (jq is not a dependency).
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

# Skip the review-panel's own run-report marker. Its path sits under specs/
# and its basename inherits the reviewed artifact's suffix, so it would look
# like a nested spec/plan and re-trigger the panel on itself.
case "$FILE_PATH" in
  */.review-panel/*) exit 0 ;;
esac

KIND=""
# spec: *-design.md with a /specs/ segment in the path
if printf '%s' "$FILE_PATH" | grep -Eq '(^|/)specs/.*-design\.md$'; then
  KIND="spec"
# plan: *-plan.md with a /specs/ or /plans/ segment in the path
elif printf '%s' "$FILE_PATH" | grep -Eq '(^|/)(specs|plans)/.*-plan\.md$'; then
  KIND="plan"
fi

[ -n "$KIND" ] || exit 0

# Marker-aware suggestion. The review-panel skill writes its run report at
# <artifact-dir>/.review-panel/<artifact-basename>.md; that file's presence
# means the panel already ran on this artifact. Without this check, the
# panel's own append of the "## Clarifications" section to the artifact
# re-fires this hook and re-suggests a fresh panel — a feedback loop.
# (KIND is only set when the path contains a specs/ or plans/ segment, so
# FILE_PATH always has a slash and ${FILE_PATH%/*} is safe.)
MARKER="${FILE_PATH%/*}/.review-panel/${FILE_PATH##*/}"
if [ -f "$MARKER" ]; then
  MSG="A ${KIND} was updated at ${FILE_PATH}, but a review-panel run report already exists for it (${MARKER}). Re-convene the review-panel skill ONLY if the ${KIND}'s substance changed since that run — never for mechanical appends such as the Clarifications section."
else
  MSG="A ${KIND} was written at ${FILE_PATH}. Convene the review-panel skill — it will review it and ask any clarifying questions — unless the user directed otherwise."
fi

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
