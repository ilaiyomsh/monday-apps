#!/usr/bin/env bash
# test-guard stateful gate. Subcommands:
#   red  <test-file>                       test MUST fail on assertions; records state (hash + failing tests)
#   green <test-file> [--amended "why"] [--allow-skipped]
#                                          test MUST pass; blocks if the file changed since red,
#                                          if zero tests ran, if tests are skipped, or if a
#                                          red-recorded test vanished from the run
#   spotcheck-arm  <src-file> <test-file>  verify green baseline, snapshot src (.mutbak)
#   spotcheck-fire <src-file> <test-file> "<mutation description>"
#                                          mutated src must FAIL the tests; restores src; verifies
#                                          restore; records KILLED/SURVIVED
#   waive  <test-file> "<objective reason>"  record a triviality waiver (visible in status)
#   status <test-file>                     gate state + definition-of-done verdict
#   reset  <test-file>                     clear recorded state
#   amend-intent <test-file> "<reason>"    arm a ONE-shot unlock of a locked test file (green
#                                          still requires --amended); consumed by testfile-lock hook
#   status-all                             aligned table of every v2-tracked test file
#   verdict <test-file>                    one word: DONE / NOT_DONE / UNTRACKED (no tests run)
#   locked                                 list abs paths of currently hash-locked test files
#
# State root (v2): $REDGREEN_STATE_ROOT overrides the default ${TMPDIR:-/tmp}/redgreen-state.
#
# Exit codes: 0 = gate passed, 1 = gate FAILED, 2 = usage/setup/anomaly error.
# Execution cwd = nearest package.json above the test file; the vitest/jest binary may be
# hoisted higher (monorepo) — resolved via `npx --no-install`, never auto-installed.
# Non-vitest/jest runners: set REDGREEN_RUNNER='npx mocha' (skips detection+preflight),
# or use the manual gate in references/mutation-protocol.md.

set -u

# State root (v2, §3.1): overridable for testability. Default is byte-identical to the
# original hard-coded scheme (${TMPDIR:-/tmp}/redgreen-state) — fully backward compatible.
# Computed once, globally, so the state-query commands (status-all/locked) can iterate it
# even though they take no <test-file> argument.
STATE_ROOT="${REDGREEN_STATE_ROOT:-${TMPDIR:-/tmp}/redgreen-state}"

usage() { echo "usage: redgreen.sh red|green|spotcheck-arm|spotcheck-fire|waive|status|reset|status-all|verdict|locked|amend-intent ... (see header)" >&2; exit 2; }
die()   { echo "$*" >&2; exit 2; }

CMD="${1:-}"; [[ -z "$CMD" ]] && usage

# Evidence of a behavioral (assertion) failure. NOT_IMPLEMENTED is the sanctioned stub marker.
ASSERTION_RE='AssertionError|NOT_IMPLEMENTED|[ :]expected .+ (to|deeply) |Expected[:.]|Received[:.]|toBe|toEqual|toStrictEqual|toMatch|toContain|toThrow|toHaveBeen'
# Failures that prove nothing about behavior. Checked only when assertion evidence is absent.
PLUMBING_RE='Cannot find module|Cannot find package|Failed to resolve import|SyntaxError|No test files found|No tests found|Unexpected token|is not defined|is not a function|is not a constructor|Cannot read propert'

abs_path() { (cd "$(dirname "$1")" && printf '%s/%s\n' "$PWD" "$(basename "$1")"); }

