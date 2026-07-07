#!/bin/bash
# mapps-api.sh — Secure Monday.com API wrapper
# Usage: ./mapps-api.sh '<graphql-query>' ['{"var":"val"}'] [api-version]
#
# Reads API token from ~/.config/mapps/.mappsrc internally.
# Note: This is a prompt-level convention, not a system sandbox —
# the AI has shell access and could technically read the token file.

set -euo pipefail

MAPPSRC="$HOME/.config/mapps/.mappsrc"
if [[ ! -f "$MAPPSRC" ]]; then
  echo "Error: .mappsrc not found. Run 'mapps init -t <TOKEN>' first." >&2
  exit 1
fi

QUERY="$1"
VARIABLES="${2:-}"
API_VERSION="${3:-2026-04}"

# Python builds the JSON payload and extracts the token.
# Line 1 = token, Line 2 = JSON payload.
# All user input passed via sys.argv — no bash interpolation into Python code.
OUTPUT=$(python3 -c "
import json, sys

with open(sys.argv[1]) as f:
    token = json.load(f)['accessToken']

query = sys.argv[2]
raw_vars = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] else ''

payload = {'query': query}
if raw_vars:
    payload['variables'] = json.loads(raw_vars)

print(token)
print(json.dumps(payload))
" "$MAPPSRC" "$QUERY" "$VARIABLES")

TOKEN=$(echo "$OUTPUT" | head -1)
PAYLOAD=$(echo "$OUTPUT" | tail -1)

curl -s -X POST \
  -H "Authorization: $TOKEN" \
  -H "Content-Type: application/json" \
  -H "API-Version: $API_VERSION" \
  -d "$PAYLOAD" \
  https://api.monday.com/v2
