#!/usr/bin/env bash
# Fixture verifier for hooks/stop-gate.sh (contract §5: "Hooks: pipe hand-crafted
# stdin JSON with REDGREEN_STATE_ROOT pointed at a fixture dir").
#
# Run it by hand:  bash .claude/skills/test-guard/hooks/tests/verify-stop-gate.sh
# Exit 0 = every case passed. Exit 1 = a case failed (each failure prints the
# expectation, the actual stdout, and the exit code).
#
# It builds a throwaway STATE_ROOT per case, so it never touches real session
# state, and it asserts BOTH directions on every behavioural claim: the gate must
# stop blocking where blocking is unfixable, and must still block everywhere else.
# Bash 3.2-safe (no associative arrays, no mapfile), no dependencies beyond the
# hook's own (jq optional — the hook has a no-jq fallback and so does this).

set -u

HOOK="$(cd "$(dirname "$0")/.." && pwd)/stop-gate.sh"
[ -f "$HOOK" ] || { echo "cannot find stop-gate.sh next to $0" >&2; exit 2; }
REDGREEN="$(cd "$(dirname "$0")/../../scripts" && pwd)/redgreen.sh"

PASS=0; FAIL=0
ok()   { PASS=$((PASS + 1)); printf 'ok   — %s\n' "$1"; }
bad()  { FAIL=$((FAIL + 1)); printf 'FAIL — %s\n' "$1"; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

SID="fixture-session"

# new_case <name> -> sets ROOT (fresh state root), WORK (fresh product dir), SESS
new_case() {
  CASE="$1"
  ROOT="$TMP/$2/state"; WORK="$TMP/$2/work"; SESS="$ROOT/sessions/$SID"
  mkdir -p "$SESS" "$WORK"
}

touch_path() { printf '%s\n' "$1" >> "$SESS/touched.txt"; }

# done_gate <test-path> — a state dir whose §2.4 verdict is DONE for that test file.
done_gate() {
  local d="$ROOT/gate-$RANDOM$RANDOM"
  mkdir -p "$d"
  printf '%s\n' "$1" > "$d/test.path"
  printf 'deadbeef\n' > "$d/red.hash"
  : > "$d/green.ok"
  printf 'KILLED|one\nKILLED|two\n' > "$d/kills.log"
}

# run_hook -> sets OUT (stdout) and RC (exit code)
run_hook() {
  local json
  json="{\"session_id\":\"$SID\",\"cwd\":\"$WORK\"}"
  OUT="$(printf '%s' "$json" | REDGREEN_STATE_ROOT="$ROOT" TEST_GUARD_APPS_ROOT="$WORK/" \
    bash "$HOOK" 2>/dev/null)"
  RC=$?
}

blocked()      { case "$OUT" in *'"block"'*) return 0 ;; *) return 1 ;; esac; }
mentions()     { case "$OUT" in *"$1"*) return 0 ;; *) return 1 ;; esac; }

# Every case asserts exit 0 as well: the contract forbids a non-zero exit (§3.5.1).
assert_rc0() { [ "$RC" -eq 0 ] || bad "$CASE: exit code was $RC, must always be 0"; }

echo "== stop-gate fixture verifier =="

# ---------------------------------------------------------------- A: the defect
# A module created and then DELETED within the session must not block: every exit
# redgreen.sh offers needs the file to exist, so blocking here is unescapable.
new_case "A deleted-only" a
touch_path "$WORK/security/xss-fuzz.mjs"      # never created on disk = deleted
run_hook; assert_rc0
if blocked; then bad "A: a deleted touched path still blocks the stop"
else ok "A: deleted touched path does not block"; fi
if mentions "skipped 1 touched path"; then ok "A: the skip is reported, not silent"
else bad "A: skip was silent — no 'skipped N touched path(s)' line"; fi

# ------------------------------------------------- B: no coverage was weakened
new_case "B existing-uncovered" b
mkdir -p "$WORK/src"; printf 'export const x = 1;\n' > "$WORK/src/real.mjs"
touch_path "$WORK/src/real.mjs"
run_hook; assert_rc0
if blocked; then ok "B: an existing untracked module still blocks"
else bad "B: existing untracked module no longer blocks — coverage weakened"; fi