resolve_env() { # sets ABS_TEST PROJECT_DIR RUNNER REL_TEST STATE_DIR
  [[ -f "$TEST_FILE" ]] || die "GATE ERROR: test file not found: $TEST_FILE"
  ABS_TEST="$(abs_path "$TEST_FILE")"
  local dir runner_bin="" d found=""
  dir="$(dirname "$ABS_TEST")"; PROJECT_DIR=""
  while [[ "$dir" != "/" ]]; do
    if [[ -f "$dir/package.json" ]]; then
      [[ -z "$PROJECT_DIR" ]] && PROJECT_DIR="$dir"
      if [[ -z "$runner_bin" ]]; then
        if grep -q '"vitest' "$dir/package.json"; then runner_bin="vitest"
        elif grep -q '"jest' "$dir/package.json"; then runner_bin="jest"; fi
      fi
      [[ -n "$runner_bin" ]] && break
    fi
    dir="$(dirname "$dir")"
  done
  [[ -z "$PROJECT_DIR" ]] && die "GATE ERROR: no package.json found above $TEST_FILE"
  if [[ -n "${REDGREEN_RUNNER:-}" ]]; then
    RUNNER="$REDGREEN_RUNNER"
  else
    if [[ -z "$runner_bin" ]]; then
      echo "GATE ERROR: no vitest/jest declared in any package.json above the test file." >&2
      echo "Set REDGREEN_RUNNER='<command>' for another runner, or follow the Manual gate" >&2
      echo "section in .claude/skills/test-guard/references/mutation-protocol.md." >&2
      exit 2
    fi
    d="$PROJECT_DIR"
    while [[ "$d" != "/" ]]; do
      [[ -x "$d/node_modules/.bin/$runner_bin" ]] && { found=1; break; }
      d="$(dirname "$d")"
    done
    [[ -z "$found" ]] && die "GATE ERROR: $runner_bin declared but not installed — run the package manager install in $PROJECT_DIR first (the gate never auto-installs)."
    # verbose reporter so PASSING test names are printed too (green verifies red-recorded names)
    if [[ "$runner_bin" == "vitest" ]]; then RUNNER="npx --no-install vitest run --reporter=verbose"; else RUNNER="npx --no-install jest --verbose"; fi
  fi
  REL_TEST="${ABS_TEST#"$PROJECT_DIR"/}"
  local key; key="$(printf '%s' "$ABS_TEST" | shasum -a 256 | cut -c1-16)"
  STATE_DIR="$STATE_ROOT/$key"
}

OUT=""
cleanup() { [[ -n "$OUT" ]] && rm -f "$OUT"; }
trap cleanup EXIT

run_tests() {
  OUT="$(mktemp)"
  ( cd "$PROJECT_DIR" && NO_COLOR=1 CI=1 FORCE_COLOR=0 $RUNNER "$REL_TEST" ) >"$OUT" 2>&1
  STATUS=$?
}

# Per-test failure lines → bare test names (marker + trailing duration stripped).
# Amendment 8: the marker is stripped as an ALTERNATION of full glyphs (not a
# bracket class) and any leftover non-ASCII marker bytes are removed under
# LC_ALL=C — in a C/POSIX locale a bracket class matches single BYTES of the
# multi-byte ✗, leaving a residual byte (0x97) glued to every recorded name,
# which then never matches the green run (false "ABSENT from this run").
fail_names()   { grep -E '^[[:space:]]*(✗|×|✕|✖)' "$OUT" | LC_ALL=C sed -E 's/^[[:space:]]*(✗|×|✕|✖)?[[:space:]]*//; s/^[^ -~]+[[:space:]]*//; s/[[:space:]]*\(?[0-9]+[[:space:]]?ms\)?[[:space:]]*$//'; }
passed_count() { grep -E '^[[:space:]]*Tests[: ]' "$OUT" | grep -Eo '[0-9]+ passed' | head -n 1 | grep -Eo '[0-9]+' || echo 0; }
skipped_count(){ grep -E '^[[:space:]]*Tests[: ]' "$OUT" | grep -Eo '[0-9]+ (skipped|todo)' | awk '{s+=$1} END {print s+0}'; }
test_hash()    { shasum -a 256 "$ABS_TEST" | cut -d' ' -f1; }

