#!/usr/bin/env bash
# error-guard/audit.sh — deterministic gap report for a whole app.
#
# Runs the same error-guard rule set (via the shared flat-config engine in
# lib-eslint-flat.sh) over the app's src/ tree, then adds cheap grep/awk
# heuristics that static rules cannot cover. Prints a severity-bucketed summary:
#   HIGH   — ESLint rule violations (the enforced kit; also the CI/ship gate).
#   REVIEW — heuristics a human confirms: bare JSON.parse outside try, console.*
#            in non-exempt files, and a catch-block census.
#
# Full-tree mode adds ONE type-aware rule the per-edit hook cannot afford:
# @typescript-eslint/no-floating-promises (ignoreVoid:false), enabled only when
# the app has a tsconfig and the TS plugin resolves. It is best-effort and fails
# open: a type-service error just drops the type-aware rule, never the audit.
#
# Arg: an app directory.
# FAIL OPEN on missing ESLint (rule section is skipped with a note).
# Exit 1 if any HIGH (rule) violation exists, else 0. Heuristics never set exit 1.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMPLATE="$SKILL_DIR/templates/eslint-error-rules.json"
# Project root: prefer the session's $CLAUDE_PROJECT_DIR; otherwise derive from
# this script's own location (scripts -> error-guard -> skills -> .claude -> <project root>).
APPS_ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$SCRIPT_DIR/../../../.." && pwd)}"

# shellcheck source=./lib-eslint-flat.sh
. "$SCRIPT_DIR/lib-eslint-flat.sh"

note() { printf 'error-guard/audit: %s\n' "$1" >&2; }

APPDIR="${1:-}"
if [ -z "$APPDIR" ] || [ ! -d "$APPDIR" ]; then
  note "usage: audit.sh <app-directory>"
  exit 2
fi
APPDIR="$(cd "$APPDIR" && pwd)"

SCAN_ROOT="$APPDIR/src"
if [ ! -d "$SCAN_ROOT" ]; then SCAN_ROOT="$APPDIR"; fi

# --- collect target files ---------------------------------------------------
declare -a FILES=()
while IFS= read -r f; do
  eg_should_skip "$f" && continue
  FILES+=("$f")
done < <(find "$SCAN_ROOT" -type f \( -name '*.js' -o -name '*.jsx' -o -name '*.ts' -o -name '*.tsx' \) \
           -not -path '*/node_modules/*' -not -path '*/dist/*' -not -path '*/build/*' 2>/dev/null | sort)

echo "== error-guard audit: $APPDIR =="
echo "scanned root: $SCAN_ROOT"
echo "target files (after exemptions): ${#FILES[@]}"
echo

RULE_VIOLATIONS=0

# --- HIGH: ESLint rule set --------------------------------------------------
echo "--- HIGH: rule violations (enforced kit) ---"
if [ "${#FILES[@]}" -eq 0 ] || [ ! -f "$TEMPLATE" ]; then
  note "nothing to lint (no files or missing template)"
