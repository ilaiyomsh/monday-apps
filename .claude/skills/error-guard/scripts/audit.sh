#!/usr/bin/env bash
# error-guard/audit.sh — deterministic gap report for a whole app.
#
# Runs the same error-guard rule set (via check.sh's engine, re-implemented here
# for a tree) over the app's src/ tree, then adds cheap grep/awk heuristics that
# static rules cannot cover. Prints a severity-bucketed summary:
#   HIGH   — ESLint rule violations (the enforced kit; also the CI/ship gate).
#   REVIEW — heuristics a human confirms: bare JSON.parse outside try, console.*
#            in non-exempt files, and a catch-block census.
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

note() { printf 'error-guard/audit: %s\n' "$1" >&2; }

APPDIR="${1:-}"
if [ -z "$APPDIR" ] || [ ! -d "$APPDIR" ]; then
  note "usage: audit.sh <app-directory>"
  exit 2
fi
APPDIR="$(cd "$APPDIR" && pwd)"

SCAN_ROOT="$APPDIR/src"
if [ ! -d "$SCAN_ROOT" ]; then SCAN_ROOT="$APPDIR"; fi

# --- shared file filter (matches check.sh) ----------------------------------
should_skip() {
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

# --- collect target files ---------------------------------------------------
declare -a FILES=()
while IFS= read -r f; do
  should_skip "$f" && continue
  FILES+=("$f")
done < <(find "$SCAN_ROOT" -type f \( -name '*.js' -o -name '*.jsx' -o -name '*.ts' -o -name '*.tsx' \) \
           -not -path '*/node_modules/*' -not -path '*/dist/*' -not -path '*/build/*' 2>/dev/null | sort)

echo "== error-guard audit: $APPDIR =="
echo "scanned root: $SCAN_ROOT"
echo "target files (after exemptions): ${#FILES[@]}"
echo

RULE_VIOLATIONS=0

# --- HIGH: ESLint rule set --------------------------------------------------
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
resolve_module() {
  local base="$1" mod="$2"
  node -e "try{process.stdout.write(require.resolve('$mod',{paths:['$base']}))}catch(e){}" 2>/dev/null || true
}

echo "--- HIGH: rule violations (enforced kit) ---"
if [ "${#FILES[@]}" -eq 0 ] || [ ! -f "$TEMPLATE" ]; then
  note "nothing to lint (no files or missing template)"
else
  RESOLVE_DIR=""
  if ! RESOLVE_DIR="$(find_eslint_dir "$APPDIR")"; then
    if RESOLVE_DIR="$(sibling_eslint_dir)"; then
      note "no ESLint in app; borrowing $RESOLVE_DIR/node_modules"
    else
      RESOLVE_DIR=""
    fi
  fi

  if [ -z "$RESOLVE_DIR" ]; then
    note "no ESLint available — rule section skipped (fail open)"
    echo "(skipped: no ESLint available)"
  else
    ESLINT_BIN="$RESOLVE_DIR/node_modules/.bin/eslint"
    PARSER_PATH="$(resolve_module "$RESOLVE_DIR" '@typescript-eslint/parser')"
    HAS_PROMISE=false
    [ -n "$(resolve_module "$RESOLVE_DIR" 'eslint-plugin-promise')" ] && HAS_PROMISE=true
    if [ "$HAS_PROMISE" = false ]; then
      note "promise/catch-or-return skipped — eslint-plugin-promise not resolvable from $RESOLVE_DIR; floating promises are NOT counted in HIGH (install: pnpm add -D eslint-plugin-promise)"
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
      CONFIG="$TMPDIR_EG/eslintrc.json"
      # Union catch-must-log selector (client + server allowances) — same rationale
      # as check.sh: one config covers both worlds; per-app kits stay precise.
      UNION_SELECTOR="CatchClause > BlockStatement:not(:has(CallExpression[callee.object.name='logger'])):not(:has(ThrowStatement)):not(:has(CallExpression[callee.name='showErrorWithDetails'])):not(:has(CallExpression[callee.name='next']))"
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

      OUT="$TMPDIR_EG/out.json"
      "$ESLINT_BIN" --no-eslintrc --config "$CONFIG" \
        --resolve-plugins-relative-to "$RESOLVE_DIR" \
        --format json "${LINT_FILES[@]}" > "$OUT" 2>"$TMPDIR_EG/err.txt" || true

      if ! jq -e . "$OUT" >/dev/null 2>&1; then
        note "ESLint produced no parseable output — rule section skipped (fail open)"
        [ -s "$TMPDIR_EG/err.txt" ] && note "$(head -3 "$TMPDIR_EG/err.txt")"
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
