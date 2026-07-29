# Changelog - deadline-confirm

*Auto-generated. Source: `~/.change-tracker/changes.db`*

## 0.10.1 — 2026-07-29 — fix: Gmail refused the AMP part (INTERNAL_ERROR)

The first real send worked — mail delivered, plain fallback rendered — but Gmail
would not display the dynamic part, reporting `INTERNAL_ERROR`. Two defects in
the outgoing message, both in `helpers/mime-alternative.js`:

- **Bare LF line endings in the AMP part.** The rendered amp4email document
  comes from a template literal, so its lines end in `\n`. The helper joined
  headers and boundaries with CRLF but passed the body through untouched — and
  RFC 5322 requires CRLF in a message body. The AMP part was therefore not
  syntactically a valid body. The `text/plain` fallback survived it (short, and
  clients are forgiving); Gmail's amp4email parser did not.
- **`Content-Transfer-Encoding: 8bit` on Hebrew content**, which declares raw
  octets above 127 and needs 8BITMIME support along the whole delivery path.

**Both parts are now base64** (`Content-Transfer-Encoding: base64`, wrapped at 76
characters per RFC 2045 §6.8). That is 7-bit safe, carries real CRLF, and — the
property that actually matters — passes the AMP document's bytes through
**unchanged**, since nothing downstream can rewrite a line ending inside a base64
payload. What Gmail decodes is exactly what was rendered.

Six regression assertions pin it: base64 declared and `8bit` absent, byte-for-byte
round-trip of an LF-bearing Hebrew AMP document, no bare LF anywhere in the
assembled body, the 76-character wrap, and no raw non-ASCII in the payload.

**Also:** `GET /health` reported `version: "dev"` on every deployment.
`getEnv()` never carried a version (the number is a package.json read, not an
env var) and `index.js` never passed one to `createApp`. It now reports the real
version — without it there was no way to tell from outside which version a
container was running, which is precisely what was needed while verifying the
0.10.0 live deploy.

- **Dropdown open-state is now per CELL, not per item.** An item legitimately
  appears in two clusters (due to start *and* due to finish). `dd.o` was keyed by
  `itemId`, so both menus opened on one tap. Key is now
  `<clusterIndex>_<itemId>`. The selection keys (`v`/`l`/`c`) stay per **item**
  deliberately — one wire value per task is what makes two conflicting statuses
  impossible, and the hidden input is still emitted exactly once per item.
