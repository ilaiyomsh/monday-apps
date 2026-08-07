#!/usr/bin/env bash
# Per-app cleanup environment: twyst-your-status (SPA + guard server, two workspaces).
# Loaded ONLY through scripts/cleanup/cleanup-env.sh (CLEANUP_APP=twyst-your-status,
# which is also the default). Everything the workflow knows about this app is here;
# the guards derive their allowlist from these variables, so a path not named here
# cannot be edited by a cleanup agent.

CLEANUP_APP_SLUG="twyst-your-status"
CLEANUP_APP_DIR="apps/twyst-your-status"
CLEANUP_SPA_DIR="apps/twyst-your-status"
CLEANUP_SRV_DIR="apps/twyst-your-status/server"
CLEANUP_STATE_DIR="apps/twyst-your-status/.cleanup"

# pnpm workspace filters — the same forms deploy-draft-twyst-your-status.yml uses.
# Path filters (./apps/...), not package names: the app package is `twyst-your-status`
# and the server is `twyst-your-status-guard`, and mixing the two naming styles is how
# a filter silently matches nothing and a gate reports green on zero work.
CLEANUP_SPA_FILTER='./apps/twyst-your-status'
CLEANUP_SRV_FILTER='./apps/twyst-your-status/server'

CLEANUP_INSTALL_CMD='pnpm install --frozen-lockfile'

# Toolchain pins — same majors as CI (CLAUDE.md: "Node 20, pnpm 10, match it locally").
# check-toolchain.sh enforces these at every gate; recording the version without
# enforcing it is how the 2026-08-07 re-baseline nearly ran on the container's Node 22.
CLEANUP_NODE_MAJOR='20'
CLEANUP_PNPM_MAJOR='10'

# --- The gate. This is the repo's BLOCKING CI set (.github/workflows/ci.yml), narrowed
# to what twyst-your-status can break, in fail-fast order. Cleanup is only ever "green"
# against all of it.
#
#   wiring  — scripts/error-wiring-audit.mjs. twyst-your-status is TWO surfaces there
#             (client + twyst-guard-server) and apps/twyst-your-status/server/src is in
#             APP_SRC_DIRS. Deleting a boot wire or an "unused" logger export fails here.
#   eager   — scripts/lib/eager-graph.mjs. Invariant: no static path from
#             src/index.jsx to @vibe/core. A consolidation that turns a lazy import into
#             a top-level one breaks it, and nothing else in the gate would notice.
#   drift   — packages/error-kit/test/drift.test.ts imports
#             server/src/helpers/axiomServerSink.js directly and holds the vendored copy
#             behaviourally identical to @mapps/error-kit.
#   type    — the app is plain JS; its type-check script is `echo no-typescript`. Kept in
#             the gate anyway so the day someone adds TypeScript the gate already covers it.
#   toolchain / lintcfg / custody / reconcile — the cleanup's own mechanical checks;
#             see each script's header for the run history that motivated it.
CLEANUP_TOOLCHAIN_CMD='bash scripts/cleanup/check-toolchain.sh'
CLEANUP_LINTCFG_CMD='bash scripts/cleanup/lint-config-audit.sh'
CLEANUP_CUSTODY_CMD='bash scripts/cleanup/verify-approval.sh'
CLEANUP_RECONCILE_CMD='bash scripts/cleanup/reconcile-plan.sh'
CLEANUP_WIRING_CMD='node scripts/error-wiring-audit.mjs'
CLEANUP_EAGER_CMD='node scripts/lib/eager-graph.mjs'
CLEANUP_TYPECHECK_CMD='pnpm --filter "./apps/twyst-your-status" run type-check'
CLEANUP_LINT_CMD='pnpm --filter "./apps/twyst-your-status" lint && pnpm --filter "./apps/twyst-your-status/server" lint'
CLEANUP_BUILD_CMD='pnpm --filter "./apps/twyst-your-status" build && pnpm --filter "./apps/twyst-your-status/server" build'
CLEANUP_TEST_CMD='pnpm --filter "./apps/twyst-your-status" test && pnpm --filter "./apps/twyst-your-status/server" test'
CLEANUP_DRIFT_CMD='pnpm --filter @mapps/error-kit test'

# --- Scanners. Pinned exact versions (verified 2026-08-05): a knip minor can change what
# it reports, and a cleanup plan built on shifting scanner output is not reproducible.
# Run through `pnpm dlx` on purpose — adding knip/jscpd to a package.json would churn the
# lockfile and, for an app whose deploy triggers on apps/twyst-your-status/**, put a
# dev-only tool in the redeploy path. Needs network; this is a session tool, never CI.
CLEANUP_KNIP_VERSION='knip@5.88.1'
CLEANUP_JSCPD_VERSION='jscpd@4.2.5'
# Two knip runs, one per workspace, each with its own knip.jsonc — that is what keeps
# dependency attribution per package.json and the scan inside this one app.
CLEANUP_KNIP_SPA_ARGS='--directory apps/twyst-your-status'
CLEANUP_KNIP_SRV_ARGS='--directory apps/twyst-your-status/server'
# Tests are excluded from duplication analysis: test files are not editable during
# cleanup (test-guard locks them), so a clone between two suites is not actionable.
# --max-lines 5000: jscpd's DEFAULT silently skips any file over 1000 lines — verified
# on the first run, where the 1,352-line ColumnSettings.jsx (the single biggest cleanup
# target) was absent from the baseline scan and the before/after clone counts were not
# like-for-like. A scanner that skips the worst file must never be the default again.
CLEANUP_JSCPD_ARGS='apps/twyst-your-status/src apps/twyst-your-status/server/src --min-tokens 50 --max-lines 5000 --ignore **/*.test.js,**/*.test.jsx,**/dev-harness/**,**/test-utils/**'

# --- Served bundle dir (cleanup_bundle_kb): dist/ for this app; sourcemaps are excluded
# by the shared helper — see env/lib-metrics.sh for why a plain `du -sk` lies.
CLEANUP_BUNDLE_DIR="$CLEANUP_SPA_DIR/dist"

# --- The error/observability boot layer (apps/twyst-your-status/.error-guard), plus the
# Axiom adapter and the root boundary. scripts/error-wiring-audit.mjs asserts this wiring
# structurally for BOTH surfaces, and the vendored server sink is held identical to
# @mapps/error-kit by packages/error-kit/test/drift.test.ts. knip cannot see that a global
# handler, a sink export or a vendored module is reached from the platform (or from
# another package's test) rather than from an import — so every "unused" finding in here
# is a false positive with an outage behind it. lib-path-verdict.sh consumes these
# (one path per line; dirs protect their whole subtree).
CLEANUP_PROTECTED_FILES="$CLEANUP_SPA_DIR/src/utils/logger.js
$CLEANUP_SPA_DIR/src/utils/globalErrorHandler.js
$CLEANUP_SPA_DIR/src/utils/axiomLoggerAdapter.js
$CLEANUP_SPA_DIR/src/hooks/useUiErrorSink.js
$CLEANUP_SRV_DIR/src/helpers/logger.js
$CLEANUP_SRV_DIR/src/helpers/process-guards.js
$CLEANUP_SRV_DIR/src/helpers/axiomServerSink.js"
CLEANUP_PROTECTED_DIRS="$CLEANUP_SPA_DIR/src/components/ErrorBoundary"

# Shared, app-agnostic metric helpers (cleanup_loc / cleanup_bundle_kb / cleanup_file_count).
# shellcheck source=./lib-metrics.sh
. "${BASH_SOURCE[0]%/*}/lib-metrics.sh"
