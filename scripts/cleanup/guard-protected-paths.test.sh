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

echo ""
echo "cleanup guard fixtures: $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
