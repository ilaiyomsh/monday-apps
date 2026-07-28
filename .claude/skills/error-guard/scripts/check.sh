#!/usr/bin/env bash
# error-guard/check.sh — fast, single-file (or few-file) gate for the error-catching rule set.
#
# Runs ESLint with ONLY the error-guard rules (from templates/eslint-error-rules.json)
# against the given files. Used by the PostToolUse hook and the ship gate.
#
# Contract:
#   - Args: one or more FILE paths.
#   - Skips files that are not *.js/*.jsx/*.ts/*.tsx, test files, node_modules,
#     dist/build output, the logger itself, and *Sink* files.
#   - FAIL OPEN: if no usable ESLint is found, or ESLint cannot produce parseable
#     output, print a note and exit 0 — the hook must never block on tooling gaps.
#   - Exit 1 when at least one rule violation is found, 0 otherwise.
#   - Designed to finish in ~1-2s for a single file.
#
# Output on violation (one short block per violation the agent can act on):
#   FILE:LINE:COL  [rule]  <remediation message>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMPLATE="$SKILL_DIR/templates/eslint-error-rules.json"
# Project root: prefer the session's $CLAUDE_PROJECT_DIR; otherwise derive from
# this script's own location (scripts -> error-guard -> skills -> .claude -> <project root>).
APPS_ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$SCRIPT_DIR/../../../.." && pwd)}"

note() { printf 'error-guard/check: %s\n' "$1" >&2; }

if [ "$#" -eq 0 ]; then
  note "no files given; nothing to check"
  exit 0
fi
if [ ! -f "$TEMPLATE" ]; then
  note "rule template missing ($TEMPLATE); failing open"
  exit 0
fi

# --- file filtering ---------------------------------------------------------
should_skip() {
  # returns 0 (skip) / 1 (keep)
  local f="$1" base
  base="$(basename "$f")"
  case "$f" in
    *.js|*.jsx|*.ts|*.tsx) : ;;
    *) return 0 ;;
  esac
  case "$f" in
    */node_modules/*|*/dist/*|*/build/*) return 0 ;;
    */__tests__/*|*/test-utils/*) return 0 ;;
    */dev-harness/*) return 0 ;;
    *.test.js|*.test.jsx|*.test.ts|*.test.tsx) return 0 ;;
    *.spec.js|*.spec.jsx|*.spec.ts|*.spec.tsx) return 0 ;;
  esac
  case "$f" in
    */services/logger/*) return 0 ;;   # server logger dir (basename is index.js)
  esac
  case "$base" in
    setupTests.*|logger.js|logger.ts) return 0 ;;
    *Sink*|*-sink.*) return 0 ;;
    # sanctioned infra files: console breadcrumbs + intentional exit-path catches
    axiomBrowserTransport.js|processGuards.js|process-guards.js) return 0 ;;
  esac
  return 1
}

abs_path() {
  local f="$1" d b
  d="$(dirname "$f")"; b="$(basename "$f")"
  if d="$(cd "$d" 2>/dev/null && pwd)"; then
    printf '%s/%s' "$d" "$b"
  else
    printf '%s' "$f"
  fi
}

# --- locate an ESLint install (fail open if none) ---------------------------
find_eslint_dir() {
  local d="$1"
  while [ -n "$d" ] && [ "$d" != "/" ]; do
    if [ -x "$d/node_modules/.bin/eslint" ]; then printf '%s' "$d"; return 0; fi
    d="$(dirname "$d")"
  done
  return 1
}

sibling_eslint_dir() {
  # Prefer an install where eslint-plugin-promise also resolves, so borrow mode
  # keeps the full rule kit (promise/catch-or-return) whenever any app has it.
  local d
  for d in "$APPS_ROOT"/*/ "$APPS_ROOT"/*/*/; do
    if [ -x "${d}node_modules/.bin/eslint" ] && [ -d "${d}node_modules/eslint-plugin-promise" ]; then
      printf '%s' "${d%/}"; return 0
    fi
  done
  for d in "$APPS_ROOT"/*/ "$APPS_ROOT"/*/*/; do
    [ -x "${d}node_modules/.bin/eslint" ] && { printf '%s' "${d%/}"; return 0; }
  done
  return 1
}

# --- collect surviving target files ----------------------------------------
declare -a SURVIVORS=()
declare -a SKIPPED_TS=()
FIRST_ABS=""
for f in "$@"; do
  if should_skip "$f"; then continue; fi
  af="$(abs_path "$f")"
  [ -z "$FIRST_ABS" ] && FIRST_ABS="$af"
  SURVIVORS+=("$af")
done

if [ "${#SURVIVORS[@]}" -eq 0 ]; then
  # everything filtered out — nothing to enforce
  exit 0
fi

RESOLVE_DIR=""
if RESOLVE_DIR="$(find_eslint_dir "$(dirname "$FIRST_ABS")")"; then :; else RESOLVE_DIR=""; fi
if [ -z "$RESOLVE_DIR" ]; then
  if RESOLVE_DIR="$(sibling_eslint_dir)"; then
    note "no ESLint in target app; borrowing $RESOLVE_DIR/node_modules"
  else
    note "no ESLint available in target app or any sibling; failing open"
    exit 0
  fi
fi
ESLINT_BIN="$RESOLVE_DIR/node_modules/.bin/eslint"

