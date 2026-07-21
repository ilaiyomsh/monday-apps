#!/usr/bin/env bash
# error-guard/check.sh — fast, single-file (or few-file) gate for the error-catching rule set.
#
# Runs ESLint (9, flat config) with ONLY the error-guard rules (from
# templates/eslint-error-rules.json) against the given files. Used by the
# PostToolUse hook and the ship gate.
#
# Contract:
#   - Args: one or more FILE paths.
#   - Skips files that are not *.js/*.jsx/*.ts/*.tsx, test files, node_modules,
#     dist/build output, the logger itself, and *Sink* files.
#   - FAIL OPEN: if no usable ESLint is found, or ESLint cannot produce parseable
#     output, print a note and exit 0 — the hook must never block on tooling gaps.
#   - Exit 1 when at least one rule violation is found, 0 otherwise.
#   - Designed to finish in ~1-2s for a single file.
#   - HOOK MODE = syntax-level rules only (no-console, no-empty, catch-must-log,
#     promise/catch-or-return). Type-aware rules (no-floating-promises) are too
#     heavy per edit — they run in audit.sh full-tree mode. This is the
#     documented degraded mode (references/eslint-rules.md).
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

# shellcheck source=./lib-eslint-flat.sh
. "$SCRIPT_DIR/lib-eslint-flat.sh"

note() { printf 'error-guard/check: %s\n' "$1" >&2; }

if [ "$#" -eq 0 ]; then
  note "no files given; nothing to check"
  exit 0
fi
if [ ! -f "$TEMPLATE" ]; then
  note "rule template missing ($TEMPLATE); failing open"
  exit 0
fi

abs_path() {
  local f="$1" d b
  d="$(dirname "$f")"; b="$(basename "$f")"
  if d="$(cd "$d" 2>/dev/null && pwd)"; then
    printf '%s/%s' "$d" "$b"
  else
    printf '%s' "$f"
  fi
}

# --- collect surviving target files ----------------------------------------
declare -a SURVIVORS=()
declare -a SKIPPED_TS=()
FIRST_ABS=""
for f in "$@"; do
  if eg_should_skip "$f"; then continue; fi
  af="$(abs_path "$f")"
  [ -z "$FIRST_ABS" ] && FIRST_ABS="$af"
  SURVIVORS+=("$af")
done

if [ "${#SURVIVORS[@]}" -eq 0 ]; then
  # everything filtered out — nothing to enforce
  exit 0
fi

# --- locate an ESLint install (fail open if none) --------------------------
if ! RESOLVE_DIR="$(eg_resolve_eslint_root "$(dirname "$FIRST_ABS")")"; then
  note "no ESLint available at repo root or any app; failing open"
  exit 0
fi
[ "$RESOLVE_DIR" = "$APPS_ROOT" ] || note "repo-root ESLint kit not found; borrowing $RESOLVE_DIR/node_modules (rule kit may be reduced)"
ESLINT_BIN="$RESOLVE_DIR/node_modules/.bin/eslint"

# --- resolve the parser + promise plugin (root kit preferred) --------------
PARSER_PATH="$(eg_resolve_module '@typescript-eslint/parser' "$RESOLVE_DIR")"
PROMISE_PATH="$(eg_resolve_module 'eslint-plugin-promise' "$RESOLVE_DIR")"
if [ -z "$PROMISE_PATH" ]; then
  note "promise/catch-or-return skipped — eslint-plugin-promise not resolvable; floating promises are NOT checked (install at repo root: pnpm add -D -w eslint-plugin-promise)"
fi

# Drop TS/TSX files when no TS parser is available — fail open per file.
if [ -z "$PARSER_PATH" ]; then
  declare -a KEEP=()
  for f in "${SURVIVORS[@]}"; do
    case "$f" in
      *.ts|*.tsx) SKIPPED_TS+=("$f") ;;
      *) KEEP+=("$f") ;;
    esac
  done
  SURVIVORS=("${KEEP[@]:-}")
  if [ "${#SKIPPED_TS[@]}" -gt 0 ]; then
    note "skipped TS file(s) — no @typescript-eslint/parser available: ${SKIPPED_TS[*]}"
  fi
fi
if [ "${#SURVIVORS[@]}" -eq 0 ] || [ -z "${SURVIVORS[0]:-}" ]; then
  exit 0
fi

# --- build the flat config + run ESLint (never let its exit code abort us) --
TMPDIR_EG="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_EG"' EXIT
CONFIG="$TMPDIR_EG/eslint.config.mjs"
OUT="$TMPDIR_EG/out.json"
ERR="$TMPDIR_EG/err.txt"

# TYPE_AWARE=0: hook mode is syntax-only (see contract above).
eg_gen_config "$CONFIG" "$PROMISE_PATH" "$PARSER_PATH" "" 0 ""
eg_run_eslint "$OUT" "$ERR" "$ESLINT_BIN" "$CONFIG" "${SURVIVORS[@]}"

if ! jq -e . "$OUT" >/dev/null 2>&1; then
  note "ESLint produced no parseable output; failing open"
  [ -s "$ERR" ] && note "$(head -3 "$ERR")"
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
