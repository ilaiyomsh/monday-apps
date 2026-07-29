# CLAUDE.md — docs-export

Guidance for Claude Code working in this app. The repo-wide rules in the root
`CLAUDE.md` win on any conflict; this file covers app-internal facts only.

## What this is

`docs-export` — a monday.com **board view**, client-side (CDN), React 19 + Vite 8,
Hebrew-first RTL, CSS Modules. It exports a **reporter's** daily/weekly report to a
`.docx` that carries the page header/footer from a template the owner uploaded.

**The document is per REPORTER, not per committee.** Every user only ever sees items
they appear in (via the mapped `people` column), and the report they generate is
*theirs* — even when they select several committees. That is why the committee name
is a table column rather than something that splits the document.

Scaffolded from `monday-scaffold` (board_view) and then reconciled to the monorepo's
client standard; the reconciliation list lives in
`.claude/skills/monday-scaffold/references/template-drift.md`.

## Commands

```bash
pnpm --filter ./apps/docs-export dev:mock   # :8304, renders OUTSIDE the monday iframe
pnpm --filter ./apps/docs-export dev        # :8304 against the real SDK (needs VITE_MONDAY_TOKEN)
pnpm --filter ./apps/docs-export build      # -> dist/
pnpm --filter ./apps/docs-export test
pnpm --filter ./apps/docs-export lint
```

Single test: `npx vitest run --root apps/docs-export <file>` or `-t "<name pattern>"`.

There is **no `vitest.config.js`** — test config is the `test:` block of
`vite.config.js`. `monday-sdk-js` is aliased to `src/dev-harness/monday-sdk-stub.js`
**always** under vitest, and under `dev:mock` via `VITE_MONDAY_MOCK=1`.

**Never deploy from a machine.** `.claude/hooks/deploy-guard.sh` blocks it, and this
app deliberately has no `deploy` script. Deploys happen on GitHub Actions only.

## The five column roles — the central idea

Nothing hardcodes a board or column id. The owner maps five roles in settings, and
`settings.boardId` is the **target** board, which need not be the board the view sits
on.

| role | type | job |
|---|---|---|
| `action` | any | table col 1 (RIGHTMOST in RTL) — merged across consecutive equal values |
| `committee` | **mirror** | table col 2 **and** the multi-select filter |
| `report` | text/long_text | table col 3 |
| `date` | date | table col 4 **and** the daily/weekly range filter — one mapping, two jobs |
| `person` | people | NOT in the table; the personal item scope |

Settings live in `monday.storage` under `docs_export_settings_${instanceId}`. The
uploaded `.docx` lives under a **separate** key `docs_export_assets_${instanceId}`.
That split is mandatory — the settings blob is read on every boot and gates render, so
hundreds of KB of template bytes must never sit in it.

## One query per interaction

Picking a range fires a single `items_page` with two **server-side** rules
(`operator: and`): `date between [from,to]` and `people any_of ["person-<userId>"]`.
The committee list is then derived from the fetched items, and generating the report
is pure client-side work. **Zero further API calls** after the range is chosen.

- **`person-<id>` is mandatory** in a people filter. A bare numeric user id is
  silently ignored and returns zero items.
- **The committee filter must stay client-side.** A mirror is a computed column;
  `query_params` does not filter it reliably.
- `next_items_page` is a **root** field, not nested under `boards`.

## Row ordering is forced by Word, not chosen

Sort is **action → committee → date ascending**, action groups in first-appearance
order. This is not a preference: Word's vertical merge (`w:vMerge`) only spans
**consecutive** rows. Action cells merge across a whole action group; committee cells
merge only **within** an action group and must never cross an action boundary — that
is the easiest thing in this app to break, so it has its own tests.

## The .docx pipeline

`utils/docx/`:

- `templateMerge.js` — ported essentially verbatim from
  `apps/discussions/src/utils/docxTemplateMerge.js`. It keeps the template's
  `<w:sectPr>` (which is what references the header/footer parts, and therefore
  preserves the uploaded logo/chrome) and replaces only the body flow. Do not
  redesign it.
