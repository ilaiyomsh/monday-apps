#!/usr/bin/env bash
# PreToolUse hook (Edit|Write|MultiEdit + Bash) — repo-wide, every session and subagent.
#
# ONE rule: no agent ever writes `status: approved` into a CLEANUP_PLAN.md. That word is
# the human gate of the cleanup workflow, and round 2 (commit 953f8ce) proved that as a
# discipline-only rule it fails: an agent transcribed the owner's verbal approval into the
# plan, a later agent treated the file as the gate, and the chain of custody was
# agent-authored end to end. This hook makes the violation physically impossible at the
# tool call; scripts/cleanup/verify-approval.sh is the fail-closed backstop that checks
# the git authorship of every approved line at execute time.
#
# Flipping approved → done stays allowed (the guard inspects only NEW content on the Edit
# surface). On the Bash surface any write-shaped command that touches the plan AND
# mentions the word is blocked — including the approved→done flip via `sed -i`; use the
# Edit tool for that, it can see what you are actually introducing.
#
# exit 0 = allow, exit 2 = block (stderr becomes the agent-facing reason).
# Self-test: bash scripts/cleanup/guard-approval-word.test.sh
set -uo pipefail

command -v jq >/dev/null 2>&1 || {
  echo "Blocked: jq is required by the approval-word guard and is not installed. The guard fails closed on purpose." >&2
  exit 2
}

INPUT=$(cat)
TOOL=$(printf '%s' "$INPUT" | jq -r '.tool_name // empty')

# The two patterns that constitute "writing the approval": a status field set to the
# word, or a bare `approved` summary-table cell. Prose ABOUT approval (the plan header,
# an evidence cell) matches neither.
STATUS_RE='status:[[:space:]]*[Aa]pproved'
CELL_RE='\|[[:space:]]*[Aa]pproved[[:space:]]*\|'

block() {
  echo "Blocked by the approval-word guard: $1 'status: approved' in a CLEANUP_PLAN.md is the human gate of the cleanup workflow — no agent writes it, ever (CLAUDE.md, cleanup runbook). If the owner has approved batches, they set the word themselves in their editor and commit it under their own git identity; scripts/cleanup/verify-approval.sh checks that authorship before anything executes. If you are flipping approved → done, use the Edit tool with the new status only." >&2
  exit 2
}

case "$TOOL" in
  Edit|Write|MultiEdit)
    FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty')
    case "$(basename "$FILE")" in
      CLEANUP_PLAN.md) ;;
      *) exit 0 ;;
    esac
    NEW=$(printf '%s' "$INPUT" | jq -r '[.tool_input.new_string // empty, .tool_input.content // empty, ((.tool_input.edits // [])[] | .new_string // empty)] | join("\n")')
    if printf '%s' "$NEW" | grep -qE "$STATUS_RE|$CELL_RE"; then
      block "this $TOOL introduces it."
    fi
    exit 0
    ;;
  Bash)
    CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty')
    # Only write-shaped commands that involve the plan file AND the word. Reads
    # (grep/cat) and plan commits pass through untouched. "Write-shaped" means the
    # write operator sits in the SAME command segment as the plan path (segments end
    # at | ; & or a newline — grep is line-based, so newlines split for free): a `>`
    # or a quoted sed in a commit MESSAGE that merely mentions the plan is prose, not
    # a write. Found live 2026-08-07: the first version blocked this redesign's own
    # commit for exactly that. An oblique write this misses (exotic delimiters, cp
    # onto the plan) is caught fail-closed by verify-approval.sh at execute time.
    printf '%s' "$CMD" | grep -qi 'CLEANUP_PLAN' || exit 0
    printf '%s' "$CMD" | grep -qi 'approved' || exit 0
    if printf '%s' "$CMD" | grep -qE '(>>?[^|;&]*CLEANUP_PLAN|\bsed\b[^|;&]*[[:space:]](-[a-zA-Z]*i[a-zA-Z]*|--in-place)[^|;&]*CLEANUP_PLAN|\bperl\b[^|;&]*[[:space:]]-[a-zA-Z]*i[^|;&]*CLEANUP_PLAN|\btee\b[^|;&]*CLEANUP_PLAN)'; then
      block "this shell command writes it (or round-trips it) into the plan."
    fi
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
