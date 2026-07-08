#!/bin/bash
# schema.sh — fetch + cache the monday.com GraphQL SDL schema (token-safe).
#
# Usage:
#   ./schema.sh              # ensure a fresh cache for RECOMMENDED_VERSION, print its path
#   ./schema.sh 2026-04      # same, for an explicit API version
#   ./schema.sh --path       # print the cache path WITHOUT fetching (fails if stale/missing)
#
# Token safety: the API token is read in-process from ~/.config/mapps/.mappsrc
# (same pattern as mapps/mapps-api.sh) and is NEVER echoed or logged.
#
# HARD GATE: a cache older than 30 days is treated as INVALID. This script
# refuses to hand out a stale cache — it auto-refetches, and if the refetch
# fails it exits non-zero instead of falling back to the stale file.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CACHE_DIR="$SKILL_DIR/schema-cache"
VERSIONING_MD="$SKILL_DIR/references/versioning.md"
MAPPSRC="$HOME/.config/mapps/.mappsrc"
MAX_AGE_DAYS=30

mkdir -p "$CACHE_DIR"

PATH_ONLY=false
VERSION=""
for arg in "$@"; do
  case "$arg" in
    --path) PATH_ONLY=true ;;
    *) VERSION="$arg" ;;
  esac
done

# Default version: the single RECOMMENDED_VERSION declared in references/versioning.md
if [[ -z "$VERSION" ]]; then
  if [[ -f "$VERSIONING_MD" ]]; then
    VERSION="$(sed -n 's/^RECOMMENDED_VERSION: *\([0-9-]*\).*/\1/p' "$VERSIONING_MD" | head -1)"
  fi
  if [[ -z "$VERSION" ]]; then
    echo "ERROR: could not resolve RECOMMENDED_VERSION from $VERSIONING_MD — pass a version explicitly." >&2
    exit 1
  fi
fi

CACHE_FILE="$CACHE_DIR/schema-$VERSION.sdl"

cache_age_days() {
  local f="$1"
  local now mtime
  now=$(date +%s)
  mtime=$(stat -f %m "$f")           # BSD stat (macOS)
  echo $(( (now - mtime) / 86400 ))
}

cache_is_fresh() {
  [[ -f "$CACHE_FILE" ]] || return 1
  local age
  age=$(cache_age_days "$CACHE_FILE")
  (( age <= MAX_AGE_DAYS ))
}

if cache_is_fresh; then
  echo "$CACHE_FILE"
  exit 0
fi

if $PATH_ONLY; then
  echo "ERROR: schema cache for $VERSION is missing or older than $MAX_AGE_DAYS days — run schema.sh (without --path) to refetch. Do NOT validate against a stale schema." >&2
  exit 1
fi

if [[ ! -f "$MAPPSRC" ]]; then
  echo "ERROR: $MAPPSRC not found. Run 'mapps init -t <TOKEN>' first." >&2
  exit 1
fi

# Read the token in-process (never printed) and fetch the SDL.
TMP_FILE="$(mktemp "$CACHE_DIR/.schema-fetch.XXXXXX")"
trap 'rm -f "$TMP_FILE"' EXIT

TOKEN="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['accessToken'])" "$MAPPSRC")"

HTTP_CODE=$(curl -s -o "$TMP_FILE" -w "%{http_code}" \
  -H "Authorization: $TOKEN" \
  "https://api.monday.com/v2/get_schema?format=sdl&version=$VERSION")
unset TOKEN

if [[ "$HTTP_CODE" != "200" ]] || ! grep -q "type Query" "$TMP_FILE"; then
  echo "ERROR: schema fetch for $VERSION failed (HTTP $HTTP_CODE) or response is not SDL." >&2
  if [[ -f "$CACHE_FILE" ]]; then
    echo "A stale cache exists at $CACHE_FILE but it is >$MAX_AGE_DAYS days old — NOT usable for validation." >&2
  fi
  exit 1
fi

{
  echo "# monday.com GraphQL SDL — API version $VERSION — fetched $(date +%Y-%m-%d) by monday-api/scripts/schema.sh"
  echo "# Cache policy: invalid after $MAX_AGE_DAYS days — schema.sh auto-refetches; never validate against a stale copy."
  cat "$TMP_FILE"
} > "$CACHE_FILE"

echo "$CACHE_FILE"
