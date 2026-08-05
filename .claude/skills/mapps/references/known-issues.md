# mapps — known issues / quirks (skill's own tooling)

## 2026-07-27 — Windows config location differs from the Unix wrapper default

**Symptom:** `mapps.cmd` commands were authenticated and succeeded on Windows,
while `mapps-api.sh` reported `.mappsrc not found` because it checked only
`$HOME/.config/mapps/.mappsrc`.

**Fix (same session, at source):** the wrapper now falls back to
`$LOCALAPPDATA/mapps/.mappsrc` when the Unix path is absent. The token file is
still read only inside the wrapper and is never printed by diagnostics. The
payload builder now uses Node.js instead of the Windows `python3` app-execution
alias, which can exist on `PATH` while being non-executable.

## 2026-07-27 — Specific-version manifest export still requires the app id

**Symptom:** `mapps manifest:export -i <VERSION_ID>` failed with `App id is
required`, despite the older command table implying that the version id alone
was sufficient.

**Fix (same session, at source):** use
`mapps manifest:export -a <APP_ID> -i <VERSION_ID> -p <PATH>` and keep both
identifiers in the CLI reference.

## 2026-07-14 — deploy-guard hook blocked `mapps code:push --help` (false positive)

**Symptom:** the PreToolUse deploy-guard blocked a pure help query
(`mapps code:push --help`) with the ship.sh redirect message. A help query
executes nothing — blocking it only forces awkward workarounds.

**Fix (same session, at source):** `deploy-guard.sh` now allows
single-segment commands ending in `--help`/`-h` and `mapps help ...`
invocations. Multi-segment commands (anything containing `;`, `&`, `|`,
backtick or newline) are still matched by the guard, so a real push cannot
hide behind a `--help` token.

## 2026-07-14 — ship.sh assumption: "single-live-version apps" is standalone-era

`ship.sh` pushes with `--force` and no `-i`, relying on the CLI resolving
the target version. That is correct ONLY for standalone apps with a single
version. **Monorepo/pipeline apps keep a standing draft on top of live** —
there `code:push --force` resolves the LATEST version (the draft!), despite
the CLI help text claiming "Force push to live version" (incident-verified
2026-07-14, see monday-cicd/references/known-issues.md). Consequences:

- ship.sh must NOT be used for apps onboarded to the monorepo pipeline —
  releases go through the pipeline (deploy-live workflows, which resolve the
  LIVE version id at run time and push pinned with `-i`).
- If a standalone app ever grows a draft version on top of live, ship.sh
  would silently push to the draft. Remedy when in doubt:
  `mapps app-version:list -i <APP_ID>` first, and push pinned with
  `-i <LIVE_VERSION_ID>`.

## 2026-07-28 — `openAppFeatureModal` chrome is monday's; the close X cannot be moved

**Ask:** move the required-fields modal's close X to the left, for an RTL
Hebrew form (twyst-your-status).

**Finding:** not possible from the app. `monday.execute('openAppFeatureModal',
…)` accepts exactly `url` / `urlPath` / `urlParams` / `width` / `height`
(monday-sdk-js 0.5.9 `types/client-execute.interface.ts`) — there is no option
for the modal's chrome, and the X lives in monday's own DOM around the iframe,
so CSS inside the app cannot reach it. The only thing an app can do is draw its
OWN close control inside its iframe, which leaves monday's in place too (two
X's). The width/height we ask for also include that chrome — hence
`MODAL_CHROME_PX` headroom in twyst's `requiredFormModalSize.js`.

**Consequence for RTL apps:** a full-screen-ish surface that wants its dismissal
on the reading-start side has to own the whole chrome — i.e. draw its own header
with its own X (as twyst's settings overlay does) and treat monday's frame X as
a second, unavoidable exit.

## 2026-08-05 — `manifest:import` refuses a LIVE version; OAuth config IS per-version

**Ask:** point twyst-your-status' OAuth Redirect URI at the stable `live1-…`
host instead of the version-pinned `acca6-…` hash, on the LIVE version.

**Findings, all CLI-verified against app 11775054:**

- **`mapps manifest:import -a <APP_ID> -i <LIVE_VERSION_ID>` fails** with
  `FAILED: Could not find app version to update`. It succeeds on a DRAFT version
  id. So the platform accepts manifest writes to drafts only — **a live version's
  manifest (OAuth redirect URIs, scopes, feature builds) is Developer-Center-UI
  only.** The failure is clean: re-exporting the live manifest afterwards showed
  it byte-identical, feature ids unchanged, version list unchanged. Do not reach
  for `app:deploy -f` as a workaround on production — it is the same manifest
  path with a wider blast radius.
- **A draft import is non-destructive and does not fork a version.** Importing an
  export-then-patched manifest onto the draft left the version list at three rows
  and the three app-feature ids untouched; the re-export matched the intended file
  exactly. Safe to rehearse a manifest change on the draft before asking a human
  to repeat it in the UI.
- **OAuth config is per app VERSION, not per app.** `manifest:export` for the
  draft and for the live version returned byte-identical files, which reads as
  app-level — it is not. After importing three redirect URIs onto the draft, the
  draft exported three and the live still exported one. The earlier identity was
  two versions happening to hold the same value.

**Trap this creates:** `BASE_URL` is one value per app, and the guard server
derives `redirectUri = ${BASE_URL}/oauth/callback`. Moving `BASE_URL` to the
`live1-…` host BEFORE that exact URI is registered on the live version leaves
OAuth broken — monday rejects an authorize request whose `redirect_uri` is not
registered on the version. Register the URI first, then move `BASE_URL`.

## 2026-08-05 — every version shows the SAME "static url (latest deployment)"

**Symptom:** a live push and a draft push appear to print the same address, which
looks like both landed on one code project.

**Finding:** `mapps app-version:builds -i <VERSION_ID>` reports, for EVERY version
of the app, an identical `static url (latest deployment)` —
`https://service-<account>-<app>.us.monday.app`. That column is a code-project-wide
alias, not a per-version address. The per-version addresses are the `url` column
(a per-version hash, e.g. `acca6-…` for live vs `af0df-…` for draft) and, on the
live version only, `live url` (`live1-…`).

**How to actually prove which version a push hit:** read the deploy job log. The
CLI polls `https://monday-apps-ms.monday.com/api/code/<VERSION_ID>/deployments`
while it waits — that path carries the version id it is really deploying to.