else
  if ! RESOLVE_DIR="$(eg_resolve_eslint_root "$APPDIR")"; then
    note "no ESLint available — rule section skipped (fail open)"
    echo "(skipped: no ESLint available)"
    RESOLVE_DIR=""
  fi

  if [ -n "$RESOLVE_DIR" ]; then
    [ "$RESOLVE_DIR" = "$APPS_ROOT" ] || note "repo-root ESLint kit not found; borrowing $RESOLVE_DIR/node_modules (rule kit may be reduced)"
    ESLINT_BIN="$RESOLVE_DIR/node_modules/.bin/eslint"
    PARSER_PATH="$(eg_resolve_module '@typescript-eslint/parser' "$RESOLVE_DIR")"
    PROMISE_PATH="$(eg_resolve_module 'eslint-plugin-promise' "$RESOLVE_DIR")"
    TSPLUGIN_PATH="$(eg_resolve_module '@typescript-eslint/eslint-plugin' "$RESOLVE_DIR")"
    [ -z "$PROMISE_PATH" ] && note "promise/catch-or-return skipped — eslint-plugin-promise not resolvable; floating .then() chains are NOT counted in HIGH"

    # Type-aware pass: only with a tsconfig, TS files, and the TS plugin present.
    TYPE_AWARE=0
    if [ -n "$PARSER_PATH" ] && [ -n "$TSPLUGIN_PATH" ] && [ -f "$APPDIR/tsconfig.json" ]; then
      if ls "$SCAN_ROOT"/**/*.ts "$SCAN_ROOT"/*.ts "$SCAN_ROOT"/**/*.tsx "$SCAN_ROOT"/*.tsx >/dev/null 2>&1 \
         || find "$SCAN_ROOT" -name '*.ts' -o -name '*.tsx' 2>/dev/null | grep -q .; then
        TYPE_AWARE=1
      fi
    fi

    declare -a LINT_FILES=()
    declare -a SKIPPED_TS=()
    for f in "${FILES[@]}"; do
      if [ -z "$PARSER_PATH" ]; then
        case "$f" in *.ts|*.tsx) SKIPPED_TS+=("$f"); continue ;; esac
      fi
      LINT_FILES+=("$f")
    done
    [ "${#SKIPPED_TS[@]}" -gt 0 ] && note "skipped ${#SKIPPED_TS[@]} TS file(s) — no @typescript-eslint/parser"

    if [ "${#LINT_FILES[@]}" -eq 0 ]; then
      echo "(no lintable files after TS exemption)"
    else
      TMPDIR_EG="$(mktemp -d)"
      trap 'rm -rf "$TMPDIR_EG"' EXIT
      CONFIG="$TMPDIR_EG/eslint.config.mjs"
      OUT="$TMPDIR_EG/out.json"
      ERR="$TMPDIR_EG/err.txt"

      eg_gen_config "$CONFIG" "$PROMISE_PATH" "$PARSER_PATH" "$TSPLUGIN_PATH" "$TYPE_AWARE" "$APPDIR"
      [ "$TYPE_AWARE" = 1 ] && note "type-aware pass ON (@typescript-eslint/no-floating-promises via tsconfig)"
      eg_run_eslint "$OUT" "$ERR" "$ESLINT_BIN" "$CONFIG" "${LINT_FILES[@]}"

      # If a type-aware run produced no parseable output (project-service error),
      # retry once WITHOUT type awareness so the syntax kit still reports.
      if [ "$TYPE_AWARE" = 1 ] && ! jq -e . "$OUT" >/dev/null 2>&1; then
        note "type-aware pass failed to produce output; retrying syntax-only"
        [ -s "$ERR" ] && note "$(head -2 "$ERR")"
        eg_gen_config "$CONFIG" "$PROMISE_PATH" "$PARSER_PATH" "" 0 ""
        eg_run_eslint "$OUT" "$ERR" "$ESLINT_BIN" "$CONFIG" "${LINT_FILES[@]}"
      fi

      if ! jq -e . "$OUT" >/dev/null 2>&1; then
        note "ESLint produced no parseable output — rule section skipped (fail open)"
        [ -s "$ERR" ] && note "$(head -3 "$ERR")"
        echo "(skipped: ESLint error)"
      else
        RULE_VIOLATIONS="$(jq '[.[].messages[] | select(.ruleId != null)] | length' "$OUT")"
        if [ "$RULE_VIOLATIONS" -gt 0 ]; then
          jq -r '.[] | .filePath as $f | .messages[]
                   | select(.ruleId != null)
                   | "\($f):\(.line):\(.column)  [\(.ruleId)]  \(.message)"' "$OUT"
          echo
          # per-rule tally
          echo "rule tally:"
          jq -r '[.[].messages[] | select(.ruleId != null) | .ruleId] | group_by(.) | .[] | "  \(length)  \(.[0])"' "$OUT"
        else
          echo "(none)"
        fi
      fi
    fi
  fi
fi
echo

# --- REVIEW: grep/awk heuristics -------------------------------------------
echo "--- REVIEW: heuristics (human confirms) ---"

# 1. bare JSON.parse outside a try block (per-file brace-depth heuristic).
echo "* JSON.parse outside try (heuristic):"
JP_HITS=0
if [ "${#FILES[@]}" -gt 0 ]; then
  for f in "${FILES[@]}"; do
    awk '
      # Track whether we are inside at least one open try block by brace depth.
      { line = $0 }
      # Is a "try {" opening on this line?
      {
        opens_try = (line ~ /(^|[^A-Za-z0-9_])try([[:space:]]*|[[:space:]]*\/\/.*|[[:space:]]*)\{/)
      }
      {
        # count braces on this line
        tmp = line; nopen = gsub(/\{/, "", tmp)
        tmp = line; nclose = gsub(/\}/, "", tmp)
      }
      # If a try opens here, remember the depth level it lives at.
      opens_try { try_stack[++tstop] = depth }
      # Flag JSON.parse on this line if no try is currently open around it.
      /JSON\.parse[[:space:]]*\(/ {
        if (tstop <= 0) print FILENAME ":" FNR ":  " line
      }
      # Update running depth, and pop try levels that have closed.
      {
        depth += nopen - nclose
        while (tstop > 0 && depth <= try_stack[tstop]) tstop--
      }
    ' "$f"
  done > /tmp/.eg_jp_$$ 2>/dev/null || true
  if [ -s /tmp/.eg_jp_$$ ]; then
    sed 's/^/    /' /tmp/.eg_jp_$$
    JP_HITS="$(wc -l < /tmp/.eg_jp_$$ | tr -d ' ')"
  else
    echo "    (none)"
  fi
  rm -f /tmp/.eg_jp_$$
else
  echo "    (none)"
fi
echo "  -> $JP_HITS site(s) to verify are wrapped in try/catch"
echo

# 2. console.* in non-exempt files (cross-check of no-console).
echo "* console.* in non-exempt files:"
CONSOLE_HITS=0
if [ "${#FILES[@]}" -gt 0 ]; then
  # Strip lines whose code content starts with a comment marker (// * /*) so
  # commented-out console mentions are not counted.
  if grep -RnE '(^|[^A-Za-z0-9_.])console[[:space:]]*\.' "${FILES[@]}" 2>/dev/null \
       | grep -vE '^[^:]*:[0-9]+:[[:space:]]*(//|\*|/\*)' > /tmp/.eg_con_$$; then :; fi
  if [ -s /tmp/.eg_con_$$ ]; then
    sed 's/^/    /' /tmp/.eg_con_$$
    CONSOLE_HITS="$(wc -l < /tmp/.eg_con_$$ | tr -d ' ')"
  else
    echo "    (none)"
  fi
  rm -f /tmp/.eg_con_$$
else
  echo "    (none)"
fi
echo "  -> $CONSOLE_HITS occurrence(s) (each is also a HIGH no-console violation)"
echo

# 3. catch-block census (informational).
echo "* catch blocks (census):"
CATCH_HITS=0
if [ "${#FILES[@]}" -gt 0 ]; then
  # Exclude the dot-prefixed promise form (.catch()) — this census is try/catch blocks.
  if grep -RnE '(^|[^A-Za-z0-9_.])catch[[:space:]]*[({]' "${FILES[@]}" > /tmp/.eg_cat_$$ 2>/dev/null; then :; fi
  if [ -s /tmp/.eg_cat_$$ ]; then
    CATCH_HITS="$(wc -l < /tmp/.eg_cat_$$ | tr -d ' ')"
  fi
  rm -f /tmp/.eg_cat_$$
fi
echo "  -> $CATCH_HITS catch site(s) across target files"
echo

# --- summary ---------------------------------------------------------------
echo "== summary =="
echo "HIGH   rule violations : $RULE_VIOLATIONS"
echo "REVIEW JSON.parse/try  : $JP_HITS"
echo "REVIEW console.*       : $CONSOLE_HITS"
echo "REVIEW catch census    : $CATCH_HITS"

if [ "$RULE_VIOLATIONS" -gt 0 ]; then
  exit 1
fi
exit 0
