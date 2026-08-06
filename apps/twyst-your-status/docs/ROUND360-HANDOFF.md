# round360 handoff — status-guard fixes: state, remaining work, re-test protocol

**Written:** 2026-08-06 ~12:00 · **Branch:** `feature/round360-twyst-guard-fixes-20260806` (from `develop`)
**Server suite at handoff: 269/269 green** (`cd apps/twyst-your-status/server && npx vitest run`).
**Read first:** [STATUS-GUARD-LATENCY-REVIEW.md](STATUS-GUARD-LATENCY-REVIEW.md) — §6 has the live
measurements and the two P0 bugs; §4–5 the approved plan and owner decisions. This file is the
work-state ledger for the fresh session that continues the round.

## What is already implemented ON THIS BRANCH (all committed)

Via a 4-agent workflow, then hand-fixes for 7 adversarial-review findings:

| # | Change | File(s) | Status |
|---|---|---|---|
| 1 | **P0: labels source** — `GET_COLUMN_LABELS` now selects typed `settings` (array shape, same field the client picker reads) instead of `settings_str` (map shape → `[]` labels → guard blocked EVERYTHING). Live-verified on API 2026-04. | `server/src/services/monday-api.js`, `server/tests/services.test.js` | done + tested |
| 2 | **P0: echo guard** — check moved to top of `process()` (zero I/O; marker stores `actorId`), TTL 60s→600s, marker is now **counted** (double-revert-same-value safe), and a **throwing revert disarms** the marker it armed. | `server/src/guard/handleStatusChangeEvent.js` | done; counter+disarm **UNTESTED** (see remaining) |
| 3 | Fail-open on empty labels (log + skip, no evaluate/revert/bypass) — now also emits the timing line. | same | done; timing-on-fail-open **UNTESTED** |
| 4 | Parallel gated GraphQL (labels ∥ teams ∥ item-context; gating unchanged). | same | done + tested |
| 5 | Lane release after revert — notify + bypass append run as a **concurrent** detached tail (`Promise.all`), lane test amended via amend-intent. | same | done + tested |
| 6 | Bounded redelivery — one retry after `retryDelayMs` (default 5000) on transient storage errors only. | same | done + tested |
| 7 | Per-step timing line — `guard timing total=..ms tokens=..ms rules=..ms gql=..ms reread=..ms revert=..ms` per evaluated delivery, `code:logs` only (owner decision: NOT Axiom). | same | done + tested |
| 8 | Token access cache (`accountId:userId` → token+expiry, never refreshToken) + reader-pointer cache **with dead-pointer fallback** (cross-instance re-auth recovery). | `server/src/services/stores.js`, `server/tests/stores-caching.test.js` | done + tested |
| 9 | Rules TTL cache 45s — **webhook-only**: caches ONLY when the JWT-verified `accountId` is passed (4th arg); sessionToken routes pass none and always fetch (cross-tenant poisoning fix). Handler passes `accountId`; routes were deliberately left unchanged. | same + `handleStatusChangeEvent.js` | done + tested |
| 10 | Cross-instance refresh race — `invalid_grant` re-reads the record; a rotated pair is adopted, not flagged. | `stores.js` | done + tested |
| 11 | Vault per-attempt GET timeout — default **8000ms** (raised from the reviewer-rejected 3000ms guess: live-measured per-call latency is ~4–5s, review doc §6.1); sets/deletes deliberately not timed out. | `server/src/helpers/secure-storage-resilient.js` + its test | done + tested (default value itself not asserted) |
| 12 | Boot Vault warm-up — fire-and-forget `secureStorage.get('warmup:boot')` in `index.js`. | `server/src/index.js` | done (untestable entrypoint by design) |

Review findings already fixed by hand (do not re-fix): timeout default (P0), rules-cache tenant
poisoning (P1), reader-pointer blindness (P1), echo single-slot (P1), orphaned echo marker on
revert throw (P2), fail-open missing timing (P2), tail append delayed behind notify (P2).

