# HANDOFF — deadline-confirm V5 (Gmail dynamic email / AMP for Email)

**From:** cloud session (Claude Code on the web), 2026-07-26
**To:** local agent on the owner's Mac, repo `~/monday-apps`
**Read `CLAUDE.md` (root) and `apps/deadline-confirm/CLAUDE.md` first.** This file
only carries what is NOT in the repo: live state, deviations, and open items.

---

## 1. What was built

The client's organization runs **Google Workspace (Gmail)**, so Outlook
Actionable Messages / Adaptive Cards is off the table (Outlook-only rendering).
Gmail's equivalent is **AMP for Email**, which Gmail calls **dynamic email**.

V5 adds a `text/x-amp-html` part to the digest email: one `<amp-form>` per
section, **a checkbox per task**, one submit per section — several tasks
confirmed in one click, inside the message. Added **alongside** the v4 digest:
the static `text/html` body with per-task links is unchanged and remains the
universal fallback, so any client that does not render AMP shows exactly the
old email. That graceful degradation is a locked property.

New code (all on `develop`):

| File | Role |
|---|---|
| `src/helpers/amp-cors.js` | AMP-for-Email CORS resolver. Both documented variants: v2 `AMP-Email-Sender` → `AMP-Email-Allow-Sender`; v1 `Origin` + `?__amp_source_origin` → `Access-Control-Allow-Origin` + `AMP-Access-Control-Allow-Source-Origin` + `Access-Control-Expose-Headers`. v2 wins when both present. **Default deny**; wildcard `*` deliberately unsupported. |
| `src/helpers/digest-amp.js` | amp4email renderer. Link secret in hidden inputs only, never in a URL. |
| `src/routes/amp.js` | `POST`/`OPTIONS /amp/confirm` — the app's ONLY bulk mutation path (cap `MAX_ITEMS = 50`). |
| `src/helpers/environment.js` | `+ AMP_ALLOWED_SENDERS` parsing (trim/lowercase/dedupe). |
| `src/routes/admin-api.js` | `GET /api/digest/preview` also returns `amp`. |
| `src/client/admin/{types.ts,draft.ts,components/DigestSection.tsx}` | `amp` type + copy-AMP button + the 0.7.1 legacy-config guard. |

`/amp/confirm` gate order is a **security contract** (module header is
authoritative): CORS gate FIRST (pure header work → an unlisted sender never
reaches storage and cannot probe whether a secret is valid; a rejection carries
**no** CORS headers so the email client discards it) → validate `a`,`k`,`btn`,
`item[]` → secret gate (constant-time, account-scoped) → rate limit → 
`performAction` per item (the SAME engine as `/confirm`, so already-at-target
stays a silent success and nothing is written twice). JSON replies carry counts
+ a Hebrew message only; authorized-but-nothing-updated answers **502** so the
reader sees the error template, not a green one.

Docs: `docs/spec.md` → **V5 Amendment**; `docs/v5-gmail-dynamic-email.md`
(design log, enablement paths, phase-2 sender); `CHANGELOG.md` 0.7.0 + 0.7.1.

Tests: `tests/{amp-cors,amp-route,digest-amp,environment-amp,admin-api-amp}.test.js`
+ `src/client/admin/draft-digest-legacy.test.ts`. All test-guard gated
(red→green + 11 killed mutations total, 0 survivors). **Full suite 519 green**,
`tsc --noEmit` and `eslint` clean, SPA build passes.

---

## 2. Git state

- Work branch: **`claude/deadline-app-x3ec20`** (already merged twice).
- **PR #430** — V5 feature → merged into `develop`.
- **PR #432** — 0.7.1 hotfix → merged into `develop` as `31715d7`.
- `apps/deadline-confirm/package.json` version: **0.7.1**.
- **`main` is 428 commits behind `develop`** and **does NOT contain V5.**

### ⚠️ The single most dangerous fact in this handoff

