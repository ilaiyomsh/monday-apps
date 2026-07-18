# Changelog - sync-calender

*Auto-generated. Source: `~/.change-tracker/changes.db`*

## 2.2.0 — 2026-07-17

- Telemetry hardening: the server sink allowlists the `stage` field and ships the failure
  `cause` (err.message at many call sites) ONLY scrubbed, as err_msg — errors keep their content
  on Axiom instead of shipping near-contentless.
- Axiom logging v2: refactored `src/services/logger.js` to a single `emit()` choke-point with sink fan-out (`addSink`/`removeSink`/`setBeforeSend`), log-once error correlation (`__loggedId`/`correlationId`), and new `encodeDims` + `track` (domainKind `usage`) + `health` (domainKind `health`) primitives. Kept the `(message, tag, context)` signature and the exported `flush`/`maskEmail`/`shortId` helpers, so all existing call sites are untouched.
- Moved the inline Axiom transport out of the logger into a dedicated `src/services/axiomServerSink.js` (`attachAxiomServerSink`/`shouldShip`/`mapRecordToEvent`/`flushAxiom` + `scrubMessage`). Privacy-hardened wire schema: `ev.kind` carries the domain discriminator (`error`/`usage`/`health`), `error.message` ships ONLY scrubbed as `err_msg` (emails / hex&tokens≥16 / digit-runs≥7 redacted, capped 200), and a `CTX_ALLOW` allowlist ships only short ids/counters (`acc`/`usr`/`obj`/`cfg`/`prv`/`item`/`ev` + `created`/`updated`/`deleted`/`skipped`/… ) — emails, event titles, links and GraphQL bodies never leave the process.
- Wired the sink in `src/index.js` (attach right after the logger import; graceful-shutdown drain now calls `flushAxiom()`), emitted a boot `logger.health('server_boot', { port, version })` after `server.listen`, and added bucketed API-latency health `logger.health('monday_api_latency', { op, status, bucket, ok })` at the `mondayQuery` data-layer funnel.
- Deferred: client admin view-tracking (no logger in `src/client/admin` today) and a vitest lock test (no test infra in this app) — verified the new primitives via a runtime smoke instead. Version 2.1.0 → 2.2.0.

## 2026-06

### 🐛 Bug Fixes

- **2026-06-02** — Scheduler flips config status to <provider>_disconnected + sets lastError on token-refresh failure, and notifies the affected monday user `9d8c8e4`
  - _Why:_ Discovered bug — a disconnected Microsoft config kept showing as Active in the admin UI because the scheduler's catch block only logged the error without updating status/lastError
  - _Requested:_ תתקן את הבאג שה-scheduler לא מעדכן status/lastError כשרענון טוקן נכשל (המשתמש נראה Active למרות ניתוק), וגם תוסיף התראה (notification) למשתמש שהחיבור שלו מנותק
  - _Done:_ Plan: Stop dead Microsoft/Google configs from showing as Active by having the scheduler's renewal catch classify token-refresh failures and flip the config to <provider>_disconnected + set lastError, and add a disconnect notification to the affected monday user (later extended to also alert the instance owner). Done: Reused the webhook path's sync-status.js#classifyError in scheduler.js's renewal catch so a dead refresh token (invalid_grant/400) now persists status=<provider>_disconnected + lastError; added maybeNotifyAffectedUser and maybeNotifyOwner (via create_notification in monday-api.js), a 24h cooldown, and a disconnect pill on the owner's row in UsersTable.tsx. Owner alerts are sent through the owner's OWN monday token (resolveOwnerToken) so they survive the affected user's monday disconnect, deep-linking to the custom object instance. Deviations: Scope grew beyond the original request — added owner notifications, owner's-own-token resolution, and the UI disconnect pill (commits c345330 to 1cf84aa). Verified in production via Axiom (cfg 0ff12f78): the status flip and user_notified work correctly, but a follow-up bug remains — owner notifications fail with UNAUTHORIZED_FIELD_OR_TYPE (owner token appears to lack notifications:write), to be tracked as a separate change.

## 2026-05

### ♻️  Refactor

- **2026-05-28** — העשרת לוגים של שגיאות sync — code/status/body/stack ב-catch של webhook-config + try/catch ייעודי סביב provider.listChanges `2cb263c`
  - _Why:_ באג שאי-אפשר היה לאבחן ב-Axiom (cfg=0ff12f78, 'Provided input is invalid') כי הלוג חסר code/status/body/פונקציה זורקת
  - _Requested:_ 1. להעשיר את ה-catch ב-webhook-config.js עם err.code, err.status, err.body (אם קיים), ו-err.stack.split('\n')[1] כדי לקבל את הפונקציה הזורקת. 2. לעטוף את provider.listChanges ב-try/catch ייעודי שירשום את ה-stage מדויק (provider_list_changes) ואת ה-body של Graph אם זה 400.
  - _Done:_ Investigated a single Axiom error (cfg=0ff12f78, "Provided input is invalid", provider=microsoft) and found the outer catch in webhook-config.js logs only err.message — no code, status, body, or throwing frame, making the error undiagnosable. Added errCode, errStatus, errBody (capped at 500 chars), and throwAt (first stack frame) to the catch, and switched stage to honor err.stage when set. In sync-engine.js, wrapped both provider.listChanges calls in a listChangesTagged helper that tags errors with stage='provider_list_changes' and emits a dedicated log with the Graph body on 400. Built client, committed 2cb263c, deployed to monday code (v14818258, successful). Follow-up: verify in production that the new fields actually land in Axiom on the next real error — none has fired since deploy.
