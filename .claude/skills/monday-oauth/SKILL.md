---
name: monday-oauth
description: "monday.com auth + OAuth 2.1 — which secret verifies what, and the full OAuth 2.1 flow (PKCE S256, expiring access tokens, single-use rotating refresh tokens, 6-month lifetime, revocation). Use when adding monday OAuth to a NEW app, migrating a legacy OAuth app, wiring sessionToken verification, or debugging auth. Trigger on: oauth, code_challenge is required, invalid_grant, PKCE, refresh token, token expired, sessionToken, client secret vs signing secret, authorize button, revoke; and on the user's phrases: אימות מאנדיי, טוקן פג, חיבור OAuth."
---

# monday-oauth — auth model + OAuth 2.1

The failure mode this skill exists to end: an app's authorize button dies in
production with `Invalid request — code_challenge is required` (or a token
silently stops working after 6 months) because the code speaks monday's
LEGACY OAuth while the app version enforces the NEW flow — or a developer
verifies a token with the wrong secret and burns hours on
"invalid signature".

**Reference implementation:** `apps/telemetry-dashboard` (Change #144) —
router `src/routes/oauth.js`, endpoint client
`src/services/monday-oauth-client.js`, refresh provider
`src/services/oauth-token-provider.js`, record + state storage
`src/services/storage.js`, tests `test/oauth*.test.js`. The templates in
`templates/` are vendored copies of those files — canonical source is the
app; fix there first, then re-sync the template.

Authority note: monday's docs are the upstream authority
(developer.monday.com/apps/docs/migrating-to-the-new-oauth-flow). When this
skill and a doc under `docs/` disagree, THIS SKILL wins — fix the doc.

## 1. Which secret verifies what (the #1 confusion)

Two DISTINCT per-app secrets live on the app's Basic Information page.
They are never interchangeable:

| Inbound thing | Verify with | Where |
|---|---|---|
| `sessionToken` (iframe `monday.get("sessionToken")`) | **Client Secret** | `jwt.verify(token, MONDAY_CLIENT_SECRET)` — see any app's `middlewares/session-token.js` |
| OAuth token exchange (`client_secret` param) | **Client Secret** | token endpoint POST |
| App-lifecycle webhooks (install/uninstall/subscription) | **Client Secret** | telemetry-dashboard `middlewares/webhook-auth.js` |
| Board webhooks, integration-recipe JWTs (`shortLivedToken`), custom-trigger subscribe/unsubscribe, monetization | **Signing Secret** | integration-scaffold `authentication.js.template` |

Symptom map: sessionToken verified with the SIGNING secret → "invalid
signature". Webhook verified with the CLIENT secret → 401s on every
delivery.

## 2. When you need OAuth at all

`sessionToken` only IDENTIFIES the caller (account/user) to your backend —
it is not an API token. Seamless auth (`shortLivedToken`, 5-min) covers
in-request work in integration recipes. You need a stored **OAuth access
token** exactly when the app calls the monday API **outside a user request**
— background jobs, webhook-driven writes, crons. If you never do that, you
do not need this flow.

## 3. OAuth 2.1 — the flow (NEW apps start here)

Endpoints (well-known:
`auth.monday.com/oauth_ms/.well-known/oauth-authorization-server`):

- Authorize (UNCHANGED from legacy): `GET https://auth.monday.com/oauth2/authorize`
- Token (NEW): `POST https://auth.monday.com/oauth_ms/oauth/token`
- Revoke (NEW): `POST https://auth.monday.com/oauth_ms/oauth/revoke`

Non-negotiables of the new flow:

1. **PKCE S256 is mandatory** (`plain` rejected). Verifier =
   `crypto.randomBytes(32).toString('base64url')` (43 chars; 43–128 allowed);
   challenge = `createHash('sha256').update(verifier).digest('base64url')`.
2. **Access tokens EXPIRE.** No `expires_in` in the response — decode the
   access-token JWT's `exp` claim (DECODE, never verify: monday issued it,
   you have no key; use it for refresh scheduling only).
3. **Refresh tokens are SINGLE-USE and rotate**: every refresh returns a new
   `refresh_token` — persist the newest, discard the old. Concurrent
   refreshes burn the rotation → serialize them (single-flight mutex; see
   `templates/oauth-token-provider.js.template`).
4. **6-month max lifetime** from the ORIGINAL authorization (anchor it in
   the stored record as `obtainedAt`). After that the refresh token dies
   permanently (`invalid_grant`) — the ONLY fix is a fresh authorize, so the
   UI must surface a re-authorize CTA (`reauth_required` state).
