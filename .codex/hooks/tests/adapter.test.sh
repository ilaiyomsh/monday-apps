#!/usr/bin/env bash
# Tests for .codex/hooks/codex-adapter.py — the Codex -> Claude hook bridge.
#
# The adapter is the ONLY thing standing between a Codex session and the
# enforcement hooks in .claude/hooks/. Its failure mode is silent: a payload it
# mis-normalizes makes every guard fail open, which looks exactly like "wired
# and enforcing". So the cases below pin the translation itself, not just the
# happy path:
#   - a shell command arriving as ["bash","-lc","<script>"] must reduce to
#     "<script>" — a naive space-join hides `mapps code:push` from deploy-guard's
#     command-position regex (it would no longer sit at a command boundary).
#   - apply_patch must fan out to one Claude-shaped Write/Edit payload per file.
#   - deny protocol + fail-open semantics must survive delegation.
#
# Run: bash .codex/hooks/tests/adapter.test.sh
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ADAPTER="$HERE/../codex-adapter.py"
REPO_ROOT="$(cd "$HERE/../../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0
ok()   { printf '  \033[32mok\033[0m   %s\n' "$1"; PASS=$((PASS + 1)); }
bad()  { printf '  \033[31mFAIL\033[0m %s\n       %s\n' "$1" "$2"; FAIL=$((FAIL + 1)); }

# run <payload-json> [adapter args...] -> sets OUT / ERR / RC
run() {
  local payload="$1"; shift
  OUT="$(printf '%s' "$payload" | python3 "$ADAPTER" "$@" 2>"$TMP/stderr")"
  RC=$?
  ERR="$(cat "$TMP/stderr" 2>/dev/null)"
}

# assert_emit <label> <payload> <python-assertion-body>
# The assertion body gets `rows` = list of normalized payload dicts, and should
# raise AssertionError on mismatch.
assert_emit() {
  local label="$1" payload="$2" body="$3" msg
  run "$payload" --emit .claude/hooks/deploy-guard.sh
  if [ "$RC" -ne 0 ]; then
    bad "$label" "adapter exited $RC (stderr: $ERR)"
    return
  fi
  msg="$(printf '%s' "$OUT" | python3 -c "
import json, sys
rows = [json.loads(l) for l in sys.stdin if l.strip()]
try:
$(printf '%s' "$body" | sed 's/^/    /')
except AssertionError as e:
    print('assertion failed: %s | rows=%s' % (e, json.dumps(rows)))
except Exception as e:
    print('%s: %s | rows=%s' % (type(e).__name__, e, json.dumps(rows)))
" 2>&1)"
  [ -z "$msg" ] && ok "$label" || bad "$label" "$msg"
}

printf '\n=== normalization (--emit) ===\n'

assert_emit 'shell + ["bash","-lc",script] reduces to the script itself' \
  '{"hook_event_name":"PreToolUse","tool_name":"shell","cwd":"/tmp","tool_input":{"command":["bash","-lc","mapps code:push -i 123"]}}' \
  'assert len(rows) == 1, "expected 1 payload, got %d" % len(rows)
assert rows[0]["tool_name"] == "Bash", rows[0]["tool_name"]
assert rows[0]["tool_input"]["command"] == "mapps code:push -i 123", repr(rows[0]["tool_input"]["command"])'

assert_emit 'shell + plain argv array joins into one command string' \
  '{"hook_event_name":"PreToolUse","tool_name":"shell","cwd":"/tmp","tool_input":{"command":["ls","-la","/etc"]}}' \
  'assert rows[0]["tool_input"]["command"] == "ls -la /etc", repr(rows[0]["tool_input"]["command"])'

assert_emit 'shell + string command passes through unchanged' \
  '{"hook_event_name":"PreToolUse","tool_name":"shell","cwd":"/tmp","tool_input":{"command":"echo hi && ls"}}' \
  'assert rows[0]["tool_name"] == "Bash"
assert rows[0]["tool_input"]["command"] == "echo hi && ls", repr(rows[0]["tool_input"]["command"])'

