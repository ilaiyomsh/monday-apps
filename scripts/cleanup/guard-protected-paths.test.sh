#!/usr/bin/env bash
# Fixture test for the cleanup path guard. Run from anywhere:
#   bash scripts/cleanup/guard-protected-paths.test.sh
#
# Why this exists: the guard is the only physical thing keeping a cleanup run inside
# apps/twyst-your-status, and a guard that silently stops blocking is indistinguishable
# from one that passed. Same reasoning as ci.yml's "test-guard hook fixtures" job.
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel)"
GUARD="$ROOT/scripts/cleanup/guard-protected-paths.sh"
export CLAUDE_PROJECT_DIR="$ROOT"

pass=0; fail=0

check() { # $1 = expected (allow|block), $2 = path, $3 = what the case proves
  local expected="$1" path="$2" label="$3" out code
  out=$(printf '{"tool_name":"Edit","tool_input":{"file_path":"%s"}}' "$path" | bash "$GUARD" 2>&1)
  code=$?
  local actual=allow
  [ "$code" -eq 2 ] && actual=block
  if [ "$actual" = "$expected" ]; then
    pass=$((pass + 1))
    printf '  ok    %-5s %s\n' "$expected" "$label"
  else
    fail=$((fail + 1))
    printf '  FAIL  expected %s, got %s (exit %s) — %s\n     path: %s\n     out:  %s\n' \
      "$expected" "$actual" "$code" "$label" "$path" "$out"
  fi
}

echo "cleanup guard fixtures"

# --- allowed: the app's own source and the two manifests a dependency batch edits
check allow "$ROOT/apps/twyst-your-status/src/domain/statusPolicy.js"                "SPA domain module (absolute path)"
check allow "apps/twyst-your-status/src/components/OnClickDialog/OnClickDialog.jsx"  "SPA component (relative path)"
check allow "apps/twyst-your-status/src/components/OnClickDialog/OnClickDialog.css"  "SPA stylesheet"
check allow "apps/twyst-your-status/server/src/guard/evaluateStatusChange.js"        "guard-server module"
check allow "apps/twyst-your-status/package.json"                                    "SPA manifest (unused-deps batch)"
check allow "apps/twyst-your-status/server/package.json"                             "server manifest (unused-deps batch)"
check allow "apps/twyst-your-status/.cleanup/CLEANUP_PLAN.md"                        "cleanup's own state"

# --- blocked: everything outside the one app in scope
check block "apps/discussions/src/App.jsx"                    "another app in the monorepo"
check block "packages/error-kit/src/browser/index.ts"         "shared package"
check block "apps/axis/tracker/src/App.jsx"                   "axis app"
check block "scripts/cleanup/baseline.sh"                     "the cleanup tooling itself"
check block "CLAUDE.md"                                       "repo root file"
check block "/etc/passwd"                                     "absolute path outside the repo"

# --- blocked: tests and test infrastructure
check block "apps/twyst-your-status/src/domain/statusPolicy.test.js"         "SPA unit test"
check block "apps/twyst-your-status/src/App.test.jsx"                        "SPA component test"
check block "apps/twyst-your-status/server/tests/services.test.js"           "server test"
check block "apps/twyst-your-status/src/setupTests.js"                       "vitest setup file"
check block "apps/twyst-your-status/src/test-utils/renderWithProviders.jsx"  "test utilities"

# --- blocked: build output and staged artifacts
check block "apps/twyst-your-status/dist/assets/index-abc.js"          "SPA build output"
check block "apps/twyst-your-status/server/dist/index.js"              "server bundle"
check block "apps/twyst-your-status/server/public/index.html"          "SPA staged for the monday-code push"

# --- blocked: the error/observability boot layer + the drift-locked vendor copy
check block "apps/twyst-your-status/src/utils/logger.js"                       "logger choke-point"
check block "apps/twyst-your-status/src/utils/globalErrorHandler.js"           "global handlers"
check block "apps/twyst-your-status/src/utils/axiomLoggerAdapter.js"           "Axiom adapter"
check block "apps/twyst-your-status/src/hooks/useUiErrorSink.js"               "UI error sink"
check block "apps/twyst-your-status/src/components/ErrorBoundary/AppErrorBoundary.jsx" "root boundary"
check block "apps/twyst-your-status/server/src/helpers/process-guards.js"      "server process guards"
check block "apps/twyst-your-status/server/src/helpers/axiomServerSink.js"     "drift-locked vendored sink"