Production got V5 by a **manual promote in the Developer Center**, not through
the pipeline. So the live app version runs V5 while `main`'s git history does
not contain it. **Any merge into `main` right now runs
`🚨 FORCE DEPLOY deadline-confirm TO LIVE 🚨` with `main`'s pre-V5 code and
rolls production backwards, deleting `/amp/confirm`.** Do not merge anything
into `main` until the gap is closed.

**Closing the gap (prepared, not pushed — a selective release, monday-cicd Mode 5):**

```bash
git checkout -B release/deadline-confirm-v0.7.1 origin/main
git checkout origin/develop -- apps/deadline-confirm
pnpm install --lockfile-only     # develop added @axiomhq/js to this app; CI runs --frozen-lockfile
git commit -am "release(deadline-confirm): sync main with develop (v0.7.1) — selective"
# PR → main → merge → deploy-live runs on Actions and pins the correct live version id
```
A full `develop → main` merge is the WRONG instrument here: 428 commits across
six apps would go to production at once.

---

## 3. Platform state (verify, don't trust — it changed several times today)

| Thing | Value at handoff |
|---|---|
| App ID | `11704868` (dev-center slug `yomsheni-il_status-email`, display name "Status Email") |
| Versions | **v6 = Draft** (new, empty until a draft deploy runs) · **v5 = Active + Live** · v1–v4 Deprecated |
| LIVE URL | `https://live1-service-14334098-a8e0a0f6.us.monday.app` |
| Former draft URL | `https://a4ba6-service-14334098-a8e0a0f6.us.monday.app` (this is where V5 was verified BEFORE v5 was promoted) |
| OAuth redirect URLs | both `live1-…/oauth/callback` and `a4ba6-…/oauth/callback` are registered ✅ |
| `BASE_URL` (env, app-level) | **currently the a4ba6 (draft) host** — must go back to the live1 host once live serves V5 |
| `AMP_ALLOWED_SENDERS` | `amp@gmail.dev` (the AMP playground's sender) — set by the owner |
| `RESEND_API_KEY` / `DIGEST_FROM` | set; `DIGEST_FROM = Deadline <onboarding@resend.dev>` (POC only) |

**Open uncertainty:** v5 was promoted from draft to live *after* we verified
`/amp/confirm` on the a4ba6 host. Whether a4ba6 still serves it, and whether
live1 now serves V5, was never re-verified. **Re-verify both hosts** (§5).

---

## 4. Immediate next action

The owner decided to push to LIVE **from the machine**, overriding the repo's
"deploys only on Actions runners" rule for this app. Ask them to reconfirm
before running it; the by-the-book alternative is §2's selective release.

From the repo root:

```bash
git pull origin develop
pnpm install --frozen-lockfile
pnpm --filter "./apps/deadline-confirm" build
rm -f apps/deadline-confirm/public/admin/assets/*.map   # CI strips these; never ship .map
LIVE_ID="$(mapps app-version:list -i 11704868 | awk -F'│' '$7 ~ /live/ {gsub(/[^0-9]/,"",$3); print $3; exit}')"
echo "LIVE_ID=$LIVE_ID"        # MUST be v5's id — stop if empty or wrong
mapps code:push --force -d apps/deadline-confirm/. -i "$LIVE_ID"
```

**`-i <LIVE_ID>` is not cosmetic.** `code:push --force` without a pinned version
resolves the app's **NEWEST** version — now **v6, the draft** — and you would
believe you fixed production while it stayed broken. Incident-verified
2026-07-15; that is exactly why `deploy-live-deadline-confirm.yml` resolves the
live id and pins it.

Then:
1. Open the admin panel — if it loads, the 0.7.1 incident is closed.
2. Set `BASE_URL` back to `https://live1-service-14334098-a8e0a0f6.us.monday.app`
   (**env is read at process boot** — a redeploy/restart is required for it to
   take effect; this already cost us an hour once with `DIGEST_FROM`).
3. Run the §5 verification against live1.

---

## 5. Verification that needs no secrets and mutates nothing

```bash
U=https://live1-service-14334098-a8e0a0f6.us.monday.app
curl -i -X OPTIONS $U/amp/confirm
#   expect 403 + {"error":"no_amp_headers"}         → V5 code is deployed here
#   404                                             → this host has no V5
curl -i -X OPTIONS -H "AMP-Email-Sender: amp@gmail.dev" $U/amp/confirm
#   expect 200 + header amp-email-allow-sender: amp@gmail.dev
#                    + access-control-allow-methods: POST, OPTIONS
#   403 not_configured                              → AMP_ALLOWED_SENDERS not loaded → restart needed
```
Both passed against the a4ba6 host at 16:15 UTC today, before the promote.

---

## 6. The end-to-end Gmail test (the whole point — still not done)

Gmail-side enablement is already handled: the Workspace admin confirmed
**Dynamic email** is enabled (Admin console → Apps → Google Workspace → Gmail →
User settings → Dynamic email), and the owner allow-listed `amp@gmail.dev` under
Gmail → Settings → General → Dynamic email → **Developer settings**.

1. Admin panel → tab **"מייל מסכם"** → תצוגה מקדימה → **"העתק גרסת AMP"**.
2. **playground.amp.dev**, format **Email** → paste. The validator here is the
   **first real AMP validation** — the document was built against the spec and is
   locked by 20 tests, but `amphtml-validator` could not run in the cloud session
   (network policy blocks `cdn.ampproject.org`). If it errors, fix and re-verify.
3. **Send to Gmail** → open in Gmail → tick 2 tasks → submit.
4. Expected: statuses change on the real board, and the message shows
   "עודכנו 2 משימות" inside the email.
5. Observe the request itself: Gmail web → DevTools → Network → Fetch/XHR shows
   the POST payload (`a`,`k`,`btn`,`item=…&item=…`) and the JSON reply.
   Server side: one log line per item (`outcome: ok / already_done / …`).
6. **Afterwards: rotate the link secret** from the admin panel. The AMP document
   carries the real `k`, and it passed through a third-party tool (the playground).

If the copy-AMP button is missing, the admin is loading the **wrong app
version** — the feature URL is per-version. Fix with Developer Center → the
version → **"Set as active for me"** (per developer, per version, no CLI exists).
A new feature *instance* does not change which version loads.

---

## 7. Open items

1. **`main` ↔ live divergence** (§2) — highest priority after production is healthy.
2. **`BASE_URL` back to live1** + restart.
3. **Rotate the link secret** after the playground test.
4. **`getBoardItems` sandbox probe** — still open from v4. The GraphQL shapes
   (`items_page` → `next_items_page`, typed Status/Date/People fragments) were
   authored in a tokenless cloud session and never probed. Pre-release gate:
   probe in sandbox workspace `TEST_WORKSPACE_ID=16291824` with `WZ-` prefixed
   scratch objects, then `/monday-api check`. See `tests/fixtures/README.md`.
   **This code is already in production** — the gate was crossed by the manual
   promote, so treat it as debt to retire, not a blocker.
5. **Phase 2 — sending the AMP MIME part.**
   > **SUPERSEDED 2026-08-04.** The "chosen direction" below was implemented and
   > then **disproven by live sends** (`docs/amp-email-verified-findings.md` §2,
   > §5): `users.messages.send` strips the `text/x-amp-html` part on external
   > delivery, and SMTP AUTH rejects `gmail.send`. The shipped channel is SMTP
   > XOAUTH2 (`src/services/smtp-sender.js`) with the broad scope
   > `https://mail.google.com/` (owner decision, testing phase). Kept for history.

   Not wired. Resend's support for
   `text/x-amp-html` is undocumented. Chosen direction: a dedicated Google
   Workspace mailbox via Gmail API `users.messages.send` with raw RFC822, scope
   **`gmail.send` only** (send, never read) — same least-privilege story as the
   security doc, and DKIM aligns for free. MIME layout:
   `multipart/alternative` with `text/plain` + `text/x-amp-html` + `text/html`,
   **AMP part before the HTML part** (some clients render only the last part).
   For org-wide reach without per-user allow-listing, the sender address must be
   registered with Google (`ampforemail.whitelisting@gmail.com` + form, ~5 working
   days, requires SPF+DKIM with `d=` aligned to the From domain — note Workspace
   DKIM is **not** on by default and must be generated under Gmail → Authenticate
   email).
6. **Per-task status dropdown** variant (`<select>` per row instead of a
   checkbox) — format supports it, mock shown to the owner, no decision.
7. **Security-review document** for the client's infosec lead was written for the
   **Microsoft/Adaptive Cards** design and is now wrong for this client. It needs
   a Google rewrite. One substantive difference to state plainly: unlike Outlook
   Actionable Messages, an AMP form POST carries **no verified clicker identity** —
   the link secret in the email remains the only credential, exactly as in v3.
   The trust model did not improve; it stayed the same.

---

## 8. Gotchas learned today (do not rediscover)

- **CI does not run on PRs created via the API token.** `ci.yml` only listens to
  `pull_request`; events generated by the session's token do not trigger
  workflows, and `ci.yml` has no `workflow_dispatch`. PR #430 and #432 have
  **zero** check runs. Gate 1 was reproduced locally instead
  (`pnpm -r --if-present type-check` → 0, `lint` → 0, build, 519 tests).
  A local agent with normal `gh` auth should not hit this.
- **Push-triggered deploys DO run** (`deploy-draft` fired on the merge to
  `develop` and succeeded in ~6.5 min).
- Platform **env vars are read at process boot** — adding one does not take
  effect until a redeploy/restart.
- **Each app version has its own server URL**; `BASE_URL` is app-level (ONE
  value shared by all versions) while feature URLs are per-version. See
  `.claude/skills/monday-cicd/references/server-app-urls.md`.
- The 0.7.1 crash class: **v0.6.0 added required config fields without a read
  guard.** Any future required field in the stored config needs a default on the
  read path, or the SPA dies at boot for accounts holding older configs.
- The `error-guard` hook flags `logError(...)` catches as silent — a known false
  positive (its selector only accepts `logger.*`). Verify with real `npx eslint`,
  which passes; documented in the skill's known-issues.
- AMP specifics: `enctype="application/x-www-form-urlencoded"` is supported (so
  `express.urlencoded` parses the body); responses must be
  `Content-Type: application/json`; `target`/`action` are website-only
  attributes; redirects are disallowed at runtime; AMP part < 200,000 bytes and
  `<style amp-custom>` < 50,000; Gmail strips the AMP part on reply/forward and
  may stop rendering it after ~30 days.

---

## 9. Rules that still bind

- **Never push to `main`.** `main` is merged only via an approved PR from
  `develop` (or a selective release branch), and the agent is the enforcement
  layer — protection is discipline-only on this GitHub plan.
- `MONDAY_TOKEN` is **user-only**: never read, print, set or commit it. Agent-side
  monday API calls go through `.claude/skills/mapps/mapps-api.sh`.
- API probes and destructive tests **only** in sandbox workspace
  `TEST_WORKSPACE_ID=16291824`, scratch objects prefixed `WZ-`.
- test-guard and error-guard bind every change; the hook message IS the fix.
- `git commit` is autonomous; **`git push`, production merges and destructive
  operations each take exactly ONE confirming question.**
- The owner has authorized local `mapps code:push` **for this app, this session**,
  as a deliberate deviation. It is not a new default — reconfirm each time, and
  keep §2's gap-closing on the table.
