# Dev-harness compatibility

## 2026-07-27 — browser mock context ignored the requested feature type

**Observed:** `pnpm dev:mock` set `VITE_MONDAY_MOCK_CONTEXT=column_view_click`,
but the browser rendered the board-view fallback. The SDK stub read only
`process.env`; Vite exposes client variables through `import.meta.env`.

**Resolution:** read `import.meta.env.VITE_MONDAY_MOCK_CONTEXT` first and retain
the `process.env` fallback for Node-based use. Browser verification must assert
that the feature component itself is visible, not merely that `/` returns 200.
