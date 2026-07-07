#!/bin/bash
# ship.sh — the ONLY sanctioned production-deploy path for monday.com apps.
#
# Invoked by the agent AFTER asking the user exactly one question: "לפרוס לפרודקשן?"
# (The script itself never prompts — the gate lives in the conversation, so the
# permission classifier sees one pre-authorized command instead of a surprise
# --force escalation mid-chain.)
#
# Usage:
#   ship.sh [--dry-run] [--allow-dirty] [--app-id <id>] [--live-url <url>]
#
#   --dry-run      Resolve config, run all read-only gates, print the exact
#                  commands that WOULD run. Executes nothing (no build, no
#                  push, no network calls).
#   --allow-dirty  Proceed despite uncommitted changes (they are still listed).
#   --app-id       Override app id resolution.
#   --live-url     CDN base URL of the live app (for verification). Falls back
#                  to LIVE_URL / CDN_URL in .env, then to parsing push output.
#
# What it does, in order:
#   1. Resolve APP_ID / BUILD_DIR / CLIENT_SIDE from package.json deploy
#      scripts, falling back to .env (APPID / APP_ID). Fails loudly if missing.
#   2. Assert pwd == git toplevel of the CURRENT worktree. Never cd anywhere.
#   3. Fail listing uncommitted changes unless --allow-dirty.
#   4. ALWAYS build first (deploy:force does NOT rebuild).
#   5. mapps code:push with --force by default (single-live-version apps).
#   6. Retry exactly once on the transient remote-server error.
#   7. Verify: curl live CDN index.html, diff asset hash vs local build,
#      grep a build marker (git short sha) in the live bundle when available.
#   8. Print the mobile-cache caveat + the verify-live reminder.
#
# Exit codes: 0 ok / dry-run plan printed; 1 gate or resolution failure;
#             2 build failed; 3 push failed; 4 verification mismatch.

set -uo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
ROOT="$(pwd -P)"
DRY_RUN=false
ALLOW_DIRTY=false
APP_ID_OVERRIDE=""
LIVE_URL="${LIVE_URL:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)     DRY_RUN=true; shift ;;
    --allow-dirty) ALLOW_DIRTY=true; shift ;;
    --app-id)      APP_ID_OVERRIDE="${2:-}"; shift 2 ;;
    --live-url)    LIVE_URL="${2:-}"; shift 2 ;;
    *) echo "ship.sh: unknown argument: $1" >&2; exit 1 ;;
  esac
done

say()  { printf '%s\n' "$*"; }
fail() { printf 'SHIP FAILED: %s\n' "$*" >&2; exit "${2:-1}"; }

# ---------------------------------------------------------------- 1. config
# package.json deploy scripts are the ground truth (they are what actually
# deployed until now); .env APPID/APP_ID is the fallback. If both exist and
# disagree, warn loudly and use the package.json value.
CONFIG="$(python3 - "$ROOT" <<'PY'
import json, os, re, sys
root = sys.argv[1]
pkg_app = build_dir = env_app = ""
client = "false"; has_build = "false"; mgr = "npm"
pkg_path = os.path.join(root, "package.json")
if os.path.exists(pkg_path):
    try:
        pkg = json.load(open(pkg_path))
    except Exception:
        pkg = {}
    scripts = pkg.get("scripts", {}) or {}
    if "build" in scripts:
        has_build = "true"
    for name in ("deploy", "deploy:force", "push", "ship"):
        s = scripts.get(name, "") or ""
        m = re.search(r"(?:-a|--appId)[= ]+(\d+)", s)
        if m and not pkg_app:
            pkg_app = m.group(1)
        m = re.search(r"(?:-d|--directoryPath)[= ]+([^\s&|;]+)", s)
        if m and not build_dir:
            build_dir = m.group(1)
        if "--client-side" in s or re.search(r"code:push[^&|;]*(?<!\S)-c(?!\S)", s):
            client = "true"
env_path = os.path.join(root, ".env")
if os.path.exists(env_path):
    for line in open(env_path, errors="replace"):
        m = re.match(r"^\s*(?:APP_ID|APPID)\s*=\s*(\d+)", line)
        if m:
            env_app = m.group(1)
            break
if os.path.exists(os.path.join(root, "pnpm-lock.yaml")):
    mgr = "pnpm"
print("\t".join([pkg_app or "-", env_app or "-", build_dir or "-",
                 client, has_build, mgr]))
