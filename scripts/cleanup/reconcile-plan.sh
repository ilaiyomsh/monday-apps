#!/usr/bin/env bash
# Cleanup gate step: a batch may only be `done` when every one of its findings is
# ACCOUNTED FOR — applied, skipped (with reason), or guard-blocked. Struck findings
# (refutation pass) are exempt: they were removed from scope before approval.
#
# Why this exists: in round 2, batch 7 was committed and flipped to `done` while an
# approved, non-struck finding (A-structure-07) had simply never run — not applied, not
# skipped, not recorded anywhere. The plan then asserted "11 of 13 findings executed"
# when it was 10, and only the stage-3 LLM reviewer caught it. "Done" was a declaration;
# this script makes it an accounting identity a grep can check.
#
# The executor writes one disposition bullet per finding at execute time:
#   - disposition: applied
#   - disposition: skipped — <reason>
#   - disposition: guard-blocked — <guard message>
#
# Usage:
#   bash scripts/cleanup/reconcile-plan.sh --batch N [plan]   # before flipping N to done
#   bash scripts/cleanup/reconcile-plan.sh --all-done [plan]  # stage 3: audit every done batch
# exit 0 — fully accounted; exit 1 — unaccounted findings listed (the batch is NOT done)
set -uo pipefail

MODE="${1:-}"
case "$MODE" in
  --batch)    TARGET_BATCH="${2:?usage: reconcile-plan.sh --batch N [plan]}"; PLAN="${3:-apps/twyst-your-status/.cleanup/CLEANUP_PLAN.md}" ;;
  --all-done) TARGET_BATCH=""; PLAN="${2:-apps/twyst-your-status/.cleanup/CLEANUP_PLAN.md}" ;;
  *) echo "usage: reconcile-plan.sh --batch N [plan] | --all-done [plan]"; exit 1 ;;
esac

[ -f "$PLAN" ] || { echo "FATAL: $PLAN does not exist."; exit 1; }

# One awk pass emits a flat record per finding:  batch|status|id|struck|disposition
# Blocks end at the next ### / ## heading. The appendix (non-actionable) is outside
# any "## Batch" section, so its ### entries carry batch="" and are ignored.
records=$(awk '
  function flush() {
    if (id != "") print batch "|" status "|" id "|" struck "|" dispo
    id = ""; struck = 0; dispo = ""
  }
  /^## Batch [0-9]+/ {
    flush()
    match($0, /Batch [0-9]+/); batch = substr($0, RSTART+6, RLENGTH-6)
    status = "unknown"
    next
  }
  /^## / { flush(); batch = "" ; next }
  /^risk:.*status:/ {
    if (id == "") { s = $0; sub(/.*status:[[:space:]]*/, "", s); sub(/[[:space:]].*/, "", s); status = s }
    next
  }
  /^### / {
    flush()
    if (batch != "") {
      line = $0; sub(/^### +/, "", line)
      id = line; sub(/[[:space:]].*/, "", id)
      if (line ~ /STRUCK|struck|⛔/) struck = 1
    }
    next
  }
  /^- disposition:[[:space:]]*(applied|skipped|guard-blocked)/ { if (id != "") dispo = "yes"; next }
  END { flush() }
' "$PLAN")

fail=0
checked=0

check_batch() { # $1 = batch number
  local n="$1" missing
  missing=$(awk -F'|' -v n="$n" '$1 == n && $4 == 0 && $5 == "" { print "  - " $3 }' <<<"$records")
  local total struckcount accounted
  total=$(awk -F'|' -v n="$n" '$1 == n' <<<"$records" | wc -l)
  struckcount=$(awk -F'|' -v n="$n" '$1 == n && $4 == 1' <<<"$records" | wc -l)
  accounted=$(awk -F'|' -v n="$n" '$1 == n && $4 == 0 && $5 == "yes"' <<<"$records" | wc -l)
  if [ "$total" -eq 0 ]; then
    echo "FAIL: batch $n has no findings in $PLAN — wrong batch number, or the plan format drifted."
    fail=1; return
  fi
  if [ -n "$missing" ]; then
    echo "FAIL: batch $n is NOT fully accounted — $accounted/$((total - struckcount)) findings have a"
    echo "      disposition ($struckcount struck, exempt). Unaccounted:"
    echo "$missing"
    echo "      Every non-struck finding needs '- disposition: applied|skipped — reason|guard-blocked'"
    echo "      BEFORE the batch may be flipped to done. A silently missing finding is round 2's"
    echo "      A-structure-07 failure — the exact thing this check exists to make impossible."
    fail=1
  else
    echo "OK: batch $n — $accounted applied/skipped/guard-blocked + $struckcount struck = $total findings, all accounted."
  fi
  checked=$((checked + 1))
}

if [ -n "$TARGET_BATCH" ]; then
  check_batch "$TARGET_BATCH"
else
  for n in $(awk -F'|' '$2 == "done" { print $1 }' <<<"$records" | sort -un); do
    check_batch "$n"
  done
  if [ "$checked" -eq 0 ]; then
    echo "reconcile-plan: no batch is marked done in $PLAN — nothing to reconcile."
  fi
fi

exit "$fail"
