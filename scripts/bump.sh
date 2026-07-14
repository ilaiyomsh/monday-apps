#!/usr/bin/env bash
# bump.sh — bump an app's version inside a task branch.
#
#   scripts/bump.sh <app-slug> [patch|minor|major]     (default: patch)
#
# Spec (docs/monday-cicd-spec.md §versioning): the bump happens at entry into
# develop, inside the task branch, as part of the PR. The magnitude is a human
# decision (ten-second rule: if you deliberate longer, it's a patch).
# package.json is the single source of truth; tags/display/changelog derive.
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
( cd "$path" && npm version "$level" --no-git-tag-version >/dev/null )
new="$(jq -r .version "$path/package.json")"

echo "$slug: $old -> $new ($level)"
echo "reminder: add a $new entry to $path/CHANGELOG.md in this same PR."
