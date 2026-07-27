# Draft deployment checklist

Target app: `11775054`
Target draft version: `16381642`

## Version permissions

- `boards:read`
- `boards:write`
- `users:read`
- `teams:read`
- `webhooks:read`
- `webhooks:write`
- `notifications:write`

Changing scopes can require existing installers to authorize the app again. Apply only
after explicit owner confirmation.

## Features

1. Keep the current Status Column and on-click dialog features.
2. Add a Board View with the monday-code URL `/?view=board`.
3. Add an Item View with the monday-code URL `/?view=item`.
4. Configure OAuth redirect to `<BASE_URL>/oauth/callback`.

## monday-code environment

- `MONDAY_CLIENT_ID`
- `MONDAY_CLIENT_SECRET`
- `MONDAY_SIGNING_SECRET`
- `BASE_URL` — the deployed app origin, without a trailing slash
- `MONDAY_APP_VERSION_ID` — optional draft version pin during OAuth activation

## Verification before push

- `vitest`: 258 tests green.
- ESLint: green.
- Vite production build: green.
- `/health`: `200 {"ok":true}`.
- API without a session JWT: `401`.
- API with a valid signed test session: `200`.
- Webhook challenge: echoed before JWT enforcement.
- Test-guard mutation checks are green for the workflow domains, storage, OAuth 2.1,
  webhook acknowledgement, monday API funnel, and build-version label.

## Deployment

The app is now a server deployment. Deploy only through the repository's draft/live
GitHub Actions workflows; never run a local `mapps code:push`. The workflows upload the
whole app root and do not use the previous client-only `--client-side -d dist` mode.
