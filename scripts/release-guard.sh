#!/usr/bin/env bash
# release-guard.sh — runs in CI on PRs targeting main (a release).
#
# Every decision was already made at develop entry; this only verifies
# consistency:
#   1. An app whose code changed since main (incl. via shared paths) must
#      carry a new version — no "quiet fixes" on a released number.
#   2. An app with no code changes must not change its version.
#   3. Versions on main only ever increase.
#
# The hotfix path passes the same guard: a hotfix branch from main bumps its
# own version, and the checks hold.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
source scripts/apps.sh

MAIN="origin/main"
fail=0

strictly_higher() { [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | tail -1)" = "$2" ] && [ "$1" != "$2" ]; }

for slug in "${APP_SLUGS[@]}"; do
  path="$(app_path "$slug")"
  changed=$(git diff --name-only "$MAIN"...HEAD -- "$path" "${SHARED_PATHS[@]}" | wc -l | tr -d ' ')
  vo="$(git show "$MAIN:$path/package.json" | jq -r .version)"
  vn="$(jq -r .version "$path/package.json")"

  if [ "$changed" -gt 0 ] && [ "$vo" = "$vn" ]; then
    echo "::error::$slug changed since main but version was not bumped ($vo)"; fail=1
  fi
  if [ "$changed" -eq 0 ] && [ "$vo" != "$vn" ]; then
    echo "::error::$slug: version changed ($vo -> $vn) with no code changes"; fail=1
  fi
  if [ "$vo" != "$vn" ]; then
    strictly_higher "$vo" "$vn" || { echo "::error::$slug: version went backwards ($vo -> $vn)"; fail=1; }
  fi
done

[ "$fail" -eq 0 ] && echo "release-guard: all apps consistent for release"
exit $fail
