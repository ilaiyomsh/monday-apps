#!/bin/bash
# preflight.sh — session-start / pre-ship sanity checks for a monday app dir.
#
# Run it (read-only, always safe) at the start of any session inside an app
# directory, and again before ship.sh. It never mutates anything — it prints
# findings and the exact remediation commands.
#
# Usage: preflight.sh [dir]   (defaults to cwd)
#
# Checks:
#   1. git repo exists           — if not: offer `git init` + .gitignore NOW,
#                                  not at session end (unversioned trees have
#                                  been deployed to production before).
#   2. pwd is the worktree root  — stray cd's into other worktrees deploy the
#                                  wrong source tree.
#   3. node_modules in THIS worktree — git worktrees do not share it; vite and
#                                  vitest silently can't run without it.
#   4. .change-tracker/project.json path matches this dir (stale after moves).
#   5. .env has APPID/APP_ID (or package.json deploy script carries -a).
#
# Exit 0 = all green. Exit 1 = at least one finding (details printed).

set -uo pipefail

ROOT="$(cd "${1:-.}" 2>/dev/null && pwd -P)" || { echo "preflight: cannot cd to ${1:-.}" >&2; exit 1; }
FAILS=0

ok()   { printf 'OK   %s\n' "$*"; }
warn() { printf 'FAIL %s\n' "$*"; FAILS=$((FAILS+1)); }

echo "== preflight: $ROOT =="

# 1. git repo
TOPLEVEL="$(git -C "$ROOT" rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$TOPLEVEL" ]]; then
  warn "no git repository. Initialize NOW (not at session end):"
  echo "       cd $ROOT && git init && printf 'node_modules/\\nbuild/\\ndist/\\n.env\\n*.log\\n.DS_Store\\n' > .gitignore && git add -A && git commit -m 'initial commit'"
else
  TOPLEVEL="$(cd "$TOPLEVEL" && pwd -P)"
  ok "git repo (toplevel: $TOPLEVEL)"
  # 2. worktree root
  if [[ "$ROOT" == "$TOPLEVEL" ]]; then
    ok "dir is the worktree toplevel"
  else
    warn "dir is NOT the worktree toplevel ($TOPLEVEL). Deploys/builds must run from the toplevel of the intended worktree."
  fi
fi

# 3. node_modules in THIS worktree (only if this is a node project)
if [[ -f "$ROOT/package.json" ]]; then
  if [[ -d "$ROOT/node_modules" ]]; then
    ok "node_modules present in this worktree"
  else
    PM=npm; [[ -f "$ROOT/pnpm-lock.yaml" ]] && PM=pnpm
    warn "node_modules missing in THIS worktree (worktrees do not share it). Run: (cd $ROOT && $PM install)"
  fi
else
  ok "no package.json — skipping node_modules check"
fi

# 4. change-tracker project.json path consistency
CT="$ROOT/.change-tracker/project.json"
if [[ -f "$CT" ]]; then
  CT_PATH="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("path",""))' "$CT" 2>/dev/null || true)"
  if [[ -z "$CT_PATH" ]]; then
    warn ".change-tracker/project.json has no \"path\" field"
  elif [[ "$CT_PATH" == "$ROOT" ]]; then
    ok "change-tracker path matches cwd"
  else
    warn ".change-tracker/project.json path is stale: '$CT_PATH' != '$ROOT' (project was moved?). Update the file before closing changes."
  fi
else
  ok "no .change-tracker/project.json (project not tracked — run /init_project if it should be)"
fi

# 5. app id present
APP_SRC=""
if [[ -f "$ROOT/.env" ]] && grep -qE '^\s*(APPID|APP_ID)\s*=\s*[0-9]+' "$ROOT/.env"; then
  APP_SRC=".env"
fi
if [[ -f "$ROOT/package.json" ]] && grep -qE '(-a|--appId)[= ][0-9]+' "$ROOT/package.json"; then
  APP_SRC="${APP_SRC:+$APP_SRC + }package.json"
fi
if [[ -n "$APP_SRC" ]]; then
  ok "app id found in: $APP_SRC"
  # cross-check for the discussions-style conflict
  if [[ "$APP_SRC" == *"+"* ]]; then
    ENV_ID="$(grep -E '^\s*(APPID|APP_ID)\s*=' "$ROOT/.env" | head -1 | grep -Eo '[0-9]+' | head -1)"
    PKG_ID="$(grep -Eo '(-a|--appId)[= ][0-9]+' "$ROOT/package.json" | head -1 | grep -Eo '[0-9]+' | head -1)"
    if [[ -n "$ENV_ID" && -n "$PKG_ID" && "$ENV_ID" != "$PKG_ID" ]]; then
      warn "app-id CONFLICT: .env says $ENV_ID but package.json deploy scripts say $PKG_ID. ship.sh will use the package.json one; fix the stale value."
    fi
  fi
else
  warn "no app id: neither APPID/APP_ID in .env nor -a/--appId in package.json scripts. ship.sh will refuse to run."
fi

echo "== preflight: $FAILS finding(s) =="
[[ $FAILS -eq 0 ]] && exit 0 || exit 1