assert_emit 'cwd and session_id survive normalization' \
  '{"hook_event_name":"PreToolUse","tool_name":"shell","cwd":"/some/dir","session_id":"abc123","tool_input":{"command":"ls"}}' \
  'assert rows[0]["cwd"] == "/some/dir", rows[0].get("cwd")
assert rows[0]["session_id"] == "abc123", rows[0].get("session_id")'

assert_emit 'apply_patch fans out to one payload per file, Add -> Write / Update -> Edit' \
  '{"hook_event_name":"PostToolUse","tool_name":"apply_patch","cwd":"/repo","tool_input":{"input":"*** Begin Patch\n*** Update File: apps/discussions/src/a.ts\n@@ ctx\n-old\n+added one\n*** Add File: apps/discussions/src/b.ts\n+brand new\n*** End Patch\n"}}' \
  'assert len(rows) == 2, "expected 2 payloads, got %d" % len(rows)
assert rows[0]["tool_name"] == "Edit", rows[0]["tool_name"]
assert rows[0]["tool_input"]["file_path"] == "/repo/apps/discussions/src/a.ts", rows[0]["tool_input"]["file_path"]
assert "added one" in rows[0]["tool_input"].get("content", ""), rows[0]["tool_input"]
assert rows[1]["tool_name"] == "Write", rows[1]["tool_name"]
assert rows[1]["tool_input"]["file_path"] == "/repo/apps/discussions/src/b.ts", rows[1]["tool_input"]["file_path"]
assert "brand new" in rows[1]["tool_input"].get("content", ""), rows[1]["tool_input"]'

assert_emit 'apply_patch context/removed lines are not reported as written content' \
  '{"hook_event_name":"PostToolUse","tool_name":"apply_patch","cwd":"/repo","tool_input":{"input":"*** Begin Patch\n*** Update File: a.ts\n@@ ctx\n-secretRemoved\n unchangedLine\n+kept\n*** End Patch\n"}}' \
  'c = rows[0]["tool_input"].get("content", "")
assert "kept" in c, c
assert "secretRemoved" not in c, c
assert "unchangedLine" not in c, c'

assert_emit 'apply_patch already-absolute paths are not re-joined against cwd' \
  '{"hook_event_name":"PostToolUse","tool_name":"apply_patch","cwd":"/repo","tool_input":{"input":"*** Begin Patch\n*** Update File: /elsewhere/x.ts\n@@\n+y\n*** End Patch\n"}}' \
  'assert rows[0]["tool_input"]["file_path"] == "/elsewhere/x.ts", rows[0]["tool_input"]["file_path"]'

assert_emit 'apply_patch Delete File still yields a payload (locked tests must be guarded)' \
  '{"hook_event_name":"PreToolUse","tool_name":"apply_patch","cwd":"/repo","tool_input":{"input":"*** Begin Patch\n*** Delete File: apps/x/src/a.test.ts\n*** End Patch\n"}}' \
  'assert len(rows) == 1, "expected 1 payload, got %d" % len(rows)
assert rows[0]["tool_input"]["file_path"] == "/repo/apps/x/src/a.test.ts", rows[0]["tool_input"]["file_path"]'

assert_emit 'patch text is found even under an unexpected tool_input key' \
  '{"hook_event_name":"PostToolUse","tool_name":"apply_patch","cwd":"/repo","tool_input":{"some_future_key":"*** Begin Patch\n*** Update File: q.ts\n@@\n+z\n*** End Patch\n"}}' \
  'assert len(rows) == 1, "expected 1 payload, got %d" % len(rows)
assert rows[0]["tool_input"]["file_path"] == "/repo/q.ts", rows[0]["tool_input"]["file_path"]'

printf '\n=== unmapped tools and malformed input fail open ===\n'

run '{"hook_event_name":"PreToolUse","tool_name":"web_fetch","cwd":"/tmp","tool_input":{"url":"https://x"}}' --emit .claude/hooks/deploy-guard.sh
if [ "$RC" -eq 0 ] && [ -z "$OUT" ]; then ok 'unmapped tool produces no payload, rc 0'
else bad 'unmapped tool produces no payload, rc 0' "rc=$RC out=$OUT"; fi

