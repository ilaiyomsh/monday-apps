#!/usr/bin/env bash
# Stage 0 of the twyst-your-status cleanup workflow — branch, green gate, metrics snapshot.
#
# Run from the repo root:  bash scripts/cleanup/baseline.sh
#
# Nothing downstream may run until this exits 0: the audit needs trustworthy scanner
# output, and the execute stage needs a known-green starting point to attribute any
# failure to its own edits. A red gate here is not a cleanup problem to work around — it
# is a pre-existing defect that belongs in its own fix, on its own branch.
set -uo pipefail

cd "$(git rev-parse --show-toplevel)" || { echo "FATAL: not inside a git repo"; exit 1; }
# shellcheck source=./cleanup-env.sh
. scripts/cleanup/cleanup-env.sh

STATE="$CLEANUP_STATE_DIR"
RAW="$STATE/raw"

echo "==> [1/6] Preconditions"
command -v jq >/dev/null 2>&1 || { echo "FATAL: jq is required (the guard hook and this script fail closed without it)"; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "FATAL: pnpm is required (never npm/yarn in this repo)"; exit 1; }
# Fail fast on a wrong runtime: metrics taken on a different Node major are not
# comparable to the previous baseline, and nothing downstream would notice.
eval "$CLEANUP_TOOLCHAIN_CMD" || exit 1
[ -d "$CLEANUP_APP_DIR" ] || { echo "FATAL: $CLEANUP_APP_DIR not found — this script only serves $CLEANUP_APP_SLUG"; exit 1; }
if [ -n "$(git status --porcelain)" ]; then
  echo "FATAL: working tree not clean. Commit or stash first — every batch must be a revertable commit."
  exit 1
fi
BASE_SHA=$(git rev-parse HEAD)

