#!/usr/bin/env bash
# test-guard route-nudge hook — PostToolUse on Write|Edit|MultiEdit.
#
# Purpose (contract §4.2): after a product-source file is written/edited, record it
# in the per-session touched log and, if that module has NO test-guard gate
# (no armed spot-check, no DONE verdict, no in-flight red, no waiver), inject a
# NON-BLOCKING nudge (additionalContext) telling the agent to route the change
# through test-guard. The Stop gate is what actually holds the session open.
#
# This hook is NON-BLOCKING by definition (§1.2 PostToolUse cannot un-run a tool).
# It NEVER exits non-zero and NEVER crashes the session: any anomaly -> exit 0 silent.
# It only reads gate state under $STATE_ROOT and appends to session files (§3.5).
#
# bash 3.2 safe: no associative arrays, no ${var,,}, no mapfile. shasum -a 256.

set -u

# State root — byte-identical default to redgreen.sh (§3.1). macOS $TMPDIR trap honored.
STATE_ROOT="${REDGREEN_STATE_ROOT:-${TMPDIR:-/tmp}/redgreen-state}"

# Prefix that marks "inside a monday app" (§4.2 step 2). Overridable for verifier fixtures.
# Portable default: the project root of the current session — Claude Code sets
# $CLAUDE_PROJECT_DIR for hooks; fall back to the git toplevel, then the hook's cwd.
# Trailing slash is load-bearing (prefix match below).
default_apps_root() {
  local root=""
  if [ -n "${CLAUDE_PROJECT_DIR:-}" ]; then
    root="$CLAUDE_PROJECT_DIR"
  else
    root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
    [ -n "$root" ] || root="$PWD"
  fi
  # Physical resolution: file paths compared against this prefix are physical (§2.1),
  # so the prefix must be too (symlinks/.. in the env var would break the match).
  root="$(cd "$root" 2>/dev/null && pwd -P || printf '%s' "$root")"
  printf '%s/' "${root%/}"
}
APPS_ROOT="${TEST_GUARD_APPS_ROOT:-$(default_apps_root)}"

# --- JSON string escaper (§3.3): backslash, quote, newline. Reads stdin, writes stdout.
json_escape() {
  # Order matters: escape backslash first, then quote, then newlines.
  sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | awk 'BEGIN{ORS=""} {if(NR>1)printf "\\n"; print}'
}

# --- Extract a top-level string field from the stdin JSON blob in $RAW.
# jq when available, sed fallback otherwise (both branches mandatory, §3.3).
json_str() { # $1 = field name
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$RAW" | jq -r --arg k "$1" '.tool_input[$k] // .[$k] // empty' 2>/dev/null
  else
    printf '%s' "$RAW" | sed -n 's/.*"'"$1"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1
  fi
}

