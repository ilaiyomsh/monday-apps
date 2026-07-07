#!/bin/bash
# probe.sh — execute an EXACT GraphQL payload against the live monday.com API,
# print the response JSON plus its complexity cost. This is the TEST step of the
# monday-api workflow: probe on a scratch item/board BEFORE the payload lands in code.
#
# Usage:
#   TEST_WORKSPACE_ID=16291824 ./probe.sh '<graphql>' ['{"var":"val"}'] [api-version]
#
# Safety:
#   * HARD-FAILS if TEST_WORKSPACE_ID is unset — never falls back to a real board.
#   * Any board-creating mutation MUST pass workspace_id explicitly (enforced below).
#   * Scratch boards use the WZ- name prefix; delete what you create.
#   * Keep probes minimal (single item, limit: 1) — they share the production
#     account's complexity budget.
#
# Token safety: delegates to the canonical mapps/mapps-api.sh wrapper, which reads
# the token in-process from ~/.config/mapps/.mappsrc. Never print the token.

set -euo pipefail

# Project root of the current session/clone (for pointing at the shared CLAUDE.md).
PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || echo '<project-root>')}"

if [[ -z "${TEST_WORKSPACE_ID:-}" ]]; then
  echo "FATAL: TEST_WORKSPACE_ID is unset — refusing to run a live probe." >&2
  echo "Probes may only write inside the agent sandbox workspace (id 16291824," >&2
  echo "'AGENT-TEST — Claude sandbox'). Set:  export TEST_WORKSPACE_ID=16291824" >&2
  echo "See $PROJECT_ROOT/.claude/CLAUDE.md — 'Test Workspace (Agent Sandbox)'." >&2
  echo "NEVER fall back to picking a real board." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MAPPS_API="$(cd "$SKILL_DIR/../mapps" && pwd)/mapps-api.sh"
VERSIONING_MD="$SKILL_DIR/references/versioning.md"

if [[ ! -x "$MAPPS_API" ]]; then
  echo "ERROR: canonical API wrapper not found/executable at $MAPPS_API" >&2
  exit 1
fi

QUERY="${1:?usage: probe.sh '<graphql>' ['<variables-json>'] [api-version]}"
VARIABLES="${2:-}"
API_VERSION="${3:-}"

# Guard: board-creating probes must scope themselves to the sandbox workspace.
if echo "$QUERY" | grep -q "create_board" && ! echo "$QUERY" | grep -q "workspace_id"; then
  echo "FATAL: create_board probe without an explicit workspace_id argument." >&2
  echo "Every board-creating probe must pass workspace_id: \$TEST_WORKSPACE_ID ($TEST_WORKSPACE_ID)" >&2
  echo "and use a 'WZ-' board-name prefix. See .claude/CLAUDE.md at the project root." >&2
  exit 1
fi

# Default API version: the single RECOMMENDED_VERSION declared in references/versioning.md.
if [[ -z "$API_VERSION" && -f "$VERSIONING_MD" ]]; then
  API_VERSION="$(sed -n 's/^RECOMMENDED_VERSION: *\([0-9-]*\).*/\1/p' "$VERSIONING_MD" | head -1)"
fi

if [[ -n "$API_VERSION" ]]; then
  RESPONSE="$("$MAPPS_API" "$QUERY" "$VARIABLES" "$API_VERSION")"
else
  RESPONSE="$("$MAPPS_API" "$QUERY" "$VARIABLES")"
fi

# Pretty-print the response and surface complexity if the query selected it.
echo "$RESPONSE" | python3 -c "
import json, sys
raw = sys.stdin.read()
try:
    resp = json.loads(raw)
except json.JSONDecodeError:
    print(raw)
    sys.exit(1)
print(json.dumps(resp, indent=2, ensure_ascii=False))
cx = (resp.get('data') or {}).get('complexity')
if cx:
    print()
    print(f\"COMPLEXITY: query={cx.get('query')} before={cx.get('before')} after={cx.get('after')}\", file=sys.stderr)
else:
    print()
    print('NOTE: no complexity data — add \`complexity { query before after }\` as a root field to measure cost.', file=sys.stderr)
if resp.get('errors'):
    codes = [ (e.get('extensions') or {}).get('code') for e in resp['errors'] ]
    print(f'GRAPHQL ERRORS present (extensions.code: {codes}) — see references/errors-and-auth.md', file=sys.stderr)
    sys.exit(2)
"