# --- blocked: config, docs, contracts, lockfiles
check block "apps/twyst-your-status/vite.config.js"        "vite config (sourcemap + route contracts)"
check block "apps/twyst-your-status/knip.jsonc"            "scanner config"
check block "apps/twyst-your-status/server/eslint.config.js" "server eslint config"
check block "apps/twyst-your-status/index.html"            "SPA html entry"
check block "apps/twyst-your-status/CHANGELOG.md"          "changelog (change-tracker owns it)"
check block "apps/twyst-your-status/MANIFEST.md"           "app manifest doc"
check block "apps/twyst-your-status/.error-guard"          "error-guard marker"
check block "apps/twyst-your-status/docs/GUARD-ACTIVATION.md" "app docs"
check block "pnpm-lock.yaml"                               "lockfile"

# --- a path inside the app that is in no allowlist bucket
check block "apps/twyst-your-status/README.md"             "unlisted file inside the app"

# =============================================================================
# Bash surface (guard-bash-ops.py). A dead-file batch deletes with `rm`, which never
# reaches an Edit hook — this half of the guard was missing until a pre-approval
# refutation pass found the hole. Every case here is one that hole let through.
# =============================================================================
BASH_GUARD="$ROOT/scripts/cleanup/guard-bash-ops.py"

checksh() { # $1 = expected (allow|block), $2 = command, $3 = what the case proves
  local expected="$1" cmd="$2" label="$3" out code actual
  out=$(printf '%s' "$(jq -nc --arg c "$cmd" '{tool_name:"Bash",tool_input:{command:$c}}')" \
        | python3 "$BASH_GUARD" 2>&1)
  code=$?
  actual=allow
  [ "$code" -eq 2 ] && actual=block
  if [ "$actual" = "$expected" ]; then
    pass=$((pass + 1)); printf '  ok    %-5s %s\n' "$expected" "$label"
  else
    fail=$((fail + 1))
    printf '  FAIL  expected %s, got %s (exit %s) — %s\n     cmd: %s\n     out: %s\n' \
      "$expected" "$actual" "$code" "$label" "$cmd" "$out"
  fi
}

echo ""
echo "cleanup guard fixtures — Bash surface"

# --- the deletions a dead-file batch legitimately needs
checksh allow 'rm apps/twyst-your-status/src/hooks/useQuery.js'                 "delete a dead app module"
checksh allow 'rm apps/twyst-your-status/src/components/shared/StatusChip.jsx apps/twyst-your-status/src/components/shared/StatusChip.module.css' "delete a module and its orphaned stylesheet"

# --- the deletions that must never happen (the hole this closes)
checksh block 'rm apps/discussions/src/App.jsx'                                 "delete in another app"
checksh block 'rm -rf packages/error-kit'                                       "delete a shared package"
checksh block 'rm apps/twyst-your-status/src/domain/statusPolicy.test.js'        "delete a test file"
checksh block 'rm apps/twyst-your-status/src/utils/logger.js'                    "delete the logger boot layer"
checksh block 'rm apps/twyst-your-status/vite.config.js'                         "delete build config"
checksh block 'rm -rf apps/twyst-your-status/src'                               "delete the whole source tree"
checksh block 'rm -rf /'                                                        "the obvious one"
checksh block 'mv apps/twyst-your-status/src/domain/x.js packages/shared/x.js'   "move code out of the app"
checksh block 'cp apps/twyst-your-status/src/a.js apps/axis/tracker/src/a.js'    "copy into another app"