# ---------------------------------------------------------------- red
cmd_red() {
  TEST_FILE="${1:-}"; [[ -z "$TEST_FILE" ]] && usage
  resolve_env; run_tests
  local fails; fails="$(fail_names)"
  if [[ $STATUS -eq 0 ]]; then
    if [[ "$(passed_count)" -eq 0 ]]; then
      echo "RED GATE ERROR: runner reported success but zero tests ran. Output tail:"; tail -n 25 "$OUT"; exit 2
    fi
    echo "RED GATE FAILED: the test PASSES before/without the implementation change."
    echo "A test that was never seen failing cannot prove the implementation works."
    echo "Fix: make the test assert the NEW behavior (it must fail right now), then re-run."
    exit 1
  fi
  if [[ -z "$fails" ]]; then
    local hit
    if hit="$(grep -E -m1 "$PLUMBING_RE" "$OUT")"; then
      echo "RED GATE FAILED: the run fails on PLUMBING before any test executes:"
      echo "  $hit"
      echo "Fix imports/setup (stub the module under test — return undefined or throw new Error('NOT_IMPLEMENTED')) until the failure is an assertion, then re-run."
      tail -n 25 "$OUT"; exit 1
    fi
    echo "RED GATE ERROR: runner produced no per-test results — did it even run? Output tail:"
    tail -n 25 "$OUT"; exit 2
  fi
  if grep -qE "$ASSERTION_RE" "$OUT"; then
    mkdir -p "$STATE_DIR"
    printf '%s\n' "$ABS_TEST" > "$STATE_DIR/test.path"   # v2 reverse index (§4.6.2) hooks depend on
    test_hash > "$STATE_DIR/red.hash"
    printf '%s\n' "$fails" > "$STATE_DIR/red-fails.txt"
    echo "RED GATE PASSED: test fails on assertions, as required. Failing tests (recorded):"
    printf '%s\n' "$fails" | head -n 15 | sed 's/^/  ✗ /'
    echo "Now implement. The test file is hash-locked: any edit to it blocks the green gate"
    echo "unless you pass --amended \"one-line reason\" (recorded)."
    exit 0
  fi
  local hit
  if hit="$(grep -E -m1 "$PLUMBING_RE" "$OUT")"; then
    echo "RED GATE FAILED: tests crash on plumbing ($hit), not on assertions."
  else
    echo "RED GATE FAILED: tests fail but not on recognizable assertions."
  fi
  echo "Make the failure behavioral: an expect(...) assertion, or a stub throwing new Error('NOT_IMPLEMENTED')."
  tail -n 25 "$OUT"; exit 1
}