run 'not json at all {{{' --emit .claude/hooks/deploy-guard.sh
if [ "$RC" -eq 0 ]; then ok 'malformed stdin exits 0 (fail open)'
else bad 'malformed stdin exits 0 (fail open)' "rc=$RC err=$ERR"; fi

run '' --emit .claude/hooks/deploy-guard.sh
if [ "$RC" -eq 0 ]; then ok 'empty stdin exits 0 (fail open)'
else bad 'empty stdin exits 0 (fail open)' "rc=$RC"; fi

printf '\n=== end-to-end through the real deploy-guard ===\n'

run '{"hook_event_name":"PreToolUse","tool_name":"shell","cwd":"'"$REPO_ROOT"'","tool_input":{"command":["bash","-lc","mapps code:push -i 11457413"]}}' \
    .claude/hooks/deploy-guard.sh
if [ "$RC" -eq 2 ] && printf '%s' "$ERR" | grep -q 'BLOCKED'; then
  ok 'local mapps code:push is BLOCKED through the array form'
else
  bad 'local mapps code:push is BLOCKED through the array form' "rc=$RC (want 2) err=$ERR"
fi

run '{"hook_event_name":"PreToolUse","tool_name":"shell","cwd":"'"$REPO_ROOT"'","tool_input":{"command":"mapps code:push -i 11457413"}}' \
    .claude/hooks/deploy-guard.sh
if [ "$RC" -eq 2 ] && printf '%s' "$ERR" | grep -q 'BLOCKED'; then
  ok 'local mapps code:push is BLOCKED through the string form'
else
  bad 'local mapps code:push is BLOCKED through the string form' "rc=$RC (want 2) err=$ERR"
fi

run '{"hook_event_name":"PreToolUse","tool_name":"shell","cwd":"'"$REPO_ROOT"'","tool_input":{"command":["bash","-lc","ship.sh"]}}' \
    .claude/hooks/deploy-guard.sh
if [ "$RC" -eq 2 ] && printf '%s' "$ERR" | grep -q 'BLOCKED'; then
  ok 'ship.sh invocation is BLOCKED'
else
  bad 'ship.sh invocation is BLOCKED' "rc=$RC (want 2) err=$ERR"
fi

run '{"hook_event_name":"PreToolUse","tool_name":"shell","cwd":"'"$REPO_ROOT"'","tool_input":{"command":["bash","-lc","mapps code:push --help"]}}' \
    .claude/hooks/deploy-guard.sh
if [ "$RC" -eq 0 ]; then ok 'mapps code:push --help is allowed (help is not a deploy)'
else bad 'mapps code:push --help is allowed (help is not a deploy)' "rc=$RC (want 0) err=$ERR"; fi

run '{"hook_event_name":"PreToolUse","tool_name":"shell","cwd":"'"$REPO_ROOT"'","tool_input":{"command":["bash","-lc","git status && ls -la"]}}' \
    .claude/hooks/deploy-guard.sh
if [ "$RC" -eq 0 ]; then ok 'benign command is allowed'
else bad 'benign command is allowed' "rc=$RC (want 0) err=$ERR"; fi

# cwd must reach the delegate: deploy-guard resolves `pnpm run deploy` by reading
# the nearest package.json from the payload cwd. A dropped cwd would change the
# verdict, so this pins the plumbing, not just the regex.
mkdir -p "$TMP/proj"
printf '{"name":"p","scripts":{"deploy":"mapps code:push -i 1"}}' > "$TMP/proj/package.json"
run '{"hook_event_name":"PreToolUse","tool_name":"shell","cwd":"'"$TMP"'/proj","tool_input":{"command":["bash","-lc","pnpm run deploy"]}}' \
    .claude/hooks/deploy-guard.sh