# --- Physical absolute path (§2.1 recipe) with a textual fallback for a not-yet-existing file.
abs_path() { # $1 = raw path, $2 = cwd for relative resolution
  local p="$1" cwd="$2" d b
  d="$(dirname "$p")"; b="$(basename "$p")"
  if [ -d "$d" ]; then
    ( cd "$d" 2>/dev/null && printf '%s/%s\n' "$PWD" "$b" )
    return 0
  fi
  # dirname missing: normalize textually against cwd (no symlink/.. resolution needed here)
  case "$p" in
    /*) printf '%s\n' "$p" ;;
    *)  printf '%s/%s\n' "${cwd%/}" "$p" ;;
  esac
}

# --- 16-hex state key for a test path (§2.1).
state_key() { printf '%s' "$1" | shasum -a 256 | cut -c1-16; }

# --- Count kills.log lines with a given prefix in a state dir. Echoes an integer.
count_kills() { # $1 = state dir, $2 = prefix (KILLED|SURVIVED)
  local f="$1/kills.log"
  [ -f "$f" ] || { echo 0; return; }
  grep -c "^$2|" "$f" 2>/dev/null || echo 0
}

# --- covered predicate for a resolved gate state dir (§4.2 step 4 + §2.4, read-only).
# Covered if: red in-flight (red.hash), OR an armed retrofit spot-check (armed.src —
# contract amendment 2026-07-07: an armed gate IS in-flight work, nudging it is a
# false positive), OR a waiver exists, OR verdict is DONE.
# Since this is only called on a real gate dir, DONE reduces to:
#   - TDD path: red && green && (killed>=2 || waiver)   (red covers via in-flight anyway)
#   - retrofit path: !red && killed>=2 && survived==0
# Returns 0 = covered, 1 = not covered.
is_covered() { # $1 = state dir
  local d="$1" killed survived
  [ -f "$d/red.hash" ] && return 0       # in-flight — lock/stop-gate own this case
  # Live-armed spot-check — in-flight (amendment 2026-07-07). armed.src alone is
  # stale metadata after fire; the .mutbak sibling is the live-arm signal.
  if [ -f "$d/armed.src" ]; then
    local asrc; asrc="$(head -n1 "$d/armed.src" 2>/dev/null)"
    [ -n "$asrc" ] && [ -f "$asrc.mutbak" ] && return 0
  fi
  [ -f "$d/waiver.txt" ] && return 0     # waived
  survived="$(count_kills "$d" SURVIVED)"
  killed="$(count_kills "$d" KILLED)"
  # §2.4 rule 1: any open survivor => NOT DONE.
  [ "$survived" -gt 0 ] 2>/dev/null && return 1
  # red is absent here, so DONE only via retrofit path (killed>=2).
  [ "$killed" -ge 2 ] 2>/dev/null && return 0
  return 1
}

# --- Locate the gate state dir for source file S, if any (§4.2 step 4).
# 1) armed gate: a state dir whose armed.src == S.
# 2) else conventional-test probe: hash candidate test paths, first existing dir wins.
# Echoes the state dir path, or nothing.
find_gate_dir() { # $1 = abs source path
  local S="$1" d dir_S stem base ext cand key
  # (1) armed gate — some state dir points its armed.src at S.
  for d in "$STATE_ROOT"/*/; do
    [ -d "$d" ] || continue
    if [ -f "${d}armed.src" ] && [ "$(cat "${d}armed.src" 2>/dev/null)" = "$S" ]; then
      printf '%s\n' "${d%/}"
      return 0
    fi
    # …or a source this gate has already KILLED a mutation in (amendment 11): one test
    # file may gate several modules, and armed.src remembers only the last of them.
    if [ -f "${d}gated-srcs.txt" ] && grep -qxF "$S" "${d}gated-srcs.txt" 2>/dev/null; then
      printf '%s\n' "${d%/}"
      return 0
    fi
  done
  # (2) conventional-test probe. dir_S is already physical; concatenate textually so the
  # key matches what redgreen.sh computed when that (existing) test file was gated.
  dir_S="$(dirname "$S")"
  base="$(basename "$S")"
  stem="${base%.*}"
  for ext in js ts mjs cjs jsx tsx; do
    for cand in \
      "$dir_S/$stem.test.$ext" \
      "$dir_S/$stem.spec.$ext" \
      "$dir_S/__tests__/$stem.test.$ext" \
      "$dir_S/__tests__/$stem.spec.$ext"; do
      key="$(state_key "$cand")"
      if [ -d "$STATE_ROOT/$key" ]; then
        printf '%s\n' "$STATE_ROOT/$key"
        return 0
      fi
    done
  done
  # (3) runner-less fallback (amendment 7): a state dir keyed to S itself — the only
  # key `redgreen.sh waive` can create in an app with no test files.
  key="$(state_key "$S")"
  if [ -d "$STATE_ROOT/$key" ]; then
    printf '%s\n' "$STATE_ROOT/$key"
    return 0
  fi
  return 1
}

