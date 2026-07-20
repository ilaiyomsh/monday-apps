# Server-side apps: draft vs live URLs — keeping BOTH versions stable

**Applies to:** monday-code (server-side) apps in the pipeline — the ones that
serve HTTP endpoints and/or OAuth from their own deployment (e.g.
`deadline-confirm`, `axis-sync-calender`). Client-side/CDN apps do not have
this problem (no per-version server URL).

**Discovered:** 2026-07-20, wiring `deadline-confirm` (v4 digest) — the app
served OAuth + `/confirm` from `BASE_URL`, and the draft/live URL mismatch
broke testing until the fields were mapped correctly.

## The core fact that causes all the confusion

Every deployed **version** of a monday-code app gets its **own server URL**.
The **live** version has a stable URL; each **draft** version has a *different*
URL. So any developer-center field or env var that hard-codes a URL is
version-sensitive — set it wrong and OAuth/callbacks/links hit the wrong
deployment.

Three kinds of URL-bearing config, and how each scopes:

| Config | Scope | Can hold multiple? |
|---|---|---|
| **`BASE_URL`** (and any URL env var) | **app-level — ONE value shared across ALL versions** (`mapps code:env -i <APP_ID>`) | No — single value |
| **OAuth Redirect URIs** (OAuth section) | app-level | **Yes — register several** |
| **Feature URL** (view/object/widget) | **per-version** (each version's build config) | one per version |

Two platform facts that make a shared `BASE_URL` survivable:

- **SecureStorage is per-APP, shared across versions.** A token/config written
  by the live deployment is readable by the draft deployment (and vice-versa).
- The action endpoints (`/confirm`, webhooks) are usually **version-stable**
  mechanisms — the live deployment can safely service links a draft composed.

## What the CODE actually depends on — check before mapping

Grep the server for how it builds URLs, because that decides which field
matters. For `deadline-confirm`:
- `routes/oauth.js`: `redirectUri = ${env.baseUrl}/oauth/callback` → **`BASE_URL`
  drives the OAuth callback destination.**
- `helpers/digest-email.js` / `snippet.js`: `/confirm` links are built from
  `BASE_URL` → **`BASE_URL` drives where email buttons point.**

If a different app derives URLs elsewhere, map those instead — the principle
holds, the field names may differ.

## Recommended stable mapping (shared-env case — the common one)

| Field | Value | Why |
|---|---|---|
| `BASE_URL` (env) | the **LIVE** URL | Single shared value → pin it to live so production (OAuth + links) is always correct. |
| OAuth Redirect URIs | **both** `<LIVE>/oauth/callback` **and** `<DRAFT>/oauth/callback` | Multiple allowed; future-proofs draft OAuth at zero cost. |
| Feature URL — live version | `<LIVE_URL>` | per-version |
| Feature URL — draft version | `<DRAFT_URL>` | per-version — never cross them |

**Why draft testing still works with `BASE_URL`=live:**
- Admin/view loads from `<DRAFT_URL>` (draft feature URL) → runs draft code. ✓
- OAuth from draft → returns to `<LIVE>/oauth/callback` → token in shared
  SecureStorage → **draft reads it.** ✓
- Draft-composed action links point to `<LIVE>/confirm` → live services them
  (mechanism is version-stable). ✓
- **Only caveat:** a change to `/confirm` or `/oauth` *behavior* itself is
  exercised on live (via `BASE_URL`), so you won't see the draft's version of
  those endpoints until promoted. View/API/business-logic changes test fine on
  draft.

## If env vars turn out to be per-version (verify first)

Open the env in BOTH the live and draft version in the developer center:
- **Same values shown → env is shared** (app-level) → use the mapping above.
- **Different per version → env is per-version** → simplest of all: set
  `BASE_URL=<that version's own URL>` in each version, and each is fully
  self-contained.

## Getting the URL values

Developer center → each version → **Host on monday → Server-side code →
General** shows that deployment's URL. Or `mapps code:status -i <APP_VERSION_ID>`.

## Relationship to the pipeline

- **develop → draft**, **main → live** is the two-version model. This page is
  how a *server* app keeps both stable while that model runs.
- Prefer the pipeline for production (`main` merge → deploy-live) over the
  developer-center **"Promote to live"** button — manual promotion bypasses the
  CI gate and the release freeze, and leaves `main` not reflecting live. Manual
  promotion is a POC convenience, not the release path.
- URL mechanics themselves (per-version deployment URLs, env scoping, manifest
  feature URLs) are monday-code platform behavior — deeper detail lives in the
  **mapps** skill (`references/app-lifecycle.md`).