- **Hover and press affordance** on the status triggers, the options and the
  submit button (`:hover` is permitted in amp4email; clients that ignore it fall
  back to today's flat look).
- **In-flight feedback:** a "שולח את העדכונים…" block plus dimming of the submit
  button and the dropdowns while the request is outstanding. Driven by the
  `amp-form-submitting` class amp-form stamps on the `<form>` itself, so the
  indicator cannot desync from the actual request state.

## 0.10.0 — 2026-07-29 — feat: Gmail sending wired end-to-end (T9/T9b/T9c)

Sending is live. The manual **"שליחה עכשיו"** button in the admin screen now runs
the whole flow — recipients from the users board, per-recipient task
classification, one signed AMP message each — and actually delivers. The
scheduler is intentionally still out of scope; the button is its stand-in.

- **Per-organization sending identity** (owner decision 2026-07-29, superseding
  D12/D13): every tenant connects a Gmail mailbox in its **own** Workspace under
  its **own** OAuth client. The record lives at `${accountId}:google_sender`, not
  an app-global key. This is what keeps DKIM aligned with the `From` domain —
  Gmail requires that alignment before it renders the AMP part at all, so a
  single vendor address would have broken dynamic email for every customer.
- **New:** `GET /oauth/google/start` + `/oauth/google/callback`. Admit gate is
  sessionToken + `ALLOWED_ACCOUNT_IDS` (empty roster = default deny). The Google
  state nonce lives in its own key namespace, so a monday-issued nonce cannot be
  redeemed at the Google callback.
- **New env:** `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`. Absent →
  no sender is constructed and `/api/digest/send` answers 409 as before.
- **Scopes:** `gmail.send` plus `openid email` (the sender address comes from the
  `id_token`, costing no API call). No mail-read scope, ever.
- **Token lifecycle:** one refresh per account per run, not per recipient.
  `invalid_grant` — and only `invalid_grant` — marks the connection dead, so a
  Google 5xx cannot silence a tenant. One forced-refresh retry on a 401.
- **Message assembly:** the `multipart/alternative` body passes through
  byte-for-byte (re-encoding would invalidate the AMP part); Hebrew subjects are
  RFC2047-encoded; CRLF in a recipient or subject is refused, not sanitized.
- **Admin:** new "שליחת מייל (Gmail)" section shows connect state and the sender
  address, and warns when the connected sender is **not** on
  `AMP_ALLOWED_SENDERS` — that combination sends mail whose every button 403s.
- Setup for a new organization: `docs/google-setup-guide.md`.

## 0.9.5 — 2026-07-28 — fix: distinct AMP errors + secret-rotate UX

- Every `/amp/confirm` failure path now returns a **distinct** `error` code and a
  Hebrew `message` tagged `[E1a]`…`[E10]` / `[E99]` (was collapsed into
  `bad_request` / `invalid` / generic "הקישור אינו בתוקף").
- Diagnose from the AMP pink error box or Network JSON: e.g. `bad_fields` [E3a],
  `bad_manifest` [E3b], `bad_slot` [E5], `bad_sig` [E6], `conflict_item` [E7b],
  `manifest_violation` [E8], `rate_limited_account` [E9].
- No ids in messages (no verification oracle). Map: `MESSAGES` in `src/routes/amp.js`.
- **Secret rotate:** `POST /api/secret/rotate` returns masked `secret` so the admin
  UI no longer depends on a follow-up `GET /api/state` (which could 500 and show
  both green success and "יצירת מפתח נכשלה"). Refresh failure is reported separately.
- Admin `internal_error` responses include `[admin <path>]` for Network diagnosis;
  SecureStorage failures are wrapped as `secure_storage_*_failed`.
- Merged with the 0.9.3 `detail` channel rather than replacing it: every AMP
  failure now carries BOTH its distinct `error` code + `[E…]` message and the
  machine `detail` that renders in the email body.

## 0.9.4 — 2026-07-28 — fix: a legacy config could not be saved at all + settings export/import

- **Production incident.** Saving from the admin panel failed with
  `PUT /api/config → 400 invalid_config`, so the operator could not change
  anything — and the digest kept running on the old stored config, which is why
  the preview showed no recipients and no tasks even though matching tasks
  existed on the board.
- **Cause: two of our own decisions collided.** 0.7.1 made reading a pre-0.6.0
  config non-throwing by defaulting a missing `section.dateColumnTitle` to `''`.
  The server, however, requires that field to be a **non-empty** string
  (`validateConfig`, pinned by `tests/admin-api-digest.test.js`). So a legacy
  config was loadable but permanently unsavable.
  It was invisible from the UI: `digestIsComplete` does not check the title, and
  the date dropdown renders its label from `dateColumnId`, so the screen showed
  a filled-in date column while the stored field was empty.
- **Fix on the client, not the server.** The title is derivable from the
  selected column, so `backfillDateColumnTitles` derives it at the save
  boundary, falling back to `'תאריך'` when the column cannot be resolved (the
  renderers already use that same fallback). Relaxing the server was rejected —
  it would mean weakening a locked test and admitting header-less sections into
  storage.
- **New: export / import settings as JSON** (owner request). The export carries
  BOTH the stored config and the on-screen draft — when a save is rejected, the
  difference between the two is the diagnosis. It contains configuration only:
  no link secret, no OAuth token (neither ever reaches the client). Import loads
  into the draft and does **not** save, so the operator reviews first.
- Tests: red → green + 3/3 mutations killed on `settings-io`. Suite 540 green.

## 0.9.3 — 2026-07-27 — fix: drop «ללא שינוי»; preview AMP uses live slot

- Status menu shows only the cluster's action buttons (no gray «ללא שינוי»).
- Unchanged tasks = leave the current-status trigger as-is (`item_<id>` stays empty).
- Admin preview AMP is signed with the **live clock** (not a fixed 09:00), so a
  copied document matches `/amp/confirm`'s current slot when tested immediately.
- Admin hint: playground submit needs `amp@gmail.dev` on `AMP_ALLOWED_SENDERS`.
- Admin `500 internal_error` now returns `message` + `detail` (name/message/stack);
  the SPA shows them on boot/save and logs the stack to the browser console.
- AMP submit-error shows machine `detail` in the **email body** (e.g. `bad_slot`,
  `bad_sig`, `missing_or_invalid_fields`) under the Hebrew message.

## 0.9.2 — 2026-07-27 — feat: AMP digest — amp-bind status dropdown (monday colors)

- Per-row status choice is a real **dropdown**: closed colored trigger → tap opens
  a popup of monday-colored options (`amp-bind` + `AMP.setState`).
- Trigger shows the **current status** (text + color); choosing an option updates
  the cell immediately via bind. Header: **סטטוס** (not «סטטוס חדש»).
  «ללא שינוי» restores the original status display and clears the wire value.
- Not native `<select>` (OS popup unstyleable) and not an always-open radio stack.
- Wire: hidden `item_<id>` with `[value]` bound to state (`""` = no change).
- Playground: `docs/amp-playground-cluster-tables.html`.

## 0.9.1 — 2026-07-27 — feat: AMP digest — styled label dropdown (`<select>`)

- Per-row status choice is a **styled** AMP-for-Email `<select class="label-dd">`
  (monday-like closed control: ~200×34, blue border `#0073ea`, Figtree). The OS
  popup panel itself cannot be restyled in Gmail/AMP.
- Options = that cluster's action buttons; empty option **ללא שינוי** = no write.
- Wire unchanged: `item_<id>=btnId`. Cluster tables + multi-button config kept.
- Playground sample: `docs/amp-playground-cluster-tables.html`.

## 0.9.0 — 2026-07-27 — feat: AMP digest — one table per cluster + multi-button columns

- **Layout:** one AMP table per populated מקבץ (cluster title + that cluster's
  date column only). No mega-table / LabelPicker chrome.
- **Multi-button:** each cluster may define `buttonIds[]` (admin multi-select);
  each button is a colored radio column. Primary `buttonId` (= first) still
  drives the status-column filter. Legacy configs with only `buttonId` work.
- **Wire unchanged:** one form, `item_<id>=btnId` radios, one **אשר את המסומנות**.
- Playground sample: `docs/amp-playground-cluster-tables.html`.

## 0.8.5 — 2026-07-27 — chore: redeploy draft after transient mapps failure

- Re-push of 0.8.4 AMP status-picker styling after monday `code:push` polling
  failed mid-deploy (`Unexpected error occurred while communicating with the
  remote server`). No product code change.

## 0.8.4 — 2026-07-27 — style: AMP status picker matches monday status-picker-wrapper-v2

- Picker column styled like monday's native status picker: **200px** wide,
  **10px** padding, thin blue border + soft shadow.
- Option labels: **34px** tall, **14px** / `font-weight: normal`, Figtree/Roboto
  stack (parity with discussions `statusOption` / monday wrapper ~200×313).
- Checked option outline uses monday blue `#0073ea`. AMP-safe (no `position`).

## 0.8.3 — 2026-07-27 — feat: digest AMP — LabelPicker-style status + all date columns

- **AMP digest UI:** monday-like board table; current status as `statusFill`;
  new status via inlined LabelPicker-style colored options (visual port of
  discussions `LabelPickerCell` / TaskTable — AMP cannot host React Dialog).
- **Dates:** every date column from digest settings appears as its own table
  column (`recipient.dateColumns` + `task.dates`).
- **Confirm:** empty `item_*` values are skipped (no-change), so a mixed
  selection still applies only the chosen statuses.
- One global **אשר את המסומנות** submits all chosen statuses.

## 0.8.2 — 2026-07-27 — feat: V6 T15/D9 — one table, one approve button

- **T15 / D9:** AMP digest is a single table with one radio column per status
  button and **one** global submit (`אשר את המסומנות`). No per-section forms.
- Tasks that appear under several digest sections get a union of those buttons
  on one row. Wire format (`a/p/m/s/sig` + `item_<id>`) unchanged.

## 0.8.1 — 2026-07-27 — feat: V6 T6c/T10–T12 (scheduler, D16, deny-all roster)

Continues V6 from `docs/v6-amp-only-decisions.md`. **Gmail OAuth / send funnel
(T9/T9b/T9c) deferred** until the Google Cloud app is provisioned — the
`emailSender` seam stays empty in production.

- **D16 / T6c:** one message per users-board row (no email dedup); multi-person
  rows skipped as `multi_person`.
- **D15 / T10b:** empty `ALLOWED_ACCOUNT_IDS` is default-deny (admin + OAuth +
  scheduler); boot error log when empty. **Breaking config change** — set the
  roster on the platform before this version goes live.
- **T10:** `POST /mndy-cronjob/digest-send` (+ `/scheduler/digest-send`) iterates
  the roster, runs tenants whose `sendHour` matches Asia/Jerusalem hour.
- **T11:** operator summary email after a scheduled run (`OPERATOR_EMAIL` env);
  counts/addresses/slot only.
- **T12:** `POST /api/digest/resend-today` — all recipients, current slot.
- **MIME helper:** `multipart/alternative` plain + `text/x-amp-html` (ready for T9).
- Manual/scheduled send path uses plain+AMP MIME via `runDigestForAccount` (no
  legacy HTML `/confirm` body).

## 0.8.0 — 2026-07-27 — feat: V6 AMP-only + per-message signed manifest

**Breaking product change.** See `docs/v6-amp-only-decisions.md`.

- **Deleted:** `/confirm` route family, snippet/email-template endpoints, Resend
  sender path, actionable HTML in digest preview.
- **Added:** `manifest-signature` module (build/parse/sign/verify/currentSlot);
  V6 wire format on `POST /amp/confirm` (`a/p/m/s/sig` + `item_<id>` radios);
  D11 runtime assignee check; two-bucket rate limit on AMP path.
- **Digest:** single `personId` per recipient; `text/plain` renderer; AMP renderer
  with one signature per message; preview returns `{ plain, amp }`.
- **Admin API:** rotate returns `{ ok: true }` only; `digest.sendHour` (0–23,
  default 8) in config validation.
- **SPA:** secret rotation without display; digest preview plain+AMP; sendHour field;
  legacy templates section (no HTML copy).
- Tests: 548 green; spotchecks on admin-api and draft sendHour.

## 0.7.3 — 2026-07-27 — fix: board pickers were empty (wrong discriminator field)

- **Reported from the admin panel:** the users-board dropdown rendered
  `No options`, so no recipient could be matched — the digest preview showed
  0 recipients and no pending tasks. **Both** board pickers were affected, not
  only the digest one; the app could not be configured from scratch at all.
- **Cause.** `fetchBoards` filtered on `object_type_unique_key`, asserting a
  standard work board returns `'board'`. Probed against the live API
  (2026-07, account with 1000+ objects) — the assertion is false:

  | field | what the API actually returns |
  |---|---|
  | `type` | `board` 330 · `sub_items_board` 80 · `custom_object` 56 · `document` 34 |
  | `object_type_unique_key` | `null` ×474 · `work-management::standalone` ×12 · `::portfolio-project` ×8 · `::project` ×4 · `::portfolio` ×2 |

  No board returns `'board'` for `object_type_unique_key`, and the field is
  `null` for 304 of the 330 real boards — and equally `null` for every document,
  sub-item board and custom object, so it cannot discriminate at all. The filter
  dropped **100%** of boards: 0/500 passed.
- **Fix.** `type` is the discriminator and is now primary.
  `object_type_unique_key` is kept only as a NEGATIVE signal (portfolios) and
  only when actually present, so it can never again exclude a board whose key
  is `null`.
- **Second defect, found while probing.** Page 1 returned exactly 500 objects
  and page 2 returned another 500 (262 of them real boards) — the single-page
  query **silently** hid boards, so any board not used recently was unreachable.
  `fetchBoards` now pages until a page comes back short, capped at 6 pages, and
  logs `board_list_truncated` if the cap is hit instead of swallowing it.
- **Why the old tests passed.** They invented the fixture
  (`object_type_unique_key: 'board'`) instead of capturing it from a probe, so
  they encoded the same wrong assumption as the code. `CLAUDE.md` requires
  monday-facing doubles to be built ONLY from probe-captured fixtures — that
  rule was violated, and 519 green tests could not catch a bug that made the
  feature unusable. Every fixture in the rewritten test now carries the probe's
  real shapes, with the distribution recorded in the file header.
- Tests: red observed (7 failing) → green, **3/3 mutations killed** — including
  one that reintroduces this exact bug and one that restores the silent
  truncation. Suite 526 green.

## 0.7.2 — 2026-07-27 — deploy hardening: client sourcemaps no longer reach production

- **Exposure, found by self-check.** The LIVE deployment was serving the admin
  SPA's sourcemap (`/admin/assets/index-*.js.map`, 2.4 MB) — 333 files with full
  `sourcesContent`, of which 19 are our own `src/client/**` sources. Verified
  that it carried **no credentials or secrets**: the client holds none, they live
  in the server's runtime env. Source exposure, not data or permission exposure.
- **Root cause was the pipeline, not the app.** The `Strip client sourcemaps
  before deploy` step was added to this app's workflows on `develop`
  (`8f0de56`), but `main` never received it — `main`'s last change to
  `deploy-live-deadline-confirm.yml` was `609a78a`, which predates it. Since
  deploy-live runs **`main`'s** workflow, every live deploy shipped the maps.
  Selective releases sync only `apps/<app>/**`, so pipeline improvements never
  travel to `main` on their own; they must be synced deliberately.
- **Fix:** `main` now carries this app's draft+live workflows as they exist on
  `develop`. The live deploy archives the maps as a 90-day build artifact (keyed
  by commit SHA, for stack symbolication) and then deletes them from
  `public/admin` before `code:push`, with a hard guard that **fails the deploy**
  if any `.map` survives — so this cannot silently regress.
- The same sync also activates the client error sink in the live build
  (`VITE_AXIOM_*`), which `develop` already did for draft. Behaviour change to
  note: the live admin SPA now reports client errors to the shared `app-errors`
  dataset, as every other app in the monorepo does.
- No application code changed. The version bump reflects a changed deployed
  artifact: production no longer serves `.map` files.

## 0.7.1 — 2026-07-26 — hotfix: admin SPA crashed at boot on a pre-0.6.0 digest config

- **Production incident.** v0.6.0 added two required digest-section fields
  (`includeStatusLabelIds`, `dateColumnTitle`) but `digestFromConfig` spread the
  array unconditionally. Accounts whose digest had been saved by an earlier
  version stored sections without those keys, so the moment v5 became the LIVE
  version the admin panel died at boot with
  `TypeError: a.includeStatusLabelIds is not iterable` — the whole SPA, not just
  the digest tab.
- **Fix:** reading a stored config never throws. A missing status condition
  becomes `[]` and a missing date-column title becomes `''`;
  `digestIsComplete` then reports the digest as incomplete, so the operator is
  asked to pick labels instead of the panel crashing or a condition being
  invented.
- The SERVER was never affected (`digest-service` reads `?? []`, validation runs
  only on write) — this was purely the client read path.
- Tests: `src/client/admin/draft-digest-legacy.test.ts` (red→green + 2 killed
  mutations) pins the legacy shape AND that a current config is untouched
  (including array copy, not aliasing). Full suite 519 green.

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

## 2026-07-22 — Client sourcemaps for stack symbolication

### 🔧 Infrastructure

- **2026-07-22** — The browser-served client bundle now builds `sourcemap: 'hidden'` instead of `true`; CI archives `public/admin/**/*.map` as artifact `sourcemaps-deadline-confirm-<sha>` then strips them before `mapps code:push`. This also closed a prior leak (the client maps were served publicly). Server code runs from source (`node ./src/index.js`, unbundled) — already-readable stacks, not symbolicated. (#361)
  - _Why:_ minified client `stack1` frames were uninvestigable, and `sourcemap: true` served source maps publicly.
  - _Done:_ Part of the portfolio-wide rollout; see `docs/LOGGING-ARCHITECTURE.md` §6.

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