# ---------------------------------------------------------------- green
cmd_green() {
  TEST_FILE="${1:-}"; [[ -z "$TEST_FILE" ]] && usage; shift
  local amended="" allow_skipped=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --amended) amended="${2:-}"; [[ -z "$amended" ]] && die "GATE ERROR: --amended requires a one-line reason"; shift 2 ;;
      --allow-skipped) allow_skipped=1; shift ;;
      *) die "GATE ERROR: unknown green flag: $1" ;;
    esac
  done
  resolve_env
  if [[ ! -f "$STATE_DIR/red.hash" ]]; then
    echo "GREEN GATE FAILED: no red recorded for this test file."
    echo "TDD: run 'redgreen.sh red' first. Retrofit/characterization: use spotcheck-arm/fire"
    echo "(a killed mutation is that flow's red). Ad-hoc test runs: call the runner directly."
    exit 1
  fi
  if [[ "$(test_hash)" != "$(cat "$STATE_DIR/red.hash")" ]]; then
    if [[ -z "$amended" ]]; then
      echo "GREEN GATE FAILED: the test file CHANGED since red was observed."
      echo "Editing the test while making it pass invalidates the red gate. Either re-run red"
      echo "(against a stub), or pass --amended \"one-line reason\" — the amendment is recorded"
      echo "and at least one spot-check mutation must then target the amended assertion."
      exit 1
    fi
    echo "⚠ GREEN GATE AMENDED: test file changed since red. Reason given: $amended"
    echo "$amended" >> "$STATE_DIR/amended.log"
    test_hash > "$STATE_DIR/red.hash"
  fi
  run_tests
  if [[ $STATUS -ne 0 ]]; then
    echo "GREEN GATE FAILED: tests still failing:"; tail -n 40 "$OUT"; exit 1
  fi
  if [[ "$(passed_count)" -eq 0 ]]; then
    echo "GREEN GATE FAILED: exit 0 but ZERO tests executed — an empty/skipped suite proves nothing."
    tail -n 15 "$OUT"; exit 1
  fi
  local sk; sk="$(skipped_count)"
  if [[ "$sk" -gt 0 && -z "$allow_skipped" ]]; then
    echo "GREEN GATE FAILED: $sk skipped/todo test(s) in the run. Unskip them, or justify with --allow-skipped."
    exit 1
  fi
  local missing=""
  while IFS= read -r name; do
    [[ -z "$name" ]] && continue
    grep -qF "$name" "$OUT" || missing="$missing  ✗ $name"$'\n'
  done < "$STATE_DIR/red-fails.txt"
  if [[ -n "$missing" && -z "$amended" ]]; then
    echo "GREEN GATE FAILED: test(s) recorded failing at red are ABSENT from this run (renamed/deleted/skipped?):"
    printf '%s' "$missing"
    echo "Restore them, or re-run red, or use --amended with the reason."
    exit 1
  fi
  printf '%s\n' "$ABS_TEST" > "$STATE_DIR/test.path"   # v2 reverse index (§4.6.2), defensive
  test_hash > "$STATE_DIR/green.ok"
  echo "GREEN GATE PASSED: $REL_TEST is green and every red-recorded test ran."
  echo "Next (mandatory unless objectively trivial — see Iron rule 2): mutation spot-check via"
  echo "spotcheck-arm/spotcheck-fire. 'redgreen.sh status $TEST_FILE' shows what's left for done."
  exit 0
}

# ---------------------------------------------------------------- spotcheck
cmd_arm() {
  SRC_FILE="${1:-}"; TEST_FILE="${2:-}"; [[ -z "$SRC_FILE" || -z "$TEST_FILE" ]] && usage
  [[ -f "$SRC_FILE" ]] || die "GATE ERROR: source file not found: $SRC_FILE"
  resolve_env
  local abs_src; abs_src="$(abs_path "$SRC_FILE")"
  run_tests
  [[ $STATUS -ne 0 ]] && { echo "SPOTCHECK ERROR: baseline not green — fix the suite before arming."; tail -n 20 "$OUT"; exit 2; }
  cp "$abs_src" "$abs_src.mutbak"
  mkdir -p "$STATE_DIR"; printf '%s\n' "$abs_src" > "$STATE_DIR/armed.src"
  printf '%s\n' "$ABS_TEST" > "$STATE_DIR/test.path"   # v2 reverse index (§4.6.2)
  echo "ARMED. Apply exactly ONE semantic mutation to $SRC_FILE with Edit (kinds + selection"
  echo "discipline: references/mutation-protocol.md), then run:"
  echo "  redgreen.sh spotcheck-fire $SRC_FILE $TEST_FILE '<mutation description>'"
  exit 0
}

