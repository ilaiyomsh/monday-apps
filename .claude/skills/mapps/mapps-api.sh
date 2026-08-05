#!/bin/bash
# mapps-api.sh — Secure Monday.com API wrapper
# Usage: ./mapps-api.sh '<graphql-query>' ['{"var":"val"}'] [api-version]
#
# Reads API token from ~/.config/mapps/.mappsrc internally.
# Note: This is a prompt-level convention, not a system sandbox —
# the AI has shell access and could technically read the token file.

set -euo pipefail

MAPPSRC="${MAPPSRC:-$HOME/.config/mapps/.mappsrc}"
if [[ ! -f "$MAPPSRC" && -n "${LOCALAPPDATA:-}" && -f "$LOCALAPPDATA/mapps/.mappsrc" ]]; then
  MAPPSRC="$LOCALAPPDATA/mapps/.mappsrc"
fi
if [[ ! -f "$MAPPSRC" ]]; then
  echo "Error: .mappsrc not found in the Unix or Windows mapps config directory. Run 'mapps init -t <TOKEN>' first." >&2
  exit 1
fi

QUERY="$1"
VARIABLES="${2:-}"
API_VERSION="${3:-2026-04}"

# Node.js builds the JSON payload and extracts the token.
# Line 1 = token, Line 2 = JSON payload.
# All user input is passed via argv — no bash interpolation into JavaScript.
OUTPUT=$(node -e '
const fs = require("fs");
const config = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const rawVariables = process.argv[3] || "";
const payload = { query: process.argv[2] };
if (rawVariables) payload.variables = JSON.parse(rawVariables);
process.stdout.write(`${config.accessToken}\n${JSON.stringify(payload)}\n`);
' "$MAPPSRC" "$QUERY" "$VARIABLES")

# Split "token\npayload" with parameter expansion only — macOS ships bash 3.2,
# which has no `mapfile` (it failed with "mapfile: command not found", making
# every API call through this script a no-op on a stock mac).
TOKEN="${OUTPUT%%$'\n'*}"
PAYLOAD="${OUTPUT#*$'\n'}"

curl -s -X POST \
  -H "Authorization: $TOKEN" \
  -H "Content-Type: application/json" \
  -H "API-Version: $API_VERSION" \
  -d "$PAYLOAD" \
  https://api.monday.com/v2
