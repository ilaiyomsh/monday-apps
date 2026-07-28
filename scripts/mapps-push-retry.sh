#!/usr/bin/env bash
# mapps-push-retry.sh — run `mapps code:push` with bounded retries and backoff.
#
# Why this exists. The platform's push step fails on transient remote errors —
# "Unexpected error occurred while communicating with the remote server" — and it did so 4
# times in one hour. Without a retry, one blip is a dead deploy that needs a human to notice
# and re-run it. A draft deploy that fails after merge has to be fixed FORWARD on a new
# branch (root CLAUDE.md), so the cost of a lost push is high out of proportion to the cause.
#
# deploy-live-deadline-confirm.yml already carried a hand-rolled version of this after the
# 2026-07-15 live-run failure. This is that precedent generalised to one implementation every
# workflow shares, instead of the same loop copy-pasted into eighteen files.
#
# Retries are UNCONDITIONAL, deliberately. Matching on transient error text would mean a
# pattern list that silently loses its retry the day the platform rewords a message — the
# exact fail-quiet shape this repo keeps closing. Re-pushing is idempotent (the same tarball
# replaces the same draft/live version), so the cost of retrying a genuine failure is a few
# minutes of runner time, while the cost of NOT retrying a transient one is a dead deploy.
#
# Usage:  bash scripts/mapps-push-retry.sh <all flags for `mapps code:push`>
#   e.g.  bash scripts/mapps-push-retry.sh -d apps/x/. -a "$APP_ID"
#         bash scripts/mapps-push-retry.sh -c --force -d apps/x/dist -i "$LIVE_ID"
#
# Env:
#   PUSH_ATTEMPTS  total attempts (default 3)
#   PUSH_BACKOFF   comma-separated seconds between attempts (default "10,30")
#   MAPPS_BIN      the mapps binary (default "mapps") — the test seam
#
# Exit code is the LAST attempt's exit code, so a failure still fails the job.

set -uo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <mapps code:push flags…>" >&2
  exit 2
fi

ATTEMPTS="${PUSH_ATTEMPTS:-3}"
MAPPS_BIN="${MAPPS_BIN:-mapps}"
IFS=',' read -r -a BACKOFF <<< "${PUSH_BACKOFF:-10,30}"

if ! [[ "$ATTEMPTS" =~ ^[1-9][0-9]*$ ]]; then
  echo "::error::PUSH_ATTEMPTS must be a positive integer, got '$ATTEMPTS'" >&2
  exit 2
fi

attempt=1
while [ "$attempt" -le "$ATTEMPTS" ]; do
  "$MAPPS_BIN" code:push "$@"
  status=$?

  if [ "$status" -eq 0 ]; then
    if [ "$attempt" -gt 1 ]; then
      # Surface the flakiness even on success — a push that needed 3 tries is a signal,
      # and a silent recovery hides a degrading platform.
      echo "::notice::mapps code:push succeeded on attempt ${attempt}/${ATTEMPTS}"
    fi
    exit 0
  fi

  if [ "$attempt" -eq "$ATTEMPTS" ]; then
    echo "::error::mapps code:push failed after ${ATTEMPTS} attempt(s); last exit ${status}" >&2
    exit "$status"
  fi

  # Reuse the final backoff value if fewer delays than attempts were configured.
  delay="${BACKOFF[$((attempt - 1))]:-${BACKOFF[${#BACKOFF[@]} - 1]}}"
  echo "::warning::mapps code:push attempt ${attempt}/${ATTEMPTS} failed (exit ${status}); retrying in ${delay}s"
  sleep "$delay"
  attempt=$((attempt + 1))
done