cmd_fire() {
  SRC_FILE="${1:-}"; TEST_FILE="${2:-}"; DESC="${3:-}"
  [[ -z "$SRC_FILE" || -z "$TEST_FILE" || -z "$DESC" ]] && usage
  resolve_env
  local abs_src; abs_src="$(abs_path "$SRC_FILE")"
  [[ -f "$abs_src.mutbak" ]] || die "SPOTCHECK ERROR: not armed for $SRC_FILE — run spotcheck-arm first."
  if cmp -s "$abs_src" "$abs_src.mutbak"; then
    die "SPOTCHECK ERROR: source is UNCHANGED — no mutation applied. Edit $SRC_FILE, then fire again."
  fi
  run_tests; local mut_status=$STATUS mut_fails; mut_fails="$(fail_names)"
  mv "$abs_src.mutbak" "$abs_src"                      # restore ALWAYS
  local mut_out="$OUT"; OUT=""                          # keep mutated-run output
  run_tests                                             # verify restore
  if [[ $STATUS -ne 0 ]]; then rm -f "$mut_out"; die "SPOTCHECK ERROR: suite NOT green after restore — the tree may be dirty, investigate NOW."; fi
  if [[ $mut_status -eq 0 ]]; then
    printf 'SURVIVED|%s\n' "$DESC" >> "$STATE_DIR/kills.log"
    echo "MUTATION SURVIVED: '$DESC' — the tests cannot see this bug."
    echo "Strengthen the assertion/fixture (classify via references/gap-patterns.md), then"
    echo "re-arm and re-apply the SAME mutation until it is killed."
    rm -f "$mut_out"; exit 1
  fi
  if [[ -z "$mut_fails" ]]; then
    printf 'INVALID|%s\n' "$DESC" >> "$STATE_DIR/kills.log"
    echo "SPOTCHECK INVALID: mutated run failed with NO per-test failures (syntax/plumbing"
    echo "break, not a semantic bug) — not counted. Re-arm with a semantic mutation."
    tail -n 15 "$mut_out"; rm -f "$mut_out"; exit 1
  fi
  printf 'KILLED|%s\n' "$DESC" >> "$STATE_DIR/kills.log"
  # Append-only record of every SOURCE this gate has killed a mutation in (contract
  # amendment 11). `armed.src` holds only the LAST arm, so one test file gating several
  # modules lost the mapping for the earlier ones and the stop gate called them
  # "untracked" despite their kills sitting in this very dir (known gap 9, hit three
  # times). Written on KILL, not on arm: an armed-but-never-fired source proves nothing.
  if ! grep -qxF "$abs_src" "$STATE_DIR/gated-srcs.txt" 2>/dev/null; then
    printf '%s\n' "$abs_src" >> "$STATE_DIR/gated-srcs.txt"
  fi
  echo "MUTATION KILLED by:"; printf '%s\n' "$mut_fails" | head -n 5 | sed 's/^/  ✗ /'
  echo "Restore verified green. Recorded: KILLED — $DESC"
  rm -f "$mut_out"; exit 0
}

# ---------------------------------------------------------------- waive / status / reset
cmd_waive() {
  TEST_FILE="${1:-}"; REASON="${2:-}"; [[ -z "$TEST_FILE" || -z "$REASON" ]] && usage
  resolve_env; mkdir -p "$STATE_DIR"
  printf '%s\n' "$ABS_TEST" > "$STATE_DIR/test.path"   # v2 reverse index (§4.6.2)
  printf '%s\n' "$REASON" >> "$STATE_DIR/waiver.txt"
  echo "WAIVER RECORDED (must satisfy Iron rule 2's objective criteria — no conditionals, no"
  echo "arithmetic, no key mapping): $REASON"
}

