# Changelog - deadline-confirm

*Auto-generated. Source: `~/.change-tracker/changes.db`*

## 0.4.0 — 2026-07-17

- Axiom logging v2 telemetry ported into the **server** (load-bearing part of this hybrid app).
- `src/helpers/logger.js`: added the shared v2 primitives — a single sink pipeline
  (`emit` → `beforeSend` → fan-out with log-once dedup), `encodeDims`, `track` (usage/D3),
  `health` (D5), `addSink`/`removeSink`/`setBeforeSend`, and a logger-shaped default export.
  The locked line writers `logAttempt`/`logError`/`logInfo` keep their byte-exact stdout/stderr
  JSON (tests/core-output.test.js stays green) and now also feed the sink pipeline.
- `src/helpers/axiomServerSink.js` (new): ships records to Axiom via `@axiomhq/js`. Inline
  `scrubMessage` (emails / tokens&hex≥16 / digit-runs≥7 redacted, precap 1000 / cap 200);
  `mapRecordToEvent` sets `ev.kind = domainKind ?? 'error'` and ships `error.message` ONLY
  scrubbed as `err_msg`; `shouldShip` order = !record→false, duplicate→false, alwaysShip→true,
  then WARN/ERROR level policy. Server-only `firstStackFrame` (V8 `/^\s*at /`).
- `src/index.js`: attach the sink gated on `AXIOM_TOKEN`/`AXIOM_DATASET`/`AXIOM_APP_NAME`
  read through `EnvironmentVariablesManager` (not `process.env`); a `beforeSend` that strips the
  `/confirm` client `ip` from attempt records (PII) before they reach any sink; boot health
  (`health('boot', {version, port})`) after `app.listen`; Axiom flush on SIGTERM/SIGINT.
- `src/services/monday-api.js`: wrapped the GraphQL funnel to emit
  `health('api_latency', {op, ms, ok})` per call.
- `src/routes/confirm.js`: `track('confirm', {outcome, method})` usage event on POST confirmations.
- `tests/telemetry-v2.test.js` (new): 13 lock tests for the new primitives (encodeDims / track /
  health / emit+beforeSend ip-scrub / scrubMessage / mapRecordToEvent / shouldShip).
- Dependency: `@axiomhq/js@^1.3.1` (already in the workspace via sync-calender).
- **Deferred (flagged):** the client admin-SPA telemetry (client `logger.ts` + browser sink +
  transport + `useViewTracking` + client boot/api-latency health). The strict-TS admin app has a
  `tsc --noEmit` gate and the reference browser logger/sink/transport exist only as untyped `.js`;
  porting them cleanly is a separate, non-trivial unit deferred to keep the verified server port safe.

## 2026-07

### ✨ New Features

- **2026-07-14** — Bootstrap new app: one-click email confirmation endpoint (status transition + attribution update), monday OAuth, Hebrew RTL Admin View, CI/CD pipeline onboarding
  - _Why:_ Business requirement — assignees confirm deadline tasks straight from reminder emails without opening monday
  - _Requested:_ הקמת אפליקציה חדשה deadline-confirm (App ID 11704868, slug yomsheni-il_status-email): שרת monday-code עם endpoint אישור בקליק אחד מהמייל (מעבר סטטוס + עדכון ייחוס), OAuth, ו-Admin View בעברית RTL — לפי ספק monday-deadline-confirm-spec.md, על בסיס הרפרנס sync-calender. כולל onboarding לצנרת ה-CI/CD
  - _Done:_ הוקמה האפליקציה מאפס בתוך המונורפו לפי הספק: שרת monday-code עם GET/HEAD /confirm (שער סוד בזמן-קבוע, rate limit, guards, מוטציית סטטוס + עדכון ייחוס), OAuth מלא עם state חד-פעמי, API אדמין מאובטח ב-sessionToken, ו-Admin View בעברית RTL. חוברה לצנרת CI/CD (workflows + secret), נפרסה ל-draft ואומתה קצה-לקצה מול לוח אמיתי דרך טאנל dev-live. בדרך נתגלו ותוקנו שלושה מוקשי פלטפורמה: קריאת env דרך apps-sdk (לא process.env), הצמדת OAuth לגרסת draft עם app_version_id, ועטיפת מחרוזות ב-SecureStorage — כולם תועדו בסקילים. איכות: 214 טסטים בשערי test-guard עם 36 מוטציות שנהרגו. זמן משוער (נגזר מטווח הפתיחה-סגירה, כולל שני סשנים).

### 🔧 Feature Changes

- **2026-07-15** — v2: dynamic status buttons (N buttons, per-button column + target label + style), JS auto-confirm scanner protection, block-based email template editor with saved templates and full-HTML copy; drop from-status guard and expiry
  - _Why:_ Owner redefined final behavior: externally-scheduled emails need multiple distinct buttons and fully composed email HTML from the admin panel
  - _Requested:_ ההתנהגות הסופית הרצויה: כפתורים דינמיים למספר סטטוסים עם קוד זיהוי שונה, מיפוי לוח ועמודות כרצוני, בלי משמעות לסטטוס נוכחי ובלי ימי חסד, תצוגה מקדימה של כפתור עם עריכת צבע/אייקון/גודל, ותיבת עריכה מלאה למייל עם שיבוץ כפתורים, כיוון, גודל וגופן והעתקת HTML מלא
  - _Done:_ שוכתבה ההתנהגות ל-v2 בהחלטת בעלים: N כפתורי פעולה דינמיים (עמודת סטטוס, לייבל יעד וסגנון פר-כפתור, מזהה btn ב-URL), ביטול שער הסטטוס-הנוכחי והתפוגה, דילוג שקט על קליק-כשכבר-ביעד, הגנת סורקי-מייל בדף אישור-JS אוטומטי (GET בלי שום פעולה), ועורך תבניות מייל בבלוקים עם העתקת HTML מלא. נפרס ל-draft, אומת בקליקים אמיתיים מ-workflow (שני כפתורים, עדכוני ייחוס), קודם ל-live (v2) עם draft v3 עומד. איכות: 308 טסטים, 18 מוטציות נהרגו בסבב v2, אפס שורדים.