## Remaining work (fresh session TODO, in order)

1. **Add the three missing handler tests** in `server/tests/handleStatusChangeEvent.test.js`
   (red-first — verify red by temporarily reverting the specific source lines):
   a. Double revert, two echoes: two illegal changes to the same item processed before either echo;
      both echoes must be consumed (second echo must NOT be evaluated). Exercises the marker `count`.
   b. Revert throw disarms: `api.revertStatus` rejects → a subsequent event matching the would-be
      echo (same value, primary owner as actor) must be EVALUATED, not skipped.
   c. Fail-open emits timing: labels `[]` → the `guard timing` info line is still logged.
2. **Mutation spot-checks** (test-guard): kill ≥2 mutations across the hand-fixed code (e.g. remove
   the pointer-cache fallback → stores-caching dead-pointer test must fail; remove `count` handling →
   test 1a must fail).
3. Run BOTH suites (`server` and app root) + `npx eslint .` in server.
4. **CHANGELOG.md** (app root, Hebrew per its convention): new `3.16.0` section — the two P0 fixes,
   the latency work, the measurements. **Bump `apps/twyst-your-status/package.json` version to 3.16.0.**
   (`server/package.json` stays 1.1.0 unless its own convention says otherwise — check git history.)
5. Commit; then ONE gated question for `git push` + PR to `develop` (merge = draft deploy).
6. **Re-tests need LIVE, not draft:** the production webhook targets the live service
   (`live1-service-14334098-c3055738.us.monday.app`). Verifying on the real board requires a
   develop→main release (`monday-cicd` Mode 5, owner-gated) — or enrolling a separate test column
   against the draft URL. Ask the owner which path.

## Re-test protocol (repeat of this session's measurements, expected AFTER deploy)

- Board `18423875018`, column `color_mm5nwms4`, workspace 15426602 (owner-designated test board).
  Items: `12636416245` (Item 3), `12645678373` (Item 4). Label ids: 0=בעבודה (hidden), 1=בוצע,
  2=תקוע, 3=לא רלוונטי. Rules blob: label 1 allowlist includes 48274917 (the owner); rule 0 has
  `nextLabelIds ["2","3","6","7"]`; `autoRevert: true`; primary owner 48274917.
- App: TwystYourStatus id **11775054**, account 14334098, live app-version **16639151** (re-check
  `mapps app-version:list -i 11775054` after a release). Logs: `mapps code:logs -i <versionId> -s live
  -t console` (streams die ~10 min — restart). API via `.claude/skills/mapps/mapps-api.sh` ONLY.
- Method: mutate the cell to an ILLEGAL value via `change_column_value` (`{"index":0}` from 3), poll
  every ~0.4s until it flips back; scripts from this round live in the session scratchpad — trivial
  to rewrite: mutation + poll loop + timestamps.
- **Expected after fixes:** `3→1` is ALLOWED (was wrongly blocked — P0#1); `3→0` reverts with a
  `guard timing` line decomposing the latency; echoes are consumed (one `revert echo skipped` info
  line, no oscillation); warm-path time-to-revert well under the measured 38–42s baseline; no revert
  storm under repeated changes.
- Baseline to beat (3 runs, live, 2026-08-06): 41.3s / 38.7s / 41.9s mutation→revert; server-side
  receipt→verdict ≈ 32–38s. Per-call latency ~4–5s is a PLATFORM property — if timing lines still
  show ~4–5s per step, that is the §6.1 open question (connection setup / egress), not a regression.

## Conduct notes for the continuing session

- Never deploy locally; merge-to-develop deploys the draft, release to main via monday-cicd Mode 5.
- Live probes revert cells and send real notifications to the owner — batch them, announce first.
- The revert storm is fixed in code but NOT yet deployed: until the release, repeated illegal
  changes on the live board can still oscillate. Don't leave test cells on hidden label 0.
