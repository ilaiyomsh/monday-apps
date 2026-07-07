#!/bin/bash
# bootstrap-monorepo.sh — one-time creation of the monday-apps monorepo.
#
# Local skeleton always runs (idempotent). Account-level actions are gated
# behind explicit flags so an agent can ask the user once, then run:
#   --create-remote   gh repo create + push both branches
#   --set-protection  branch protection: 5 rules on main, status-check on develop
#   --all             both of the above
#
# The MONDAY_TOKEN secret is deliberately NOT set by this script: reading the
# local token store is denied to agents by permission rules. The script prints
# the exact interactive command; the USER runs it and pastes the token when
# gh prompts. The value never passes through an agent.
#
# Usage: bootstrap-monorepo.sh [--repo owner/name] [--dir path] [--public] [--all|flags...]
set -euo pipefail

REPO="ilaiyomsh/monday-apps"
# Skill root: this script lives at <skill>/scripts/, so one level up.
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Monorepo working copy: the repo this skill is checked into (the skill lives at
# <repo-root>/.claude/skills/monday-cicd). Pass --dir to create/target another path.
DIR="$(git -C "$SKILL_DIR" rev-parse --show-toplevel 2>/dev/null || (cd "$SKILL_DIR/../../.." && pwd))"
VISIBILITY="--private"
DO_REMOTE=0; DO_PROTECT=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --dir) DIR="$2"; shift 2 ;;
    --public) VISIBILITY="--public"; shift ;;
    --create-remote) DO_REMOTE=1; shift ;;
    --set-protection) DO_PROTECT=1; shift ;;
    --all) DO_REMOTE=1; DO_PROTECT=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

TPL="$SKILL_DIR/templates"
SUMMARY=()
note() { echo ">> $1"; SUMMARY+=("$1"); }

# ---- 1. Local skeleton -------------------------------------------------------
if [[ -d "$DIR/.git" && -f "$DIR/pnpm-workspace.yaml" ]]; then
  note "[skip] local monorepo already exists at $DIR"
else
  mkdir -p "$DIR/apps" "$DIR/packages/shared/src" "$DIR/.github/workflows"
  cp "$TPL/package.json"        "$DIR/package.json"
  cp "$TPL/pnpm-workspace.yaml" "$DIR/pnpm-workspace.yaml"
  cp "$TPL/gitignore"           "$DIR/.gitignore"
  cp "$TPL/monorepo-CLAUDE.md"  "$DIR/CLAUDE.md"
  cp "$TPL/ci.yml"              "$DIR/.github/workflows/ci.yml"
  cp "$TPL/shared-package.json" "$DIR/packages/shared/package.json"
  [[ -f "$DIR/packages/shared/src/index.js" ]] || echo "// shared code entry point" > "$DIR/packages/shared/src/index.js"
  touch "$DIR/apps/.gitkeep"
  git -C "$DIR" init -b main >/dev/null
  note "[done] local skeleton created at $DIR"
fi

# ---- 2. Initial commit on main + develop branch ------------------------------
cd "$DIR"
if [[ -n "$(git log -1 --format=%H 2>/dev/null || true)" ]]; then
  note "[skip] main already has commits"
else
  git add -A
  git commit -m "chore: bootstrap monorepo skeleton (ci gate, workspaces, shared package)" >/dev/null
  note "[done] initial commit on main"
fi
if git rev-parse --verify develop >/dev/null 2>&1; then
  note "[skip] develop branch exists"
else
  git branch develop main
  note "[done] develop branch created from main"
fi

# ---- 3. Remote ----------------------------------------------------------------
if [[ $DO_REMOTE -eq 1 ]]; then
  if gh repo view "$REPO" >/dev/null 2>&1; then
    note "[skip] remote $REPO already exists"
    git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$REPO.git"
  else
    gh repo create "$REPO" $VISIBILITY --source . --push >/dev/null
    note "[done] remote $REPO created ($VISIBILITY)"
  fi
  git push -u origin main >/dev/null 2>&1 && note "[done] pushed main" || note "[skip] main already pushed"
  git push -u origin develop >/dev/null 2>&1 && note "[done] pushed develop" || note "[skip] develop already pushed"
else
  note "[gated] remote creation skipped (run with --create-remote)"
fi

# ---- 4. Branch protection ------------------------------------------------------
# Context string must match the CI job's display name in ci.yml.
CI_CONTEXT="type-check, lint, build"
protect() {
  local branch="$1" payload="$2" label="$3"
  local tmp; tmp="$(mktemp)"; printf '%s' "$payload" > "$tmp"
  local out
  if out=$(gh api -X PUT "repos/$REPO/branches/$branch/protection" --input "$tmp" 2>&1); then
    note "[done] protection set on $branch ($label)"
  else
    if grep -qi "upgrade" <<<"$out"; then
      note "[WARN] protection on $branch REFUSED — likely free plan + private repo."
      echo "       Options: make the repo public, upgrade to GitHub Pro, or rely on team discipline." >&2
    else
      note "[WARN] protection on $branch failed: $(head -c 200 <<<"$out")"
    fi
  fi
  rm -f "$tmp"
}
if [[ $DO_PROTECT -eq 1 ]]; then
  protect main "{
    \"required_status_checks\": {\"strict\": true, \"contexts\": [\"$CI_CONTEXT\"]},
    \"enforce_admins\": true,
    \"required_pull_request_reviews\": {\"required_approving_review_count\": 1},
    \"restrictions\": null,
    \"allow_force_pushes\": false,
    \"allow_deletions\": false
  }" "PR + 1 approval + checks + up-to-date + no admin bypass"
  protect develop "{
    \"required_status_checks\": {\"strict\": false, \"contexts\": [\"$CI_CONTEXT\"]},
    \"enforce_admins\": false,
    \"required_pull_request_reviews\": null,
    \"restrictions\": null
  }" "status checks only, no approval"
else
  note "[gated] branch protection skipped (run with --set-protection)"
fi

# ---- Summary -------------------------------------------------------------------
echo
echo "==================== bootstrap summary ===================="
printf ' - %s\n' "${SUMMARY[@]}"
echo "============================================================"
echo
echo "USER-ONLY step still required — set the deploy token secret."
echo "Run this yourself in a terminal and paste the token when prompted:"
echo
echo "    gh secret set MONDAY_TOKEN --repo $REPO"
echo
echo "(An agent must never read or handle the token value.)"
echo "Next step: onboard an app —"
echo "  $(dirname "$0")/onboard-app.sh --app <path> --id <monday app id>"
