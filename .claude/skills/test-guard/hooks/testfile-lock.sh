#!/usr/bin/env bash
# test-guard v2 — PreToolUse hook: the "crown jewel" test-file lock.
#
# Registered on two matchers (see .claude/settings.json), both pointing here:
#   Write|Edit|MultiEdit  -> block edits to a hash-locked test file
#   Bash                  -> block destructive shell ops on a hash-locked test file
#
# A test file is LOCKED  <=>  its state dir has red.hash AND does NOT have green.ok
# (contract §2.3). Editing a test between red and green invalidates the red gate, so
# we deny it — unless the agent first declared `redgreen.sh amend-intent`, which drops
# a one-shot token this hook consumes.
#
# HOOK SAFETY INVARIANTS (contract §3.5): never crash the session, never exit non-zero,
# never run tests / touch the network. Blocking is ALWAYS "exit 0 + deny JSON" (exit 1
# does NOT block in Claude Code — footgun). Any anomaly -> exit 0 silently.

set -u

# --- state root: byte-identical default to redgreen.sh; override for tests (§3.1) -----
STATE_ROOT="${REDGREEN_STATE_ROOT:-${TMPDIR:-/tmp}/redgreen-state}"

# --- absolute path to the sibling redgreen.sh, for the escape-hatch message -----------
REDGREEN="$(cd "$(dirname "$0")/../scripts" 2>/dev/null && pwd)/redgreen.sh"
[ -f "$REDGREEN" ] || REDGREEN="redgreen.sh"   # fall back to bare name if walk failed

# Destructive-verb regex (contract §4.1 Bash branch). The char class includes the
# shell metacharacters that can begin a command: ; & | whitespace ( " ' `.
# Written in double quotes so we can embed the single quote literally and escape " and `.
# NOTE on the redirect arm: it must NOT match fd redirects like 2>&1 (shakedown-era
# false positive — it blocked the sanctioned `redgreen.sh green ... 2>&1 | tail`).
# After optional spaces the target must start with a non-&, non-> character, i.e. a
# real path token.
DESTRUCTIVE_RE="(^|[;&|[:space:](\"'\`])(rm|mv|truncate)[[:space:]]|(^|[;&|[:space:]])cp[[:space:]].*[[:space:]]|git[[:space:]]+(checkout|restore)([[:space:]]|\$)|(>|>>)[[:space:]]*[^&>[:space:]]"

CONSUMED_REASON=""   # set by try_consume_intent on success

# --- JSON string escaping for our emitted reason strings (contract §3.3) --------------
json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"       # backslash first
  s="${s//\"/\\\"}"       # then double quotes
  s="${s//$'\n'/\\n}"     # then newlines
  printf '%s' "$s"
}

emit_deny() {   # $1 = plain-text reason
  local r; r="$(json_escape "$1")"
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$r"
}

emit_allow() {  # $1 = plain-text reason
  local r; r="$(json_escape "$1")"
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"%s"}}\n' "$r"
}