# ------------------------------------ C: mixed session lists only the real one
new_case "C mixed" c
mkdir -p "$WORK/src"; printf 'export const x = 1;\n' > "$WORK/src/real.mjs"
touch_path "$WORK/src/real.mjs"
touch_path "$WORK/src/gone.mjs"
run_hook; assert_rc0
if blocked; then ok "C: mixed session still blocks on the surviving module"
else bad "C: mixed session did not block"; fi
if mentions "real.mjs"; then ok "C: the surviving module is named"
else bad "C: block did not name the surviving module"; fi
if mentions "gone.mjs — untracked"; then
  bad "C: deleted module is still listed as an uncovered module"
else ok "C: deleted module is not listed as uncovered"; fi
if mentions "skipped 1 touched path"; then ok "C: the skip is reported alongside the block"
else bad "C: block did not report the deleted-path skip"; fi

# ---------------------------------------------- D: covered module stays silent
new_case "D covered" d
mkdir -p "$WORK/src"; printf 'export const x = 1;\n' > "$WORK/src/covered.mjs"
touch_path "$WORK/src/covered.mjs"
done_gate "$WORK/src/covered.test.mjs"
run_hook; assert_rc0
if [ -z "$OUT" ]; then ok "D: a DONE module allows the stop with no output"
else bad "D: expected silence for a DONE module, got: $OUT"; fi

# ------------------------------------------- E: garbage / empty stdin (§5 c,d)
new_case "E garbage" e
OUT="$(printf 'not json' | REDGREEN_STATE_ROOT="$ROOT" bash "$HOOK" 2>/dev/null)"; RC=$?
assert_rc0
[ -z "$OUT" ] && ok "E: garbage stdin -> exit 0, empty stdout" \
              || bad "E: garbage stdin produced output: $OUT"
OUT="$(printf '{}' | REDGREEN_STATE_ROOT="$ROOT" bash "$HOOK" 2>/dev/null)"; RC=$?
assert_rc0
[ -z "$OUT" ] && ok "E: '{}' -> exit 0, empty stdout" \
              || bad "E: '{}' produced output: $OUT"

# ----------------------------------- F: loop-guard yield still fires, with note
new_case "F loop-guard" f
mkdir -p "$WORK/src"; printf 'export const x = 1;\n' > "$WORK/src/real.mjs"
touch_path "$WORK/src/real.mjs"
touch_path "$WORK/src/gone.mjs"
printf '2\n' > "$SESS/stop-blocks.count"
run_hook; assert_rc0
if blocked; then bad "F: budget was exhausted but the gate still blocked"
else ok "F: budget exhausted -> yields instead of blocking"; fi
if mentions "allowing stop after 2 blocks"; then ok "F: the yield warning is emitted"
else bad "F: yield warning missing: $OUT"; fi
if mentions "skipped 1 touched path"; then ok "F: yield warning carries the skip note"
else bad "F: yield warning dropped the skip note"; fi

# ------------------------- G: redgreen.sh waive records for a nonexistent path
new_case "G waive-missing" g
GONE="$WORK/src/gone.mjs"
WOUT="$(REDGREEN_STATE_ROOT="$ROOT" bash "$REDGREEN" waive "$GONE" "deleted this session" 2>&1)"
WRC=$?
if [ "$WRC" -eq 0 ]; then ok "G: waive on a deleted path succeeds"
else bad "G: waive on a deleted path exited $WRC: $WOUT"; fi
if grep -rlF "$GONE" "$ROOT" --include=test.path >/dev/null 2>&1; then
  ok "G: the waiver is recorded in state (auditable)"
else bad "G: no state dir recorded the waived path"; fi
case "$WOUT" in *"does not exist on disk"*) ok "G: output flags the absent path" ;;
                *) bad "G: output did not flag the absent path: $WOUT" ;; esac

# --------------------------------------------------------------------- summary
printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