# --- resolve optional parser + promise plugin relative to that install ------
resolve_module() {
  node -e "try{process.stdout.write(require.resolve('$1',{paths:['$RESOLVE_DIR']}))}catch(e){}" 2>/dev/null || true
}
PARSER_PATH="$(resolve_module '@typescript-eslint/parser')"
HAS_PROMISE=false
if [ -n "$(resolve_module 'eslint-plugin-promise')" ]; then HAS_PROMISE=true; fi
if [ "$HAS_PROMISE" = false ]; then
  note "promise/catch-or-return skipped — eslint-plugin-promise not resolvable from $RESOLVE_DIR; floating promises are NOT checked (install: pnpm add -D eslint-plugin-promise)"
fi

# Drop TS/TSX files when no TS parser is available (espree can't parse types) — fail open per file.
if [ -z "$PARSER_PATH" ]; then
  declare -a KEEP=()
  for f in "${SURVIVORS[@]}"; do
    case "$f" in
      *.ts|*.tsx) SKIPPED_TS+=("$f") ;;
      *) KEEP+=("$f") ;;
    esac
  done
  SURVIVORS=("${KEEP[@]:-}")
  # KEEP may be empty
  if [ "${#SKIPPED_TS[@]}" -gt 0 ]; then
    note "skipped TS file(s) — no @typescript-eslint/parser available: ${SKIPPED_TS[*]}"
  fi
fi
if [ "${#SURVIVORS[@]}" -eq 0 ] || [ -z "${SURVIVORS[0]:-}" ]; then
  exit 0
fi

# --- build a self-contained eslintrc from the template ----------------------
TMPDIR_EG="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_EG"' EXIT
CONFIG="$TMPDIR_EG/eslintrc.json"

# The hook checks BOTH client and server files with one config, so the
# catch-must-log selector here is the union of the two kits' allowances:
# logger.* / throw / showErrorWithDetails (client) / next(err) (server —
# forwarding to the terminal error middleware, which logs) / logError(...)
# (deadline-confirm server named-import convention — known-issues 2026-07-19).
# The per-app ESLint kit stays the precise anchor (client kit does NOT allow next()).
UNION_SELECTOR="CatchClause > BlockStatement:not(:has(CallExpression[callee.object.name='logger'])):not(:has(ThrowStatement)):not(:has(CallExpression[callee.name='showErrorWithDetails'])):not(:has(CallExpression[callee.name='next'])):not(:has(CallExpression[callee.name='logError']))"

jq \
  --arg parser "$PARSER_PATH" \
  --arg unionsel "$UNION_SELECTOR" \
  --argjson haspromise "$HAS_PROMISE" \
  '{
     root: true,
     parserOptions: { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true } },
     plugins: (if $haspromise then ["promise"] else [] end),
     rules: ((.rules | if $haspromise then . else del(."promise/catch-or-return") end)
             | ."no-restricted-syntax"[1].selector = $unionsel)
   }
   + (if $parser != "" then { parser: $parser } else {} end)' \
  "$TEMPLATE" > "$CONFIG"

# --- run ESLint (never let its exit code abort us) --------------------------
# --no-inline-config: (a) an app file's own eslint-disable/enable comments can
# reference rules this minimal config doesn't define — ESLint then emits
# "Definition for rule ... was not found" as a ruleId-bearing message, which
# false-failed the gate on every edit to such a file (2026-07-14); (b) it also
# means inline comments can never silence the error-guard rules themselves.
OUT="$TMPDIR_EG/out.json"
# ESLINT_USE_FLAT_CONFIG=false: ESLint 9 defaults to flat config and rejects the
# eslintrc-mode flags below (--no-eslintrc / --resolve-plugins-relative-to) — the
# invocation errored, produced no JSON, and the gate FAILED OPEN on every v9 app
# (rules silently unenforced). Forcing eslintrc mode keeps this minimal rule kit
# working on v8 AND v9 with no other change (v8 is unaffected; it already used
# eslintrc). NOTE: eslintrc support is removed in ESLint v10 — migrate this to a
# generated flat config before any app upgrades to v10.
ESLINT_USE_FLAT_CONFIG=false "$ESLINT_BIN" --no-eslintrc --no-inline-config --config "$CONFIG" \
  --resolve-plugins-relative-to "$RESOLVE_DIR" \
  --format json "${SURVIVORS[@]}" > "$OUT" 2>"$TMPDIR_EG/err.txt" || true

if ! jq -e . "$OUT" >/dev/null 2>&1; then
  note "ESLint produced no parseable output; failing open"
  [ -s "$TMPDIR_EG/err.txt" ] && note "$(head -3 "$TMPDIR_EG/err.txt")"
  exit 0
fi

# fatal parse errors (ruleId null) are tool failures, not violations -> fail open per file
FATALS="$(jq '[.[].messages[] | select(.fatal == true)] | length' "$OUT")"
if [ "$FATALS" -gt 0 ]; then
  note "ESLint could not parse $FATALS file(s); those are skipped (fail open)"
fi

VIOL="$(jq '[.[].messages[] | select(.ruleId != null)] | length' "$OUT")"
if [ "$VIOL" -gt 0 ]; then
  jq -r '.[] | .filePath as $f | .messages[]
           | select(.ruleId != null)
           | "\($f):\(.line):\(.column)  [\(.ruleId)]  \(.message)"' "$OUT"
  exit 1
fi

exit 0
