# twyst-your-status — Agent State & Handoff

**Updated:** 2026-08-06, end of round360 (released to live + live-verified the same evening).
This is the entry point for the next agent session. Living references: [`MANIFEST.md`](../MANIFEST.md)
(features, scopes, URLs — synced against the live manifest in 3.15.2),
[`GUARD-ACTIVATION.md`](GUARD-ACTIVATION.md) (owner model + one-time activation),
[`BYPASS-PROOF-DECISION.md`](BYPASS-PROOF-DECISION.md) (architecture decision record; its
"pending owner decision" status line is historical — the layer-1 webhook guard has been
implemented since round322), [`CHANGELOG.md`](../CHANGELOG.md) (Hebrew, per-version history).
Pipeline rules live in the repo-root `CLAUDE.md` + the `monday-cicd` skill.

## Deployment state

| What | Value |
|---|---|
| Live | **3.16.0** (round360), app-version **16639151** (v4), `live1-service-14334098-c3055738.us.monday.app` |
| Draft | app-version 16639900 (v5) |
| App / account | App ID **11775054**, account 14334098; server workspace `server/package.json` stays 1.1.0 |
| Release path used | PR #655 (feature → develop) + PR #656 (selective hotfix from main, twyst only) → main, back-merged into develop. discussions round367 was left unreleased in develop on purpose. |

## round360 — shipped and live-verified

Two P0 fixes + the approved latency plan (full detail: CHANGELOG 3.16.0):

- **P0 labels source:** server `GET_COLUMN_LABELS` selects the typed `settings` field
  (array shape, same normalizer as the client picker). Before: `settings_str` map shape
  → `labels = []` → every transition "not-offered" → with auto-revert on, the guard
  reverted every change. Plus true fail-open: empty labels ⇒ log + skip, never evaluate.
- **P0 echo guard:** echo check at the top of `process()` before any I/O (marker carries
  `actorId`), TTL 60s→600s, **counted** markers (two same-value reverts in flight are
  safe), and a throwing revert **disarms** the marker it armed. Kills the observed
  ~25-minute self-revert oscillation storm.
- **Latency plan:** parallel gated GraphQL reads · lane released after the revert
  (notify+bypass append run as a detached concurrent tail) · bounded redelivery (one
  retry, transient storage errors only) · per-step `guard timing` line · access-token +
  reader-pointer caches with dead-pointer fallback · webhook-only 45s rules TTL cache
  (JWT-verified accountId only) · cross-instance `invalid_grant` race guard · 8s Vault
  GET per-attempt timeout · boot Vault warm-up.
- **Tests:** server suite 272/272, app root 885/885, eslint clean; 8 targeted spotcheck
  mutations fired this round, 8 KILLED (test-guard). Server stores now live in
  `server/src/services/stores/` (barrel `stores.js` re-exports, incl. `REFRESH_CUSHION_MS`).

### Live verification results (2026-08-06 evening, owner-designated test board)

- `BLOCKED (not-offered) 0→1` → reverted as the primary owner; the revert's **echo was
  consumed** (`revert echo skipped`, zero oscillation) under **130s** processing — the
  exact slow-processing scenario that caused the old storm.
- `ALLOWED 0→3` — legal transition passes (pre-round360 it was wrongly blocked).
- Warm path: `guard timing total=2252ms tokens=0ms rules=73ms gql=2079ms reread=0ms
  revert=0ms` — vs the 32–38s pre-round360 receipt→verdict baseline. Cold + degraded
  worst case observed: 130s with `tokens=99549ms` (Vault slow + one OAuth refresh).
- **Incident (closed):** ~19:30–20:04 IDT every SecureStorage GET timed out at the 8s
  cap; deliveries were dropped **fail-open** (no wrongful writes, every failure in
  `code:logs` + shipped to Axiom `app-errors` with full context); self-recovered. Same
  family as the 2026-08-05 cold-start Vault incident. Consequence to understand: during
  such a window the guard neither enforces nor records bypasses.

## Open follow-ups (priority order)

1. **Vault GET timeout policy (round361 candidate, owner decision needed).** The 8s
   per-attempt cap converts a slow-but-alive Vault into dropped deliveries — enforcement
   and monitoring are down for the whole window. Options: raise to ~20–30s, adaptive
   timeout, or exempt the first post-boot call. Trade-off: slower deliveries during
   degradation vs. no enforcement at all.
2. **Owner-approved feature request (2026-08-06): settings-export debug button** — a
   control in the settings screen exporting the column's full rules JSON. Interim CLI:
   `mapps storage:search -a 11775054 -c <accountId> -t "twystStatus:<board>:<column>"`
   and `mapps storage:export -a 11775054 -c <accountId>`.
3. **Per-call latency question** (was §6.1 of the retired latency review): why did every
   outbound call cost ~4–5s uniformly (connection setup / undici pool idle-out /
   egress?). Now directly measurable via the per-step `guard timing` line in `code:logs`;
   warm-path gql was observed at ~2s for the parallel batch.
4. **Standing owner decisions that bind:** the timing line stays `code:logs`-only (NOT
   shipped to Axiom); the 45s rules-cache staleness trade-off is approved; the revert
   notification copy in `handleStatusChangeEvent.js` is the owner's exact wording — do
   not edit.

## Live test fixture (owner-designated) + probe protocol

- Board **18423875018**, column **`color_mm5nwms4`**, workspace 15426602. Items:
  **12636416245** ("Item 3"), **12645678373** ("Item 4"). Labels: 0=בעבודה (hidden),
  1=בוצע, 2=תקוע, 3=לא רלוונטי. Rules blob: label 1 allowlist includes 48274917 (the
  owner, also primary owner); rule 0 `nextLabelIds ["2","3","6","7"]`; `autoRevert: true`.
- Probe method: `change_column_value` via `.claude/skills/mapps/mapps-api.sh` ONLY
  (never a raw token), then poll ~0.4s until the cell settles. Logs:
  `mapps code:logs -i <live-version-id> -s live -t console` (streams die after ~10 min —
  restart; History mode dumps a window with fetch-time stamps, out of order).
- Conduct: announce probes first (an evaluated-blocked change sends a REAL notification
  to the acting user and reverts the cell), batch them, restore board state when done,
  and **never leave a cell on hidden label 0**.

## Docs pruned in the same commit as this file

`ROUND360-HANDOFF.md` and `STATUS-GUARD-LATENCY-REVIEW.md` (round complete; every
still-live fact was carried into this file), `DEPLOYMENT-CHECKLIST.md` (pre-round324
CDN-era instructions; `MANIFEST.md` is the authoritative feature/URL doc), and the
`.cleanup/*.md` run artifacts (that cleanup round shipped in 3.15.3; the runbook lives
in `scripts/cleanup/README.md`). All recoverable from git history at this commit's
parent.
