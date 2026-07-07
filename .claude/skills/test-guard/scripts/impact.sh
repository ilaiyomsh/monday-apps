#!/usr/bin/env bash
# test-guard impact.sh — informational blast-radius report for a changed source file.
# Contract: binding-contract.md §4.5. Bash 3.2 portable (macOS default), no associative arrays.
#
# Usage: impact.sh <changed-src-file>
#
# Prints:
#   1. CONSUMERS: every project file that imports/requires the changed module,
#      split into production: / test:
#   2. DEAD-CODE CANDIDATES: exported identifiers with zero references in any
#      PRODUCTION consumer file (heuristic — see caveat in output)
#
# Exit codes: 0 = report produced (even if empty), 2 = usage/setup/anomaly.
# No state is written anywhere (pure read-only report). Never call this from a hook
# (it may take seconds on a large tree) — hooks are read-only-fast; this is a CLI.

set -u

usage() { echo "usage: impact.sh <changed-src-file>" >&2; exit 2; }
die()   { echo "IMPACT ERROR: $*" >&2; exit 2; }

SRC_FILE="${1:-}"
[[ -z "$SRC_FILE" ]] && usage
[[ -f "$SRC_FILE" ]] || die "source file not found: $SRC_FILE"

# ---------------------------------------------------------------- helpers (shared style w/ redgreen.sh)

# Physical absolute path (same recipe as redgreen.sh's abs_path — must match so
# string-suffix comparisons below are apples-to-apples).
abs_path() { (cd "$(dirname "$1")" && printf '%s/%s\n' "$PWD" "$(basename "$1")"); }

# Escape a literal string for safe use inside an ERE (grep -E) pattern.
ere_escape() {
  printf '%s' "$1" | sed -E 's/[][\.^$*+?(){}|\\]/\\&/g'
}

ABS_SRC="$(abs_path "$SRC_FILE")"
BASE="$(basename "$ABS_SRC")"
STEM="${BASE%.*}"                       # basename without extension, e.g. "foo" from "foo.js"
[[ -z "$STEM" ]] && die "could not derive a module stem from: $SRC_FILE"

# ---------------------------------------------------------------- project root

dir="$(dirname "$ABS_SRC")"
PROJECT_DIR=""
while [[ "$dir" != "/" ]]; do
  if [[ -f "$dir/package.json" ]]; then PROJECT_DIR="$dir"; break; fi
  dir="$(dirname "$dir")"
done
[[ -z "$PROJECT_DIR" ]] && die "no package.json found above $SRC_FILE"

echo "test-guard impact report for ${ABS_SRC#"$PROJECT_DIR"/}"
echo "project root: $PROJECT_DIR"
echo

# ---------------------------------------------------------------- consumer scan

STEM_RE="$(ere_escape "$STEM")"
# One combined ERE: any of the three import shapes, as long as the specifier
# string contains the module's stem somewhere. Precision beyond "contains stem"
# is applied afterward via the suffix check (step below) — this first pass is
# intentionally loose to avoid missing hits.
IMPORT_RE="(from[[:space:]]*['\"][^'\"]*${STEM_RE}[^'\"]*['\"])"
IMPORT_RE="${IMPORT_RE}|(require\\(['\"][^'\"]*${STEM_RE}[^'\"]*['\"]\\))"
IMPORT_RE="${IMPORT_RE}|(import\\([[:space:]]*['\"][^'\"]*${STEM_RE}[^'\"]*['\"])"

RAW_HITS="$(mktemp)"
trap 'rm -f "$RAW_HITS" "${PROD_LIST:-}" "${TEST_LIST:-}"' EXIT

grep -rnE \
  --include='*.js' --include='*.ts' --include='*.jsx' --include='*.tsx' --include='*.mjs' --include='*.cjs' \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=build --exclude-dir=coverage --exclude-dir=.git \
  "$IMPORT_RE" \
  "$PROJECT_DIR" > "$RAW_HITS" 2>/dev/null
# grep exit 1 (no matches) is a normal outcome here, not an error — do not die on it.