echo "==> [2/6] Branch check (CLAUDE.md branch rules)"
BRANCH=$(git rev-parse --abbrev-ref HEAD)
case "$BRANCH" in
  main)
    echo "FATAL: never work on main. Base cleanup on develop and PR back into develop."
    exit 1;;
  develop)
    NEW="feature/cleanup-$CLEANUP_APP_SLUG-$(date +%Y%m%d)"
    echo "    on develop → creating $NEW"
    git checkout -b "$NEW" || exit 1
    BRANCH="$NEW";;
  feature/*|claude/*|hotfix/*)
    echo "    staying on $BRANCH (cleanup commits land here; PR goes into develop)";;
  *)
    echo "FATAL: unexpected branch '$BRANCH'. Use develop, feature/*, claude/* or hotfix/*."
    exit 1;;
esac

echo "==> [3/6] Clean install ($CLEANUP_INSTALL_CMD)"
eval "$CLEANUP_INSTALL_CMD" || { echo "FATAL: install failed"; exit 1; }

echo "==> [4/6] Green gate — the blocking CI set, narrowed to $CLEANUP_APP_SLUG"
gate() { # $1 = label, $2 = command
  echo "    - $1"
  eval "$2" >"$RAW/gate-$1.log" 2>&1 && return 0
  echo "FATAL: gate '$1' is RED at baseline — cleanup must start from green."
  echo "       command: $2"
  echo "       last 20 lines of $RAW/gate-$1.log:"
  tail -20 "$RAW/gate-$1.log" | sed 's/^/       /'
  exit 1
}
mkdir -p "$RAW"
gate wiring   "$CLEANUP_WIRING_CMD"
gate eager    "$CLEANUP_EAGER_CMD"
gate typecheck "$CLEANUP_TYPECHECK_CMD"
gate lint     "$CLEANUP_LINT_CMD"
gate lintcfg  "$CLEANUP_LINTCFG_CMD"
gate build    "$CLEANUP_BUILD_CMD"
gate tests    "$CLEANUP_TEST_CMD"
gate drift    "$CLEANUP_DRIFT_CMD"

echo "==> [5/6] Metrics snapshot -> $RAW/*-baseline.*"
# knip exits 1 when it HAS findings — that is a report, not a failure. What would make the
# output untrustworthy is invalid JSON or an empty file, which is checked right after.
pnpm dlx "$CLEANUP_KNIP_VERSION" $CLEANUP_KNIP_SPA_ARGS --reporter json \
  >"$RAW/knip-spa-baseline.json" 2>"$RAW/knip-spa-baseline.err" || true
KNIP_REPORTS=("$RAW/knip-spa-baseline.json")
# The server knip run exists only for apps that HAVE a server workspace. Guarded on the
# args being non-empty ON PURPOSE: found live 2026-08-07 on the first discussions
# baseline — with empty args this ran `pnpm dlx knip` with no --directory from the repo
# root, scanned the WHOLE monorepo, and reported 183 "unused files" (every other app's)
# as this app's baseline. Numbers from the wrong scope poison every later comparison.
if [ -n "${CLEANUP_KNIP_SRV_ARGS:-}" ]; then
  pnpm dlx "$CLEANUP_KNIP_VERSION" $CLEANUP_KNIP_SRV_ARGS --reporter json \
    >"$RAW/knip-srv-baseline.json" 2>"$RAW/knip-srv-baseline.err" || true
  KNIP_REPORTS+=("$RAW/knip-srv-baseline.json")
else
  rm -f "$RAW/knip-srv-baseline.json" "$RAW/knip-srv-baseline.err"
fi
for f in "${KNIP_REPORTS[@]}"; do
  jq -e . "$f" >/dev/null 2>&1 || {
    echo "FATAL: $f is not valid JSON — the scan is broken, and every finding downstream would be guesswork."
    echo "       stderr: $(head -3 "${f%.json}.err")"
    exit 1
  }
done
pnpm dlx "$CLEANUP_JSCPD_VERSION" $CLEANUP_JSCPD_ARGS \
  --reporters json --output "$RAW/jscpd-baseline" >/dev/null 2>&1 || echo "    WARN: jscpd failed (duplication metrics will be missing)"

LOC=$(cleanup_loc)
FILES=$(cleanup_file_count)
BUNDLE_KB=$(cleanup_bundle_kb)   # served bytes only — sourcemaps excluded, see cleanup-env.sh
JSCPD_REPORT="$RAW/jscpd-baseline/jscpd-report.json"
CLONES=$( [ -f "$JSCPD_REPORT" ] && jq -r '.statistics.total.clones // "unknown"' "$JSCPD_REPORT" || echo unknown )
DUP_PCT=$( [ -f "$JSCPD_REPORT" ] && jq -r '.statistics.total.percentage // "unknown"' "$JSCPD_REPORT" || echo unknown )
# knip's JSON reporter shape: {files:[path...], issues:[{file, exports:[{name,line}...],
# dependencies:[...], devDependencies:[...], duplicates:[...], ...}]}. Summed across the
# workspace reports that EXIST for this app — the same numbers the verify stage compares
# against.
knip_sum() { # $1 = jq filter
  local total=0 f
  for f in "${KNIP_REPORTS[@]}"; do
    total=$((total + $(jq "$1" "$f")))
  done
  echo "$total"
}
KNIP_FILES=$(knip_sum '(.files // []) | length')
KNIP_EXPORTS=$(knip_sum '[(.issues // [])[] | (.exports // []) | length] | add // 0')
KNIP_DEPS=$(knip_sum '[(.issues // [])[] | ((.dependencies // []) | length) + ((.devDependencies // []) | length)] | add // 0')

echo "==> [6/6] Writing $STATE/baseline.json"
jq -n \
  --arg date "$(date -Iseconds)" \
  --arg node "$(node --version)" \
  --arg pnpm "$(pnpm --version)" \
  --arg app "$CLEANUP_APP_SLUG" \
  --arg base_sha "$BASE_SHA" \
  --arg branch "$BRANCH" \
  --arg app_dir "$CLEANUP_APP_DIR" \
  --arg spa_dir "$CLEANUP_SPA_DIR" \
  --arg srv_dir "$CLEANUP_SRV_DIR" \
  --arg state_dir "$STATE" \
  --arg install "$CLEANUP_INSTALL_CMD" \
  --arg toolchain "$CLEANUP_TOOLCHAIN_CMD" \
  --arg wiring "$CLEANUP_WIRING_CMD" \
  --arg eager "$CLEANUP_EAGER_CMD" \
  --arg typecheck "$CLEANUP_TYPECHECK_CMD" \
  --arg lint "$CLEANUP_LINT_CMD" \
  --arg lintcfg "$CLEANUP_LINTCFG_CMD" \
  --arg build "$CLEANUP_BUILD_CMD" \
  --arg test "$CLEANUP_TEST_CMD" \
  --arg drift "$CLEANUP_DRIFT_CMD" \
  --arg custody "$CLEANUP_CUSTODY_CMD" \
  --arg reconcile "$CLEANUP_RECONCILE_CMD" \
  --arg knip "pnpm dlx $CLEANUP_KNIP_VERSION" \
  --arg knip_spa_args "$CLEANUP_KNIP_SPA_ARGS" \
  --arg knip_srv_args "$CLEANUP_KNIP_SRV_ARGS" \
  --arg jscpd "pnpm dlx $CLEANUP_JSCPD_VERSION $CLEANUP_JSCPD_ARGS" \
  --argjson loc "${LOC:-0}" \
  --argjson files "${FILES:-0}" \
  --arg bundle_kb "$BUNDLE_KB" \
  --arg clones "$CLONES" \
  --arg dup_pct "$DUP_PCT" \
  --argjson knip_unused_files "${KNIP_FILES:-0}" \
  --argjson knip_unused_exports "${KNIP_EXPORTS:-0}" \
  --argjson knip_unused_deps "${KNIP_DEPS:-0}" \
  '{date:$date, toolchain:{node:$node, pnpm:$pnpm}, app:$app, base_sha:$base_sha, branch:$branch,
    scope:{app_dir:$app_dir, spa_dir:$spa_dir, srv_dir:$srv_dir, state_dir:$state_dir},
    commands:{install:$install, toolchain:$toolchain, wiring:$wiring, eager:$eager,
              typecheck:$typecheck, lint:$lint, lintcfg:$lintcfg, build:$build,
              test:$test, drift:$drift, custody:$custody, reconcile:$reconcile},
    scanners:{knip:$knip, knip_spa_args:$knip_spa_args, knip_srv_args:$knip_srv_args, jscpd:$jscpd},
    metrics:{loc:$loc, source_files:$files, bundle_kb:$bundle_kb, clones:$clones,
             duplication_pct:$dup_pct, knip_unused_files:$knip_unused_files,
             knip_unused_exports:$knip_unused_exports, knip_unused_dependencies:$knip_unused_deps},
    tests:"green",
    raw:{knip_spa:"knip-spa-baseline.json",
         knip_srv:(if $knip_srv_args == "" then null else "knip-srv-baseline.json" end),
         jscpd:"jscpd-baseline/jscpd-report.json"}}' > "$STATE/baseline.json"

cat <<EOF

BASELINE OK — $CLEANUP_APP_SLUG
  branch      $BRANCH
  base sha    $BASE_SHA
  gate        toolchain, wiring, eager, typecheck, lint, lintcfg, build, tests, drift — all green
  metrics     ${LOC} LOC in ${FILES} source files, bundle ${BUNDLE_KB} KB,
              knip: ${KNIP_FILES} unused file(s) / ${KNIP_EXPORTS} unused export(s) / ${KNIP_DEPS} unused dep(s),
              jscpd: ${CLONES} clone(s), ${DUP_PCT}% duplicated
  state       $STATE/baseline.json

Next: /cleanup-audit${CLEANUP_APP:+ {\"app\":\"$CLEANUP_APP\"\}}  (first run: pilot ONE
      subdirectory via an additional "target" arg inside $CLEANUP_APP_DIR/src)
EOF
