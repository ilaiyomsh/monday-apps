# Tracker

Monday.com Board View for Hebrew/English work-hours reporting.

## What it does

- Drag-and-drop calendar UI in Hebrew (RTL) or English (LTR), embedded in the Monday iframe.
- Reports billable / non-billable / routine hours and full-day events (vacation, sick, reserves).
- Configurable column mapping — works against any Monday board with the right columns, no hard-coded IDs.
- Multi-user filtering (reporter / project) and an undo flow on destructive actions.

<!-- TODO: add screenshot -->

## Quick start

```bash
pnpm install
pnpm start
```

`pnpm start` runs the Vite dev server on port 8301 and opens a Monday tunnel via `mapps tunnel:create`. Open the printed tunnel URL inside Monday's "External hosting" board-view configuration to load the app in the iframe.

## Commands

| Command | What it does |
|---------|--------------|
| `pnpm start` | Dev server (port 8301) + tunnel, in parallel. |
| `pnpm run server` | Dev server only — no tunnel. |
| `pnpm run expose` | Create the Monday tunnel only. |
| `pnpm run build` | Production build into `build/`. |
| `pnpm run deploy` | Build + `mapps code:push` to the configured Monday app. |
| `pnpm run stop` | Kill the dev/tunnel ports (8301, 4040, 4049). |
| `pnpm test` | Vitest in watch mode. |
| `pnpm run test:run` | Vitest single run (CI mode). |
| `pnpm run test:tz:matrix` | Run the suite under three timezones (IL / UTC / NY). |

## Configuration

The app is configured at runtime through Monday's settings UI (column mappings, board IDs, structure mode). Persisted via `monday.storage.instance` — see the [`SettingsContext`](./src/contexts/SettingsContext.jsx) and [`SettingsDialog`](./src/components/SettingsDialog/) for the full surface.

Environment variables are only relevant for the Monday CLI / deploy flow (e.g. `MONDAY_SIGNING_SECRET`, `PORT`). See [`apps/.claude/CLAUDE.md`](../../.claude/CLAUDE.md) for the shared Monday-app environment reference.

## Documentation

| Doc | What's there |
|-----|--------------|
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | High-level architecture: layers, data flow, state management. |
| [`CLAUDE.md`](./CLAUDE.md) | Coding conventions, hooks, settings keys, common pitfalls. |
| [`tech-debt/`](./tech-debt/) | Tech-debt audit, wave plans, and ongoing cleanup status. |
| [`docs/`](./docs/) | Incident notes, settings-wizard plans, API-concurrency notes. |

## Tech stack

React 18 + Vite 6, `react-big-calendar` (patched), `@vibe/core`, `i18next`, `date-fns` + `@hebcal/core`, `monday-sdk-js`. Tested with Vitest + Testing Library.
