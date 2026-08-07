#!/usr/bin/env bash
# Cleanup gate step: every `status: approved` line in CLEANUP_PLAN.md must have been
# COMMITTED BY A HUMAN. This is the fail-closed half of the approval chain of custody;
# scripts/cleanup/guard-approval-word.sh is the preventive half (agents cannot write the
# word at all).
#
# Why this exists: in round 2 (commit 953f8ce) an agent transcribed the owner's verbal
# approval into the plan, and a later agent treated that file as the human gate — the
# entire chain of custody was agent-authored, and only the stage-3 LLM reviewer noticed.
# This script makes the check mechanical: `git blame` each approved status line and
# reject any commit that is agent-authored (Claude author/email) or agent-assisted
# (Co-Authored-By: Claude / Claude-Session trailer — local agent commits carry the
# human's git identity, so author alone is not enough). An uncommitted approval is also
# rejected: custody means a human identity in git history, not bytes in a working tree.
#
# Usage: bash scripts/cleanup/verify-approval.sh [path/to/CLEANUP_PLAN.md]
#   exit 0 — every approved batch has human custody (or none is approved)
#   exit 1 — at least one approval line fails custody; execution must not start
set -uo pipefail

cd "$(git rev-parse --show-toplevel)" || { echo "FATAL: not inside a git repo"; exit 1; }
PLAN="${1:-apps/twyst-your-status/.cleanup/CLEANUP_PLAN.md}"

[ -f "$PLAN" ] || { echo "verify-approval: $PLAN does not exist — nothing to verify."; exit 0; }

# Collect "<line-number>:<batch>" pairs for every batch status line set to approved.
# The batch status line format is `risk: X | status: approved`, attributed to the
# nearest preceding `## Batch N` heading. Summary-table cells are presentation, not
# the gate — the batch line is authoritative.
mapfile -t approved_lines < <(awk '
  /^## Batch [0-9]+/ { match($0, /Batch [0-9]+/); batch = substr($0, RSTART+6, RLENGTH-6) }
  /^risk:.*status:[[:space:]]*[Aa]pproved/ { print NR ":" batch }
' "$PLAN")

if [ "${#approved_lines[@]}" -eq 0 ]; then
  echo "verify-approval: no batch is approved in $PLAN — nothing to verify."
  exit 0
fi

fail=0
for entry in "${approved_lines[@]}"; do
  line="${entry%%:*}"
  batch="${entry##*:}"

  blame=$(git blame -L "$line,$line" --porcelain -- "$PLAN" 2>/dev/null) || {
    echo "FAIL: batch $batch — could not blame $PLAN:$line (file not committed?)."
    fail=1; continue
  }
  sha=$(head -1 <<<"$blame" | awk '{print $1}')
  author=$(grep -m1 '^author ' <<<"$blame" | cut -d' ' -f2-)
  mail=$(grep -m1 '^author-mail ' <<<"$blame" | cut -d' ' -f2- | tr -d '<>')

  if [[ "$sha" =~ ^0+$ ]]; then
    echo "FAIL: batch $batch — the approval on $PLAN:$line is UNCOMMITTED."
    echo "      Custody means a human identity in git history. The owner commits the"
    echo "      approval themselves; an agent never commits it for them."
    fail=1; continue
  fi

  msg=$(git log -1 --format='%B' "$sha")
  reason=""
  case "$author $mail" in
    *[Cc]laude*|*noreply@anthropic.com*|*\[bot\]*) reason="agent-authored commit ($author <$mail>)" ;;
  esac
  if [ -z "$reason" ] && grep -qE 'Co-Authored-By:.*Claude|Claude-Session:' <<<"$msg"; then
    reason="agent-assisted commit (Claude trailer in the message)"
  fi

  if [ -n "$reason" ]; then
    echo "FAIL: batch $batch — approved in ${sha:0:9} by $reason."
    echo "      'approved' is a human-only word (CLAUDE.md, cleanup runbook). An agent"
    echo "      transcribing the owner's words is NOT custody — round 2's exact failure."
    echo "      The owner must set the word in their own editor and commit it under"
    echo "      their own git identity, then re-run this check."
    fail=1
  else
    echo "OK: batch $batch — approved in ${sha:0:9} by $author <$mail> (human custody)."
  fi
done

exit "$fail"
