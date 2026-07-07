#!/bin/bash
# verify-pipeline.sh — read-only health check of the monorepo pipeline wiring.
# Never prints secret values (names only). Exits nonzero if any FAIL.
#
# Usage: verify-pipeline.sh [--repo owner/name] [--dir path] [--app <name> --id <monday app id>]
set -uo pipefail

REPO="ilaiyomsh/monday-apps"
# Skill root: this script lives at <skill>/scripts/, so one level up.
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Monorepo working copy: the repo this skill is checked into (the skill lives at
# <repo-root>/.claude/skills/monday-cicd). Override with --dir.
DIR="$(git -C "$SKILL_DIR" rev-parse --show-toplevel 2>/dev/null || (cd "$SKILL_DIR/../../.." && pwd))"
APP=""; APP_MONDAY_ID=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --dir) DIR="$2"; shift 2 ;;
    --app) APP="$2"; shift 2 ;;
    --id) APP_MONDAY_ID="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

FAILS=0
pass() { echo "PASS  $1"; }
warn() { echo "WARN  $1"; [[ -n "${2:-}" ]] && echo "      fix: $2"; }
fail() { echo "FAIL  $1"; [[ -n "${2:-}" ]] && echo "      fix: $2"; FAILS=$((FAILS+1)); }

# ---- 1. Local monorepo ----------------------------------------------------------
if [[ -d "$DIR/.git" && -f "$DIR/pnpm-workspace.yaml" && -f "$DIR/.github/workflows/ci.yml" ]]; then
  pass "local monorepo at $DIR (git + workspace + ci.yml)"
else
  fail "no monorepo found at $DIR" "run bootstrap-monorepo.sh (Mode 1)"
  echo; echo "no monorepo found — remaining checks skipped"; exit 1
fi

# ---- 2. Remote + branches --------------------------------------------------------
if gh repo view "$REPO" >/dev/null 2>&1; then
  pass "remote $REPO exists"
  for b in main develop; do
    if gh api "repos/$REPO/branches/$b" --jq .name >/dev/null 2>&1; then
      pass "remote branch $b exists"
    else
      fail "remote branch $b missing" "git push -u origin $b"
    fi
  done
  BEHIND=$(gh api "repos/$REPO/compare/main...develop" --jq .behind_by 2>/dev/null || echo "?")
  if [[ "$BEHIND" == "0" ]]; then
    pass "develop is not behind main"
  elif [[ "$BEHIND" == "?" ]]; then
    warn "could not compare main...develop"
  else
    fail "develop is $BEHIND commits behind main (spec: develop >= main, always)" "merge main back into develop (hotfix rule)"
  fi
else
  fail "remote $REPO not found" "bootstrap-monorepo.sh --create-remote"
fi

# ---- 3. Branch protection ----------------------------------------------------------
PROT=$(gh api "repos/$REPO/branches/main/protection" 2>&1)
if grep -q '"required_pull_request_reviews"' <<<"$PROT"; then
  pass "main branch protection present (PR reviews required)"
  grep -q '"enforce_admins":{"enabled":true' <<<"$PROT" || grep -q '"enabled": *true' <<<"$(grep -o '"enforce_admins":[^}]*}' <<<"$PROT")" \
    && pass "main protection applies to admins" \
    || warn "main protection does NOT bind admins" "enable 'Do not allow bypassing' in Settings -> Branches"
else
  warn "main branch protection missing/unreadable (403/404 = free plan + private repo?)" \
       "set in GitHub Settings -> Branches, or bootstrap-monorepo.sh --set-protection"
fi

# ---- 4. Secrets (names only) ---------------------------------------------------------
SECRETS=$(gh secret list --repo "$REPO" 2>/dev/null | awk '{print $1}')
grep -qx "MONDAY_TOKEN" <<<"$SECRETS" \
  && pass "secret MONDAY_TOKEN present" \
  || fail "secret MONDAY_TOKEN missing" "USER runs: gh secret set MONDAY_TOKEN --repo $REPO (paste token when prompted)"
