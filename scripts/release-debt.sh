#!/usr/bin/env bash
# release-debt.sh — the accumulation backstop (owner decision 2026-07-14).
#
# The accumulation model has no corridor lock, so nothing mechanical stops
# develop from drifting 180 commits ahead of main again (the #103 backlog).
# This script counts, per app, how many commits on develop are not yet on
# main; above the threshold it emits a friendly nudge to release.
#
# Used by BOTH:
#   - CI (release-debt job in ci.yml, on pushes to develop) — job summary
#   - the checked-in Claude hook (.claude/settings.json) — after commits/merges
#
# Advisory by design: always exits 0. The nudge is the mechanism.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
source scripts/apps.sh

THRESHOLD="${DEBT_THRESHOLD:-10}"

# Best-effort refresh (hook context may be stale); never fail on network.
if [ "${1:-}" = "--fetch" ]; then
  git fetch origin develop main --quiet 2>/dev/null || true
fi

DEV="origin/develop"; MAIN="origin/main"
git rev-parse --verify --quiet "$DEV" >/dev/null || exit 0
git rev-parse --verify --quiet "$MAIN" >/dev/null || exit 0

nudges=()
for slug in "${APP_SLUGS[@]}"; do
  n=$(git rev-list --count "$MAIN..$DEV" -- "$(app_path "$slug")" "${SHARED_PATHS[@]}")
  if [ "$n" -gt "$THRESHOLD" ]; then
    nudges+=("$slug: $n commits on develop not yet on live")
  fi
done

[ "${#nudges[@]}" -eq 0 ] && exit 0

msg="🔔 הצטברו לא מעט שינויים בצנרת שעדיין לא שוחררו ל-live — כדאי לתכנן שחרור develop→main בקרוב 🙂"
echo "$msg"
for line in "${nudges[@]}"; do echo "  - $line"; done

# CI extras: yellow warning annotation + job summary
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### 🔔 Release debt above threshold ($THRESHOLD)"
    echo ""
    for line in "${nudges[@]}"; do echo "- $line"; done
    echo ""
    echo "Consider a develop→main release (see monday-cicd skill, release mode)."
  } >> "$GITHUB_STEP_SUMMARY"
  for line in "${nudges[@]}"; do echo "::warning::release debt — $line"; done
fi

exit 0
