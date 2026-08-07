#!/usr/bin/env bash
# Shared, app-agnostic metric helpers for the cleanup workflow. Sourced by every
# per-app env file AFTER its CLEANUP_* vars are set; each helper tolerates an app
# with no server workspace (CLEANUP_SRV_DIR empty).

# Source dirs actually present for this app.
_cleanup_src_dirs() {
  printf '%s/src\n' "$CLEANUP_SPA_DIR"
  [ -n "${CLEANUP_SRV_DIR:-}" ] && printf '%s/src\n' "$CLEANUP_SRV_DIR"
}

# LOC metric: git-tracked, non-test source lines. Deliberately not cloc — one less
# network dependency, and `git ls-files` is gitignore-aware by construction.
cleanup_loc() {
  _cleanup_src_dirs | tr '\n' '\0' | xargs -0 git ls-files \
    | grep -vE '\.(test|spec)\.[jt]sx?$' \
    | tr '\n' '\0' | xargs -0 wc -l | tail -1 | awk '{print $1}'
}

cleanup_file_count() {
  _cleanup_src_dirs | tr '\n' '\0' | xargs -0 git ls-files \
    | grep -vE '\.(test|spec)\.[jt]sx?$' | wc -l | tr -d ' '
}

# Bundle metric: the app's SERVED output dir (CLEANUP_BUNDLE_DIR — dist/ or build/,
# read the app's deploy workflow, never assume) EXCLUDING sourcemaps. The vite configs
# build with sourcemap:'hidden' and the deploy workflows strip every .map before
# pushing, so a plain `du -sk` measures something no browser ever downloads — verified
# 2026-08-05 on twyst: 2644 KB with maps vs 716 KB actually served. Cleanup deltas
# would vanish in that noise. baseline.sh and the verify workflow both call THIS
# function, so before and after are always measured the same way.
cleanup_bundle_kb() {
  local dist="${CLEANUP_BUNDLE_DIR:-$CLEANUP_SPA_DIR/dist}"
  [ -d "$dist" ] || { echo unknown; return; }
  find "$dist" -type f ! -name '*.map' -exec du -k {} + 2>/dev/null \
    | awk '{s+=$1} END{print (s ? s : "unknown")}'
}
