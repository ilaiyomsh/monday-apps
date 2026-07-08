#!/bin/bash
# dev-live-detach.sh — end a dev-live session: kill the dev server + tunnel and
# rebind the draft version's features back to the CDN build.
#
# INCIDENT-VERIFIED (2026-07-07): a pipeline redeploy does NOT rebind a feature
# that points at a custom URL — the tunnel binding survives code:push. This
# script's explicit rebind is therefore MANDATORY, not belt-and-suspenders.
# The verified restore: buildType monday_code_cdn with route "/" — the CLI
# resolves it to the version's current CDN deployment automatically.
#
# Usage: dev-live-detach.sh --app <name> [--dir <monorepo>]
set -euo pipefail

# Skill root: this script lives at <skill>/scripts/, so one level up.
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Monorepo working copy: the repo this skill is checked into (the skill lives at
# <repo-root>/.claude/skills/monday-cicd). Override with --dir.
DIR="$(git -C "$SKILL_DIR" rev-parse --show-toplevel 2>/dev/null || (cd "$SKILL_DIR/../../.." && pwd))"
APP=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app) APP="$2"; shift 2 ;;
    --dir) DIR="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$APP" ]] || { echo "ERROR: --app required" >&2; exit 2; }

STATE_DIR="$DIR/.dev-live"
STATE="$STATE_DIR/$APP.state"
[[ -f "$STATE" ]] || { echo "ERROR: no dev-live state for $APP ($STATE) — nothing attached?" >&2; exit 1; }
# shellcheck disable=SC1090
source "$STATE"

# ---- 1. Kill dev server + tunnel ------------------------------------------------
for kind in dev tunnel; do
  PIDFILE="$STATE_DIR/$APP.$kind.pid"
  if [[ -f "$PIDFILE" ]]; then
    kill "$(cat "$PIDFILE")" 2>/dev/null && echo ">> [done] $kind process stopped" || echo ">> [skip] $kind already gone"
    rm -f "$PIDFILE"
  fi
done
# Belt: free the port and any leftover tunnel for this app
[[ -n "${PORT:-}" ]] && { P=$(lsof -ti ":$PORT" 2>/dev/null || true); [[ -n "$P" ]] && kill $P 2>/dev/null || true; }
pkill -f "tunnel:create.*$APP_ID" 2>/dev/null || true

# ---- 2. Rebind features to the CDN build (the critical step) ----------------------
for f in $FEATURES; do
  OUT=$(mapps app-features:build --appId "$APP_ID" --appVersionId "$DRAFT_ID" \
    --appFeatureId "$f" --buildType monday_code_cdn --customUrl=/ 2>&1 | grep -oE "https://[a-z0-9.-]+\.cdn[0-9]*\.monday\.app/?" | head -1)
  echo ">> [done] feature $f -> CDN build ($OUT)"
done

# ---- 3. Verify nothing still points at a tunnel ------------------------------------
if mapps app-features:list -a "$APP_ID" -i "$DRAFT_ID" 2>/dev/null | grep -q "apps-tunnel"; then
  echo "ERROR: a feature still points at a tunnel URL — rebind failed, fix before leaving!" >&2
  exit 1
fi
rm -f "$STATE"
echo
echo "==================== dev-live DETACHED ===================="
echo "Draft version $DRAFT_ID serves the CDN build again."
echo "Remember: uncommitted local changes are NOT on the draft —"
echo "push + PR + merge to develop to get them deployed."
echo "============================================================"
