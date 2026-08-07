#!/usr/bin/env bash
# Cleanup gate step: the running toolchain must match the repo's CI pins.
#
# Why this exists: the 2026-08-07 re-baseline was nearly taken on Node 22 — the cloud
# container's default — while CI (and the previous baseline) run Node 20. baseline.sh
# *recorded* the version but never enforced it, so before/after metrics could silently
# compare two different runtimes and every "no regression" claim would stand on sand.
# The pins live in cleanup-env.sh next to the scanner pins, for the same reason.
#
# Run from the repo root:  bash scripts/cleanup/check-toolchain.sh
set -uo pipefail

cd "$(git rev-parse --show-toplevel)" || { echo "FATAL: not inside a git repo"; exit 1; }
# shellcheck source=./cleanup-env.sh
. scripts/cleanup/cleanup-env.sh

fail=0

NODE_MAJOR=$(node --version 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/')
if [ "$NODE_MAJOR" != "$CLEANUP_NODE_MAJOR" ]; then
  echo "FAIL: node is v${NODE_MAJOR:-not-found}, the cleanup toolchain pin is v${CLEANUP_NODE_MAJOR}.x (CI runs the same)."
  echo "      Metrics and gates taken on a different major are not comparable to the baseline."
  echo "      Fix: install Node ${CLEANUP_NODE_MAJOR} (nvm/fnm/volta, or a tarball from nodejs.org) and put it first on PATH."
  fail=1
fi

PNPM_MAJOR=$(pnpm --version 2>/dev/null | cut -d. -f1)
if [ "$PNPM_MAJOR" != "$CLEANUP_PNPM_MAJOR" ]; then
  echo "FAIL: pnpm is ${PNPM_MAJOR:-not-found}.x, the cleanup toolchain pin is ${CLEANUP_PNPM_MAJOR}.x."
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "toolchain OK — node v$(node --version | sed 's/^v//'), pnpm $(pnpm --version)"
fi
exit "$fail"
