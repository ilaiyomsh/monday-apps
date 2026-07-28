# Draft deployment checklist

Target app: `11775054` (client-side CDN)

## Feature URLs

Configure on the draft version:

1. Status Column on-click → `<CDN_ORIGIN>/picker`
   (cell-attached Dialog Design — do **not** also bind On-Hover to this URL)
2. Column settings (slim launcher) → `<CDN_ORIGIN>/settings`
3. Full settings overlay → `<CDN_ORIGIN>/settings-full`

`<CDN_ORIGIN>/required-fields` needs **no** Developer Center entry — the picker opens
it at runtime through `openAppFeatureModal({ urlPath, urlParams, width, height })`.

The Vite build copies `index.html` into `dist/picker/`, `dist/settings/`,
`dist/settings-full/` and `dist/required-fields/` so the static CDN can serve those
paths without rewrite rules. **Adding a route means adding it to `copySpaFallbacks`
in `vite.config.js` as well as `App.resolveAppRoute`** — a missing folder is a 404
and the surface opens blank.

## Version permissions (scopes)

- `boards:read`
- `boards:write`
- `users:read`
- `teams:read`

Changing scopes can require existing installers to authorize the app again.

## Verification before push

- `pnpm --filter ./apps/twyst-your-status test`
- `pnpm --filter ./apps/twyst-your-status lint`
- `pnpm --filter ./apps/twyst-your-status build` → `dist/` (+ `dist/picker`, `dist/settings`, `dist/settings-full`, `dist/required-fields`)

## Deployment

Deploy only through GitHub Actions (`deploy-draft/live-twyst-your-status.yml`):

```text
mapps code:push -c -d apps/twyst-your-status/dist -a <APP_ID>
```

Never run a local `mapps code:push`.

Draft push retries once on the transient monday remote error (same as live).