cmd_status() {
  TEST_FILE="${1:-}"; [[ -z "$TEST_FILE" ]] && usage
  resolve_env
  local red="no" green="no" killed=0 survived=0 invalid=0 waiver="no" amended="no"
  [[ -f "$STATE_DIR/red.hash" ]] && { red="yes"; [[ "$(test_hash)" != "$(cat "$STATE_DIR/red.hash")" ]] && red="yes (file changed SINCE — stale)"; }
  [[ -f "$STATE_DIR/green.ok" ]] && green="yes"
  [[ -f "$STATE_DIR/amended.log" ]] && amended="yes: $(tr '\n' ';' < "$STATE_DIR/amended.log")"
  [[ -f "$STATE_DIR/waiver.txt" ]] && waiver="yes: $(tr '\n' ';' < "$STATE_DIR/waiver.txt")"
  if [[ -f "$STATE_DIR/kills.log" ]]; then
    killed=$(grep -c '^KILLED|' "$STATE_DIR/kills.log" || true)
    survived=$(grep -c '^SURVIVED|' "$STATE_DIR/kills.log" || true)
    invalid=$(grep -c '^INVALID|' "$STATE_DIR/kills.log" || true)
  fi
  echo "test-guard status for $REL_TEST"
  echo "  red observed:   $red"
  echo "  green gate:     $green"
  echo "  amended:        $amended"
  echo "  spot-check:     $killed killed / $survived survived / $invalid invalid"
  [[ -f "$STATE_DIR/kills.log" ]] && sed 's/^/    /' "$STATE_DIR/kills.log"
  echo "  waiver:         $waiver"
  # v2 additive line (§4.6.7): one-shot amend-intent pending flag.
  if [[ -f "$STATE_DIR/amend-intent.txt" ]]; then
    echo "  amend-intent:   pending: $(cat "$STATE_DIR/amend-intent.txt")"
  else
    echo "  amend-intent:   none"
  fi
  if [[ "$survived" -gt 0 ]]; then
    echo "VERDICT: NOT DONE — unresolved survivor(s): strengthen the test and kill them."
  elif [[ "$red" == "yes" && "$green" == "yes" && ( "$killed" -ge 2 || "$waiver" != "no" ) ]]; then
    echo "VERDICT: DONE (TDD path)."
  elif [[ "$red" == "no" && "$killed" -ge 2 ]]; then
    echo "VERDICT: DONE (retrofit path — killed mutations are the red; ensure the suite is green)."
  else
    echo "VERDICT: NOT DONE — need: red+green with ≥2 killed mutations (TDD), or ≥2 killed (retrofit), or a waiver."
  fi
}

cmd_reset() {
  TEST_FILE="${1:-}"; [[ -z "$TEST_FILE" ]] && usage
  resolve_env; rm -rf "$STATE_DIR"; echo "State cleared for $REL_TEST"
}

# ---------------------------------------------------------------- v2 extensions (§4.6)

