#!/usr/bin/env bash
# verify.sh — is this repo's Codex wiring actually in force on this machine?
#
# A hook that is not loaded fails silently and looks exactly like one that
# passed, so nothing here is taken on faith: every registered command is really
# executed, and deploy-guard is fed a real violation to prove it still blocks.
#
# Run: bash .codex/verify.sh
set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." 2>/dev/null && pwd)"
cd "$REPO_ROOT" || exit 1

PROBLEMS=0
say()  { printf '%s\n' "$1"; }
ok()   { printf '  \033[32mok\033[0m   %s\n' "$1"; }
warn() { printf '  \033[33mwarn\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31mFAIL\033[0m %s\n' "$1"; PROBLEMS=$((PROBLEMS + 1)); }

say ''
say '=== files ==='
for f in AGENTS.md CLAUDE.md .codex/hooks.json .codex/briefing.md \
         .codex/hooks/codex-adapter.py .codex/hooks/session-brief.sh; do
  [ -f "$f" ] && ok "$f" || bad "$f is missing"
done
for d in .codex/skills .agents/skills; do
  if [ -d "$d" ] && [ -f "$d/README.md" ]; then ok "$d resolves to the skill catalog"
  else bad "$d does not resolve (symlink broken?)"; fi
done

say ''
say '=== prerequisites ==='
if command -v python3 >/dev/null 2>&1; then ok "python3 $(python3 -V 2>&1 | awk '{print $2}')"
else bad 'python3 not found — the adapter cannot run'; fi
if command -v git >/dev/null 2>&1 && git rev-parse --show-toplevel >/dev/null 2>&1; then
  ok 'git repo root resolves (hook commands rely on it)'
else
  bad 'git rev-parse --show-toplevel failed — hook commands cannot locate the repo'
fi

say ''
say '=== Codex config (~/.codex/config.toml) ==='
CFG="${CODEX_HOME:-$HOME/.codex}/config.toml"
if [ -f "$CFG" ]; then
  if grep -Eq '^[[:space:]]*codex_hooks[[:space:]]*=[[:space:]]*true' "$CFG"; then
    ok 'codex_hooks = true'
  else
    warn "codex_hooks is not enabled in $CFG — add:  [features]\\n      codex_hooks = true"
  fi
else
  warn "$CFG not found — hooks stay off until you create it with [features] codex_hooks = true"
fi

say ''
say '=== hooks.json ==='
if python3 -c "import json;json.load(open('.codex/hooks.json'))" 2>/dev/null; then
  ok 'valid JSON'
  python3 - <<'PY'
import json
data = json.load(open('.codex/hooks.json'))
for event, groups in data['hooks'].items():
    count = sum(len(g['hooks']) for g in groups)
    print('  %-14s %d hook(s)' % (event, count))
PY
else
  bad '.codex/hooks.json is not valid JSON'
fi

say ''
say '=== every registered command executes ==='
python3 - <<'PY'
import json, subprocess, sys
data = json.load(open('.codex/hooks.json'))
payload = json.dumps({
    "hook_event_name": "PreToolUse", "tool_name": "shell", "cwd": ".",
    "tool_input": {"command": ["bash", "-lc", "ls -la"]},
})
failures = 0
for event, groups in data['hooks'].items():
    for group in groups:
        for hook in group['hooks']:
            label = hook.get('statusMessage', hook['command'])[:46]
            try:
                proc = subprocess.run(hook['command'], shell=True, input=payload,
                                      capture_output=True, text=True, timeout=60)
            except subprocess.TimeoutExpired:
                print('  \033[31mFAIL\033[0m %-46s timed out' % label); failures += 1; continue
            if proc.returncode == 0:
                print('  \033[32mok\033[0m   %-46s' % label)
            else:
                print('  \033[31mFAIL\033[0m %-46s rc=%d %s' % (label, proc.returncode, proc.stderr.strip()[:60]))
                failures += 1
sys.exit(1 if failures else 0)
PY
[ $? -eq 0 ] || PROBLEMS=$((PROBLEMS + 1))

say ''
say '=== deploy-guard still blocks a real violation ==='
CMD="$(python3 -c "import json;print(json.load(open('.codex/hooks.json'))['hooks']['PreToolUse'][0]['hooks'][0]['command'])" 2>/dev/null)"
if [ -n "$CMD" ]; then
  PAYLOAD='{"hook_event_name":"PreToolUse","tool_name":"shell","cwd":"'"$REPO_ROOT"'","tool_input":{"command":["bash","-lc","mapps code:push -i 11457413"]}}'
  ERR="$(printf '%s' "$PAYLOAD" | sh -c "$CMD" 2>&1 >/dev/null)"
  RC=$?
  if [ "$RC" -eq 2 ] && printf '%s' "$ERR" | grep -q 'BLOCKED'; then
    ok 'a local `mapps code:push` is blocked'
  else
    bad "a local deploy was NOT blocked (rc=$RC) — the guard is not in force"
  fi
else
  bad 'could not read the deploy-guard command out of hooks.json'
fi

say ''
say '=== adapter test suite ==='
if bash .codex/hooks/tests/adapter.test.sh >/tmp/codex-adapter-tests.$$ 2>&1; then
  ok "$(tail -2 /tmp/codex-adapter-tests.$$ | tr -d '\n' | sed 's/  */ /g')"
else
  bad 'adapter tests failed — see output below'
  cat /tmp/codex-adapter-tests.$$
fi
rm -f /tmp/codex-adapter-tests.$$

say ''
if [ "$PROBLEMS" -eq 0 ]; then
  printf '\033[32mCodex wiring verified.\033[0m Confirm with /hooks inside Codex too.\n\n'
  exit 0
fi
printf '\033[31m%d problem(s) found.\033[0m See .codex/README.md.\n\n' "$PROBLEMS"
exit 1
