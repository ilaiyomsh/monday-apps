#!/usr/bin/env bash
# release-debt-nudge.sh — PostToolUse(Bash) hook: the agent-side half of the
# accumulation backstop (owner decision 2026-07-14).
#
# After any commit/merge command in an agent session, count per-app release
# debt (commits on develop not yet on main) via scripts/release-debt.sh.
# Above the threshold (10) the script prints a friendly Hebrew nudge, which
# lands in the agent's context — the agent relays it to the user.
# The CI half is .github/workflows/release-debt.yml (same script).
#
# Always exits 0 — advisory only, never blocks.
set -uo pipefail

input="$(cat)"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)" || exit 0
case "$cmd" in
  *"git commit"*|*"git merge"*|*"gh pr merge"*) ;;
  *) exit 0 ;;
esac

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
[ -f scripts/release-debt.sh ] || exit 0
bash scripts/release-debt.sh --fetch 2>/dev/null || true
exit 0
