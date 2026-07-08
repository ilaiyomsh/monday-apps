# CLAUDE.md — Unified Template (Axis)

> This template defines the **mandatory core sections** for every Axis app's `CLAUDE.md`.
> Source of truth for decisions: `STANDARDS.md`. Replace each `{{...}}` with the app's content.
> Core sections (1–7) = **mandatory**. Additional sections (8) = **optional** per app.

---

## 1. App Description  *(mandatory)*
{{What the app does, in a sentence or two. Type: board_view / item_view / dashboard / backend.}}
App ID: `{{app_id}}`

## 2. Purpose & Usage  *(mandatory)*
{{Who it's for and when it's used. The primary user scenario.}}

## 3. Technologies  *(mandatory)*
- React `{{19}}` · Vite `{{7}}` · Language: `{{TypeScript / JavaScript}}`  *(standard #1, #2)*
- `@mondaycom/apps-sdk@4.x` · `monday-sdk-js`  *(standard #3)*
- {{@vibe/core, i18next, date-fns, @hebcal/core, Tailwind, …}}

## 4. Constants  *(mandatory)*
{{Key constants: board IDs, column IDs, storage keys, default values, feature flags. Where they're defined.}}

## 5. Deploy  *(mandatory)*
```bash
# Development
mapps tunnel:create -p {{port}} -a {{app_id}}
# Deploy
{{npm/pnpm run deploy}}   # → mapps code:push -a {{app_id}}
```
{{.env conventions — see standard #16. The liveUrl is stable across deploys (mapps code:status).}}

---

## 6. Technical Standards  *(mandatory — implements STANDARDS.md)*

### MondayAPI  *(#4)*
The API layer implements the **`Monday-api-service` contract** (getBoard / createItem / updateMultipleColumnValues / getAllItems / …).
- Location: `{{src/services/mondayApi.*}}`
- All API calls go through this layer — no direct SDK calls from components.

### Logging  *(#5)*
- New app: unified logger → `Axiom`. Existing: {{console / Axiom — current state + migration plan}}.
- Location: `{{src/utils/logger.*}}` · levels: debug/info/warn/error.

### Error Handling  *(#6 — Tracker model)*
- `ErrorBoundary` (render-throws) + error-details modal + `globalErrorHandler` (window.onerror + unhandledrejection).
- A `catch` block **must** log / throw / show an error — never swallow (enforced by ESLint, #9).

### I18n  *(#7)*
- `i18next` mandatory (if bilingual). Hebrew strings **only** via `t(...)` — enforced by ESLint.
- Bundles location: `{{src/i18n/locales/{he,en}}}`.

### Settings Management  *(#8 — must document)*
- Mechanism: `{{monday.storage.instance / SecureStorage}}`
- Keys: `{{...}}` · Schema: `{{...}}` · Validation: `{{...}}`

### Testing  *(#10)*
- `Vitest` mandatory · coverage threshold: `{{%}}` · `test:tz` (timezones).
- Run: `{{npm/pnpm test}}` · CI: `{{npm/pnpm test:run}}`.

### ESLint  *(#9)*
- Local config + **two shared core rules**: Hebrew-in-`t()` enforcement, and catch-block must handle the error.

---

## 7. Workflow  *(mandatory — #13, #14)*

### Before All
{{Guidance to read before any change: where the relevant code lives, what not to break, tests to run.}}

### Change Classification
Before working — classify: **behavior change / bug fix / new component**. Open a change via the `change-tracker` skill (`/new_change`).

### After All
- Run tests.
- **Structural change → update `ARCHITECTURE.md`** (the dedicated architecture file).
- Close the change via `change-tracker` (`/close_change`) — changes and bugs are documented there, not in CLAUDE.md.

---

## 8. Optional Sections  *(per app — #11)*
{{Add as needed, e.g.:}}
- Architecture / Module Layout / Endpoint Contracts
- Key Hooks · Component Patterns · Data Flow
- Folder structure *(recommended: api → services → hooks/components — #15)*
- Cloud integrations (Google / Microsoft) · OAuth · Storage Schema
