# add-to-status-hub — quirks & self-correction log

## 2026-07-07 — stale template path (`_axiom-dashboard-template/` does not exist)

**What broke:** SKILL.md's "Reference locations" and Step 2 pointed at
`/Users/ilaish/monday_app/apps/_axiom-dashboard-template/app/logger.js` as the
logger source. The directory does not exist on disk (verified with `ls` — nothing
matching under the apps root). Any Path A run would have failed at Step 2.

**Verified fix (applied same session):** the canonical dual-transport logger source
is the production implementation at
`Axis/sync-calender/src/services/logger.js` (monday apps-sdk Logger + `@axiomhq/js`,
running live behind the hub). SKILL.md Step 2 and the reference table now point there.

**Bonus verified fact recorded in that file's comments:** the `@mondaycom/apps-sdk`
Logger (Pino) silently drops `warn` and `debug` — route those through bare
`console.warn`/`console.log` inside the logger file.

## 2026-07-07 — boundary change with error-guard (not a defect; a decision)

Error-record shipping (WARN/ERROR → shared `app-errors` dataset, including for
browser-only apps via a sanctioned exposed ingest-only token) moved to the
`error-guard` skill (`references/remote-monitoring.md`). This skill keeps full
observability (INFO streams, per-app `<slug>-prod` dataset, hub registration).
The old flat "SPA → STOP" rule was replaced accordingly in the platform question
and the "When NOT to use Path A" section.
