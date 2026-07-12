#!/usr/bin/env bash
# error-guard-check.sh — PostToolUse hook (matcher: Write|Edit). Monorepo variant.
#
# Immediate-feedback layer of the error-guard skill: after every Write/Edit to
# an app source file (*.js/*.jsx/*.ts/*.tsx under this repo), run the
# error-guard rule set (scripts/check.sh) on just that file. If it finds
# violations, surface them to the agent (stderr + exit 2) — the rule message IS
# the remediation instruction. The hook never blocks the write itself.
#
# Paths are derived from this script's own location (.claude/hooks/ -> repo
# root), so the hook works from any clone, including cloud sessions.
#
# Reads the tool-call JSON on stdin (same convention as graphql-write-reminder.sh):
#   {"tool_name": "Write"|"Edit", "tool_input": {"file_path": "...", ...}}
#
# Exit codes: 2 = violations found (message on stderr, fed back to the agent);
#             0 = everything else — TOTAL FAIL-OPEN: any internal error, missing
#                 tool, unparseable input, or filtered-out path exits 0 silently.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." 2>/dev/null && pwd)"
CHECK_SH="$REPO_ROOT/.claude/skills/error-guard/scripts/check.sh"

main() {
  [ -n "$REPO_ROOT" ] || return 0

  # --- read + parse stdin (fail open on any parse problem) -------------------
  local raw file_path
  raw="$(cat 2>/dev/null)" || return 0
  [ -n "$raw" ] || return 0

  file_path="$(printf '%s' "$raw" | python3 -c '
import json, sys
try:
    payload = json.load(sys.stdin)
except Exception:
    sys.exit(0)
ti = payload.get("tool_input") or {}
# file_path is the documented key for Write/Edit; keep fallbacks for variants.
fp = ti.get("file_path") or ti.get("filePath") or ti.get("path") or ""
if isinstance(fp, str):
    sys.stdout.write(fp)
' 2>/dev/null)" || return 0
  [ -n "$file_path" ] || return 0

  # --- scope: app source files only ------------------------------------------
  case "$file_path" in
    "$REPO_ROOT"/*) : ;;
    *) return 0 ;;
  esac
  case "$file_path" in
    */.claude/*) return 0 ;;                # skill/hook files are not app source
  esac
  case "$file_path" in
    *.js|*.jsx|*.ts|*.tsx) : ;;
    *) return 0 ;;
  esac

  # --- test-guard interop: a .mutbak sibling means an ARMED test-guard mutation
  # is deliberately applied to this file (spot-check in progress). Findings on a
  # mutated body are noise, and "fix then re-edit" would break the one-mutation-
  # at-a-time protocol. The pristine file is re-checked on the restoring edit
  # after spotcheck-fire. (Added 2026-07-07 after the v2 shakedown collision.)
  [ -f "$file_path.mutbak" ] && return 0

  [ -f "$CHECK_SH" ] || return 0

  # --- run the error-guard check (check.sh: exit 1 = violations) -------------
  local out status
  out="$(bash "$CHECK_SH" "$file_path" 2>/dev/null)"
  status=$?

  if [ "$status" -eq 1 ] && [ -n "$out" ]; then
    {
      printf 'error-guard: the file you just wrote violates the error-catching rules.\n'
      printf 'Fix each finding below (the message is the remediation), then re-edit:\n'
      printf '%s\n' "$out"
    } >&2
    return 2
  fi

  return 0
}

# TOTAL FAIL-OPEN wrapper: only a clean "violations found" path may exit 2;
# every other outcome — including unexpected internal errors — exits 0.
main
rc=$?
if [ "$rc" -eq 2 ]; then
  exit 2
fi
exit 0
