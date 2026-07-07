#!/bin/bash
# dev-live-attach.sh — point an app's DRAFT version at a local dev server
# through a monday tunnel: hot-reload development inside real monday.
#
# What it does: starts the app's dev server + a tunnel (both background),
# then rebinds every VIEW-type feature of the draft version to the tunnel URL.
# The LIVE version and customers are never touched. Only whoever set the
# draft as their active version sees the dev server.
#
# ALWAYS end the session with dev-live-detach.sh — a draft left pointing at
# a dead laptop breaks draft testing for the whole team.
#
# Usage: dev-live-attach.sh --app <name> --id <monday app id> [--dir <monorepo>] [--port <p>]
set -euo pipefail

# Skill root: this script lives at <skill>/scripts/, so one level up.
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Monorepo working copy: the repo this skill is checked into (the skill lives at
# <repo-root>/.claude/skills/monday-cicd). Override with --dir.
DIR="$(git -C "$SKILL_DIR" rev-parse --show-toplevel 2>/dev/null || (cd "$SKILL_DIR/../../.." && pwd))"
APP=""; APP_ID=""; PORT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app) APP="$2"; shift 2 ;;
    --id) APP_ID="$2"; shift 2 ;;
    --dir) DIR="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$APP" && -n "$APP_ID" ]] || { echo "ERROR: --app and --id required" >&2; exit 2; }
[[ -d "$DIR/apps/$APP" ]] || { echo "ERROR: $DIR/apps/$APP not found" >&2; exit 2; }

STATE_DIR="$DIR/.dev-live"; mkdir -p "$STATE_DIR"
STATE="$STATE_DIR/$APP.state"
[[ -f "$STATE" ]] && { echo "ERROR: dev-live already attached for $APP (state: $STATE). Detach first." >&2; exit 1; }
LOG_DEV="$STATE_DIR/$APP.dev.log"; LOG_TUN="$STATE_DIR/$APP.tunnel.log"

# ---- 1. Draft version + its view features -----------------------------------
DRAFT_ID=$(mapps app-version:list -i "$APP_ID" 2>/dev/null | awk -F'│' '/draft/ {gsub(/ /,"",$3); print $3; exit}')
[[ -n "$DRAFT_ID" ]] || { echo "ERROR: no draft version — create one first (see SKILL.md standing-draft step)" >&2; exit 1; }
echo ">> draft version: $DRAFT_ID"
FEATURES=$(mapps app-features:list -a "$APP_ID" -i "$DRAFT_ID" 2>/dev/null | awk -F'│' '/View|Widget/ {gsub(/ /,"",$3); print $3}')
[[ -n "$FEATURES" ]] || { echo "ERROR: no view-type features found on draft $DRAFT_ID" >&2; exit 1; }
echo ">> view features to rebind: $(echo $FEATURES | tr '\n' ' ')"

# ---- 2. Dev server -----------------------------------------------------------
( cd "$DIR" && pnpm --filter "./apps/$APP" dev > "$LOG_DEV" 2>&1 & echo $! > "$STATE_DIR/$APP.dev.pid" )
sleep 6
DETECTED_PORT=$(grep -oE "localhost:[0-9]+" "$LOG_DEV" | head -1 | cut -d: -f2)
PORT="${PORT:-$DETECTED_PORT}"
[[ -n "$PORT" ]] || { echo "ERROR: dev server port not detected (see $LOG_DEV)"; kill "$(cat "$STATE_DIR/$APP.dev.pid")" 2>/dev/null; exit 1; }
echo ">> dev server up on port $PORT"

# ---- 3. Tunnel -----------------------------------------------------------------
( mapps tunnel:create -p "$PORT" -a "$APP_ID" > "$LOG_TUN" 2>&1 & echo $! > "$STATE_DIR/$APP.tunnel.pid" )
TUNNEL_URL=""
for _ in $(seq 1 20); do
  TUNNEL_URL=$(grep -oE "https://[a-z0-9.-]+\.apps-tunnel\.monday\.app" "$LOG_TUN" | head -1 || true)
  [[ -n "$TUNNEL_URL" ]] && break
  sleep 2
done
[[ -n "$TUNNEL_URL" ]] || { echo "ERROR: tunnel URL not detected (see $LOG_TUN)" >&2; exit 1; }
curl -sf -o /dev/null "$TUNNEL_URL" || echo "WARN: tunnel not answering yet ($TUNNEL_URL)"
echo ">> tunnel: $TUNNEL_URL -> localhost:$PORT"

# ---- 4. Rebind draft view features ------------------------------------------------
# NOTE: --customUrl=<url> long form with '=' is REQUIRED (short -u fails, incident-verified).
for f in $FEATURES; do
  mapps app-features:build --appId "$APP_ID" --appVersionId "$DRAFT_ID" \
    --appFeatureId "$f" --buildType custom_url --customUrl="$TUNNEL_URL" >/dev/null 2>&1
  echo ">> [done] feature $f -> tunnel"
done

# ---- 5. State for detach -------------------------------------------------------------
cat > "$STATE" <<EOF
APP_ID=$APP_ID
DRAFT_ID=$DRAFT_ID
FEATURES="$(echo $FEATURES | tr '\n' ' ')"
TUNNEL_URL=$TUNNEL_URL
PORT=$PORT
EOF

cat <<DONE

==================== dev-live ATTACHED ====================
App:            $APP ($APP_ID), draft version $DRAFT_ID
Dev server:     http://localhost:$PORT   (log: $LOG_DEV)
Tunnel:         $TUNNEL_URL              (log: $LOG_TUN)
Who sees it:    only viewers of the DRAFT version (set-as-active). Live untouched.
Edit code under apps/$APP — changes appear live in monday.

When finished:  dev-live-detach.sh --app $APP
===========================================================
DONE
