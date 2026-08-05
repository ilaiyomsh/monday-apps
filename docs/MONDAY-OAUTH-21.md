# monday OAuth 2.1 — the unified standard

One standard for every app in this monorepo that holds a monday API token
beyond a user request. This document is the map + adoption status; the
**authority on the pattern is the `monday-oauth` skill**
(`.claude/skills/monday-oauth/`). When the two disagree, the skill wins —
fix this doc.

## The goal

Every app authenticates monday traffic with the right secret (sessionToken
→ Client Secret; webhooks/triggers → Signing Secret) and obtains background
API access via **OAuth 2.1**: PKCE S256, single-use CSRF state, expiring
access tokens (JWT `exp`), single-use ROTATING refresh tokens, a 6-month max
lifetime surfaced as a re-authorize CTA, and best-effort revocation on
disconnect. No legacy `oauth2/token` exchanges, no bare-string token
storage, no token material in any log.

## Why now (fixed facts)

monday's legacy OAuth (non-expiring tokens, no PKCE) is deprecated. The
**New OAuth Flow toggle is per app VERSION** in the Developer Center, and
newly created apps land on the new flow — telemetry-dashboard's authorize
button failed in production with `code_challenge is required` until Change
#144. Apps still on legacy keep working only until their version flips.

## Per-app adoption

| App | Status | Delivery |
|---|---|---|
| telemetry-dashboard | ✅ **OAuth 2.1 — reference implementation** (PR #340, Change #144) | `src/routes/oauth.js` + `src/services/{monday-oauth-client,oauth-token-provider,storage}.js` |
| deadline-confirm | legacy, working (version toggle OFF) | Follow-up PR planned — outline in the skill's §4 table |
| sync-calender | legacy, deployment currently broken | Guide-only until revived — mirror its own Microsoft `ensureAccessToken` pattern |
| all other apps | n/a — no background monday API access | sessionToken / seamless auth only |

## Runbooks

- **New app with OAuth** → skill §3 (quickstart) + `templates/`.
- **Migrating a legacy app** → skill §4 (runbook incl. the Dev-Center
  per-version toggle steps and `MONDAY_APP_VERSION_ID` draft testing).
- **Debugging** (`code_challenge is required`, `invalid_grant`, invalid
  signature, silent 6-month death) → `references/troubleshooting.md` +
  its Axiom probes.

## Enforcement

- test-guard: OAuth contracts are locked by red-first tests + mutation
  spot-checks in the reference app (`test/oauth*.test.js`).
- error-guard: every OAuth catch logs a machine code; the privacy invariant
  (no code/state/verifier/token in any log call) has its own test sweep.
- Vendoring: server apps keep self-contained copies (`packages/shared` is
  forbidden for server runtime); the skill's `templates/` are the canonical
  cross-app source, synced from the reference app.
