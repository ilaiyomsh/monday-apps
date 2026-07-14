#!/usr/bin/env bash
# bump.sh — bump an app's version inside a task branch.
#
#   scripts/bump.sh <app-slug> [patch|minor|major]     (default: patch)
#
# Spec (docs/monday-cicd-spec.md §versioning): the bump happens at entry into
# develop, inside the task branch, as part of the PR. The magnitude is the
# agent's call by the customer-impact table (ten-second rule: if you
# deliberate longer, it's a patch), announced in the report.
# package.json is the single source of truth; tags/display/changelog derive.
#
# BUMP ONCE PER CANDIDATE (owner rule 2026-07-14): version numbers count
# RELEASES, not PRs. A candidate already above main keeps its number through
# every draft iteration — the build SHA distinguishes builds. This script
# REFUSES a default bump when the app is already above main; pass an explicit
# level (patch|minor|major) only for a deliberate magnitude raise (a bigger
# change joined the pending candidate). There is NO bump-per-PR convention.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
source scripts/apps.sh

if [ $# -lt 1 ]; then
  echo "usage: scripts/bump.sh <app-slug> [patch|minor|major]" >&2
  echo "apps: ${APP_SLUGS[*]}" >&2
  exit 1
fi

slug="$1"
level="${2:-patch}"
case "$level" in patch|minor|major) ;; *)
  echo "invalid level '$level' (patch|minor|major)" >&2; exit 1 ;;
esac

path="$(app_path "$slug")"

branch="$(git branch --show-current)"
if [ "$branch" = "develop" ] || [ "$branch" = "main" ]; then
  echo "::error::bump only runs in task branches — you are on '$branch'" >&2
  exit 1
fi

old="$(jq -r .version "$path/package.json")"

# --- bump-once-per-candidate gate ---
strictly_higher() { [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | tail -1)" = "$2" ] && [ "$1" != "$2" ]; }
main_ver="$(git show "origin/main:$path/package.json" 2>/dev/null | jq -r .version 2>/dev/null || echo "")"
if [ -n "$main_ver" ] && strictly_higher "$main_ver" "$old"; then
  if [ $# -lt 2 ] || [ "$level" = "patch" ]; then
    echo "REFUSED: $slug is already a pending candidate ($old > main's $main_ver)." >&2
    echo "Draft iterations KEEP the candidate's number — the build SHA tells builds apart." >&2
    echo "Another patch here is exactly the noise the owner banned (2026-07-14)." >&2
    echo "Bump again ONLY to raise the magnitude because a bigger change joined:" >&2
    echo "  scripts/bump.sh $slug minor|major" >&2
    exit 1
  fi
  echo "note: deliberate raise of an unreleased candidate ($old, main has $main_ver) — the old number is abandoned, never shipped."
fi

( cd "$path" && npm version "$level" --no-git-tag-version >/dev/null )
new="$(jq -r .version "$path/package.json")"

echo "$slug: $old -> $new ($level)"
echo "reminder: add a $new entry to $path/CHANGELOG.md in this same PR."