# --- unresolvable destructive targets: refused rather than guessed
checksh block 'rm apps/twyst-your-status/src/components/shared/*.jsx'            "glob target"
checksh block 'rm -rf $TARGET_DIR'                                              "variable target"
checksh block 'rm $(cat files.txt)'                                            "command substitution target"
checksh block 'find apps/twyst-your-status/src -name "*.jsx" -delete'            "find -delete"
checksh block 'find . -name x -exec rm {} +'                                    "find -exec rm"
checksh block 'git ls-files | xargs rm'                                         "xargs rm"

# --- writes that bypass Edit entirely
checksh block 'echo "" > apps/twyst-your-status/src/utils/logger.js'             "redirect over a protected file"
checksh block "sed -i 's/a/b/' apps/twyst-your-status/src/App.test.jsx"          "in-place edit of a test"
checksh allow "sed -i 's/a/b/' apps/twyst-your-status/src/domain/statusPolicy.js" "in-place edit of app source"
checksh block 'echo x > CLAUDE.md'                                              "redirect outside the app"
checksh allow 'node scripts/error-wiring-audit.mjs > /dev/null 2>&1'             "/dev/null redirect is not a write"

# --- git: the executor never commits or reverts (the finalize step does)
checksh block 'git rm apps/twyst-your-status/src/hooks/useQuery.js'              "git rm"
checksh block 'git commit -m "cleanup"'                                         "git commit"
checksh block 'git checkout -- apps/twyst-your-status'                           "git checkout"
checksh block 'git clean -fd'                                                   "git clean"
checksh allow 'git status --porcelain'                                          "git status is read-only"
checksh allow 'git log --oneline -5'                                            "git log is read-only"
checksh allow 'git diff -- apps/twyst-your-status/src'                           "git diff is read-only"

# --- package manager: pnpm only, scoped, and the gate itself is never policed
checksh allow 'pnpm remove --filter "./apps/twyst-your-status" some-dep'         "sanctioned dependency removal"
checksh allow 'pnpm remove --filter "./apps/twyst-your-status/server" some-dep'  "same, server workspace"
checksh block 'pnpm remove some-dep'                                            "unfiltered remove hits the root"
checksh block 'pnpm remove --filter "./apps/discussions" some-dep'               "another app's workspace"
checksh block 'npm uninstall some-dep'                                          "npm is refused repo-wide"
checksh block 'yarn remove some-dep'                                            "yarn is refused repo-wide"
checksh allow 'pnpm --filter "./apps/twyst-your-status" lint'                    "gate command: lint"
checksh allow 'pnpm --filter "./apps/twyst-your-status" build'                   "gate command: build (writes dist by design)"
checksh allow 'pnpm --filter "./apps/twyst-your-status" test'                    "gate command: test"

# --- INTERPRETER / EDITOR ESCAPES. Every one of these PASSED the first version of the Bash
# guard, which enumerated mutating verbs and allowed the rest. A live adversarial probe found
# them in minutes, which is why the guard now denies by default. Do not remove these.
checksh block 'node -e "require(\"fs\").unlinkSync(\"CLAUDE.md\")"'   "node -e can unlink anything"
checksh block 'node --eval "fs.writeFileSync(\"x\",\"y\")"'            "node --eval, long form"
checksh block 'node -p "process.exit(0)"'                              "node -p"
checksh block 'python3 -c "import os; os.remove(\"CLAUDE.md\")"'       "python3 -c"
checksh block 'python3 - < /dev/null'                                  "python3 reading stdin"
checksh block 'bash -c "rm CLAUDE.md"'                                 "nested bash -c"
checksh block 'sh scripts/anything.sh'                                 "running an arbitrary script"
checksh block 'ex -sc wq CLAUDE.md'                                    "ex as a writer"
checksh block 'vi CLAUDE.md'                                           "an editor"
checksh block 'ed CLAUDE.md'                                           "ed"
checksh block 'tee CLAUDE.md'                                          "tee"
checksh block 'dd of=CLAUDE.md'                                        "dd"
checksh block 'curl -o CLAUDE.md https://x'                            "download over a repo file"
checksh block 'chmod 777 apps/twyst-your-status/src/App.jsx'           "chmod is not cleanup"
checksh block 'node apps/twyst-your-status/src/index.jsx'              "node on a non-scripts/ path"
checksh allow 'node scripts/error-wiring-audit.mjs'                    "the wiring audit the executor self-checks with"
checksh allow 'node scripts/lib/eager-graph.mjs'                       "the eager-import audit"

