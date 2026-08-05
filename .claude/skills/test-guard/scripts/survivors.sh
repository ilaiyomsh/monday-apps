#!/usr/bin/env bash
# test-guard survivors ledger — records, lists, and reports OPEN mutation survivors
# for a test file, and resolves them once a strengthened assertion kills them.
# Not a hook: may run for seconds, may be verbose. Companion to redgreen.sh (shares
# the same STATE_DIR resolution — see resolve_state_dir()).
#
# Subcommands:
#   record <test-file> --src <src-file> --line <N> --hypothesis "<text>"
#          [--desc "<one-line>"] [--diff-file <path>] [--log-kills]
#          Reads the mutation diff from stdin (unless --diff-file is given) and
#          writes the next survivors/NNN record with status OPEN.
#          --desc defaults to --hypothesis; it is what would appear in kills.log.
#          Pass --log-kills to also append 'SURVIVED|<desc>' to kills.log — do NOT
#          pass it if spotcheck-fire (redgreen.sh) already logged this survival,
#          or the count will be doubled.
#   list   <test-file>          one line per record: NNN  STATUS  file:line  hypothesis
#   report <test-file>          strengthen-brief: every OPEN record's diff + hypothesis
#                                + next step, then the iteration count (and the >=4 warning)
#   iterate <test-file>         increments strengthen.iter, prints the new value
#                                (and the >=4 warning) — call once per strengthen round
#   resolve <test-file> <NNN>   marks record NNN KILLED; rewrites the first still-open
#                                'SURVIVED|<desc>' line in kills.log to 'SURVIVED-RESOLVED|<desc>'
#                                so redgreen.sh's DONE verdict (which counts '^SURVIVED|' lines)
#                                can stop seeing it as an unresolved survivor.
#
# Exit codes: 0 = ok, 2 = usage/setup/anomaly.
# Honors REDGREEN_STATE_ROOT (same override as redgreen.sh); default state root is
# ${TMPDIR:-/tmp}/redgreen-state — computed the same way to avoid the macOS $TMPDIR trap.

set -u

usage() { echo "usage: survivors.sh record|list|report|iterate|resolve <test-file> ... (see header)" >&2; exit 2; }
die()   { echo "$*" >&2; exit 2; }

CMD="${1:-}"; [[ -z "$CMD" ]] && usage
shift

# Physical absolute path (dir-relative cd, matches redgreen.sh's abs_path exactly —
# same recipe is required so both scripts land on the same STATE_DIR key).
abs_path() { (cd "$(dirname "$1")" && printf '%s/%s\n' "$PWD" "$(basename "$1")"); }

# Sets ABS_TEST and STATE_DIR from a test-file path. Requires the file to exist,
# same as redgreen.sh's resolve_env (a tracked test file is always a real file).
resolve_state_dir() {
  local test_file="$1" state_root key
  [[ -f "$test_file" ]] || die "SURVIVORS ERROR: test file not found: $test_file"
  ABS_TEST="$(abs_path "$test_file")"
  key="$(printf '%s' "$ABS_TEST" | shasum -a 256 | cut -c1-16)"
  state_root="${REDGREEN_STATE_ROOT:-${TMPDIR:-/tmp}/redgreen-state}"
  STATE_DIR="$state_root/$key"
}

