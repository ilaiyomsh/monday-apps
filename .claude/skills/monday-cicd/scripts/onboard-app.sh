#!/bin/bash
# onboard-app.sh — wire one client-side app into the monday-apps monorepo pipeline.
#
# Copies the app source into apps/<name>/, normalizes its scripts, instantiates
# the two per-app deploy workflows from templates, sets the APP_<NAME>_ID secret,
# rehearses the CI gate locally, and commits everything on a feature branch.
# It does NOT open the PR — it prints the exact command for the agent/user.
#
# Usage: onboard-app.sh --app <source dir> --id <monday app id>
#        [--repo owner/name] [--dir monorepo-path] [--dist <dir>] [--branch <name>] [--force-copy]
#        [--name <workflow/secret name>] [--dest <subpath under apps/>]
#        [--shared-paths <comma-separated extra path globs for the deploy triggers>]
#        [--no-push] [--no-secret]
#
# Nested-system support (e.g. the Axis multi-app system):
#   --dest axis/planner            → source lands at apps/axis/planner/
#   --name axis-planner            → workflows deploy-{draft,live}-axis-planner.yml, secret APP_AXIS_PLANNER_ID
#   --shared-paths "apps/axis/services/**"
#                                  → a change to the system's shared services deploys this app too
#   The nested parent glob (e.g. "apps/axis/*") must already be in the monorepo's
#   pnpm-workspace.yaml — this script verifies and fails loudly if it is not.
set -euo pipefail

REPO="ilaiyomsh/monday-apps"
# Skill root: this script lives at <skill>/scripts/, so one level up.
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Monorepo working copy: the repo this skill is checked into (the skill lives at
# <repo-root>/.claude/skills/monday-cicd). Override with --dir.
DIR="$(git -C "$SKILL_DIR" rev-parse --show-toplevel 2>/dev/null || (cd "$SKILL_DIR/../../.." && pwd))"
APP_SRC=""; APP_ID=""; DIST=""; BRANCH=""; FORCE_COPY=0; TYPE=""; NAME_OVERRIDE=""; DEST=""; SHARED_PATHS="packages/shared/**"; PUSH=1; SET_SECRET=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app) APP_SRC="$2"; shift 2 ;;
    --id) APP_ID="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --dir) DIR="$2"; shift 2 ;;
    --dist) DIST="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --type) TYPE="$2"; shift 2 ;;   # client | server (auto-detected if omitted)
    --name) NAME_OVERRIDE="$2"; shift 2 ;;
    --dest) DEST="$2"; shift 2 ;;
    --shared-paths) SHARED_PATHS="packages/shared/**,$2"; shift 2 ;;
    --force-copy) FORCE_COPY=1; shift ;;
    --no-push) PUSH=0; shift ;;
    --no-secret) SET_SECRET=0; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
[[ -z "$TYPE" || "$TYPE" == "client" || "$TYPE" == "server" ]] || { echo "ERROR: --type must be client or server" >&2; exit 2; }
[[ -n "$APP_SRC" && -n "$APP_ID" ]] || { echo "ERROR: --app and --id are required" >&2; exit 2; }
[[ -d "$APP_SRC" ]] || { echo "ERROR: source dir not found: $APP_SRC" >&2; exit 2; }
[[ "$APP_ID" =~ ^[0-9]+$ ]] || { echo "ERROR: --id must be the numeric monday App ID" >&2; exit 2; }
git -C "$DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "ERROR: monorepo not found at $DIR — run bootstrap-monorepo.sh first" >&2; exit 2; }

TPL="$SKILL_DIR/templates"

# ---- 1. Names -----------------------------------------------------------------
NAME="${NAME_OVERRIDE:-$(basename "$APP_SRC" | tr '[:upper:]' '[:lower:]' | tr ' _' '--' | tr -cd 'a-z0-9-')}"
DEST="${DEST:-$NAME}"
[[ "$DEST" =~ ^[a-z0-9/-]+$ && "$DEST" != /* && "$DEST" != *..* ]] || { echo "ERROR: --dest must be a relative lowercase subpath under apps/ (got: $DEST)" >&2; exit 2; }
SECRET_NAME="APP_$(tr '[:lower:]-' '[:upper:]_' <<<"$NAME")_ID"
BRANCH="${BRANCH:-feature/onboard-$NAME}"
echo ">> app: $NAME | dest: apps/$DEST | secret: $SECRET_NAME | branch: $BRANCH"

# Nested dest → the workspace glob must already cover it, or CI silently skips the app.
if [[ "$DEST" == */* ]]; then
  PARENT_GLOB="apps/${DEST%/*}/*"
  grep -qF -- "\"$PARENT_GLOB\"" "$DIR/pnpm-workspace.yaml" || grep -qF -- "- $PARENT_GLOB" "$DIR/pnpm-workspace.yaml" || {
    echo "ERROR: pnpm-workspace.yaml lacks the nested glob \"$PARENT_GLOB\" — add it first (scaffolding PR), then rerun" >&2; exit 2; }