# State-only resolution: sets ABS_TEST + STATE_DIR from a test-file path with NO runner
# detection and NO installed-binary preflight (mirrors survivors.sh's resolve_state_dir).
# Used by the cheap, test-runner-independent helpers (verdict, amend-intent) so they work
# in a fresh clone whose node_modules is absent — the whole point of those commands.
# A nonexistent file is normalized textually (against $PWD) so a caller that treats
# "no state dir" as UNTRACKED still gets a stable key; such files never have a state dir.
resolve_state_only() {
  local test_file="$1"
  if [[ -f "$test_file" ]]; then
    ABS_TEST="$(abs_path "$test_file")"        # physical path — matches red/green's key
  else
    case "$test_file" in
      /*) ABS_TEST="$test_file" ;;
      *)  ABS_TEST="$PWD/$test_file" ;;         # textual absolutize; no physical cd
    esac
  fi
  local key; key="$(printf '%s' "$ABS_TEST" | shasum -a 256 | cut -c1-16)"
  STATE_DIR="$STATE_ROOT/$key"
}

# Definition-of-done verdict for a state dir, computed WITHOUT running tests (mirrors the
# cmd_status rule / §2.4). Echoes "DONE" or "NOT-DONE". Pure file-existence + kills.log counts.
verdict_for_dir() {
  local d="$1" red=0 green=0 killed=0 survived=0 waiver=0
  [[ -f "$d/red.hash" ]]   && red=1
  [[ -f "$d/green.ok" ]]   && green=1
  [[ -f "$d/waiver.txt" ]] && waiver=1
  if [[ -f "$d/kills.log" ]]; then
    # grep -c prints "0" and exits 1 on no match; || true keeps the "0" and swallows the code.
    killed=$(grep -c '^KILLED|' "$d/kills.log" || true)
    survived=$(grep -c '^SURVIVED|' "$d/kills.log" || true)
  fi
  if [[ "$survived" -gt 0 ]]; then
    echo "NOT-DONE"                                                    # unresolved survivor(s)
  elif [[ "$red" -eq 1 && "$green" -eq 1 && ( "$killed" -ge 2 || "$waiver" -eq 1 ) ]]; then
    echo "DONE"                                                         # TDD path
  elif [[ "$red" -eq 0 && "$killed" -ge 2 ]]; then
    echo "DONE"                                                         # retrofit path
  else
    echo "NOT-DONE"
  fi
}

# amend-intent <test-file> "<reason>" — arm a one-shot unlock for the (locked) test file.
cmd_amend_intent() {
  TEST_FILE="${1:-}"; REASON="${2:-}"
  [[ -z "$TEST_FILE" ]] && usage
  [[ -z "$REASON" ]] && die "GATE ERROR: amend-intent requires a one-line reason"
  # State-only resolution (no runner detection/preflight): amend-intent is the sanctioned
  # escape hatch the testfile-lock deny message points at (§3.5 invariant 4), so it must
  # stay available even when node_modules was wiped (fresh clone). It only reads/writes
  # state — a runner preflight would be pure downside. A locked test file always exists.
  [[ -f "$TEST_FILE" ]] || die "GATE ERROR: test file not found: $TEST_FILE"
  resolve_state_only "$TEST_FILE"
  # LOCK predicate (§2.3): red.hash exists AND green.ok does NOT.
  if [[ ! -f "$STATE_DIR/red.hash" || -f "$STATE_DIR/green.ok" ]]; then
    echo "NO LOCK: $TEST_FILE is not hash-locked; amend-intent is unnecessary"
    exit 0
  fi
  # Overwrite (not append): the intent is one-shot. testfile-lock.sh consumes it via mv.
  printf '%s %s\n' "$(date +%Y-%m-%dT%H:%M:%S)" "$REASON" > "$STATE_DIR/amend-intent.txt"
  echo "AMEND-INTENT RECORDED: exactly ONE Write/Edit/Bash touch of $ABS_TEST will be allowed."
  echo "The green gate will STILL require --amended \"$REASON\" (the amendment is recorded)."
  exit 0
}

# verdict <test-file> — one word: DONE / NOT_DONE / UNTRACKED. Never runs tests. Always exit 0.
cmd_verdict() {
  TEST_FILE="${1:-}"; [[ -z "$TEST_FILE" ]] && usage
  # State-only resolution (§4.6.5): a cheap helper for hooks/scripts — never runs tests
  # and never touches runner detection, so it works with node_modules absent. A nonexistent
  # test file has no state dir, which is exactly the UNTRACKED case below (never a GATE ERROR).
  resolve_state_only "$TEST_FILE"
  # UNTRACKED = no state dir, or a dir with neither a red gate nor any kill history.
  if [[ ! -d "$STATE_DIR" ]] || { [[ ! -f "$STATE_DIR/red.hash" ]] && [[ ! -f "$STATE_DIR/kills.log" ]]; }; then
    echo "UNTRACKED"; exit 0
  fi
  local v; v="$(verdict_for_dir "$STATE_DIR")"
  [[ "$v" == "DONE" ]] && echo "DONE" || echo "NOT_DONE"
  exit 0
}

# locked — abs path of every currently locked test file (red recorded, green not yet passed).
cmd_locked() {
  [[ -d "$STATE_ROOT" ]] || exit 0
  local d
  for d in "$STATE_ROOT"/*/; do
    [[ -d "$d" ]] || continue
    [[ -f "$d/test.path" ]] || continue
    if [[ -f "$d/red.hash" && ! -f "$d/green.ok" ]]; then
      head -n1 "$d/test.path"
    fi
  done
  exit 0
}

