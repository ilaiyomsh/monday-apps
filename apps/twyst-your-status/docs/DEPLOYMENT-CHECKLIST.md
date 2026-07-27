# Draft deployment checklist

Target app: `11775054` (client-side CDN)

## Feature URLs

Configure on the draft version:

1. Status Column on-click → `<CDN_ORIGIN>/picker`
2. Column settings → `<CDN_ORIGIN>/settings`

The Vite build copies `index.html` into `dist/picker/` and `dist/settings/` so the
static CDN can serve those paths without rewrite rules.

## Version permissions (scopes)

- `boards:read`
- `boards:write`
- `users:read`
- `teams:read`

Changing scopes can require existing installers to authorize the app again.

## Verification before push

- `pnpm --filter ./apps/twyst-your-status test`
- `pnpm --filter ./apps/twyst-your-status lint`
- `pnpm --filter ./apps/twyst-your-status build` → `dist/` (+ `dist/picker`, `dist/settings`)

## Deployment

Deploy only through GitHub Actions (`deploy-draft/live-twyst-your-status.yml`):

```text
mapps code:push -c -d apps/twyst-your-status/dist -a <APP_ID>
```

Never run a local `mapps code:push`.