PY
)" || fail "could not parse project config (package.json / .env) in $ROOT"

IFS=$'\t' read -r PKG_APP_ID ENV_APP_ID BUILD_DIR CLIENT_SIDE HAS_BUILD PKG_MGR <<< "$CONFIG"
[[ "$PKG_APP_ID" == "-" ]] && PKG_APP_ID=""
[[ "$ENV_APP_ID" == "-" ]] && ENV_APP_ID=""
[[ "$BUILD_DIR"  == "-" ]] && BUILD_DIR=""

APP_ID="${APP_ID_OVERRIDE:-${PKG_APP_ID:-$ENV_APP_ID}}"

if [[ -z "$APP_ID" ]]; then
  fail "no app id found. Looked for -a/--appId in package.json scripts \
(deploy / deploy:force / push / ship) and APPID/APP_ID in .env of $ROOT. \
Add one of those, or pass --app-id <id>."
fi

if [[ -n "$PKG_APP_ID" && -n "$ENV_APP_ID" && "$PKG_APP_ID" != "$ENV_APP_ID" && -z "$APP_ID_OVERRIDE" ]]; then
  say "WARNING: app-id conflict — package.json deploy script says $PKG_APP_ID but .env APPID says $ENV_APP_ID."
  say "         Using $PKG_APP_ID (the id the deploy script has actually been pushing to)."
  say "         Fix the stale one, or pass --app-id to override."
fi

# Live URL fallback from .env
if [[ -z "$LIVE_URL" && -f "$ROOT/.env" ]]; then
  LIVE_URL="$(grep -E '^\s*(LIVE_URL|CDN_URL)\s*=' "$ROOT/.env" | head -1 | sed -E 's/^[^=]+=\s*//; s/["'"'"']//g' || true)"
fi

# ------------------------------------------------------------- 2. worktree
# Wrong-worktree deploys happen when a stray `cd` lands in another checkout.
# We assert and NEVER cd: everything below runs relative to $ROOT.
TOPLEVEL="$(git -C "$ROOT" rev-parse --show-toplevel 2>/dev/null)" \
  || fail "$ROOT is not inside a git repository. Run scripts/preflight.sh — it offers git init + .gitignore. Never deploy an unversioned tree."
TOPLEVEL="$(cd "$TOPLEVEL" && pwd -P)"
if [[ "$ROOT" != "$TOPLEVEL" ]]; then
  fail "pwd ($ROOT) is not the toplevel of the current worktree ($TOPLEVEL). \
cd to the worktree root you intend to ship and re-run. ship.sh never cds for you."
fi

# ---------------------------------------------------------------- 3. dirty
GATE_BLOCKED=false
DIRTY="$(git -C "$ROOT" status --porcelain=v1 2>/dev/null || true)"
if [[ -n "$DIRTY" ]]; then
  say "Uncommitted changes in $ROOT:"
  say "$DIRTY"
  if [[ "$ALLOW_DIRTY" != true ]]; then
    if [[ "$DRY_RUN" == true ]]; then
      say "GATE (dry-run): a real ship would FAIL here — uncommitted tree. Commit first, or use --allow-dirty."
      GATE_BLOCKED=true
    else
      fail "refusing to ship an uncommitted tree ('done' must never be claimed with uncommitted work). Commit first, or re-run with --allow-dirty."
    fi
  else
    say "--allow-dirty set: shipping anyway. Do NOT report 'done' until these are committed."
  fi
fi

GIT_SHA="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo "")"

# ------------------------------------------------------- 3b. error-guard gate
# Retrofitted apps (an .error-guard marker file in the app root) get a BLOCKING
# whole-app audit. Apps not yet retrofitted get a best-effort, NON-blocking
# check on recently changed source files (warning only).
EG_SCRIPTS="$(cd "$SKILL_DIR/.." && pwd -P)/error-guard/scripts"
if [[ -f "$ROOT/.error-guard" ]]; then
  say "== error-guard gate (retrofitted app — blocking audit) =="
  if [[ -f "$EG_SCRIPTS/audit.sh" ]]; then
    if ! bash "$EG_SCRIPTS/audit.sh" "$ROOT"; then
      if [[ "$DRY_RUN" == true ]]; then
        say "GATE (dry-run): a real ship would FAIL here — error-guard audit found violations (see above)."
        GATE_BLOCKED=true
      else
        fail "error-guard audit found violations (see above). This app is retrofitted (.error-guard marker) — fix every finding (each message is the remediation) before shipping. See /error-guard."
      fi
    fi
  else
    say "WARNING: error-guard audit script missing ($EG_SCRIPTS/audit.sh) — gate skipped."
  fi
