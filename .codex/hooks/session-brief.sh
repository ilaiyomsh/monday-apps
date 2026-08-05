#!/usr/bin/env bash
# session-brief.sh — SessionStart hook: inject the standing briefing.
#
# This is what makes the briefing STANDING instead of something a human retypes
# every session. Codex loads AGENTS.md on its own, but two things still need
# saying out loud at turn zero: skills are not auto-loaded in Codex, and the
# file-edit hooks may not fire, so parts of the enforcement are self-enforced.
#
# Content lives in .codex/briefing.md (edit that, not this script). Output is
# Codex's SessionStart contract: hookSpecificOutput.additionalContext, which is
# appended as developer context. Plain stdout also counts as additional context,
# so the no-python3 fallback still works.
#
# Never blocks and never fails a session: any problem exits 0 with a note on
# stderr.
set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." 2>/dev/null && pwd)"
BRIEFING="$REPO_ROOT/.codex/briefing.md"

if [ ! -f "$BRIEFING" ]; then
  echo "session-brief: $BRIEFING is missing — session starts without the briefing." >&2
  exit 0
fi

if command -v python3 >/dev/null 2>&1; then
  python3 -c '
import json, sys
try:
    with open(sys.argv[1], encoding="utf-8") as handle:
        text = handle.read()
except OSError as exc:
    sys.stderr.write("session-brief: cannot read briefing (%s)\n" % exc)
    sys.exit(0)
json.dump({
    "hookSpecificOutput": {
        "hookEventName": "SessionStart",
        "additionalContext": text,
    }
}, sys.stdout)
sys.stdout.write("\n")
' "$BRIEFING" || {
    echo "session-brief: JSON emit failed; falling back to plain text." >&2
    cat "$BRIEFING"
  }
else
  # No python3: plain stdout is accepted as additional context.
  cat "$BRIEFING"
fi

exit 0
