#!/usr/bin/env bash
# Dispatcher for the cleanup workflow's per-app environment.
#
# ONE app per run, selected by CLEANUP_APP (default: twyst-your-status — every
# pre-multi-app caller keeps working unchanged). The per-app facts live in
# scripts/cleanup/env/<app>.sh; this file holds NO globs and NO app facts, so
# onboarding app N+1 is exactly what the README always promised: a new env file
# with its own APP_DIR — never a widened glob here.
#
# FAIL-CLOSED: an unknown CLEANUP_APP refuses to load. The two PreToolUse guards
# source this file to build their allowlist — if it half-loaded on a typo, every
# CLEANUP_* var would be empty and the path verdict would quietly allow nothing
# it should and block nothing it must. `return 1` (this file is always sourced)
# lets each caller fail its own way; the guards exit 2 (block) on it.
#
# Registered apps (add a line here AND an env file, nothing else):
#   twyst-your-status   SPA + guard server (two workspaces)
#   discussions         client-only SPA (one workspace)

CLEANUP_APP="${CLEANUP_APP:-twyst-your-status}"

case "$CLEANUP_APP" in
  twyst-your-status|discussions) ;;
  *)
    echo "cleanup-env: unknown CLEANUP_APP '$CLEANUP_APP' — registered: twyst-your-status, discussions. Refusing to load (fail-closed: guards derive their allowlist from this file)." >&2
    return 1 2>/dev/null || exit 1
    ;;
esac

# shellcheck source=/dev/null
. "${BASH_SOURCE[0]%/*}/env/${CLEANUP_APP}.sh"