else
  # Best-effort: check files changed in the last few commits; never blocks.
  EG_CHANGED="$(git -C "$ROOT" diff --name-only HEAD~5 2>/dev/null | grep -E '\.(js|jsx|ts|tsx)$' || true)"
  if [[ -n "$EG_CHANGED" && -f "$EG_SCRIPTS/check.sh" ]]; then
    declare -a EG_FILES=()
    while IFS= read -r egf; do
      [[ -n "$egf" && -f "$ROOT/$egf" ]] && EG_FILES+=("$ROOT/$egf")
    done <<< "$EG_CHANGED"
    if [[ "${#EG_FILES[@]}" -gt 0 ]]; then
      EG_OUT="$(bash "$EG_SCRIPTS/check.sh" "${EG_FILES[@]}" 2>/dev/null || true)"
      if [[ -n "$EG_OUT" ]]; then
        say "WARNING: error-guard violations in recently changed files (non-blocking — app not retrofitted):"
        say "$EG_OUT"
        say "         Fix these, or run '/error-guard retrofit' to make this gate blocking. Continuing."
      fi
    fi
  fi
fi

# ------------------------------------------------------------------- plan
BUILD_CMD=""
if [[ "$HAS_BUILD" == "true" ]]; then
  BUILD_CMD="$PKG_MGR run build"    # always 'run' — bare 'pnpm deploy/build' collides with pnpm builtins
fi
PUSH_CMD=(mapps code:push -a "$APP_ID" --force)
[[ "$CLIENT_SIDE" == "true" ]] && PUSH_CMD+=(--client-side)
[[ -n "$BUILD_DIR" ]] && PUSH_CMD+=(-d "$BUILD_DIR")

say "== ship plan =="
say "  root:        $ROOT (== worktree toplevel: OK)"
say "  app id:      $APP_ID (pkg: ${PKG_APP_ID:-none}, .env: ${ENV_APP_ID:-none})"
say "  client-side: $CLIENT_SIDE"
say "  build dir:   ${BUILD_DIR:-<none>}"
say "  git HEAD:    ${GIT_SHA:-unknown}$( [[ -n "$DIRTY" ]] && echo ' (DIRTY)' )"
say "  1) ${BUILD_CMD:-<no build script — skipping build>}"
say "  2) ${PUSH_CMD[*]}"
say "  3) verify live CDN vs local build (url: ${LIVE_URL:-auto-detect from push output})"

if [[ "$DRY_RUN" == true ]]; then
  if [[ "$GATE_BLOCKED" == true ]]; then
    say "== dry run: nothing executed — a real ship would be BLOCKED (see gate above) =="
    exit 1
  fi
  say "== dry run: nothing executed =="
  exit 0
fi

# ---------------------------------------------------------------- 4. build
# deploy:force does NOT rebuild — shipping without a fresh build once shipped
# a stale build/ directory. So we ALWAYS build.
if [[ -n "$BUILD_CMD" ]]; then
  say "== building ($BUILD_CMD) =="
  ( cd "$ROOT" && $BUILD_CMD ) || fail "build failed — nothing was pushed." 2
else
  say "WARNING: no build script in package.json — pushing the tree as-is."
fi

# ----------------------------------------------------------- 5+6. push (+retry)
TRANSIENT_MSG="Unexpected error occurred while communicating with the remote server"
PUSH_LOG="$(mktemp -t ship-push)"
do_push() {
  ( cd "$ROOT" && "${PUSH_CMD[@]}" ) 2>&1 | tee "$PUSH_LOG"
  return "${PIPESTATUS[0]}"
}
say "== pushing (${PUSH_CMD[*]}) =="
if ! do_push; then
  if grep -qF "$TRANSIENT_MSG" "$PUSH_LOG"; then
    say "Transient remote-server error — retrying exactly once..."
    do_push || fail "push failed twice (transient error persisted). Try again later; do not loop retries." 3
  else
    fail "push failed (not the known transient error) — see output above." 3
  fi
fi

