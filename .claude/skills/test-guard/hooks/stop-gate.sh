#!/usr/bin/env bash
# test-guard Stop hook — stop-gate (contract §4.3).
#
# Purpose: when the agent tries to end its turn, hold the session open if any
# product-source module it touched this session has no DONE verdict and no
# waiver. Blocking is loop-protected by an OWN persisted counter (the docs do
# not guarantee `stop_hook_active`, so we never rely on it — §1.1 / §3.4).
#
# Contract invariants honored here (§3.5):
#   - Never crashes the session and NEVER exits non-zero: every anomaly -> exit 0.
#   - Blocking is exit 0 + JSON only (the exit-1 footgun is avoided entirely).
#   - Read-only w.r.t. gate state, EXCEPT its own per-session stop-blocks.count.
#   - Fast: filesystem reads under $STATE_ROOT only; no test runs, no network,
#     never calls redgreen.sh red/green/spotcheck-* (verdict is reimplemented
#     read-only per §2.4).
#   - Every block names the sanctioned way out (finish the gate, or waive).
#
# Portable to macOS bash 3.2: no associative arrays, no ${var,,}, no mapfile.

set -u

# ---- state root (§3.1): default byte-identical to redgreen.sh's scheme -------
STATE_ROOT="${REDGREEN_STATE_ROOT:-${TMPDIR:-/tmp}/redgreen-state}"

# ---- loop-protection budget (§3.4) -------------------------------------------
MAX="${TEST_GUARD_STOP_MAX_BLOCKS:-2}"
case "$MAX" in ''|*[!0-9]*) MAX=2 ;; esac   # non-integer override -> default 2

# ---- where product source is expected to live (§4.2, override for fixtures) --
# Not filtered here (route-nudge already filtered before writing touched.txt);
# retained only for relpath shortening.
# Portable default: the project root of the current session — Claude Code sets
# $CLAUDE_PROJECT_DIR for hooks; fall back to the git toplevel, then the hook's cwd.
# Trailing slash is load-bearing (prefix strip in relpath).
default_apps_root() {
  local root=""
  if [ -n "${CLAUDE_PROJECT_DIR:-}" ]; then
    root="$CLAUDE_PROJECT_DIR"
  else
    root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
    [ -n "$root" ] || root="$PWD"
  fi
  # Physical resolution: touched.txt paths are physical (route-nudge §2.1 recipe),
  # so the prefix stripped here must be too.
  root="$(cd "$root" 2>/dev/null && pwd -P || printf '%s' "$root")"
  printf '%s/' "${root%/}"
}
APPS_ROOT="${TEST_GUARD_APPS_ROOT:-$(default_apps_root)}"

# --- JSON string escaper for the no-jq fallback (§3.3) ------------------------
# Escapes \ then " then converts real newlines to \n. Emits WITHOUT quotes.
json_escape() {
  printf '%s' "$1" \
    | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' \
    | awk 'BEGIN{ORS=""} {if (NR>1) printf "\\n"; printf "%s", $0}'
}

# --- field extraction from stdin JSON: jq when present, sed fallback (§3.3) ----
json_field() { # $1 = full JSON, $2 = field name
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$1" | jq -r --arg k "$2" '.[$k] // empty' 2>/dev/null
  else
    printf '%s' "$1" \
      | sed -n "s/.*\"$2\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" \
      | head -n1
  fi
}

