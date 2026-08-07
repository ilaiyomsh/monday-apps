#!/usr/bin/env bash
# Single source of truth for the twyst-your-status cleanup workflow.
#
# Sourced by baseline.sh, guard-protected-paths.sh and post-edit-format.sh. The
# workflows in .claude/workflows/cleanup-*.js read the same values back out of
# <state>/baseline.json, which baseline.sh writes from here — so the commands exist
# in exactly one place.
#
# SCOPE — this file is what makes the cleanup package "twyst-your-status ONLY".
# Every path below is inside apps/twyst-your-status. Onboarding a second app means a
# second copy of this file with its own APP_DIR (and its own guard), never widening
# the globs here. The guard hook derives its allowlist from these variables, so a
# path that is not named here cannot be edited by a cleanup agent.

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
#   toolchain — check-toolchain.sh. Node/pnpm majors must match the CI pins above;
#             metrics taken on a different runtime are not comparable to the baseline.
#   lintcfg — lint-config-audit.sh. The EFFECTIVE eslint config of each workspace must
#             hold no-undef/no-unused-vars (+ the react JSX pair for the SPA) at error —
#             a gate that cannot see a dangling identifier certifies nothing about the
#             move/split edits cleanup actually makes.
#   custody — verify-approval.sh. Every `status: approved` line must be committed by a
#             human identity (round 2: an agent transcribed the approval, commit 953f8ce).
#   reconcile — reconcile-plan.sh. `done` is an accounting identity, not a declaration:
#             every non-struck finding needs a disposition (round 2: A-structure-07 was
#             silently skipped and the batch still flipped to done).
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

# LOC metric: git-tracked, non-test source lines. Deliberately not cloc — one less
# network dependency, and `git ls-files` is gitignore-aware by construction.
cleanup_loc() {
  git ls-files "$CLEANUP_SPA_DIR/src" "$CLEANUP_SRV_DIR/src" \
    | grep -vE '\.(test|spec)\.[jt]sx?$' \
    | tr '\n' '\0' | xargs -0 wc -l | tail -1 | awk '{print $1}'
}

# Bundle metric: the SPA dist EXCLUDING sourcemaps. vite.config.js builds with
# sourcemap:'hidden', and the deploy workflow strips every .map before pushing, so a plain
# `du -sk dist` measures something no browser ever downloads — verified 2026-08-05:
# 2644 KB with maps vs 716 KB of actually-served bundle. Cleanup deltas would vanish in
# that noise. Both baseline.sh and the verify workflow call THIS function, so before and
# after are always measured the same way.
cleanup_bundle_kb() {
  local dist="$CLEANUP_SPA_DIR/dist"
  [ -d "$dist" ] || { echo unknown; return; }
  find "$dist" -type f ! -name '*.map' -exec du -k {} + 2>/dev/null \
    | awk '{s+=$1} END{print (s ? s : "unknown")}'
}

cleanup_file_count() {
  git ls-files "$CLEANUP_SPA_DIR/src" "$CLEANUP_SRV_DIR/src" \
    | grep -vE '\.(test|spec)\.[jt]sx?$' | wc -l | tr -d ' '
}