# --- normalize a Write/Edit target to a physical abs path (contract §4.1 step 2) ------
# Locked files always exist (red was recorded on them), so the physical recipe matches
# the stored test.path. Nonexistent Write targets fall back to a textual cwd-join.
normalize_path() {
  local f="$1" cwd="$2" out
  case "$f" in
    /*) : ;;                                  # already absolute
    *)  [ -n "$cwd" ] && f="$cwd/$f" ;;       # join relative against stdin cwd
  esac
  if [ -e "$f" ]; then
    out="$(cd "$(dirname "$f")" 2>/dev/null && printf '%s/%s' "$PWD" "$(basename "$f")")"
    [ -n "$out" ] && { printf '%s' "$out"; return; }
  fi
  printf '%s' "$f"
}

# --- one-shot amend-intent consumption (contract §4.1 step 4) -------------------------
# mv is the atomic gate: under a race exactly one caller's mv succeeds, so exactly one
# edit is allowed. On success sets CONSUMED_REASON and returns 0; otherwise returns 1.
try_consume_intent() {
  local d="$1" reason target
  [ -f "$d/amend-intent.txt" ] || return 1
  reason="$(cat "$d/amend-intent.txt" 2>/dev/null)"
  target="$d/amend-consumed.log.$(date +%s)"
  if mv "$d/amend-intent.txt" "$target" 2>/dev/null; then
    printf '%s\n' "$reason" >> "$d/amended-intent.log" 2>/dev/null
    CONSUMED_REASON="$reason"
    return 0
  fi
  return 1
}

# --- lock predicate for a state dir (contract §2.3) -----------------------------------
is_locked_dir() {
  local d="$1"
  [ -f "$d/test.path" ] || return 1
  [ -f "$d/red.hash" ] || return 1
  [ -f "$d/green.ok" ] && return 1
  return 0
}

# ---------------------------------------------------------------- Write/Edit/MultiEdit
handle_writeedit() {
  local file_path="$1" cwd="$2" norm d tp
  [ -n "$file_path" ] || return 0                 # no target -> nothing to guard
  norm="$(normalize_path "$file_path" "$cwd")"

  for d in "$STATE_ROOT"/*/; do
    [ -d "$d" ] || continue
    is_locked_dir "$d" || continue
    tp="$(head -n1 "$d/test.path" 2>/dev/null)"
    [ "$tp" = "$norm" ] || continue

    # locked hit — honor a pending one-shot amend-intent, else deny
    if try_consume_intent "$d"; then
      emit_allow "amend-intent consumed: $CONSUMED_REASON"
      return 0
    fi
    emit_deny "test-guard LOCK: $tp is hash-locked (red recorded, green not yet passed). Editing a test while making it pass invalidates the red gate. Sanctioned paths: (a) implement product code until 'redgreen.sh green $tp' passes, or (b) declare intent first: '$REDGREEN amend-intent $tp \"one-line reason\"' — that unlocks exactly ONE edit, and green will then require --amended."
    return 0
  done
  return 0                                         # no locked file matched -> allow
}

# ---------------------------------------------------------------- Bash
handle_bash() {
  local command="$1" d tp base
  [ -n "$command" ] || return 0

  # Deny requires BOTH a destructive verb AND a locked file named in the command.
  # Check the (file-independent) destructive verb once; if absent, nothing to block.
  printf '%s' "$command" | grep -Eq "$DESTRUCTIVE_RE" || return 0

  for d in "$STATE_ROOT"/*/; do
    [ -d "$d" ] || continue
    is_locked_dir "$d" || continue
    tp="$(head -n1 "$d/test.path" 2>/dev/null)"
    [ -n "$tp" ] || continue
    base="$(basename "$tp")"

    # (b): command contains the full locked path, or the basename as a whole word.
    if printf '%s' "$command" | grep -Fq "$tp" \
       || printf '%s' "$command" | grep -Fqw "$base"; then
      if try_consume_intent "$d"; then
        emit_allow "amend-intent consumed: $CONSUMED_REASON"
        return 0
      fi
      emit_deny "test-guard LOCK (bash): the command performs a destructive operation on hash-locked test file $tp (red recorded, green not yet passed). Rephrase the command so it does not touch the locked test file, or declare intent first: '$REDGREEN amend-intent $tp \"one-line reason\"' — that unlocks exactly ONE Write/Edit/Bash touch, after which green requires --amended."
      return 0
    fi
  done
  return 0
}

# --- best-effort extraction of tool_input.command without jq (contract §3.3) ----------
extract_command_fallback() {
  printf '%s' "$INPUT" \
    | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\(.*\)".*/\1/p' | head -n1 \
    | sed 's/\\n/ /g; s/\\"/"/g; s/\\\\/\\/g'
}

main() {
  INPUT="$(cat)"
  [ -n "$INPUT" ] || return 0

  local tool_name file_path command cwd
  if command -v jq >/dev/null 2>&1; then
    tool_name="$(printf '%s' "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)"
    file_path="$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)"
    command="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)"
    cwd="$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)"
  else
    tool_name="$(printf '%s' "$INPUT" | sed -n 's/.*"tool_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
    file_path="$(printf '%s' "$INPUT" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
    command="$(extract_command_fallback)"
    cwd="$(printf '%s' "$INPUT" | sed -n 's/.*"cwd"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
  fi

  case "$tool_name" in
    Write|Edit|MultiEdit) handle_writeedit "$file_path" "$cwd" ;;
    Bash)                 handle_bash "$command" ;;
    *)                    return 0 ;;             # unknown tool -> allow
  esac
}

# Run main; swallow every error, never exit non-zero (contract §3.5).
main "$@" 2>/dev/null || exit 0
exit 0
