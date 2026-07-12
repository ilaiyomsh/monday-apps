#!/usr/bin/env bash
# error-guard-check.sh — PostToolUse hook.
#
# Runs the error-guard single-file gate (skills/error-guard/scripts/check.sh) on the
# just-edited JS/JSX/TS/TSX file and surfaces any catch/log violations back to the
# agent. The write has already happened (PostToolUse), so this never blocks the edit —
# exit 2 only feeds the remediation message to the agent.
#
# Interop (error-guard SKILL.md §Self-correction rule 6): skip any file with a live
# `.mutbak` sibling — that's a test-guard mutation in progress; linting it is noise.
#
# Fail-open everywhere: a missing path, missing check.sh, or unknown extension exits 0.
set -euo pipefail

INPUT="$(cat)"
# Extract tool_input.file_path from the PostToolUse JSON (jq-free, tolerant).
FILE="$(printf '%s' "$INPUT" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"

[ -n "$FILE" ] || exit 0
[ -f "$FILE" ] || exit 0
[ -f "$FILE.mutbak" ] && exit 0   # test-guard mutation in progress — stay quiet

case "$FILE" in
  *.js | *.jsx | *.ts | *.tsx) ;;
  *) exit 0 ;;
esac

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK="$DIR/../skills/error-guard/scripts/check.sh"
[ -x "$CHECK" ] || exit 0

if OUT="$("$CHECK" "$FILE" 2>&1)"; then
  exit 0
fi

printf 'error-guard: unhandled-error violations in %s\n\n%s\n' "$FILE" "$OUT" >&2
exit 2