# --- reverse index, built ONCE per invocation (fixes the §3.5.3 timing bug) ----
# Iterate $STATE_ROOT/*/ a SINGLE time, reading each dir's test.path and
# armed.src (forkless first-line reads) into parallel indexed arrays. Per-touched
# lookups are then pure-bash string compares — zero shasum/cat spawns in the hot
# loop, so cost is O(dirs + touched) instead of O(dirs * touched) with 18 shasum
# execs per file. Indexed arrays are bash-3.2-safe (associative arrays are not).
# test.path exists in every v2 state dir (§4.6.2); pre-v2 dirs lacking it are
# contractually invisible to hooks, so hashing candidate paths is unnecessary.
PATH_KEYS=(); PATH_DIRS=(); ARMED_KEYS=(); ARMED_DIRS=()
build_index() {
  local d tp as
  PATH_KEYS=(); PATH_DIRS=(); ARMED_KEYS=(); ARMED_DIRS=()
  for d in "$STATE_ROOT"/*/; do
    [ -d "$d" ] || continue
    d="${d%/}"
    tp=""; [ -f "$d/test.path" ] && IFS= read -r tp < "$d/test.path" 2>/dev/null
    if [ -n "$tp" ]; then PATH_KEYS+=("$tp"); PATH_DIRS+=("$d"); fi
    as=""; [ -f "$d/armed.src" ] && IFS= read -r as < "$d/armed.src" 2>/dev/null
    if [ -n "$as" ]; then ARMED_KEYS+=("$as"); ARMED_DIRS+=("$d"); fi
    # Every source this gate has KILLED a mutation in, not just the last one armed
    # (amendment 11 — closes known gap 9: one test file gating several modules used to
    # lose the mapping for all but the last, reporting DONE modules as untracked).
    if [ -f "$d/gated-srcs.txt" ]; then
      while IFS= read -r as; do
        [ -n "$as" ] && { ARMED_KEYS+=("$as"); ARMED_DIRS+=("$d"); }
      done < "$d/gated-srcs.txt"
    fi
  done
}

# Forkless exact-key lookups over the index. Each sets LOOKUP and returns 0 on hit.
LOOKUP=""
lookup_armed() { # $1 = source path; searches ARMED_KEYS
  LOOKUP=""; local i=0 n=${#ARMED_KEYS[@]}
  while [ "$i" -lt "$n" ]; do
    if [ "${ARMED_KEYS[$i]}" = "$1" ]; then LOOKUP="${ARMED_DIRS[$i]}"; return 0; fi
    i=$((i + 1))
  done
  return 1
}
lookup_path() { # $1 = test path; searches PATH_KEYS
  LOOKUP=""; local i=0 n=${#PATH_KEYS[@]}
  while [ "$i" -lt "$n" ]; do
    if [ "${PATH_KEYS[$i]}" = "$1" ]; then LOOKUP="${PATH_DIRS[$i]}"; return 0; fi
    i=$((i + 1))
  done
  return 1
}

# --- §2.4 verdict for a state dir, computed READ-ONLY (no test run) ------------
# echoes DONE or NOT_DONE.
verdict_of_dir() {
  local d="$1" red=0 green=0 killed=0 survived=0 waiver=0
  [ -f "$d/red.hash" ]   && red=1
  [ -f "$d/green.ok" ]   && green=1
  [ -f "$d/waiver.txt" ] && waiver=1
  if [ -f "$d/kills.log" ]; then
    killed=$(grep -c '^KILLED|'   "$d/kills.log" 2>/dev/null || true)
    survived=$(grep -c '^SURVIVED|' "$d/kills.log" 2>/dev/null || true)
    killed=${killed:-0}; survived=${survived:-0}
  fi
  # Rule order mirrors cmd_status (§2.4):
  if [ "$survived" -gt 0 ]; then echo NOT_DONE; return; fi
  if [ "$red" -eq 1 ] && [ "$green" -eq 1 ] && { [ "$killed" -ge 2 ] || [ "$waiver" -eq 1 ]; }; then
    echo DONE; return
  fi
  if [ "$red" -eq 0 ] && [ "$killed" -ge 2 ]; then echo DONE; return; fi
  echo NOT_DONE
}

# --- locate the gate state dir for a source file S (§4.2 step 4) --------------
# Preference: an armed gate (armed.src == S) wins; else a conventional-test
# candidate whose test.path is recorded in the index. All matching is pure-bash
# string comparison against the prebuilt index (build_index must run first) and
# forkless string ops for dir/base/stem — no shasum, no per-file dir scan.
# The candidate list is the 4-pattern SUPERSET shared with route-nudge (test +
# spec, both alongside the source and under __tests__/) so the two hooks agree
# on coverage — a stop-gate that probed fewer patterns falsely reported a real
# __tests__/<stem>.spec gate as "untracked" and blocked a DONE module.
gate_dir_for_src() {
  local s="$1" dir base stem ext cand
  # 1) armed gate: some state dir points its armed.src at this exact source.
  lookup_armed "$s" && { printf '%s\n' "$LOOKUP"; return; }
  # 2) conventional test candidates next to the source (and __tests__/).
  dir="${s%/*}"; base="${s##*/}"; stem="${base%.*}"
  for ext in js ts mjs cjs jsx tsx; do
    for cand in \
      "$dir/$stem.test.$ext" \
      "$dir/$stem.spec.$ext" \
      "$dir/__tests__/$stem.test.$ext" \
      "$dir/__tests__/$stem.spec.$ext"; do
      lookup_path "$cand" && { printf '%s\n' "$LOOKUP"; return; }
    done
  done
  # 3) runner-less fallback (amendment 7): a state dir keyed to the SOURCE itself —
  # the only key `redgreen.sh waive` can create in an app with no test files.
  lookup_path "$s" && { printf '%s\n' "$LOOKUP"; return; }
}

# --- human-readable state description for an UNCOVERED module ------------------
uncovered_desc() {
  local d="$1"
  [ -z "$d" ] && { echo "untracked"; return; }
  local survived=0 killed=0
  if [ -f "$d/kills.log" ]; then
    survived=$(grep -c '^SURVIVED|' "$d/kills.log" 2>/dev/null || true)
    killed=$(grep -c '^KILLED|'   "$d/kills.log" 2>/dev/null || true)
    survived=${survived:-0}; killed=${killed:-0}
  fi
  if [ -f "$d/red.hash" ] && [ ! -f "$d/green.ok" ]; then
    echo "red recorded, green missing"; return
  fi
  if [ "$survived" -gt 0 ]; then echo "$survived survivor(s) open"; return; fi
  if [ -f "$d/armed.src" ]; then
    # Live-armed only when the .mutbak sibling still exists (fire's restore removes it).
    local asrc; asrc="$(head -n1 "$d/armed.src" 2>/dev/null)"
    if [ -n "$asrc" ] && [ -f "$asrc.mutbak" ]; then
      echo "armed spot-check, $killed/2 killed — a mutation may still be APPLIED to product source (spotcheck-fire it, or restore from .mutbak)"; return
    fi
  fi
  echo "tracked, no DONE verdict"
}

