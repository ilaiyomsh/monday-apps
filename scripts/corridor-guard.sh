#!/usr/bin/env bash
# corridor-guard.sh — runs in CI on PRs targeting develop.
#
# Always enforced (version rules, accumulation-compatible):
#   1. Scope: a PR touches at most ONE app — unless the 'shared-change' label
#      is set (env HAS_SHARED_LABEL=true). Touching packages/shared requires
#      that label too.
#   2. Every app touched by the PR must carry a version STRICTLY ABOVE main's
#      (the bump happens in the task branch — scripts/bump.sh).
#   3. Versions never go backwards relative to develop.
#   4. An app the PR does not touch must not change its version.
#
# CORRIDOR_MODE=on additionally enforces the corridor lock (one candidate at
# a time; develop==main at rest). OFF by default — the corridor-vs-accumulation
# decision is deferred (owner, 2026-07-14); accumulation is bounded by
# scripts/release-debt.sh instead.
#
# NOTE (enforcement honesty): repo is private on GitHub Free — no required
# status checks, so a red guard REPORTS but does not physically block.
# Discipline + the agent are the enforcement layer (owner decision 2026-07-07).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
source scripts/apps.sh

DEV="origin/develop"; MAIN="origin/main"
SHARED_LABEL="${HAS_SHARED_LABEL:-false}"
CORRIDOR="${CORRIDOR_MODE:-off}"
fail=0

ver_at()  { git show "$1:$(app_path "$2")/package.json" | jq -r .version; }
ver_now() { jq -r .version "$(app_path "$1")/package.json"; }
# strictly_higher OLD NEW -> true if NEW > OLD
strictly_higher() { [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | tail -1)" = "$2" ] && [ "$1" != "$2" ]; }
not_lower() { [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | tail -1)" = "$2" ]; }

# --- which apps does this PR touch? ---
touched=()
for slug in "${APP_SLUGS[@]}"; do
  git diff --quiet "$DEV"...HEAD -- "$(app_path "$slug")" || touched+=("$slug")
done
shared=false
for sp in "${SHARED_PATHS[@]}"; do
  git diff --quiet "$DEV"...HEAD -- "$sp" || shared=true
done

# --- rule 1: scope ---
if [ "$SHARED_LABEL" != "true" ]; then
  [ "$shared" = "true" ] && { echo "::error::PR touches ${SHARED_PATHS[*]} without the 'shared-change' label"; fail=1; }
  [ "${#touched[@]}" -gt 1 ] && { echo "::error::PR touches more than one app (${touched[*]}) — one app per PR, or add the 'shared-change' label"; fail=1; }
fi

# --- targets: which apps must satisfy the version rules ---
targets=("${touched[@]:-}")
[ "$SHARED_LABEL" = "true" ] && targets=("${APP_SLUGS[@]}")   # shared change: all apps redeploy

# --- rules 2+3: bump above main, never backwards vs develop ---
for slug in "${targets[@]}"; do
  [ -n "$slug" ] || continue
  vm="$(ver_at "$MAIN" "$slug")"; vd="$(ver_at "$DEV" "$slug")"; vn="$(ver_now "$slug")"
  strictly_higher "$vm" "$vn" || { echo "::error::$slug: version must bump above main ($vm) — got $vn. Run: scripts/bump.sh $slug"; fail=1; }
  not_lower "$vd" "$vn"       || { echo "::error::$slug: version went backwards vs develop ($vd -> $vn)"; fail=1; }
  # Bump-once-per-candidate (owner rule 2026-07-14): numbers count RELEASES,
  # not PRs. Raising an already-pending candidate is sanctioned ONLY as a
  # deliberate magnitude raise — warn so needless per-PR bumps stay visible.
  if strictly_higher "$vm" "$vd" && strictly_higher "$vd" "$vn"; then
    echo "::warning::$slug: raising an unreleased candidate ($vd -> $vn, main has $vm). Draft iterations keep the number; raise only for a bigger change (bump-once rule)."
  fi
done

# --- rule 4: a bump with no code changes is meaningless ---
for slug in "${APP_SLUGS[@]}"; do
  case " ${targets[*]:-} " in *" $slug "*) continue ;; esac
  [ "$(ver_at "$DEV" "$slug")" != "$(ver_now "$slug")" ] && \
    { echo "::error::$slug: version changed but the PR has no code changes for it"; fail=1; }
done

# --- corridor lock (only when the corridor model is adopted) ---
if [ "$CORRIDOR" = "on" ]; then
  if git diff --quiet "$MAIN" "$DEV"; then STATE=empty; else STATE=occupied; fi
  if [ "$STATE" = "occupied" ]; then
    pending=()
    for slug in "${APP_SLUGS[@]}"; do
      git diff --quiet "$MAIN" "$DEV" -- "$(app_path "$slug")" || pending+=("$slug")
    done
    for slug in "${touched[@]:-}"; do
      [ -n "$slug" ] || continue
      case " ${pending[*]:-} " in *" $slug "*) ;; *)
        echo "::error::corridor occupied by [${pending[*]:-}] — $slug must wait for the release"; fail=1 ;;
      esac
    done
  fi
fi

[ "$fail" -eq 0 ] && echo "corridor-guard: all version rules pass (corridor lock: $CORRIDOR)"
exit $fail