# Next zero-padded 3-digit sequence number in a survivors/ dir (creates the dir).
next_seq() {
  local dir="$1" max=0 n f
  mkdir -p "$dir"
  for f in "$dir"/*; do
    [[ -e "$f" ]] || continue
    n="$(basename "$f")"
    [[ "$n" =~ ^[0-9][0-9][0-9]$ ]] || continue
    n=$((10#$n))
    [[ "$n" -gt "$max" ]] && max=$n
  done
  printf '%03d' $((max + 1))
}

# Pull one 'key: value' header line's value out of a survivor record file.
rec_field() { sed -n "s/^$2: //p" "$1" | head -n1; }

# ---------------------------------------------------------------- record
cmd_record() {
  local test_file="${1:-}"; [[ -z "$test_file" ]] && usage; shift
  local src="" line="" hypothesis="" desc="" diff_file="" log_kills=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      # Validate a value is present BEFORE shifting: with $#==1, `shift 2` does not
      # shift and (without set -e) the loop would re-process the same flag forever.
      --src)        [[ $# -ge 2 ]] || die "SURVIVORS ERROR: $1 requires a value"; src="$2"; shift 2 ;;
      --line)       [[ $# -ge 2 ]] || die "SURVIVORS ERROR: $1 requires a value"; line="$2"; shift 2 ;;
      --hypothesis) [[ $# -ge 2 ]] || die "SURVIVORS ERROR: $1 requires a value"; hypothesis="$2"; shift 2 ;;
      --desc)       [[ $# -ge 2 ]] || die "SURVIVORS ERROR: $1 requires a value"; desc="$2"; shift 2 ;;
      --diff-file)  [[ $# -ge 2 ]] || die "SURVIVORS ERROR: $1 requires a value"; diff_file="$2"; shift 2 ;;
      --log-kills)  log_kills=1; shift ;;
      *) die "SURVIVORS ERROR: unknown record flag: $1" ;;
    esac
  done
  [[ -z "$src" ]]        && die "SURVIVORS ERROR: --src <src-file> is required"
  [[ -z "$line" ]]       && die "SURVIVORS ERROR: --line <N> is required"
  [[ "$line" =~ ^[0-9]+$ ]] || die "SURVIVORS ERROR: --line must be a positive integer, got: $line"
  [[ -z "$hypothesis" ]] && die "SURVIVORS ERROR: --hypothesis \"<missing assertion hypothesis>\" is required"

  resolve_state_dir "$test_file"

  local diff_content
  if [[ -n "$diff_file" ]]; then
    [[ -f "$diff_file" ]] || die "SURVIVORS ERROR: --diff-file not found: $diff_file"
    diff_content="$(cat "$diff_file")"
  else
    diff_content="$(cat)"   # mutation diff piped on stdin
  fi
  [[ -z "$diff_content" ]] && die "SURVIVORS ERROR: empty mutation diff (pipe it on stdin, or pass --diff-file)"

  local logdesc="${desc:-$hypothesis}"
  mkdir -p "$STATE_DIR/survivors"
  local seq; seq="$(next_seq "$STATE_DIR/survivors")"
  local rec="$STATE_DIR/survivors/$seq"
  {
    printf 'file: %s\n' "$src"
    printf 'line: %s\n' "$line"
    printf 'status: OPEN\n'
    printf 'created: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'hypothesis: %s\n' "$hypothesis"
    # 'desc' is not one of the contract's enumerated display keys, but resolve needs
    # the EXACT string that was (or would be) logged to kills.log to find its line
    # again later — store it so resolve doesn't have to guess desc-vs-hypothesis.
    printf 'desc: %s\n' "$logdesc"
    printf '\n'
    printf '%s\n' "$diff_content"
  } > "$rec"

  if [[ -n "$log_kills" ]]; then
    printf 'SURVIVED|%s\n' "$logdesc" >> "$STATE_DIR/kills.log"
  fi

  echo "SURVIVOR RECORDED: $seq  $src:$line"
  echo "  hypothesis: $hypothesis"
  # Amendment 12 (record side) — the same trap, caught one step earlier. A survivor
  # that came from spotcheck-fire is ALREADY in kills.log under the fire's wording,
  # and only a --desc that matches it can be closed later. Say so here, while the
  # agent still has the wording in front of them, instead of at resolve time.
  if [[ -z "$desc" && -f "$STATE_DIR/kills.log" ]] && grep -q '^SURVIVED|' "$STATE_DIR/kills.log"; then
    echo "  NOTE: no --desc given, so resolve will look for 'SURVIVED|<hypothesis>'." >&2
    echo "  kills.log has unresolved line(s) that will NOT be closed by it:" >&2
    grep '^SURVIVED|' "$STATE_DIR/kills.log" | sed 's/^SURVIVED|/    - /' >&2
    echo "  If this record is one of them, re-record with --desc \"<that exact line>\"." >&2
  fi
  [[ -n "$log_kills" ]] && echo "  logged to kills.log as SURVIVED|$logdesc"
  exit 0
}

# ---------------------------------------------------------------- list
cmd_list() {
  local test_file="${1:-}"; [[ -z "$test_file" ]] && usage
  resolve_state_dir "$test_file"
  local dir="$STATE_DIR/survivors" f seq status file line hypothesis any=""
  if [[ -d "$dir" ]]; then
    for f in "$dir"/*; do
      [[ -e "$f" ]] || continue
      any=1
      seq="$(basename "$f")"
      status="$(rec_field "$f" status)"
      file="$(rec_field "$f" file)"
      line="$(rec_field "$f" line)"
      hypothesis="$(rec_field "$f" hypothesis)"
      printf '%s  %-6s  %s:%s  %s\n' "$seq" "$status" "$file" "$line" "$hypothesis"
    done
  fi
  [[ -z "$any" ]] && echo "no survivor records for $ABS_TEST"
  exit 0
}

# ---------------------------------------------------------------- report
cmd_report() {
  local test_file="${1:-}"; [[ -z "$test_file" ]] && usage
  resolve_state_dir "$test_file"
  local dir="$STATE_DIR/survivors" iter=0 f seq file line hypothesis status any_open=""
  [[ -f "$STATE_DIR/strengthen.iter" ]] && iter="$(cat "$STATE_DIR/strengthen.iter")"

  if [[ -d "$dir" ]]; then
    for f in "$dir"/*; do
      [[ -e "$f" ]] || continue
      status="$(rec_field "$f" status)"
      [[ "$status" == "OPEN" ]] || continue
      any_open=1
      seq="$(basename "$f")"
      file="$(rec_field "$f" file)"
      line="$(rec_field "$f" line)"
      hypothesis="$(rec_field "$f" hypothesis)"
      echo "=== SURVIVOR $seq: $file:$line ==="
      echo "mutation diff:"
      # body = everything after the first blank line (header/body separator)
      sed -n '/^$/,$p' "$f" | tail -n +2 | sed 's/^/  /'
      echo "hypothesis: $hypothesis"
      echo "next step: add/strengthen an assertion that fails under this diff, then re-arm and re-fire the SAME mutation."
      echo
    done
  fi
  [[ -z "$any_open" ]] && echo "no OPEN survivors for $ABS_TEST"
  echo "strengthen iterations so far: $iter"
  if [[ "$iter" -ge 4 ]]; then
    echo "WARNING: 4+ strengthen iterations on this module — research shows convergence by ~4; the remaining survivors likely indicate an equivalent mutant or a design problem (untestable seam). Consider redesign or an explicit waiver instead of iteration 5."
  fi
  exit 0
}

# ---------------------------------------------------------------- iterate
cmd_iterate() {
  local test_file="${1:-}"; [[ -z "$test_file" ]] && usage
  resolve_state_dir "$test_file"
  mkdir -p "$STATE_DIR"
  local iter=0
  [[ -f "$STATE_DIR/strengthen.iter" ]] && iter="$(cat "$STATE_DIR/strengthen.iter")"
  iter=$((iter + 1))
  printf '%s\n' "$iter" > "$STATE_DIR/strengthen.iter"
  echo "strengthen iteration: $iter"
  if [[ "$iter" -ge 4 ]]; then
    echo "WARNING: 4+ strengthen iterations on this module — research shows convergence by ~4; the remaining survivors likely indicate an equivalent mutant or a design problem (untestable seam). Consider redesign or an explicit waiver instead of iteration 5."
  fi
  exit 0
}

# ---------------------------------------------------------------- resolve
cmd_resolve() {
  local test_file="${1:-}" seq="${2:-}"; [[ -z "$test_file" || -z "$seq" ]] && usage
  resolve_state_dir "$test_file"
  local rec="$STATE_DIR/survivors/$seq"
  [[ -f "$rec" ]] || die "SURVIVORS ERROR: no survivor record $seq for $ABS_TEST"

  local status; status="$(rec_field "$rec" status)"
  if [[ "$status" == "KILLED" ]]; then
    # Idempotent: an already-KILLED record must NOT touch kills.log again. Re-running the
    # fixup here could rewrite the NEXT still-open 'SURVIVED|<desc>' line (realistic when
    # the SAME mutation was re-fired and logged twice), silently neutralizing a survivor no
    # strengthened assertion ever killed and flipping the §2.4 verdict to DONE. Skip it.
    echo "SURVIVOR $seq already marked KILLED — no change."
    exit 0
  fi

  local tmp; tmp="$(mktemp)"
  sed 's/^status: .*/status: KILLED/' "$rec" > "$tmp" && mv "$tmp" "$rec"
  echo "SURVIVOR $seq marked KILLED."

  # Best-effort kills.log fixup: rewrite the FIRST still-unresolved 'SURVIVED|<desc>'
  # line matching this record's desc to 'SURVIVED-RESOLVED|<desc>' — this is what lets
  # redgreen.sh's DONE verdict (grep -c '^SURVIVED|') stop seeing it as unresolved.
  # No-op (with a note) if this record was never logged via --log-kills. Runs exactly once,
  # on the OPEN→KILLED transition above, so each resolve rewrites at most one SURVIVED line.
  local desc; desc="$(rec_field "$rec" desc)"
  if [[ -f "$STATE_DIR/kills.log" && -n "$desc" ]]; then
    local tmp2 done_rewrite="" logline
    tmp2="$(mktemp)"
    while IFS= read -r logline || [[ -n "$logline" ]]; do
      if [[ -z "$done_rewrite" && "$logline" == "SURVIVED|$desc" ]]; then
        printf 'SURVIVED-RESOLVED|%s\n' "$desc" >> "$tmp2"
        done_rewrite=1
      else
        printf '%s\n' "$logline" >> "$tmp2"
      fi
    done < "$STATE_DIR/kills.log"
    mv "$tmp2" "$STATE_DIR/kills.log"
    if [[ -n "$done_rewrite" ]]; then
      echo "kills.log: rewrote matching SURVIVED line to SURVIVED-RESOLVED."
    else
      # Amendment 12 — this branch used to print one reassuring line and exit 0.
      # That is correct ONLY when the survivor was never logged; when it came from
      # spotcheck-fire (the common path) kills.log holds the line under the FIRE's
      # description, the record's desc defaults to the hypothesis, no line matches,
      # and the verdict silently stays NOT DONE with the reason buried in a message
      # that reads like an all-clear. Now it names the open lines and the exact way
      # to close them, and FAILS — a resolve that resolved nothing is not a success.
      # `grep -q`, not `grep -c`: with no match `-c` prints 0 AND exits 1, so the
      # obvious `$(grep -c … || echo 0)` yields the two-line string "0\n0" and the
      # arithmetic test then dies with a syntax error (caught by the fixture below).
      if grep -q '^SURVIVED|' "$STATE_DIR/kills.log" 2>/dev/null; then
        echo "SURVIVORS ERROR: record $seq is KILLED, but no kills.log line matched its desc:" >&2
        echo "  desc: $desc" >&2
        echo "The spot-check verdict reads kills.log, so it still counts these as unresolved:" >&2
        grep '^SURVIVED|' "$STATE_DIR/kills.log" | sed 's/^SURVIVED|/  - /' >&2
        echo "Re-record with the EXACT description spotcheck-fire logged, then resolve that record:" >&2
        echo "  survivors.sh record <test> --src <src> --line <N> --hypothesis \"...\" --desc \"<line above>\"" >&2
        exit 1
      fi
      echo "kills.log: nothing to close — this record was never logged with --log-kills."
    fi
  fi
  exit 0
}

case "$CMD" in
  record)  cmd_record "$@" ;;
  list)    cmd_list "$@" ;;
  report)  cmd_report "$@" ;;
  iterate) cmd_iterate "$@" ;;
  resolve) cmd_resolve "$@" ;;
  *) usage ;;
esac