for appdir in "$DIR"/apps/*/; do
  [[ -d "$appdir" ]] || continue
  a=$(basename "$appdir")
  s="APP_$(tr '[:lower:]-' '[:upper:]_' <<<"$a")_ID"
  grep -qx "$s" <<<"$SECRETS" \
    && pass "secret $s present (app: $a)" \
    || fail "secret $s missing (app: $a)" "gh secret set $s --repo $REPO --body <APP_ID>"
done

# ---- 5. Per-app workflows --------------------------------------------------------------
check_app_workflows() {
  local a="$1"
  local d="$DIR/.github/workflows/deploy-draft-$a.yml"
  local l="$DIR/.github/workflows/deploy-live-$a.yml"
  for f in "$d" "$l"; do
    [[ -f "$f" ]] || { fail "$(basename "$f") missing" "re-run onboard-app.sh for $a"; return; }
  done
  grep -q "code:push" "$d" \
    && pass "deploy-draft-$a.yml runs code:push" \
    || fail "deploy-draft-$a.yml missing code:push"
  # Client flag (-c) must be CONSISTENT between draft and live — client-side
  # apps have it in both, server-side (monday-code) apps in neither.
  D_CLIENT=$(grep -vE '^\s*#' "$d" | grep -cE 'code:push.* -c( |$)|--client-side' || true)
  L_CLIENT=$(grep -vE '^\s*#' "$l" | grep -cE 'code:push.* -c( |$)|--client-side' || true)
  if [[ "$D_CLIENT" == "$L_CLIENT" ]]; then
    [[ "$D_CLIENT" -gt 0 ]] && pass "app $a: client-side push (-c) in both workflows" \
                            || pass "app $a: server-side push (no -c) in both workflows"
  else
    fail "app $a: draft/live workflows disagree on the -c flag" "both must match the app's type (client=with -c, server=without)"
  fi
  grep -vE '^\s*#' "$d" | grep -qE -- '(--force|-f )' \
    && fail "deploy-draft-$a.yml contains --force (draft deploy must NOT force!)" "remove --force from the draft workflow" \
    || pass "deploy-draft-$a.yml has no --force"
  grep -vE '^\s*#' "$l" | grep -q -- '--force' \
    && pass "deploy-live-$a.yml uses --force (live deploy)" \
    || fail "deploy-live-$a.yml missing --force" "live deploys must force-push to the live version"
  grep -q "apps/$a/\*\*" "$d" \
    && pass "deploy-draft-$a.yml path filter targets apps/$a/" \
    || fail "deploy-draft-$a.yml path filter mismatch" "paths must include apps/$a/** and packages/shared/**"
}
if [[ -n "$APP" ]]; then
  check_app_workflows "$APP"
else
  for appdir in "$DIR"/apps/*/; do
    [[ -d "$appdir" ]] || continue
    check_app_workflows "$(basename "$appdir")"
  done
fi

# ---- 6. Release freeze -------------------------------------------------------------------
RELEASE_PR=$(gh pr list --repo "$REPO" --base main --state open --json number,headRefName --jq '.[0].number' 2>/dev/null)
if [[ -n "$RELEASE_PR" ]]; then
  warn "RELEASE FREEZE ACTIVE: PR #$RELEASE_PR into main is open" \
       "do NOT merge anything into develop until PR #$RELEASE_PR is merged/closed"
else
  pass "no open release PR — merges into develop are allowed"
fi

# ---- 7. monday versions (optional) ----------------------------------------------------------
if [[ -n "$APP_MONDAY_ID" ]] && command -v mapps >/dev/null 2>&1; then
  echo "---- monday versions for app $APP_MONDAY_ID ----"
  mapps app-version:list -i "$APP_MONDAY_ID" 2>/dev/null | grep -E "id|live|draft|deprecated" | head -10
  DRAFT_ID=$(mapps app-version:list -i "$APP_MONDAY_ID" 2>/dev/null | awk -F'│' '/draft/ {gsub(/ /,"",$3); print $3; exit}')
  if [[ -n "$DRAFT_ID" ]]; then
    pass "a standing draft version exists ($DRAFT_ID)"
    # Dev-live leftover check: a draft feature pointing at a tunnel means someone
    # forgot to detach — redeploys do NOT clear it (incident-verified).
    if mapps app-features:list -a "$APP_MONDAY_ID" -i "$DRAFT_ID" 2>/dev/null | grep -q "apps-tunnel"; then
      fail "draft feature still points at a DEV TUNNEL (dev-live not detached)" \
           "run dev-live-detach.sh --app $APP — draft testing is broken until then"
    else
      pass "no dev-tunnel binding left on the draft"
    fi
  else
    fail "no draft version — deploy-draft will fail" "manifest:export then manifest:import -a $APP_MONDAY_ID (see SKILL.md standing-draft step)"
  fi
fi

# ---- 8. Last workflow runs --------------------------------------------------------------------
if [[ -n "$APP" ]]; then
  for wf in "deploy-draft-$APP.yml" "deploy-live-$APP.yml"; do
    LAST=$(gh run list --repo "$REPO" --workflow "$wf" -L 1 --json conclusion,updatedAt --jq '.[0] | "\(.conclusion) (\(.updatedAt))"' 2>/dev/null)
    [[ -n "$LAST" && "$LAST" != "null"* ]] && echo "INFO  last $wf run: $LAST" || echo "INFO  $wf has no runs yet"
  done
fi

echo
if [[ $FAILS -eq 0 ]]; then
  echo "verify-pipeline: ALL CHECKS PASSED"
else
  echo "verify-pipeline: $FAILS FAILURE(S) — see fix hints above"
  exit 1
fi