# --- shorten an abs path for display (strip cwd, then apps-root) --------------
relpath() {
  local p="$1"
  if [ -n "${CWD:-}" ] && [ "${p#"$CWD"/}" != "$p" ]; then
    printf '%s' "${p#"$CWD"/}"; return
  fi
  if [ "${p#"$APPS_ROOT"}" != "$p" ]; then printf '%s' "${p#"$APPS_ROOT"}"; return; fi
  printf '%s' "$p"
}

main() {
  local input; input="$(cat)"
  [ -z "$input" ] && return 0

  # Defensive loop-break if the runtime DOES send stop_hook_active (§1.1).
  if printf '%s' "$input" | grep -Eq '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
    return 0
  fi

  local sid; sid="$(json_field "$input" session_id)"
  sid="$(printf '%s' "$sid" | tr -cd 'A-Za-z0-9._-')"
  [ -z "$sid" ] && return 0

  CWD="$(json_field "$input" cwd)"

  local sess_dir="$STATE_ROOT/sessions/$sid"
  local touched="$sess_dir/touched.txt"
  # Common fast path: nothing touched this session -> allow the stop silently.
  [ -s "$touched" ] || return 0

  # Build the reverse index ONCE (O(dirs)); per-touched lookups are forkless.
  build_index

  # Collect uncovered modules (§4.2 step 4 coverage rule; deduped input).
  local uncovered="" count=0 s d verdict cov desc rp
  while IFS= read -r s; do
    [ -z "$s" ] && continue
    d="$(gate_dir_for_src "$s")"
    cov=0
    if [ -n "$d" ]; then
      # covered iff: red.hash present (in-flight — lock owns it), OR a waiver,
      # OR the §2.4 verdict is DONE.
      if [ -f "$d/red.hash" ] || [ -f "$d/waiver.txt" ]; then
        cov=1
      else
        verdict="$(verdict_of_dir "$d")"
        [ "$verdict" = "DONE" ] && cov=1
      fi
    fi
    if [ "$cov" -eq 0 ]; then
      desc="$(uncovered_desc "$d")"
      rp="$(relpath "$s")"
      uncovered="${uncovered}${rp} — ${desc}"$'\n'
      count=$((count + 1))
    fi
  done <<EOF
$(sort -u "$touched")
EOF

  # All touched modules are covered/waived -> allow the stop silently.
  [ "$count" -eq 0 ] && return 0
  uncovered="${uncovered%$'\n'}"   # trim trailing newline

  # --- loop guard (§3.4 / §4.3 steps 5-6) -------------------------------------
  local countfile="$sess_dir/stop-blocks.count" C=0
  if [ -f "$countfile" ]; then
    C="$(tr -cd '0-9' < "$countfile" 2>/dev/null)"; C=${C:-0}
  fi

  if [ "$C" -ge "$MAX" ]; then
    # Budget exhausted: yield with a recorded warning (explicit escape hatch).
    local warn="test-guard stop-gate: allowing stop after ${C} blocks, but these modules are still not DONE/waived:
${uncovered}
This is recorded, not forgiven."
    if command -v jq >/dev/null 2>&1; then
      jq -n --arg c "$warn" \
        '{hookSpecificOutput:{hookEventName:"Stop",additionalContext:$c}}'
    else
      printf '{"hookSpecificOutput":{"hookEventName":"Stop","additionalContext":"%s"}}\n' \
        "$(json_escape "$warn")"
    fi
    return 0
  fi

  # Still within budget: record the block and hold the session open.
  mkdir -p "$sess_dir" 2>/dev/null || true
  printf '%s\n' "$((C + 1))" > "$countfile" 2>/dev/null || true

  local reason="test-guard stop-gate (block $((C + 1))/${MAX}): touched modules without DONE verdict or waiver:
${uncovered}
Finish the gate (redgreen.sh green / spotcheck-arm+fire until >=2 KILLED) or record an objective waiver: redgreen.sh waive <test-file> \"reason\". After ${MAX} blocks the gate yields with a warning."

  if command -v jq >/dev/null 2>&1; then
    jq -n --arg r "$reason" '{decision:"block",reason:$r}'
  else
    printf '{"decision":"block","reason":"%s"}\n' "$(json_escape "$reason")"
  fi
  return 0
}

# Any failure inside main must never crash or block the session (§3.5.1).
main "$@" 2>/dev/null || exit 0
exit 0
