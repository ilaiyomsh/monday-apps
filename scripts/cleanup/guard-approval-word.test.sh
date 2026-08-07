#!/usr/bin/env bash
# Fixture test for the approval-word guard. Run from anywhere:
#   bash scripts/cleanup/guard-approval-word.test.sh
#
# Why this exists: `status: approved` in CLEANUP_PLAN.md is the human gate of the whole
# cleanup workflow, and round 2 proved it was discipline-only — an agent wrote the word
# (commit 953f8ce), a second agent treated the first agent's file as the gate, and the
# stage-3 reviewer had to catch it after the fact. This guard makes the word physically
# unwritable by any agent surface; these fixtures make the guard itself unable to rot
# silently. Same reasoning as guard-protected-paths.test.sh: extend fixtures BEFORE
# extending the guard.
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel)"
GUARD="$ROOT/scripts/cleanup/guard-approval-word.sh"
export CLAUDE_PROJECT_DIR="$ROOT"

PLAN="apps/twyst-your-status/.cleanup/CLEANUP_PLAN.md"

pass=0; fail=0

check() { # $1 = expected (allow|block), $2 = hook JSON payload, $3 = what the case proves
  local expected="$1" payload="$2" label="$3" out code
  out=$(printf '%s' "$payload" | bash "$GUARD" 2>&1)
  code=$?
  local actual=allow
  [ "$code" -eq 2 ] && actual=block
  if [ "$actual" = "$expected" ]; then
    pass=$((pass + 1))
    printf '  ok    %-5s %s\n' "$expected" "$label"
  else
    fail=$((fail + 1))
    printf '  FAIL  expected %s, got %s (exit %s) — %s\n     out: %s\n' \
      "$expected" "$actual" "$code" "$label" "$out"
  fi
}

edit() { # $1 = file, $2 = new_string
  jq -cn --arg f "$1" --arg s "$2" '{tool_name:"Edit",tool_input:{file_path:$f,old_string:"x",new_string:$s}}'
}
write() { # $1 = file, $2 = content
  jq -cn --arg f "$1" --arg s "$2" '{tool_name:"Write",tool_input:{file_path:$f,content:$s}}'
}
multiedit() { # $1 = file, $2 = new_string of second edit
  jq -cn --arg f "$1" --arg s "$2" '{tool_name:"MultiEdit",tool_input:{file_path:$f,edits:[{old_string:"a",new_string:"b"},{old_string:"c",new_string:$s}]}}'
}
bashcmd() { # $1 = command
  jq -cn --arg c "$1" '{tool_name:"Bash",tool_input:{command:$c}}'
}

echo "approval-word guard fixtures"

# --- Edit family: the word is human-only, everything else about the plan stays writable
check allow "$(edit  "$PLAN" 'risk: L | status: done')"          "executor flips a batch to done"
check allow "$(edit  "$PLAN" 'risk: L | status: failed')"        "executor marks a batch failed"
check allow "$(edit  "$PLAN" 'risk: M | status: pending')"       "consolidator writes pending"
check block "$(edit  "$PLAN" 'risk: L | status: approved')"      "agent writes status: approved"
check block "$(edit  "$PLAN" 'risk: L | status:  Approved')"     "case/spacing variants"
check block "$(write "$PLAN" $'## Batch 5\nrisk: L | status: approved\n')" "Write with approved inside"
check block "$(write "$PLAN" '| 5 | duplication | 10 | L | approved |')"   "summary-table cell approved"
check block "$(multiedit "$PLAN" 'status: approved')"            "MultiEdit smuggles it in edit #2"
check allow "$(write "$PLAN" $'# CLEANUP_PLAN\n**Nothing here is approved.** Every batch is `status: pending`; only the human operator writes\n`approved`.\n| 1 | comments | 9 | S | pending |')" "fresh plan: prose mentions the word, no status carries it"
check allow "$(edit  "$PLAN" '| id | verdict/reason | evidence: owner approved batches 5+7 verbally |')" "prose cell mentioning approval history"
check allow "$(edit  "apps/twyst-your-status/docs/STATE.md" 'status: approved')" "other files are not this guard's business"
check allow "$(edit  "$PLAN" '')"                                "empty new_string"

# --- Bash: write-shaped commands touching the plan may never involve the word.
# "Touching" means the write operator sits in the SAME command segment as the plan path —
# a `>` or a quoted sed in a git commit MESSAGE that merely mentions the plan is prose,
# not a write (found live 2026-08-07: this guard blocked the redesign's own commit because
# its heredoc message contained "approved", the plan filename, and an unrelated ">").
check allow "$(bashcmd "grep -n 'approved' $PLAN")"                                    "reading the plan for the word"
check allow "$(bashcmd "git add $PLAN && git commit -m 'cleanup plan status batch-5'")" "committing a plan change"
check allow "$(bashcmd "cat $PLAN")"                                                   "cat the plan"
check allow "$(bashcmd "sed -i 's/foo/bar/' apps/twyst-your-status/src/x.js")"         "in-place edit elsewhere"
check allow "$(bashcmd "git commit -F - <<MSG
docs: the human sets approved in $PLAN; counts moved 82 > 108
MSG")"                                                                                 "commit message PROSE mentioning plan+word+>"
check allow "$(bashcmd "echo ok > /tmp/x.log && grep approved $PLAN")"                 "write op in a different segment than the plan"
check block "$(bashcmd "sed -i 's/status: pending/status: approved/' $PLAN")"          "sed -i writes the word"
check block "$(bashcmd "echo 'risk: L | status: approved' >> $PLAN")"                  "echo-append writes the word"
check block "$(bashcmd "printf 'status: approved' | tee -a $PLAN")"                    "tee writes the word"
check block "$(bashcmd "sed -i 's/status: approved/status: done/' $PLAN")"             "sed flip mentioning the word (use the Edit tool instead)"
check block "$(bashcmd "perl -pi -e 's/pending/approved/' $PLAN")"                     "perl -i writes the word"
check block "$(bashcmd "cat > $PLAN <<EOF
risk: L | status: approved
EOF")"                                                                                 "heredoc redirect into the plan"

echo
echo "approval-word guard: $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
