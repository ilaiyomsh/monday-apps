# Archived — Vanilla admin UI

Replaced by a React + Vite + `@vibe/core` SPA under `src/client/admin/` on **2026-04-16**.

## Why retired

- Native `<select>` dropdowns could not search/filter large board & column lists.
- Column mapping was a free-text JSON textarea — no type awareness, easy to corrupt.
- Policy editor, per-user rows, and connection controls all stacked on one screen with no tab separation.
- OAuth flows opened a new browser tab and redirected back there — the user had to manually close the tab and reload the monday iframe after consent.

The React rewrite adds searchable dropdowns, a typed column-mapping table with auto-save, an owner-only **Setup** tab, and a popup-based OAuth flow that `postMessage`s the result back into the iframe.

## Final working commit

Last commit these files were live in production: **`5ba2d7f7f2fa539a6bddf65a842324272fed98cf`** (`Wire Custom Object path for real monday lifecycle payload + clean first-sync`).

## How to restore

```bash
# Drop the SPA and re-mount the vanilla UI.
git checkout 5ba2d7f7f2fa539a6bddf65a842324272fed98cf -- src/ui
# Revert src/index.js to serve src/ui instead of public/admin:
#   const UI_DIR = path.resolve(__dirname, 'ui');
#   app.use('/admin', express.static(UI_DIR));
#   app.get('/admin', (_req, res) => res.sendFile(path.join(UI_DIR, 'admin.html')));
#   app.get('/admin/', (_req, res) => res.sendFile(path.join(UI_DIR, 'admin.html')));
# Revert oauth-google.js / oauth-monday.js callback endings to `res.redirect(...)`.
```

These files are frozen — do not edit in place. Make fixes in `src/client/admin/` instead.
