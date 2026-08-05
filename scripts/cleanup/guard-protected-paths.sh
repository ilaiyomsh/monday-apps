#!/usr/bin/env bash
# PreToolUse hook (Edit|Write|MultiEdit) for the cleanup-executor subagent.
#
# Reads the hook JSON from stdin. exit 0 = allow, exit 2 = block and send stderr back to
# the agent as the reason. Together with its sibling guard-bash-ops.py (same hook, matcher
# Bash) this is the physical half of "cleanup, twyst-your-status ONLY" — the prompts say it,
# these two decide it. Both delegate to ONE decision function in lib-path-verdict.sh so a
# rule can never hold on one surface and not the other.
#
# Self-test: bash scripts/cleanup/guard-protected-paths.test.sh
set -uo pipefail

command -v jq >/dev/null 2>&1 || {
  echo "Blocked: jq is required by the cleanup guard and is not installed. Install jq — the guard fails closed on purpose." >&2
  exit 2
}

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
# shellcheck source=./cleanup-env.sh
. "$ROOT/scripts/cleanup/cleanup-env.sh"
# shellcheck source=./lib-path-verdict.sh
. "$ROOT/scripts/cleanup/lib-path-verdict.sh"

INPUT=$(cat)
FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // .tool_input.edits[0].file_path // empty')
[ -z "$FILE" ] && exit 0

VERDICT="$(cleanup_path_verdict "$FILE")"
case "$VERDICT" in
  ALLOW) exit 0 ;;
  BLOCK\|*)
    echo "Blocked by the cleanup guard: ${VERDICT#BLOCK|}" >&2
    exit 2 ;;
  *)
    # Unrecognized verdict = a bug in the decision function. Fail closed: an unenforced
    # guard is indistinguishable from a guard that passed.
    echo "Blocked by the cleanup guard: the path decision function returned an unexpected verdict ('$VERDICT') for $FILE. Failing closed — fix scripts/cleanup/lib-path-verdict.sh." >&2
    exit 2 ;;
esac
