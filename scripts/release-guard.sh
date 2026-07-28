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
#
# An app's FIRST release is the one case with nothing to compare against, and it
# used to abort the whole guard — see the `git cat-file` branch below.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
source scripts/apps.sh

MAIN="origin/main"
fail=0

strictly_higher() { [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | tail -1)" = "$2" ] && [ "$1" != "$2" ]; }

for slug in "${APP_SLUGS[@]}"; do
  path="$(app_path "$slug")"
  changed=$(git diff --name-only "$MAIN"...HEAD -- "$path" "${SHARED_PATHS[@]}" | wc -l | tr -d ' ')
  vn="$(jq -r .version "$path/package.json")"

  # FIRST RELEASE — the app is not on main yet.
  #
  # All three checks below compare against a released version. There isn't one, so
  # there is no released number to protect: the only thing worth asserting is that
  # the app HAS a version. Before this branch existed, `git show` on a path absent
  # from main exited 128 ("exists on disk, but not in origin/main") and, under
  # `set -euo pipefail`, killed the guard on the spot — aborting it before it had
  # checked the remaining apps. So an app could never have a first release through
  # this gate at all. The header's claim that "the hotfix path passes the same
  # guard" held only for apps already on main.
  #
  # This weakens nothing for an app that IS on main: that path is untouched below.
  if ! git cat-file -e "$MAIN:$path/package.json" 2>/dev/null; then
    if [ -z "$vn" ] || [ "$vn" = "null" ]; then
      echo "::error::$slug: first release but package.json carries no version"; fail=1
    else
      echo "release-guard: $slug is a FIRST release (absent from $MAIN) — version $vn"
    fi
    continue
  fi

  vo="$(git show "$MAIN:$path/package.json" | jq -r .version)"

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