if [ "$RC" -eq 2 ] && printf '%s' "$ERR" | grep -q 'BLOCKED'; then
  ok 'pnpm run deploy is BLOCKED via cwd-resolved package.json'
else
  bad 'pnpm run deploy is BLOCKED via cwd-resolved package.json' "rc=$RC (want 2) err=$ERR"
fi

printf '\n=== delegate result translation (fake delegates) ===\n'

cat > "$TMP/deny.sh" <<'EOF'
#!/usr/bin/env bash
cat >/dev/null
printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"nope"}}\n'
exit 0
EOF
chmod +x "$TMP/deny.sh"
run '{"hook_event_name":"PreToolUse","tool_name":"shell","cwd":"/tmp","tool_input":{"command":"ls"}}' "$TMP/deny.sh"
if printf '%s' "$OUT" | grep -q '"permissionDecision": *"deny"'; then
  ok 'delegate deny JSON is passed through on stdout'
else
  bad 'delegate deny JSON is passed through on stdout' "rc=$RC out=$OUT"
fi

cat > "$TMP/exit1.sh" <<'EOF'
#!/usr/bin/env bash
cat >/dev/null
echo "some non-blocking warning" >&2
exit 1
EOF
chmod +x "$TMP/exit1.sh"
run '{"hook_event_name":"PostToolUse","tool_name":"shell","cwd":"/tmp","tool_input":{"command":"ls"}}' "$TMP/exit1.sh"
if [ "$RC" -eq 0 ]; then ok 'delegate exit 1 does not block (mapped to 0)'
else bad 'delegate exit 1 does not block (mapped to 0)' "rc=$RC (want 0)"; fi

# Fan-out aggregation: one blocked file out of several must block the whole call,
# otherwise a multi-file patch smuggles a violation past a per-file guard.
cat > "$TMP/block-b.sh" <<'EOF'
#!/usr/bin/env bash
payload="$(cat)"
if printf '%s' "$payload" | grep -q 'b\.ts'; then
  echo "b.ts is not allowed" >&2
  exit 2
fi
exit 0
EOF
chmod +x "$TMP/block-b.sh"
run '{"hook_event_name":"PostToolUse","tool_name":"apply_patch","cwd":"/repo","tool_input":{"input":"*** Begin Patch\n*** Update File: a.ts\n@@\n+x\n*** Update File: b.ts\n@@\n+y\n*** End Patch\n"}}' \
    "$TMP/block-b.sh"
if [ "$RC" -eq 2 ] && printf '%s' "$ERR" | grep -q 'b.ts is not allowed'; then
  ok 'one blocked file in a multi-file patch blocks the whole call'
else
  bad 'one blocked file in a multi-file patch blocks the whole call' "rc=$RC (want 2) err=$ERR"
fi

cat > "$TMP/needs-projectdir.sh" <<'EOF'
#!/usr/bin/env bash
cat >/dev/null
[ -n "${CLAUDE_PROJECT_DIR:-}" ] || { echo "CLAUDE_PROJECT_DIR unset" >&2; exit 2; }
[ -d "$CLAUDE_PROJECT_DIR/.claude" ] || { echo "not a repo root: $CLAUDE_PROJECT_DIR" >&2; exit 2; }
exit 0
EOF
chmod +x "$TMP/needs-projectdir.sh"
run '{"hook_event_name":"PreToolUse","tool_name":"shell","cwd":"/tmp","tool_input":{"command":"ls"}}' "$TMP/needs-projectdir.sh"
if [ "$RC" -eq 0 ]; then ok 'CLAUDE_PROJECT_DIR is exported to the delegate'
else bad 'CLAUDE_PROJECT_DIR is exported to the delegate' "rc=$RC err=$ERR"; fi

run '{"hook_event_name":"PreToolUse","tool_name":"shell","cwd":"/tmp","tool_input":{"command":"ls"}}' .claude/hooks/does-not-exist.sh
if [ "$RC" -eq 0 ]; then ok 'missing delegate fails open'
else bad 'missing delegate fails open' "rc=$RC err=$ERR"; fi

printf '\n%d passed, %d failed\n\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
