#!/usr/bin/env bash
# PostToolUse hook (Edit|Write|MultiEdit) for the cleanup-executor subagent.
# Keeps a cleanup diff purely mechanical. Never fails the edit — exits 0 unconditionally.
#
# NO PRETTIER, deliberately: this repo has no prettier anywhere, so running it would
# reformat whole files to prettier's defaults and bury the one-line deletion the batch was
# supposed to be. What runs instead is each workspace's OWN eslint, with its own config and
# its own pinned major (the SPA is eslint 8 with the legacy eslintConfig block in
# package.json; the guard server is eslint 9 with a flat config), routed by which workspace
# the edited file belongs to. Both are green at baseline, so this only ever cleans up what
# the edit itself introduced — a dangling import, a now-unused variable.
set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
# shellcheck source=./cleanup-env.sh
. "$ROOT/scripts/cleanup/cleanup-env.sh"

INPUT=$(cat)
command -v jq >/dev/null 2>&1 || exit 0
FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // .tool_input.edits[0].file_path // empty')
[ -z "$FILE" ] && exit 0
[ -f "$FILE" ] || exit 0   # a dead-file batch just deleted it — nothing to format

case "$FILE" in
  "$ROOT"/*) REL="${FILE#"$ROOT"/}" ;;
  *)         REL="${FILE#./}" ;;
esac

case "$REL" in
  *.js|*.jsx) ;;
  *) exit 0 ;;   # .css/.json — no formatter in this repo, leave them exactly as edited
esac

case "$REL" in
  "$CLEANUP_SRV_DIR"/*) FILTER="$CLEANUP_SRV_FILTER" ;;
  "$CLEANUP_SPA_DIR"/*) FILTER="$CLEANUP_SPA_FILTER" ;;
  *) exit 0 ;;   # outside the app: the guard already blocked the edit
esac

(cd "$ROOT" && pnpm --filter "$FILTER" exec eslint --fix "$ROOT/$REL" >/dev/null 2>&1) || true
exit 0
