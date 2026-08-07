#!/usr/bin/env bash
# Per-app cleanup environment: discussions (client-only board-view SPA, ONE workspace).
# Loaded ONLY through scripts/cleanup/cleanup-env.sh (CLEANUP_APP=discussions).
#
# Differences from twyst-your-status that shaped every value below:
#   - NO server workspace: CLEANUP_SRV_* are EMPTY, and every consumer
#     (lib-path-verdict, lib-metrics, lint-config-audit, guard-bash-ops) skips the
#     server half when they are.
#   - Build output is build/, NOT dist/ (deploy-draft-discussions.yml pushes build/;
#     a stale dist/ may exist — measuring it would measure garbage).
#   - The app's own `test` script is `vitest` in WATCH mode — the gate must run
#     `test:run`, or the first gate hangs forever waiting on a watcher.
#   - Path aliases (@generated → src, @components, @api) come from vite.config.js;
#     apps/discussions/knip.jsonc mirrors them or knip reports phantom unused files.

CLEANUP_APP_SLUG="discussions"
CLEANUP_APP_DIR="apps/discussions"
CLEANUP_SPA_DIR="apps/discussions"
CLEANUP_SRV_DIR=""
CLEANUP_STATE_DIR="apps/discussions/.cleanup"

CLEANUP_SPA_FILTER='./apps/discussions'
CLEANUP_SRV_FILTER=''

CLEANUP_INSTALL_CMD='pnpm install --frozen-lockfile'

# Toolchain pins — same majors as CI (CLAUDE.md toolchain rule).
CLEANUP_NODE_MAJOR='20'
CLEANUP_PNPM_MAJOR='10'

# --- The gate: the repo's blocking CI set narrowed to this app, plus the cleanup's own
# mechanical checks. wiring covers discussions as a client surface (entry
# apps/discussions/src/index.jsx, boundaryDirs src/); eager/drift are repo-level
# invariants that this app's edits can break through packages/error-kit imports.
CLEANUP_TOOLCHAIN_CMD='bash scripts/cleanup/check-toolchain.sh'
CLEANUP_LINTCFG_CMD='CLEANUP_APP=discussions bash scripts/cleanup/lint-config-audit.sh'
CLEANUP_CUSTODY_CMD='bash scripts/cleanup/verify-approval.sh apps/discussions/.cleanup/CLEANUP_PLAN.md'
CLEANUP_RECONCILE_CMD='bash scripts/cleanup/reconcile-plan.sh'
CLEANUP_WIRING_CMD='node scripts/error-wiring-audit.mjs'
CLEANUP_EAGER_CMD='node scripts/lib/eager-graph.mjs'
CLEANUP_TYPECHECK_CMD='pnpm --filter "./apps/discussions" run type-check'
CLEANUP_LINT_CMD='pnpm --filter "./apps/discussions" lint'
CLEANUP_BUILD_CMD='pnpm --filter "./apps/discussions" build'
# test:run, NOT test — the app's `test` script is vitest in watch mode (see header).
CLEANUP_TEST_CMD='pnpm --filter "./apps/discussions" run test:run'
CLEANUP_DRIFT_CMD='pnpm --filter @mapps/error-kit test'

# --- Scanners, same pins as every other app (reproducibility is the point of pinning).
CLEANUP_KNIP_VERSION='knip@5.88.1'
CLEANUP_JSCPD_VERSION='jscpd@4.2.5'
CLEANUP_KNIP_SPA_ARGS='--directory apps/discussions'
CLEANUP_KNIP_SRV_ARGS=''
CLEANUP_JSCPD_ARGS='apps/discussions/src --min-tokens 50 --max-lines 5000 --ignore **/*.test.js,**/*.test.jsx,**/__tests__/**'

# --- Served bundle dir: build/, not dist/ (see header).
CLEANUP_BUNDLE_DIR="$CLEANUP_SPA_DIR/build"

# --- The error/observability boot layer. discussions has no .error-guard marker file,
# but the funnel architecture is the same one (app CLAUDE.md "Observability — one
# funnel"): logger.emit is the choke point, useUiErrorSink turns ERROR records into
# toasts, ErrorBoundary catches render crashes, globalErrorHandler catches
# window.onerror/unhandledrejection, errorHandler carries the display helpers,
# axiomLoggerAdapter is the remote-sink adapter, lazyRetry is the chunk-load recovery
# path. knip cannot see platform-reached exports, so "unused" findings here are false
# positives with an outage behind them.
CLEANUP_PROTECTED_FILES="$CLEANUP_SPA_DIR/src/utils/logger.js
$CLEANUP_SPA_DIR/src/utils/globalErrorHandler.js
$CLEANUP_SPA_DIR/src/utils/errorHandler.js
$CLEANUP_SPA_DIR/src/utils/axiomLoggerAdapter.js
$CLEANUP_SPA_DIR/src/utils/lazyRetry.js
$CLEANUP_SPA_DIR/src/hooks/useUiErrorSink.js"
CLEANUP_PROTECTED_DIRS="$CLEANUP_SPA_DIR/src/components/ErrorBoundary"

# Shared, app-agnostic metric helpers (cleanup_loc / cleanup_bundle_kb / cleanup_file_count).
# shellcheck source=./lib-metrics.sh
. "${BASH_SOURCE[0]%/*}/lib-metrics.sh"
