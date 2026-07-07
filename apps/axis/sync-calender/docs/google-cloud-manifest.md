# Google Cloud Project Manifest — Sync-Calendar-Monday

> Pulled 2026-05-27 via `gcloud` (account `ilai@twyst.co.il`) + app source code.
> **Note:** Google retired the OAuth Admin APIs (March 2026), so the OAuth Client
> credentials and the OAuth Consent Screen are no longer retrievable by any
> CLI/API — they are console-only. Everything else below comes from `gcloud`
> or the app's own code.

## Project

| Field | Value |
|---|---|
| Name | `Sync-Calendar-Monday` |
| Project ID | `lithe-breaker-491415-p0` |
| Project Number | `827989722403` |
| Created | 2026-03-26 |
| State | ACTIVE |
| Parent org | `882405764987` |
| Your access | `roles/owner` |

## OAuth — Google Calendar (from `src/routes/oauth-google.js`)

Scopes the app requests:

```
https://www.googleapis.com/auth/calendar.events.readonly
https://www.googleapis.com/auth/userinfo.email
```

- Flow: authorization-code, `access_type=offline`
- Client ID: env var `GOOGLE_OAUTH_CLIENT_ID` (stored in monday code, not in repo)
- Redirect URI: `GOOGLE_OAUTH_REDIRECT_URI` or `${APP_BASE_URL}/oauth/google/callback`

## Enabled APIs (relevant to the app)

| API | Purpose |
|---|---|
| `calendar-json.googleapis.com` | Google Calendar API — the sync source |
| `people.googleapis.com` | People API — used for user email resolution |

Also enabled (not used by the sync app — default/inherited): BigQuery suite,
Cloud Storage, Logging, Monitoring, Trace, Datastore, Dataform, Dataplex,
Cloud SQL component, Analytics Hub, Service Management/Usage.

## Not retrievable via CLI (console-only)

- OAuth Client: client ID value, client secret, authorized redirect URIs
- OAuth Consent Screen: app name, publishing status, test users, verified scopes

These can be read manually at:
https://console.cloud.google.com/apis/credentials?project=lithe-breaker-491415-p0
