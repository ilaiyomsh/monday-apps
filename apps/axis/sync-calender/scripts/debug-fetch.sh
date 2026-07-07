#!/usr/bin/env bash
# Signed debug fetch: computes an HMAC-SHA256 signature over a fresh timestamp
# using MONDAY_SIGNING_SECRET (read from local .env), calls /api/_debug/configs,
# and pretty-prints the response. Each request is single-use — the signature
# is bound to a 120-second window on the server, so captured headers go stale
# almost immediately.
#
# Usage:
#   scripts/debug-fetch.sh                          # list all configs
#   scripts/debug-fetch.sh <configId>               # drill-down on one config
#   scripts/debug-fetch.sh --object <objectId>      # restrict to one instance
#
# Env overrides:
#   LIVE_URL                base URL of the live deployment
#   MONDAY_SIGNING_SECRET   normally loaded from .env; override if needed

set -euo pipefail

LIVE_URL="${LIVE_URL:-https://live1-service-27549619-d2f728f4.us.monday.app}"

# --- Parse args ---------------------------------------------------------------
PATH_SUFFIX="/api/_debug/configs"
QUERY=""

if [ $# -ge 1 ]; then
  case "$1" in
    --object|--objectId)
      [ $# -ge 2 ] || { echo "error: --object requires a value" >&2; exit 2; }
      QUERY="?objectId=$2"
      ;;
    -h|--help)
      sed -n '2,16p' "$0"
      exit 0
      ;;
    *)
      PATH_SUFFIX="/api/_debug/configs/$1"
      ;;
  esac
fi

URL="${LIVE_URL}${PATH_SUFFIX}${QUERY}"

# --- Pre-flight ---------------------------------------------------------------
command -v openssl >/dev/null || { echo "error: openssl not found" >&2; exit 1; }
command -v curl    >/dev/null || { echo "error: curl not found"    >&2; exit 1; }
command -v jq      >/dev/null || { echo "error: jq not found"      >&2; exit 1; }

# --- Load MONDAY_SIGNING_SECRET from .env -------------------------------------
# We deliberately don't `source .env`: the file may contain non-assignment
# lines (comments, deploy-command snippets) that would execute as shell. Pull
# just the one variable we need, then strip surrounding quotes.
if [ -z "${MONDAY_SIGNING_SECRET:-}" ] && [ -f .env ]; then
  raw=$(grep -E '^[[:space:]]*MONDAY_SIGNING_SECRET[[:space:]]*=' .env | head -1 || true)
  if [ -n "$raw" ]; then
    val="${raw#*=}"
    # Strip matching surrounding quotes if present.
    case "$val" in
      \"*\") val="${val#\"}"; val="${val%\"}";;
      \'*\') val="${val#\'}"; val="${val%\'}";;
    esac
    MONDAY_SIGNING_SECRET="$val"
  fi
fi

if [ -z "${MONDAY_SIGNING_SECRET:-}" ]; then
  echo "error: MONDAY_SIGNING_SECRET not set" >&2
  echo "       expected as MONDAY_SIGNING_SECRET=... in .env, or in the environment" >&2
  exit 1
fi

# --- Sign and call ------------------------------------------------------------
TS=$(date +%s)
# `openssl dgst -hmac` prints either "(stdin)= <hex>" or just "<hex>" depending
# on the version. awk grabs the last whitespace-separated token in either case.
SIG=$(printf 'debug:%s' "$TS" |
  openssl dgst -sha256 -hmac "$MONDAY_SIGNING_SECRET" |
  awk '{print $NF}')

http_code=$(curl -s -o /tmp/debug-fetch.body -w "%{http_code}" \
  -H "x-debug-ts: $TS" \
  -H "x-debug-sig: $SIG" \
  "$URL" || echo "000")

if [ "$http_code" = "200" ]; then
  jq . /tmp/debug-fetch.body
  rm -f /tmp/debug-fetch.body
  exit 0
fi

echo "error: HTTP $http_code from $URL" >&2
[ -s /tmp/debug-fetch.body ] && cat /tmp/debug-fetch.body >&2
echo >&2
rm -f /tmp/debug-fetch.body
exit 1
