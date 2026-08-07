#!/usr/bin/env bash
# Cleanup gate step: each workspace's EFFECTIVE eslint config must be able to see a
# dangling identifier. This is a capability check on the gate itself, not a lint run.
#
# Why this exists: both 2026-08-05 cleanup rounds were shaped by one gap — the SPA's
# eslint had neither no-undef nor no-unused-vars, so a bad move/split edit (the exact
# shape of every L-risk batch) could ship a ReferenceError with lint, build and tests
# all green. Two structure findings were struck for precisely that risk, and the
# stage-3 reviewer hand-scanned 41 files for dangling imports because no tool could.
# The rules are cheap; what rotted was nobody noticing their absence. This step makes
# a green gate REFUSE to certify a codebase whose lint cannot see the failure mode
# cleanup is most likely to produce.
#
# Checks, per workspace, via `eslint --print-config` on a real source file:
#   no-undef        = error      (a moved-away symbol still referenced → lint-red)
#   no-unused-vars  = error      (a dangling import left behind → lint-red)
# and for the JSX workspace additionally:
#   react/jsx-uses-vars = error  (component imports used only in JSX are NOT unused)
#   react/jsx-no-undef  = error  (an undefined JSX tag is exactly A-structure-02's bug)
#
# Run from the repo root:  bash scripts/cleanup/lint-config-audit.sh
set -uo pipefail

cd "$(git rev-parse --show-toplevel)" || { echo "FATAL: not inside a git repo"; exit 1; }
# shellcheck source=./cleanup-env.sh
. scripts/cleanup/cleanup-env.sh

command -v jq >/dev/null 2>&1 || { echo "FATAL: jq is required"; exit 1; }

fail=0

# severity_of <print-config-json> <rule> → "error" | "warn" | "off" | "missing"
severity_of() {
  jq -r --arg rule "$2" '
    .rules[$rule] as $r
    | if $r == null then "missing"
      else ($r | if type == "array" then .[0] else . end)
           | if . == 2 or . == "error" then "error"
             elif . == 1 or . == "warn" then "warn"
             else "off" end
      end' <<<"$1"
}

check_workspace() { # $1 = workspace dir, $2 = sample glob dir, $3 = "jsx"|"js"
  local ws="$1" sample kind="$3" cfg rule sev missing=0
  sample=$(git ls-files "$2" | grep -E "\.${kind}$" | grep -vE '\.(test|spec)\.' | head -1)
  if [ -z "$sample" ]; then
    echo "FAIL: [$ws] no .$kind source file found under $2 to probe the config with."
    return 1
  fi
  # --print-config resolves the same config `pnpm --filter <ws> lint` would use.
  cfg=$( (cd "$ws" && ./node_modules/.bin/eslint --print-config "${sample#"$ws"/}") 2>&1 ) || {
    echo "FAIL: [$ws] eslint --print-config errored:"
    echo "$cfg" | head -5 | sed 's/^/      /'
    return 1
  }

  local rules="no-undef no-unused-vars"
  [ "$kind" = "jsx" ] && rules="$rules react/jsx-uses-vars react/jsx-no-undef"
  for rule in $rules; do
    sev=$(severity_of "$cfg" "$rule")
    if [ "$sev" != "error" ]; then
      echo "FAIL: [$ws] $rule is '$sev' for $sample — it must be 'error'."
      missing=1
    fi
  done
  if [ "$missing" -ne 0 ]; then
    echo "      A cleanup gate without these rules cannot see a dangling identifier: a moved"
    echo "      symbol or leftover import passes lint, build AND tests on any untested path."
    echo "      Fix the workspace's eslint config (see the SPA's eslintConfig in package.json"
    echo "      for the reference shape), then re-run. Do NOT proceed with cleanup batches."
    return 1
  fi
  echo "lint-config OK — $ws ($rules)"
}

check_workspace "$CLEANUP_SPA_DIR" "$CLEANUP_SPA_DIR/src" jsx || fail=1
check_workspace "$CLEANUP_SRV_DIR" "$CLEANUP_SRV_DIR/src" js  || fail=1

exit "$fail"