# Strip a leading run of "./" / "../" segments from a specifier, leaving the
# path suffix used for the string-suffix resolution check (contract §4.5 step 2:
# "full Node resolution NOT required" — this is the documented heuristic).
strip_leading_relative() {
  local s="$1"
  while [[ "$s" == ./* || "$s" == ../* ]]; do
    if [[ "$s" == ./* ]]; then s="${s#./}"; else s="${s#../}"; fi
  done
  printf '%s' "$s"
}

# Pull the quoted specifier out of one matched line (from/require/import(...)).
extract_specifier() {
  printf '%s' "$1" | sed -nE "s/.*(from|require\\(|import\\()[[:space:]]*['\"]([^'\"]*)['\"].*/\\2/p" | head -n1
}

ABS_SRC_NOEXT="${ABS_SRC%.*}"

PROD_LIST="$(mktemp)"
TEST_LIST="$(mktemp)"
: > "$PROD_LIST"
: > "$TEST_LIST"

while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  # line format: <path>:<lineno>:<content>
  hit_path="${line%%:*}"
  rest="${line#*:}"
  hit_lineno="${rest%%:*}"
  hit_content="${rest#*:}"

  # Never a consumer of itself.
  hit_abs="$(abs_path "$hit_path" 2>/dev/null)" || continue
  [[ "$hit_abs" == "$ABS_SRC" ]] && continue

  specifier="$(extract_specifier "$hit_content")"
  [[ -z "$specifier" ]] && continue
  suffix="$(strip_leading_relative "$specifier")"
  [[ -z "$suffix" ]] && continue

  # String-suffix resolution check: does the changed file's (extension-stripped)
  # absolute path end with the specifier's cleaned-up suffix? This is a heuristic,
  # not real module resolution (no alias/tsconfig-paths support) — documented.
  case "$ABS_SRC_NOEXT" in
    *"$suffix") ;;
    *) case "$ABS_SRC" in *"$suffix") ;; *) continue ;; esac ;;
  esac

  rel_hit="${hit_abs#"$PROJECT_DIR"/}"
  out_line="${rel_hit}:${hit_lineno}  $(printf '%s' "$hit_content" | sed -E 's/^[[:space:]]+//')"

  # Test-file classification mirrors route-nudge's product-source filter (§4.2):
  # basename matches .test./.spec., or path runs through /__tests__//, /tests/, /test/.
  base_hit="$(basename "$hit_abs")"
  is_test=0
  case "$base_hit" in *.test.*|*.spec.*) is_test=1 ;; esac
  case "/$rel_hit/" in */__tests__/*|*/tests/*|*/test/*) is_test=1 ;; esac

  if [[ "$is_test" -eq 1 ]]; then
    printf '%s\n' "$out_line" >> "$TEST_LIST"
    printf '%s\n' "$hit_abs" >> "${TEST_LIST}.paths"
  else
    printf '%s\n' "$out_line" >> "$PROD_LIST"
    printf '%s\n' "$hit_abs" >> "${PROD_LIST}.paths"
  fi
done < "$RAW_HITS"

echo "CONSUMERS:"
echo "  production:"
if [[ -s "$PROD_LIST" ]]; then
  sort -u "$PROD_LIST" | sed 's/^/    /'
else
  echo "    (none)"
fi
echo "  test:"
if [[ -s "$TEST_LIST" ]]; then
  sort -u "$TEST_LIST" | sed 's/^/    /'
else
  echo "    (none)"
fi
echo

PROD_COUNT=0
[[ -f "${PROD_LIST}.paths" ]] && PROD_COUNT="$(sort -u "${PROD_LIST}.paths" 2>/dev/null | grep -c . || true)"
if [[ "$PROD_COUNT" -eq 0 ]]; then
  echo "NOTE: zero production consumers found for this module — the entire file is a dead-code candidate"
  echo "(heuristic: re-exports, dynamic access, and default-import renaming are not tracked — verify before deleting)."
  echo
fi

# ---------------------------------------------------------------- export extraction

EXPORTS_FILE="$(mktemp)"
trap 'rm -f "$RAW_HITS" "${PROD_LIST:-}" "${TEST_LIST:-}" "${PROD_LIST:-}.paths" "${TEST_LIST:-}.paths" "$EXPORTS_FILE"' EXIT

# a) export default ...
grep -Eq '^[[:space:]]*export[[:space:]]+default([[:space:]]|\(|$)' "$ABS_SRC" && echo "default" >> "$EXPORTS_FILE"

# b) export (const|function|class|let|var) <name>
grep -Eo '^[[:space:]]*export[[:space:]]+(const|function|class|let|var)[[:space:]]+[A-Za-z_$][A-Za-z0-9_$]*' "$ABS_SRC" \
  | awk '{print $NF}' >> "$EXPORTS_FILE"

# c) export { a, b as c, ... } — single or multi-line via awk range extraction.
#    Best-effort: not a real JS parser, documented heuristic.
awk '
  /export[[:space:]]*\{/ { inblock=1; buf=$0; if ($0 ~ /\}/) { print buf; inblock=0; buf="" } ; next }
  inblock { buf = buf " " $0; if ($0 ~ /\}/) { print buf; inblock=0; buf="" } }
' "$ABS_SRC" | while IFS= read -r blockline; do
  inner="$(printf '%s' "$blockline" | sed -nE 's/.*export[[:space:]]*\{([^}]*)\}.*/\1/p')"
  [[ -z "$inner" ]] && continue
  # split on commas. Trailing \n before tr is required: without it a single
  # (comma-less) item has no line terminator and `read` fails on EOF, silently
  # dropping the only item — verified failing without this fix.
  printf '%s\n' "$inner" | tr ',' '\n' | while IFS= read -r item; do
    item="$(printf '%s' "$item" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
    [[ -z "$item" ]] && continue
    if [[ "$item" == *" as "* ]]; then
      # consumers import the name AFTER "as" — that's what to search for.
      printf '%s\n' "${item##* as }"
    else
      printf '%s\n' "$item"
    fi
  done