# --------------------------------------------------------------- 7. verify
VERIFY_STATUS="INCOMPLETE"
if [[ -z "$LIVE_URL" ]]; then
  # tolerant parse: first https URL in push output that looks like a CDN/app URL
  LIVE_URL="$(grep -Eo 'https://[a-zA-Z0-9./_-]+' "$PUSH_LOG" | grep -Ei 'cdn|monday' | head -1 || true)"
fi

LOCAL_INDEX=""
[[ -n "$BUILD_DIR" && -f "$ROOT/$BUILD_DIR/index.html" ]] && LOCAL_INDEX="$ROOT/$BUILD_DIR/index.html"

if [[ "$CLIENT_SIDE" == "true" && -n "$LIVE_URL" && -n "$LOCAL_INDEX" ]]; then
  say "== verifying live CDN ($LIVE_URL) =="
  LIVE_BASE="${LIVE_URL%/}"; LIVE_BASE="${LIVE_BASE%/index.html}"
  LIVE_INDEX_CONTENT="$(curl -fsSL "$LIVE_BASE/index.html" 2>/dev/null || curl -fsSL "$LIVE_BASE" 2>/dev/null || true)"
  LOCAL_ASSET="$(grep -Eo 'assets/[A-Za-z0-9._-]+\.js' "$LOCAL_INDEX" | head -1 || true)"
  LIVE_ASSET="$(printf '%s' "$LIVE_INDEX_CONTENT" | grep -Eo 'assets/[A-Za-z0-9._-]+\.js' | head -1 || true)"
  if [[ -n "$LOCAL_ASSET" && "$LOCAL_ASSET" == "$LIVE_ASSET" ]]; then
    VERIFY_STATUS="HASH-MATCH"
    say "  asset hash match: local and live both reference $LOCAL_ASSET"
    # build marker: if the local bundle embeds the git short sha, expect it live too
    if [[ -n "$GIT_SHA" && -f "$ROOT/$BUILD_DIR/$LOCAL_ASSET" ]] && grep -q "$GIT_SHA" "$ROOT/$BUILD_DIR/$LOCAL_ASSET" 2>/dev/null; then
      if curl -fsSL "$LIVE_BASE/$LIVE_ASSET" 2>/dev/null | grep -q "$GIT_SHA"; then
        say "  build marker: git sha $GIT_SHA found in live bundle"
      else
        VERIFY_STATUS="MARKER-MISSING"
        say "  build marker: git sha $GIT_SHA present locally but NOT in live bundle — investigate"
      fi
    fi
  elif [[ -z "$LIVE_INDEX_CONTENT" ]]; then
    say "  could not fetch live index.html from $LIVE_BASE — verify manually"
  else
    VERIFY_STATUS="HASH-MISMATCH"
    say "  ASSET MISMATCH: local=$LOCAL_ASSET live=${LIVE_ASSET:-<none>}"
    say "  The CDN may take a few seconds; re-check with:"
    say "    curl -fsSL $LIVE_BASE/index.html | grep -Eo 'assets/[A-Za-z0-9._-]+\\.js'"
  fi
else
  say "== verify: skipped automatic CDN check =="
  [[ "$CLIENT_SIDE" != "true" ]] && say "  server-side app — check 'mapps code:status -i <APP_VERSION_ID>' and 'mapps code:logs -i <APP_VERSION_ID> -s live -t console' instead"
  [[ -z "$LIVE_URL" ]] && say "  no live URL known — set LIVE_URL in .env or pass --live-url"
fi

# --------------------------------------------------------------- 8. caveats
say ""
say "== ship result: pushed app $APP_ID | verify: $VERIFY_STATUS =="
say ""
say "MOBILE CACHE CAVEAT (read verbatim):"
say "  deploy:force reuses the same version id and CDN URL; the monday mobile"
say "  webview may serve a stale cached bundle even though the CDN files DID"
say "  update. If mobile looks old, it is the webview cache — not a failed"
say "  deploy. Do not start a redeploy loop over it."
say ""
say "NOT DONE YET: a CDN hash-diff is necessary but NOT sufficient."
say "  Report 'done' only after driving the changed flow on the live board —"
say "  see $SKILL_DIR/references/verify-live.md (fresh tab per check,"
say "  screenshot + console messages on the exact changed flow)."

if [[ "$VERIFY_STATUS" == "HASH-MISMATCH" || "$VERIFY_STATUS" == "MARKER-MISSING" ]]; then
  exit 4
fi
exit 0