fi

# ---- 2. Feature branch from develop --------------------------------------------
cd "$DIR"
git fetch origin >/dev/null 2>&1 || true
BASE=develop
git rev-parse --verify develop >/dev/null 2>&1 || { BASE=main; echo "WARN: no develop branch, branching from main"; }
if git rev-parse --verify "$BRANCH" >/dev/null 2>&1; then
  git checkout "$BRANCH" >/dev/null 2>&1
  echo ">> [skip] branch $BRANCH exists, reusing"
else
  git checkout -b "$BRANCH" "$BASE" >/dev/null 2>&1
  echo ">> [done] branch $BRANCH created from $BASE"
fi

# ---- 3. Copy app source ---------------------------------------------------------
TARGET="$DIR/apps/$DEST"
if [[ -d "$TARGET" && $FORCE_COPY -eq 0 ]]; then
  echo ">> [skip] $TARGET already exists (use --force-copy to overwrite)"
else
  node - "$APP_SRC" "$TARGET" "$DIR/apps" <<'EOF'
const fs = require('fs');
const path = require('path');
const [source, target, appsRoot] = process.argv.slice(2).map((value) => path.resolve(value));
if (!target.startsWith(`${appsRoot}${path.sep}`)) {
  process.stderr.write(`ERROR: refusing to replace target outside apps/: ${target}\n`);
  process.exit(2);
}
const excludedNames = new Set(['.git', 'node_modules', 'dist', 'build', '.DS_Store']);
const shouldCopy = (candidate) => {
  if (candidate === source) return true;
  const relative = path.relative(source, candidate);
  const parts = relative.split(path.sep);
  if (parts.some((part) => excludedNames.has(part))) return false;
  const basename = path.basename(candidate);
  return basename !== '.env' && !basename.startsWith('.env.');
};
fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.cpSync(source, target, { recursive: true, filter: shouldCopy });
EOF
  echo ">> [done] source copied to apps/$DEST/ (git, node_modules, builds, env excluded)"
fi

# ---- 4. Normalize package.json ---------------------------------------------------
node - "$TARGET/package.json" <<'EOF'
const fs = require('fs');
const path = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
const scripts = pkg.scripts ||= {};
if (!scripts.build) {
  process.stderr.write('ERROR: app has no build script - cannot onboard (the pipeline deploys build output)\n');
  process.exit(1);
}
scripts.lint ||= 'echo no-lint-configured';
scripts['type-check'] ||= 'echo no-typescript';
fs.writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
process.stdout.write('>> [done] scripts normalized (build present, lint/type-check stubs ensured)\n');
EOF

# ---- 5. Detect dist dir ----------------------------------------------------------
if [[ -z "$DIST" ]]; then
  DIST="$(node - "$TARGET" <<'EOF'