5. `Authorization` header to the monday API stays the RAW token (no Bearer).

Wiring order for a new app (mirror the reference implementation):

1. `/oauth/start`: issue a single-use expiring `state` nonce (SecureStorage
   `oauth_state:<nonce>` = `{createdAt, verifier}`, 10-min TTL,
   delete-then-check consume) + PKCE pair; redirect with `response_type=code,
   state, code_challenge, code_challenge_method=S256` (+ `app_version_id`
   when testing a draft version).
2. `/oauth/callback`: require code AND state → consume the state (replay /
   expiry → 400) → exchange with `grant_type=authorization_code` +
   `code_verifier` → store the token RECORD:
   `{v, accessToken, refreshToken, expiresAt, obtainedAt, refreshedAt, status}`.
3. Every API consumer resolves the token through a PROVIDER, never reads the
   record directly: fresh (> 5-min cushion) → passthrough; else single-flight
   refresh, persist rotation, `invalid_grant` → flag `reauth_required`;
   transient failure → return the stale-but-unexpired token.
4. Disconnect: revoke refresh + access (best-effort, `token_type_hint`),
   ALWAYS clear the stored record.
5. Dev Center (per VERSION): OAuth & Permissions tab → enable **New OAuth
   Flow** on the draft → register redirect URI EXACTLY → test via
   "Active for me" → promote.

PRIVACY invariant (error-guard adjacent): the authorization code, state
nonce, PKCE verifier and BOTH tokens never reach any logger — log machine
codes only. Test it (see the reference `allLoggerArgs` sweep).

## 4. Migrating a LEGACY app (runbook)

Legacy = authorize without PKCE + token exchange at
`auth.monday.com/oauth2/token` + non-expiring token stored as a bare string.
It keeps working ONLY while the app version has the New OAuth Flow toggle
OFF — deprecated, borrowed time. A version created on the new flow rejects
legacy code with `code_challenge is required`.

1. **Storage first**: bare token string → record. Keep reading legacy
   strings (normalize to a non-expiring record with `refreshToken: null`,
   never refreshed) so existing installs survive the deploy. (Reference:
   `normalizeOwnerToken` in telemetry-dashboard's `storage.js`.)
2. Add the state+PKCE `/start`, new-endpoint `/callback`, provider, and
   disconnect exactly as §3. If the app already has a state nonce (e.g.
   deadline-confirm), just add `verifier` to the existing state record.
3. Tests: red-first on the new contracts (PKCE derivation, replay, rotation,
   mutex, invalid_grant) + mutation spot-checks (test-guard).
4. Dev Center: new DRAFT version → toggle ON → set `MONDAY_APP_VERSION_ID`
   env so `/start` targets the draft (`app_version_id`) → authorize → verify
   → promote → clear the env var.
5. Existing stored legacy tokens keep working until users re-authorize; the
   re-auth upgrades them to rotating records.

### Per-app migration status (this repo)

| App | Status | Notes |
|---|---|---|
| telemetry-dashboard | ✅ OAuth 2.1 (reference) | PR #340, Change #144 |
| deadline-confirm | ⏳ legacy, WORKING | Follow-up PR: add `verifier` to its `oauth_state:` record, switch endpoint + `code_verifier`, per-account records replacing bare `setOauthToken`, an `ensureFreshMondayToken(scopedStorage)` used by confirm-service / digest / admin `/api/state`, `'broken'` → `'reauth_required'`. `MONDAY_APP_VERSION_ID` already exists there. |
| sync-calender | ⏳ legacy, deploy broken | When revived: mirror its OWN Microsoft pattern (`providers/microsoft/oauth.js` `ensureMicrosoftAccessToken`) for monday tokens on sync_config records (`mondayAccessToken` + add `mondayRefreshToken`/`mondayTokenExpiresAt`). |

## 5. Vendoring convention

`packages/shared` is FORBIDDEN for server runtime (monday-code deploys the
app root only — workspace deps do not resolve). Each server app keeps a
SELF-CONTAINED copy of the four modules; `templates/` here is the canonical
cross-app source, synced FROM the reference app after review. Divergences
must be deliberate and commented (deadline-confirm's per-account tenancy,
sync-calender's per-config records).

## 6. Troubleshooting

Full table + Axiom probes: `references/troubleshooting.md`. Headlines:
`code_challenge is required` → version is on the new flow, code is legacy
(migrate; do NOT hunt for a disable toggle — inside the new flow there is
none). `invalid_grant` on refresh → rotation burned (concurrent refresh), a
revoked grant, or the 6-month death → re-authorize. Replayed/expired state →
user idled >10 min on consent or a forged callback.