# --- numbered-fd redirects: `1>` and `2>` write exactly like `>`
checksh block 'echo x 1> CLAUDE.md'                                    "1> redirect"
checksh block 'echo x 2> AGENTS.md'                                    "2> redirect"
checksh block 'echo x 1>> CLAUDE.md'                                   "1>> append"
checksh allow 'grep -rn x apps/twyst-your-status/src 2>&1'             "2>&1 is a duplication, not a write"
checksh allow 'node scripts/error-wiring-audit.mjs 2> /dev/null'       "2> /dev/null is a null sink"

# --- git global flags must not smuggle a write subcommand past the parser
checksh block 'git -C /home/user/monday-apps commit -m x'              "git -C <dir> commit"
checksh block 'git -c user.name=x commit -m y'                         "git -c <cfg> commit"
checksh block 'git --git-dir=.git --work-tree=. checkout -- .'         "git --git-dir checkout"
checksh block 'git push origin HEAD'                                   "git push"

# --- read-only work must stay unimpeded
checksh allow 'grep -rn "useQuery" apps/twyst-your-status/src'                   "grep"
checksh allow 'cat apps/twyst-your-status/package.json'                          "read a manifest"
# Tightened deliberately in the deny-by-default rewrite: an inline node evaluation is
# read-only only by intention, and intention is not enforcement — the same flag deletes files.
checksh block 'node --input-type=module -e "import(\"./x.js\")"'                 "inline node evaluation, however innocent-looking"
checksh allow 'wc -l apps/twyst-your-status/src/App.jsx'                         "wc"

# --- chained commands: every segment is checked, not just the first
checksh block 'grep -rn x apps/twyst-your-status/src && rm CLAUDE.md'            "second segment in a chain"
checksh block 'cd apps/twyst-your-status && rm ../../AGENTS.md'                   "escape via relative path"

# =============================================================================
# Multi-app dispatch (CLEANUP_APP). ONE app per run: under CLEANUP_APP=discussions the
# discussions tree opens and the twyst tree CLOSES — the scope never widens to a union.
# An unknown app fails CLOSED on both surfaces (the env refuses to load, so the verdict
# function has no allowlist and the pnpm filter set is empty).
# =============================================================================
echo ""
echo "cleanup guard fixtures — multi-app dispatch (CLEANUP_APP=discussions)"

check_d() { # Edit surface under CLEANUP_APP=discussions
  local expected="$1" path="$2" label="$3" out code actual
  out=$(printf '{"tool_name":"Edit","tool_input":{"file_path":"%s"}}' "$path" \
        | CLEANUP_APP=discussions bash "$GUARD" 2>&1)
  code=$?
  actual=allow; [ "$code" -eq 2 ] && actual=block
  if [ "$actual" = "$expected" ]; then
    pass=$((pass + 1)); printf '  ok    %-5s %s\n' "$expected" "$label"
  else
    fail=$((fail + 1))
    printf '  FAIL  expected %s, got %s (exit %s) — %s\n     path: %s\n     out:  %s\n' \
      "$expected" "$actual" "$code" "$label" "$path" "$out"
  fi
}
checksh_d() { # Bash surface under CLEANUP_APP=discussions
  local expected="$1" cmd="$2" label="$3" out code actual
  out=$(printf '%s' "$(jq -nc --arg c "$cmd" '{tool_name:"Bash",tool_input:{command:$c}}')" \
        | CLEANUP_APP=discussions python3 "$BASH_GUARD" 2>&1)
  code=$?
  actual=allow; [ "$code" -eq 2 ] && actual=block
  if [ "$actual" = "$expected" ]; then
    pass=$((pass + 1)); printf '  ok    %-5s %s\n' "$expected" "$label"
  else
    fail=$((fail + 1))
    printf '  FAIL  expected %s, got %s (exit %s) — %s\n     cmd: %s\n     out: %s\n' \
      "$expected" "$actual" "$code" "$label" "$cmd" "$out"
  fi
}