const fs = require('fs');
const path = require('path');
const target = process.argv[2];
let out = 'dist';
for (const name of fs.readdirSync(target).filter((entry) => /^vite\.config\./.test(entry))) {
  const text = fs.readFileSync(path.join(target, name), 'utf8');
  const match = text.match(/outDir\s*:\s*['\"]([^'\"]+)['\"]/);
  if (match) out = match[1];
}
process.stdout.write(out);
EOF
)"
fi
echo ">> dist dir: $DIST"

# ---- 6. App type: client-side (CDN, -c) vs server-side (monday-code) ---------------
# The ONLY deploy difference between the two is the -c flag on code:push.
if [[ -z "$TYPE" ]]; then
  if grep -q -- '--client-side\|code:push.*-c ' "$APP_SRC/package.json" 2>/dev/null; then
    TYPE=client
  elif grep -q '"@mondaycom/apps-sdk"' "$APP_SRC/package.json" 2>/dev/null; then
    TYPE=server
  else
    TYPE=client
  fi
  echo ">> app type auto-detected: $TYPE (override with --type client|server)"
else
  echo ">> app type (explicit): $TYPE"
fi
PUSH_FLAGS="-c"; [[ "$TYPE" == "server" ]] && PUSH_FLAGS=""

# ---- 7. Instantiate per-app workflows ---------------------------------------------
# Path occurrences (apps/__APP_NAME__) resolve to apps/$DEST; bare __APP_NAME__
# (workflow/job/concurrency names) resolves to $NAME. The template's single
# "packages/shared/**" trigger line expands to every glob in $SHARED_PATHS —
# for nested systems this is what makes a shared-services change deploy the app.
for kind in draft live; do
  WF="$DIR/.github/workflows/deploy-$kind-$NAME.yml"
  TPL_FILE="$TPL/deploy-$kind.yml" WF_OUT="$WF" NAME="$NAME" DEST="$DEST" \
  SECRET_NAME="$SECRET_NAME" DIST="$DIST" PUSH_FLAGS="$PUSH_FLAGS" SHARED_PATHS="$SHARED_PATHS" \
  node <<'EOF'
const fs = require('fs');
const template = fs.readFileSync(process.env.TPL_FILE, 'utf8');
const shared = process.env.SHARED_PATHS.split(',').map((value) => value.trim()).filter(Boolean);
const sharedBlock = shared.map((glob) => `      - "${glob}"`).join('\n');
const output = template
  .replace('      - "packages/shared/**"', sharedBlock)
  .replaceAll('apps/__APP_NAME__', `apps/${process.env.DEST}`)
  .replaceAll('__APP_NAME__', process.env.NAME)
  .replaceAll('__APP_ID_SECRET__', process.env.SECRET_NAME)
  .replaceAll('__DIST_DIR__', process.env.DIST)
  .replaceAll('__PUSH_FLAGS__', process.env.PUSH_FLAGS);
fs.writeFileSync(process.env.WF_OUT, output);
EOF
  echo ">> [done] $(basename "$WF") ($TYPE-side)"
done

# ---- 7. App ID secret --------------------------------------------------------------
if [[ $SET_SECRET -eq 1 ]]; then
  gh secret set "$SECRET_NAME" --repo "$REPO" --body "$APP_ID"
  echo ">> [done] secret $SECRET_NAME set on $REPO"
else
  echo ">> [skip] --no-secret requested; set $SECRET_NAME on $REPO before merging"
fi

# ---- 8. Standing-draft check (incident-verified quirk) ------------------------------
# A plain code:push FAILS when the app's latest version is live (no draft on top).
# The pipeline needs a standing draft version to exist.
if command -v mapps >/dev/null 2>&1; then
  if mapps app-version:list -i "$APP_ID" 2>/dev/null | grep -q "'draft'"; then
    echo ">> [ok] a draft version exists — deploy-draft will target it"
  else
    echo ">> [WARN] NO DRAFT VERSION — the first deploy-draft run will FAIL."
    echo "          Create one first (new draft on top of live), from a user-writable dir:"
    echo "            mapps manifest:export -a $APP_ID -p ./manifest-$NAME     # creates DIR with manifest.json"
    echo "            mapps manifest:import -a $APP_ID --manifestPath ./manifest-$NAME/manifest.json"
    echo "          (or Developer Center -> App versions -> New version)"
  fi
else
  echo ">> [WARN] mapps CLI not found — verify a draft version exists before merging"
fi

# ---- 9. Local gate rehearsal ---------------------------------------------------------
echo ">> rehearsing CI gate locally..."
pnpm install >/dev/null
pnpm --filter "./apps/$DEST" run type-check
pnpm --filter "./apps/$DEST" run lint
pnpm --filter "./apps/$DEST" run build
echo ">> [done] local type-check + lint + build all pass"

# ---- 10. Commit + push ----------------------------------------------------------------
git add -A
if git diff --cached --quiet; then
  echo ">> [skip] nothing new to commit"
else
  git commit -m "chore: onboard $NAME into the pipeline

- app source under apps/$DEST (dist: $DIST)
- deploy-draft-$NAME.yml / deploy-live-$NAME.yml
- App ID in GitHub secret $SECRET_NAME

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" >/dev/null
  echo ">> [done] committed"
fi
if [[ $PUSH -eq 1 ]]; then
  git push -u origin "$BRANCH" >/dev/null 2>&1
  echo ">> [done] pushed $BRANCH"
else
  echo ">> [skip] --no-push requested; branch remains local"
fi

# ---- Next steps -------------------------------------------------------------------------
cat <<NEXT

==================== next steps ====================
1. Open the PR (agent may run this):
   gh pr create --repo $REPO --base develop --head $BRANCH \\
     --title "Onboard $NAME into the pipeline" --body "Adds apps/$DEST + per-app deploy workflows."
2. CI (Gate 1) must pass, then merge to develop.
3. Watch the draft deploy:  gh run list --repo $REPO --workflow deploy-draft-$NAME.yml
4. Confirm the draft advanced:  mapps app-version:list -i $APP_ID
====================================================
NEXT