done >> "$EXPORTS_FILE"

# d) module.exports.<name> =
grep -Eo 'module\.exports\.[A-Za-z_$][A-Za-z0-9_$]*[[:space:]]*=' "$ABS_SRC" \
  | sed -E 's/^module\.exports\.//; s/[[:space:]]*=$//' >> "$EXPORTS_FILE"

# e) module.exports = { ... } — extract identifiers/keys inside the object literal.
#    Handles the common single-line case and a bounded multi-line case (up to the
#    next line containing a closing brace). Heuristic, not a JS parser.
awk '
  /module\.exports[[:space:]]*=[[:space:]]*\{/ { inblock=1; buf=$0; if ($0 ~ /\}/) { print buf; inblock=0; buf="" }; next }
  inblock { buf = buf " " $0; if ($0 ~ /\}/) { print buf; inblock=0; buf="" } }
' "$ABS_SRC" | while IFS= read -r blockline; do
  inner="$(printf '%s' "$blockline" | sed -nE 's/.*module\.exports[[:space:]]*=[[:space:]]*\{(.*)\}.*/\1/p')"
  [[ -z "$inner" ]] && continue
  # trailing \n before tr — same single-item EOF trap as the export{} block above.
  printf '%s\n' "$inner" | tr ',' '\n' | while IFS= read -r item; do
    item="$(printf '%s' "$item" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
    [[ -z "$item" ]] && continue
    # "key: value" shorthand or "key" alone — the KEY is what external consumers use.
    key="${item%%:*}"
    key="$(printf '%s' "$key" | sed -E 's/[[:space:]]+$//')"
    [[ -n "$key" ]] && printf '%s\n' "$key"
  done
done >> "$EXPORTS_FILE"

EXPORT_NAMES="$(sort -u "$EXPORTS_FILE" | grep -v '^$' || true)"

echo "DEAD-CODE CANDIDATES:"
if [[ -z "$EXPORT_NAMES" ]]; then
  echo "  (no exports detected — nothing to check)"
else
  found_any=0
  while IFS= read -r ident; do
    [[ -z "$ident" ]] && continue
    hit=0
    if [[ "$PROD_COUNT" -gt 0 ]]; then
      while IFS= read -r pfile; do
        [[ -z "$pfile" ]] && continue
        grep -Eq "\\<$(ere_escape "$ident")\\>" "$pfile" 2>/dev/null && { hit=1; break; }
      done < <(sort -u "${PROD_LIST}.paths")
    fi
    if [[ "$hit" -eq 0 ]]; then
      echo "  $ident"
      found_any=1
    fi
  done <<< "$EXPORT_NAMES"
  [[ "$found_any" -eq 0 ]] && echo "  (none — every export is referenced by at least one production consumer)"
  echo "  (heuristic: re-exports, dynamic access, and default-import renaming are not tracked — verify before deleting)"
fi

exit 0