- `rtl.js` — the RTL recipe extracted from `apps/discussions/src/utils/docxExport.js`.
  Every line of it is load-bearing: doc defaults set `rightToLeft` + RIGHT alignment
  **and repeat it on heading1..3**; every paragraph sets `bidirectional: true` and an
  **absolute** `AlignmentType.RIGHT` (`START`/`END` are direction-relative and
  mis-resolve to the left); every run sets `rightToLeft: true`; tables need explicit
  **DXA** widths + FIXED layout + `visuallyRightToLeft`, or columns collapse to zero
  and Hebrew stacks one glyph per line.
- `download.js` — `docx`/`fflate`/`file-saver` are reached through a **dynamic
  `import()`** so they stay off the boot path. A template whose splice throws falls
  back to the generated body alone with a `logger.warn` — a malformed template must
  never cost the user their report.

Output is **download only**. There is deliberately no upload-back-to-monday path.

## Boot order is load-bearing

`src/index.jsx`: `@vibe/core/tokens` → `index.css` → `i18n` →
`setupGlobalErrorHandlers(logger)` → `attachAxiomSink(...)` → `createRoot`. Both
wiring calls **must** appear textually before `createRoot(` — the repo's blocking
`scripts/error-wiring-audit.mjs` enforces exactly that. `SettingsGate` then blocks
render until the settings blob has loaded, so no API call can fire without its
column mapping.

`MondayContext` is `get('context')` **plus** a permanent `listen('context')` (on
mobile the context may arrive only via the event) **plus** a 4s watchdog that installs
`{}` so the app never hangs on a spinner outside monday. A serialized-diff guard drops
monday's frequent identical re-emits.

**`instanceId` on a board_view is the `boardViewId`, not the boardId**, and a
board_view context carries **no permissions** — so owner detection must query
`boards(ids:) { owners { id } }` (`services/owners.js`).

## Pitfalls

- **Never `console.*`** — log through `logger.*` or the error is invisible to the toast
  funnel and skips dedup. `logger.js` is the sole exemption.
- **`logger.error(module, message, error, context)` takes FOUR arguments.** The 4th is
  where `AppErrorBoundary` puts `componentStack`, and the Axiom sink reads the
  component tree from `record.context.componentStack` and nowhere else. Dropping it
  silently strips the component tree from every shipped render crash — this was a real
  bug in the scaffold template, fixed 2026-07-29.
- **`safeApi` does NOT throw on GraphQL soft errors** — it logs them. A write path that
  skips `assertNoGraphQLErrors` is a silent failure that looks like success.
- **`monday.storage.setItem` can resolve even when the write did not persist**, and a
  configured instance can transiently read `success:true, value:null`. Read back to
  verify; the dev harness can simulate the false-empty race.
- **`manualChunks` in `vite.config.js` must stay a function** — Vite 8/rolldown rejects
  the object form.
- **`base: './'` in `vite.config.js` is deliberate** — the monday CDN serves from a
  versioned sub-path and GitHub Pages from `/monday-apps/`. Do not change it to `/`.
- **Owner-only gates SETTINGS only.** The per-user item scope applies to owners and
  admins too.
- Timeline values come back as full ISO timestamps, not `YYYY-MM-DD` (slice to 10), and
  `numbers` arrives as a string.

## Hosting

Two targets. The monday CDN via the pipeline (not yet onboarded — see the root
`CLAUDE.md`), and **GitHub Pages** at `https://ilaiyomsh.github.io/monday-apps/` via
`.github/workflows/pages-docs-export.yml`, which builds from `develop` and publishes
**only** `apps/docs-export/dist`. A repo has one Pages site, so that URL belongs to
this app.

## i18n

Deliberately narrow, same decision as `discussions`: the app is Hebrew-first **by
design**, and `t()` serves **only** the error/toast/boundary layer. Every other string
is inline Hebrew on purpose — do not "helpfully" migrate them.