# --- the discussions tree opens...
check_d allow "apps/discussions/src/App.jsx"                                  "discussions source"
check_d allow "apps/discussions/src/utils/mondayApi/BoardSDK.js"              "discussions API layer"
check_d allow "apps/discussions/package.json"                                 "discussions manifest (unused-deps batch)"
check_d allow "apps/discussions/.cleanup/CLEANUP_PLAN.md"                     "discussions cleanup state"
# --- ...and the twyst tree CLOSES (one app per run, never a union)
check_d block "apps/twyst-your-status/src/domain/statusPolicy.js"             "twyst source is out of scope under discussions"
check_d block "apps/twyst-your-status/package.json"                           "twyst manifest is out of scope under discussions"
# --- the same protection classes hold inside discussions
check_d block "apps/discussions/src/utils/logger.js"                          "discussions logger boot layer"
check_d block "apps/discussions/src/utils/globalErrorHandler.js"              "discussions global handlers"
check_d block "apps/discussions/src/utils/lazyRetry.js"                       "discussions chunk-load recovery"
check_d block "apps/discussions/src/hooks/useUiErrorSink.js"                  "discussions UI error sink"
check_d block "apps/discussions/src/components/ErrorBoundary/ErrorBoundary.jsx" "discussions root boundary"
check_d block "apps/discussions/src/components/ErrorBoundary/ErrorBoundary.test.jsx" "discussions boundary test"
check_d block "apps/discussions/src/utils/__tests__/exportGate.test.js"       "discussions test file"
check_d block "apps/discussions/eslint.config.js"                             "discussions lint config"
check_d block "apps/discussions/vite.config.js"                               "discussions build config"
check_d block "apps/discussions/CHANGELOG.md"                                 "discussions changelog"
check_d block "apps/discussions/CLAUDE.md"                                    "discussions app docs"

# --- Bash surface under discussions: filters swap, scope swaps
checksh_d allow 'rm apps/discussions/src/utils/columnOrder.js'                "delete a dead discussions module"
checksh_d block 'rm apps/twyst-your-status/src/hooks/useQuery.js'             "delete in twyst under discussions"
checksh_d block 'rm apps/discussions/src/utils/logger.js'                     "delete the discussions logger"
checksh_d allow 'pnpm remove --filter "./apps/discussions" some-dep'          "sanctioned discussions dependency removal"
checksh_d block 'pnpm remove --filter "./apps/twyst-your-status" some-dep'    "twyst workspace under discussions"
checksh_d allow 'pnpm --filter "./apps/discussions" lint'                     "gate command: discussions lint"

# --- unknown app fails CLOSED on both surfaces
check_u() {
  local out code actual
  out=$(printf '{"tool_name":"Edit","tool_input":{"file_path":"apps/discussions/src/App.jsx"}}' \
        | CLEANUP_APP=no-such-app bash "$GUARD" 2>&1)
  code=$?
  actual=allow; [ "$code" -eq 2 ] && actual=block
  if [ "$actual" = "block" ]; then
    pass=$((pass + 1)); printf '  ok    block unknown CLEANUP_APP fails closed (Edit surface)\n'
  else
    fail=$((fail + 1)); printf '  FAIL  unknown CLEANUP_APP allowed an edit (exit %s): %s\n' "$code" "$out"
  fi
}
check_u
out=$(printf '%s' "$(jq -nc '{tool_name:"Bash",tool_input:{command:"pnpm remove --filter \"./apps/discussions\" x"}}')" \
      | CLEANUP_APP=no-such-app python3 "$BASH_GUARD" 2>&1); code=$?
if [ "$code" -eq 2 ]; then
  pass=$((pass + 1)); printf '  ok    block unknown CLEANUP_APP fails closed (Bash surface)\n'
else
  fail=$((fail + 1)); printf '  FAIL  unknown CLEANUP_APP allowed a dependency change (exit %s): %s\n' "$code" "$out"
fi

echo ""
echo "cleanup guard fixtures: $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