# status-all — aligned table across every v2-tracked test file (dirs carrying test.path).
cmd_status_all() {
  local d any=""
  if [[ -d "$STATE_ROOT" ]]; then
    for d in "$STATE_ROOT"/*/; do
      [[ -d "$d" && -f "$d/test.path" ]] && { any=1; break; }
    done
  fi
  if [[ -z "$any" ]]; then echo "no tracked test files"; exit 0; fi
  # Pre-pass: compute the widest TEST-FILE cell so the column always aligns. Real paths
  # under this repo far exceed any fixed pad (a hard-coded %-50s never lines up), so the
  # width is derived from the data. Floor at the header's own width ("TEST-FILE" = 9).
  local pw=9 tp
  for d in "$STATE_ROOT"/*/; do
    [[ -d "$d" && -f "$d/test.path" ]] || continue
    tp="$(head -n1 "$d/test.path")"
    [[ -f "$tp" ]] || tp="$tp (missing)"
    [[ ${#tp} -gt $pw ]] && pw=${#tp}
  done
  # %-*s takes the field width from a preceding integer argument (portable to bash 3.2).
  printf '%-*s %-4s %-6s %-7s %-6s %-7s %-9s %-7s %s\n' \
    "$pw" "TEST-FILE" "RED" "GREEN" "LOCKED" "ARMED" "KILLED" "SURVIVED" "WAIVER" "VERDICT"
  local warn_armed=""
  for d in "$STATE_ROOT"/*/; do
    [[ -d "$d" && -f "$d/test.path" ]] || continue
    local red green locked armed killed survived waiver verdict
    tp="$(head -n1 "$d/test.path")"
    [[ -f "$tp" ]] || tp="$tp (missing)"
    red="no";    [[ -f "$d/red.hash" ]] && red="yes"
    green="no";  [[ -f "$d/green.ok" ]] && green="yes"
    locked="no"; [[ -f "$d/red.hash" && ! -f "$d/green.ok" ]] && locked="yes"
    # Live-armed means the mutation may still be APPLIED: armed.src alone is stale
    # metadata of the last arm (fire's restoring mv removes only the .mutbak).
    armed="no"
    if [[ -f "$d/armed.src" ]]; then
      local armed_src; armed_src="$(head -n1 "$d/armed.src")"
      if [[ -f "$armed_src.mutbak" ]]; then
        armed="yes"
        warn_armed="${warn_armed}  $armed_src"$'\n'
      fi
    fi
    killed=0; survived=0
    if [[ -f "$d/kills.log" ]]; then
      killed=$(grep -c '^KILLED|' "$d/kills.log" || true)
      survived=$(grep -c '^SURVIVED|' "$d/kills.log" || true)
    fi
    waiver="no"; [[ -f "$d/waiver.txt" ]] && waiver="yes"
    verdict="$(verdict_for_dir "$d")"
    printf '%-*s %-4s %-6s %-7s %-6s %-7s %-9s %-7s %s\n' \
      "$pw" "$tp" "$red" "$green" "$locked" "$armed" "$killed" "$survived" "$waiver" "$verdict"
  done
  if [[ -n "$warn_armed" ]]; then
    printf 'WARNING: armed spot-check(s) — a mutation may still be APPLIED to:\n%s' "$warn_armed"
    printf '  Run spotcheck-fire to resolve, or restore the .mutbak sibling.\n'
  fi
  exit 0
}

case "$CMD" in
  red)            shift; cmd_red "$@" ;;
  green)          shift; cmd_green "$@" ;;
  spotcheck-arm)  shift; cmd_arm "$@" ;;
  spotcheck-fire) shift; cmd_fire "$@" ;;
  waive)          shift; cmd_waive "$@" ;;
  status)         shift; cmd_status "$@" ;;
  reset)          shift; cmd_reset "$@" ;;
  amend-intent)   shift; cmd_amend_intent "$@" ;;
  status-all)     shift; cmd_status_all ;;
  verdict)        shift; cmd_verdict "$@" ;;
  locked)         shift; cmd_locked ;;
  *) usage ;;
esac