# --- Product-source filter (§4.2 step 2). Returns 0 if S is trackable product source.
# Also sets PROJECT_ROOT (nearest package.json) on success.
PROJECT_ROOT=""
is_product_source() { # $1 = abs source path
  local S="$1" base ext dir i
  base="$(basename "$S")"
  ext="${base##*.}"
  # Allowed extensions only (excludes .jsx/.tsx = the JSX-view exclusion, and .md/.json/...).
  case "$ext" in
    js|mjs|cjs|ts) ;;
    *) return 1 ;;
  esac
  # Excluded path segments.
  case "$S" in
    */node_modules/*|*/dist/*|*/build/*|*/.claude/*|*/coverage/*) return 1 ;;
  esac
  # Not a test file (basename .test./.spec. or a test directory segment).
  case "$base" in
    *.test.*|*.spec.*) return 1 ;;
  esac
  case "$S" in
    */__tests__/*|*/tests/*|*/test/*) return 1 ;;
  esac
  # Not a config/dotfile/tooling file.
  if printf '%s' "$base" | grep -Eq '(\.config\.|^\.|rc\.(js|cjs|mjs|ts)$|vite\.|vitest\.|jest\.|babel\.|eslint)'; then
    return 1
  fi
  # Must live inside a monday app: upward walk (max 15) finds package.json AND
  # the path is under APPS_ROOT.
  case "$S" in
    "$APPS_ROOT"*) ;;
    *) return 1 ;;
  esac
  dir="$(dirname "$S")"; i=0
  while [ "$dir" != "/" ] && [ "$i" -lt 15 ]; do
    if [ -f "$dir/package.json" ]; then
      PROJECT_ROOT="$dir"
      return 0
    fi
    dir="$(dirname "$dir")"; i=$((i + 1))
  done
  return 1
}

# --- Emit the non-blocking nudge JSON (additionalContext) and exit 0.
emit_nudge() { # $1 = relpath
  local rel="$1" msg esc
  msg="test-guard: ${rel} is product source with no armed test-guard gate, no DONE verdict, and no waiver. Route this change through test-guard before finishing: /test-guard tdd (new behavior) or /test-guard retrofit <dir> (existing code), or record a waiver via redgreen.sh waive. The Stop gate will hold the session open until every touched module is DONE or waived."
  esc="$(printf '%s' "$msg" | json_escape)"
  printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"%s"}}\n' "$esc"
  exit 0
}

main() {
  # Read all of stdin.
  RAW="$(cat)"
  [ -n "$RAW" ] || exit 0

  local file_raw sid_raw sid cwd abs_S sdir sess_dir touched nudged rel

  file_raw="$(json_str file_path)"
  sid_raw="$(json_str session_id)"
  [ -n "$file_raw" ] || exit 0
  [ -n "$sid_raw" ] || exit 0

  # Sanitize session id to a safe path component (§3.2).
  sid="$(printf '%s' "$sid_raw" | tr -cd 'A-Za-z0-9._-')"
  [ -n "$sid" ] || exit 0

  cwd="$(json_str cwd)"
  abs_S="$(abs_path "$file_raw" "${cwd:-$PWD}")"
  [ -n "$abs_S" ] || exit 0

  # Product-source filter — non-source files are ignored entirely (also sets PROJECT_ROOT).
  is_product_source "$abs_S" || exit 0

  # Always record the touched source path for the Stop gate (§4.2 step 3, append-only).
  sess_dir="$STATE_ROOT/sessions/$sid"
  mkdir -p "$sess_dir" 2>/dev/null || exit 0
  touched="$sess_dir/touched.txt"
  printf '%s\n' "$abs_S" >> "$touched"

  # If a gate exists and the module is covered, nothing to nudge.
  sdir="$(find_gate_dir "$abs_S")"
  if [ -n "$sdir" ] && is_covered "$sdir"; then
    exit 0
  fi

  # Not covered. Nudge at most once per session per file (§4.2 step 5 dedupe).
  nudged="$sess_dir/nudged.txt"
  if [ -f "$nudged" ] && grep -Fxq "$abs_S" "$nudged"; then
    exit 0
  fi
  printf '%s\n' "$abs_S" >> "$nudged"

  # Relative path for the message (fall back to abs if PROJECT_ROOT somehow unset).
  if [ -n "$PROJECT_ROOT" ]; then
    rel="${abs_S#"$PROJECT_ROOT"/}"
  else
    rel="$abs_S"
  fi
  emit_nudge "$rel"
}

# Never crash the session: swallow stderr, never propagate non-zero (§3.5).
main "$@" 2>/dev/null || exit 0
exit 0
