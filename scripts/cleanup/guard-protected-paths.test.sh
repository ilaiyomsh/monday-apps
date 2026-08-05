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

# --- read-only work must stay unimpeded
checksh allow 'grep -rn "useQuery" apps/twyst-your-status/src'                   "grep"
checksh allow 'cat apps/twyst-your-status/package.json'                          "read a manifest"
checksh allow 'node --input-type=module -e "import(\"./x.js\")"'                 "read-only node evaluation"
checksh allow 'wc -l apps/twyst-your-status/src/App.jsx'                         "wc"

# --- chained commands: every segment is checked, not just the first
checksh block 'grep -rn x apps/twyst-your-status/src && rm CLAUDE.md'            "second segment in a chain"
checksh block 'cd apps/twyst-your-status && rm ../../AGENTS.md'                   "escape via relative path"

echo ""
echo "cleanup guard fixtures: $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
