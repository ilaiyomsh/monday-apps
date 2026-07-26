# Changelog - deadline-confirm

*Auto-generated. Source: `~/.change-tracker/changes.db`*

## 0.7.0 — 2026-07-26 — V5: Gmail dynamic email (AMP for Email), phase 1

- **The client's org runs Gmail, not Outlook** — so Adaptive Cards / Actionable
  Messages is out (Outlook-only) and Gmail's **dynamic email** (AMP for Email)
  is in. Design log: `docs/v5-gmail-dynamic-email.md`; spec V5 Amendment.
- **`helpers/digest-amp.js` (new)**: renders the `text/x-amp-html` part of the
  digest — one `<amp-form>` per section, a **checkbox per task** and ONE submit
  per section, so several tasks are confirmed in one click without leaving the
  message. Valid amp4email (boilerplate, CDN-only scripts, `action-xhr`,
  `amp-mustache` success/error templates); the link secret rides in hidden
  inputs, never in a URL.
- **`routes/amp.js` (new)**: `POST /amp/confirm` — the app's only bulk mutation
  path. Ordered gate: AMP CORS (first, no I/O) → validate (`a`,`k`,`btn`,
  `item[]`, cap 50) → secret → rate limit → `performAction` per item (same
  engine, so already-at-target stays a silent success). JSON replies carry
  counts + a Hebrew message only; authorized-but-nothing-updated answers 502 so
  the reader sees the error template. `OPTIONS` handled.
- **`helpers/amp-cors.js` (new)**: both documented CORS variants (v2
  `AMP-Email-Sender` preferred, v1 `Origin` + `__amp_source_origin`).
  **Default deny**, no wildcard support, and a rejected caller gets NO CORS
  headers and never touches storage.
- **Env**: `AMP_ALLOWED_SENDERS` (comma-separated, lowercased, de-duplicated;
  empty = endpoint admits nobody).
- **Admin**: `GET /api/digest/preview` now also returns `amp`, and the digest
  tab gained a copy-AMP button (for the AMP playground while the AMP sending
  path is manual). The static `text/html` digest is unchanged and remains the
  universal fallback — nobody gets a broken email.
- Tests: 5 new gated files (red→green + 9 killed mutations, 0 survivors);
  full suite 512 green. Type-check + lint clean.
- **Deferred**: sending the AMP MIME part (Resend's `text/x-amp-html` support is
  undocumented → phase 2 goes through a dedicated Workspace mailbox with the
  `gmail.send` scope only), and the per-task status dropdown variant.

## 0.6.0 — 2026-07-20 — digest: show-by-status condition + today-inclusive + real date header

- **Status condition per section ("show by status")**: each group now carries
  `includeStatusLabelIds` — a task enters only if its status (on the group
  button's status column) is one of those labels. Fixes the bug where an
  already-done task appeared in a not-yet-done group (old rule was "status ≠
  button target"). At least one label is required per section.
- **A past date now includes today** (Asia/Jerusalem) — `date ≤ today` counts
  as overdue (was strictly before today).
- **Email date-column header** is the ORIGINAL board column title
  (`dateColumnTitle`), captured when the column is picked, HTML-escaped.
- Admin UI: each section gets a multi-select of the button's status-column
  labels; the date-column title is captured on pick; a board switch clears the
  section's date + status condition.
- Server validation extended (dateColumnTitle non-empty; includeStatusLabelIds
  non-empty ints ≥0). Spec V4 Amendment + schema updated.
- Tests: digest-service / digest-email / admin-api-digest / draft-digest
  re-gated (green + 8 killed mutations total); full suite 452 green.

## 0.5.1 — 2026-07-20 — digest: board pickers filter by object type

- Both board pickers (tasks board + users board) now show only **real
  work-management boards** — `fetchBoards` requests `object_type_unique_key`
  and keeps only boards (drops sub-item boards, portfolios, docs, custom
  objects), mirroring the tracker's PortfolioPickStep filter. `isRealBoard`
  is robust to the namespace form (`board` / `work-management::board`).
- Tests: `services/monday.boards.test.ts` (red→green + 2 killed mutations).

## 0.5.0 — 2026-07-19 — v4 phase 1: per-user digest email (manual)

- **Digest email per user** (spec V4 Amendment Phase 1; design log
  `docs/v4-digest-decisions.md`): one email per user with all their pending
  tasks, replacing per-task email fatigue. Recipients from a dedicated USERS
  BOARD (people column ↔ email column); tasks matched by person-id
  intersection with the tasks board's people column. Pending = date passed
  (strict, Asia/Jerusalem) + status not at the section button's target.
- **Server**: `services/digest-service.js` (pure matching/classification),
  `services/email-sender.js` (Resend funnel; `RESEND_API_KEY`+`DIGEST_FROM`),
  `helpers/digest-email.js` (email-safe RTL renderer, REAL v3 `/confirm`
  links per task), `monday-api.js#getBoardItems` (items_page cursor
  pagination, truncation surfaced), admin routes
  `GET /api/digest/preview` + `POST /api/digest/send` (manual-only phase 1).
- **Admin UI**: two tabs — "הגדרות" (unchanged v2 flow) + new "מייל מסכם"
  (enable toggle, users-board mapping, section rules, saved-config preview
  iframe, two-step manual send with per-recipient results). Nothing removed.
- **Success page auto-close**: `/confirm` success page closes itself ~2s
  after render (visible fallback); invalid/bad-request pages stay JS-free
  (spec §7 amended).
- **Tests**: 8 new gated test files (red→green + 16 killed mutations, 0
  survivors); full suite 436 green. Two existing tests amended to the new
  pinned contract (success-page script allowance; config normalizes
  `digest: null`).
- **Pre-release gate (owner, local)**: sandbox probe of `getBoardItems`
  shapes + `/monday-api check` — authored in a tokenless cloud session; see
  `tests/fixtures/README.md`.

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
- **Follow-up (delivered):** the previously-deferred client admin-SPA telemetry landed, fully
  TS-clean under the strict `tsc --noEmit` gate — new `src/client/admin/utils/{logger,axiomBrowserTransport,
  axiomErrorSink,viewTracking,latency}.ts` (TS ports of the error-guard templates), `attachAxiomSink()`
  in `main.tsx` before render + one-shot boot health, `useViewTracking(logger,'admin_settings')` in
  `App.tsx`, every raw `console.error` catch (ErrorBoundary / App / services) replaced with `logger.*`,
  and bucketed `api_latency` health in `services/api.ts` + `services/monday.ts`; sink stays inert unless
  the `VITE_AXIOM_*` gate passes in a prod build. Also (Fable #6) the **server** sink now stamps `ev.ver`
  (app version) + `ev.sess` (per-process id) for release/process correlation — the legacy line writers
  stay byte-locked (tests/core-output.test.js green).

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
