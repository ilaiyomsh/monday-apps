---
name: monday-scaffold
description: Generate a complete Monday.com app skeleton by feature type (column_view, board_view, item_view, dashboard_widget) — React 18 + Vite + Vibe, RTL-first, proven shared components (PersonPicker, portal Popover, StatusChip, DateRangeDisplay), a local dev harness that renders the app OUTSIDE the monday iframe, git init included. Use when starting any new monday app/view/widget project, or when the user says "אפליקציה חדשה", "תקים פרויקט", "סקאפולד", "ויו חדש", "ווידג'ט חדש".
argument-hint: [column_view|board_view|item_view|dashboard_widget]
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
---

# Monday.com App Scaffold Generator

Generate production-ready Monday.com app skeletons tailored to your feature type.

## Feature Type: $ARGUMENTS

## Supported Feature Types

| Type | Description | Placement Values |
|------|-------------|------------------|
| `column_view` | Custom column view with on-click dialog and settings | `columnPickers`, `settings` |
| `board_view` | Full board view component | `board_view` |
| `item_view` | Item view modal/panel | `item_view` |
| `dashboard_widget` | Dashboard widget component | `dashboard_widget` |

## What Gets Generated

- **React 18 + Vite** — modern build tooling, parameterized dev port
- **Monday SDK** (`monday-sdk-js`) — API and context integration
- **Vibe Design System** (`@vibe/core`, `@vibe/icons`) — see the Vibe guardrail below
- **Tailwind CSS** — utility-first styling
- **RTL by default** — `<html lang="he" dir="rtl">`, runtime dir/lang sync from context, logical CSS properties (see `references/rtl-css-checklist.md`)
- **Proven shared components** — PersonPicker, Popover (body portal), StatusChip, DateRangeDisplay — ported from working sibling apps, NOT rebuilt
- **Local dev harness** — `monday-sdk-js` stub with realistic fixtures and failure toggles, so the app renders outside the monday iframe and vitest tests realistic shapes
- **Git repository** — `git init` + `.gitignore`, unconditionally
- **pnpm build-script policy** — package-scoped `allowBuilds` entries for the
  CLI and esbuild dependencies required by the scaffold
- **Starter GraphQL queries** — generated fresh through the `monday-api` skill (never copied from a static file)
- **error-guard-compliant from birth** — every generated app ships the standard
  error-catching infrastructure (see the `error-guard` skill): a single-choke-point
  `logger`, global handlers (`window.onerror` + `unhandledrejection` + resource
  errors), a render-phase `AppErrorBoundary` with a Hebrew fallback, and a
  `useUiErrorSink` hook (one logged ERROR = one toast). The entry point is
  pre-wired (global handlers before `createRoot`, root boundary above `<App />`),
  the enforcement rule kit lives in `package.json` `eslintConfig`
  (`no-console`, `no-empty`, catch-must-log, `promise/catch-or-return`), and an
  `.error-guard` marker enables the full-tree ship gate. A fresh scaffold passes
  `error-guard`'s `audit.sh` with zero gaps immediately.
- **Remote error monitoring pre-wired (opt-in at build)** — `utils/axiomErrorSink.js`
  + `utils/axiomBrowserTransport.js` ship WARN/ERROR records to the shared
  `app-errors` Axiom dataset. Structurally inert until the user creates
  `.env.production.local` with `VITE_AXIOM_DATASET=app-errors`, `VITE_AXIOM_TOKEN`
  (user pastes it — agents never touch tokens), and `VITE_AXIOM_APP=<slug>`.
  The entry attaches the sink before render; `useMondayContext` enriches records
  with account/user/board identity. Runbook + one-time Axiom setup:
  `error-guard/references/remote-monitoring.md`.

## Two hard rules before writing ANY UI code

### REUSE-BEFORE-BUILD

Before implementing any monday-native UI primitive (people picker, status
picker, date picker, floating menu, chip/badge, table with sticky header),
**grep the sibling apps under the project root (the directory the session runs
in) for an existing implementation and port it** — prefer `discussions`,
`Axis/tracker`, `Axis/Day-off`, which are proven live:

```bash
APPS_ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
grep -rln --include="*.jsx" --include="*.tsx" -iE "personpicker|peoplepicker|statuschip|statusbadge|popover|datepicker" \
  "$APPS_ROOT" --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=build
```

The PersonPicker in this scaffold exists because it was rebuilt per app over
3-6 screenshot rounds until two separate correction sessions pointed back at
the `apps/discussions` implementation as "the working one". Do not repeat that.
When you port a component, keep a header comment naming the source app (every
bundled component in `templates/shared/components/` shows the format).

### VIBE GUARDRAIL — verify props exist before using them

Before using any `@vibe/core` prop you have not personally verified in this
project, **grep the installed type declarations to confirm it exists**:

```bash
grep -rn "insideOverflowContainer" node_modules/@vibe/core/dist/types --include="*.d.ts"
# no hits = the prop DOES NOT EXIST. Do not pass it.
grep -rn "interface DialogProps" -A 40 node_modules/@vibe/core/dist/types --include="*.d.ts"
```

**Never invent props.** Cautionary example: an agent invented
`insideOverflowContainer` on a Vibe component; it silently did nothing, a later
session inherited it and "removed" it to no effect, and the fake prop kept
being re-added across **7+ sessions** before a node_modules grep proved it
never existed in `@vibe/core` 4.x.

Known-broken Vibe patterns (verified in live apps — do not rediscover them):

| Pattern | Reality | Use instead |
|---------|---------|-------------|
| `TextField` `iconName` | Silently renders nothing | Absolutely-positioned `@vibe/icons` icon over the field (see PersonPicker's search input) |
| Vibe `Dialog` in board tables | Clips under overflow/transform ancestors; double-rendered its content | Bundled `Popover` / `PersonPicker` (body portal) |
| Vibe `Combobox` option clicks | Dead click handlers inside board views | Plain clickable button list inside the bundled `Popover` |

Also: `@vibe/core` v3+ (the template pins `^3.81.1`) takes string literals
(`kind="primary"`, `size="small"`), not the old enum imports.

## Project Structure (what a scaffold produces)

```
app-name/
├── .git/                     # created unconditionally at scaffold time
├── .gitignore                # from templates/shared/gitignore.template
├── .error-guard              # error-guard marker → enables full-tree ship gate
├── package.json              # pnpm scripts + eslintConfig error-guard rule kit; {{DEV_PORT}} + {{APP_ID}} substituted
├── pnpm-workspace.yaml       # allows only the scaffold's required dependency build scripts
├── vite.config.js            # dev-harness alias + vitest config + {{DEV_PORT}}
├── tailwind.config.js
├── postcss.config.js
├── index.html                # <html lang="he" dir="rtl"> — RTL default
├── src/
│   ├── index.jsx             # React entry point — error-guard wired (global handlers + root boundary)
│   ├── index.css             # Global styles + Tailwind + Vibe tokens
│   ├── App.jsx               # Main router (routes based on context.placement)
│   ├── dev-harness/          # monday-sdk-js stub + fixtures + README (verbatim copy)
│   │   ├── monday-sdk-stub.js
│   │   ├── fixtures.js
│   │   └── README.md
│   ├── hooks/
│   │   ├── useMondayContext.js   # Context loading + listener + RTL/theme wiring
│   │   ├── useQuery.js           # GraphQL query hook
│   │   └── useUiErrorSink.js     # error-guard: one logged ERROR = one toast
│   ├── services/
│   │   ├── mondayService.js      # SDK wrapper
│   │   └── graphqlQueries.js     # GENERATED via the monday-api skill (see below)
│   ├── utils/
│   │   ├── overlayPlacement.js   # viewport flip/clamp math for portals
│   │   ├── logger.js             # error-guard: single logging choke-point
│   │   ├── globalErrorHandler.js # error-guard: window.onerror + unhandledrejection + resource errors
│   │   ├── axiomErrorSink.js         # error-guard: remote error shipping (env-gated, inert in dev)
│   │   └── axiomBrowserTransport.js  # error-guard: batching/dedup/breaker transport to Axiom
│   └── components/
│       ├── ErrorBoundary/
│       │   └── AppErrorBoundary.jsx  # error-guard: render-phase catch + Hebrew fallback
│       ├── shared/
│       │   ├── LoadingState.jsx
│       │   ├── ErrorState.jsx
│       │   ├── PersonPicker.jsx + .module.css   # ported from apps/discussions
│       │   ├── Popover.jsx + .module.css        # body-portal popover/menu
│       │   ├── StatusChip.jsx + .module.css     # ported from apps/discussions StatusBadge
│       │   └── DateRangeDisplay.jsx             # ported from apps/Axis/Day-off Rng
│       └── [FeatureComponents]/   # per feature type, see below
```

## Scaffold Procedure

When the user invokes `/monday-scaffold <feature_type>`:

### 1. Project name and location

Ask for the project name if not already in a target directory. Create the
directory under `<project-root>/<name>` (the project root the session runs in)
unless told otherwise.

### 2. Pick a dev port (collision check — required)

The port is parameterized as `{{DEV_PORT}}`. Before choosing one, scan sibling
apps for ports already in use and pick a free one (start looking from 8301):

```bash
APPS_ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
grep -rhoE "port: [0-9]{4,5}|--port [0-9]{4,5}|localhost:[0-9]{4,5}" \
  "$APPS_ROOT"/*/vite.config.* "$APPS_ROOT"/*/package.json \
  "$APPS_ROOT"/*/*/vite.config.* "$APPS_ROOT"/*/*/package.json 2>/dev/null \
  | grep -oE "[0-9]{4,5}" | sort -un
```

Choose a port NOT in that list. Substitute it for every `{{DEV_PORT}}`
occurrence (package.json, vite.config.js).

### 3. Resolve APP_ID automatically when known

Do not leave a literal placeholder if the id is discoverable:

```bash
mapps app:list   # match by app name if the app already exists in the Developer Center
```

- If found → substitute the real id for `{{APP_ID}}`.
- If the app does not exist yet → substitute the literal string `APP_ID`,
  and add a `TODO(APP_ID)` line to the generated README/first commit message so
  it cannot ship silently. Tell the user to create the app in the Developer
  Center (step at the end) and offer to fill it in afterwards.

### 4. Copy templates with substitutions

Copy from `./templates/`: `shared/` first, then the feature-type folder.
Strip the `.template` suffix. Substitutions: `{{APP_NAME}}`, `{{FEATURE_TYPE}}`,
`{{DEV_PORT}}`, `{{APP_ID}}`. Notes:

- `templates/shared/gitignore.template` → `.gitignore`
- `templates/shared/pnpm-workspace.yaml.template` → `pnpm-workspace.yaml`
- `templates/shared/error-guard.marker.template` → `.error-guard` (root marker —
  enables the error-guard full-tree ship gate; commit it with the scaffold)
- `templates/shared/dev-harness/*` → `src/dev-harness/` **verbatim** (these are
  plain `.js`/`.md` files with no placeholders — do not rename or edit them)
- `templates/shared/components/*` → `src/components/shared/`, **except**
  `templates/shared/components/ErrorBoundary/*` → `src/components/ErrorBoundary/`
  (the error-guard boundary keeps its own folder — the entry point imports it from
  `./components/ErrorBoundary/AppErrorBoundary`, not from `shared/`)
- `templates/shared/hooks/*` → `src/hooks/` (includes the error-guard
  `useUiErrorSink.js` alongside `useMondayContext.js` / `useQuery.js`)
- `templates/shared/utils/*` → `src/utils/` includes the remote-monitoring pair
  (`axiomErrorSink.js` + `axiomBrowserTransport.js`) — SYNCED COPIES of
  `error-guard/templates/`; on any defect fix the error-guard original first
- `templates/shared/utils/*` → `src/utils/` (includes the error-guard `logger.js`
  and `globalErrorHandler.js`)
- The error-guard templates carry no `{{...}}` placeholders — they copy through
  unchanged (only the `.template` suffix is stripped). Their `eslintConfig` rule
  kit is already merged into `package.json.template`; do not re-add it.
- Feature components: `column_view/` → OnClickDialog, ColumnSettings;
  `board_view/` → BoardView, ItemList; `item_view/` → ItemView, ItemDetails;
  `dashboard_widget/` → Widget, WidgetSettings.

### 5. Git init — unconditional

```bash
git init && git add -A && git commit -m "Scaffold <name> (<feature_type>) via monday-scaffold"
```

This is NOT optional and does not depend on user confirmation. Three sibling
apps shipped deploys from unversioned working trees because scaffolding skipped
this. (`git push` still requires the usual confirmation; `git init`/first
commit never does.)

### 6. Generate starter GraphQL queries via the monday-api skill

There is **no static queries template** (it was deleted deliberately —
hand-authored boilerplate queries shipped deprecated fields and guessed column
formats). Instead, invoke the **`monday-api`** skill workflow
(WRITE → VALIDATE → TEST) to generate `src/services/graphqlQueries.js` with
exactly the named exports the feature components import:

| Feature type | Required exports |
|--------------|------------------|
| `column_view` | `GET_COLUMN_VALUE`, `UPDATE_COLUMN_VALUE` |
| `board_view` | `GET_BOARD_ITEMS` |
| `item_view` | `GET_ITEM` |
| `dashboard_widget` | `GET_BOARD_ITEMS` |

Any live validation probe runs ONLY against a `WZ-` scratch board in
`TEST_WORKSPACE_ID=16291824`, minimal (`limit: 1` / single item), and cleans up
after itself.

### 7. Post-generation VERIFY (replaces "remind the user")

Do not end by telling the user what to run — run it:

1. `pnpm install`
2. `pnpm dev:mock` (starts vite with the monday-sdk-js stub aliased —
   the app renders **without** the monday iframe)
3. Confirm the app actually renders: fetch `http://localhost:<DEV_PORT>/` and
   check the dev server answers; then open it in the browser (claude-in-chrome
   if available) and confirm the feature component is on screen — not a blank
   page, not an error state.
4. `pnpm test` — the scaffold must start green (vitest runs against the stub).
5. Walk `references/rtl-css-checklist.md` verify-step items (dir=rtl, popover
   placement, date-range reading order).
6. Kill the dev server when done.

If any step fails, fix the scaffold before reporting done. "Build succeeded"
is not "renders".

### 8. Platform registration (app + feature + build URL)

Preferred: register the app, feature, and build URL entirely from the CLI/API — follow the numbered procedure in `.claude/skills/mapps/references/app-lifecycle.md` (sibling `mapps` skill, path relative to the repo root) (steps 2–5: `create_app` with the `{account}_{slug}` rule, `app-features:create`, `app-features:build`). The manual Developer Center path below remains the fallback:

1. Create/locate the app in the [Monday Developer Center](https://monday.com/developers/apps)
2. Add the feature (Column View / Board View / Item View / Dashboard Widget)
3. Build URLs — for **column_view** both onclick and settings URLs point to `/`;
   the app routes internally on `context.placement`
4. Required scopes: `boards:read`, `boards:write` (+ `users:read` if the
   PersonPicker roster query is used)
5. If `{{APP_ID}}` was left as a placeholder in step 3, fill it in now
   (package.json scripts) and commit.

## Dev harness (why and how)

`src/dev-harness/` stubs `monday-sdk-js` (get / listen / execute / api /
storage / settings) with realistic fixtures — context per feature type, account
users, GraphQL responses with real `column_values` shapes — plus failure
toggles:

- **storage false-empty first read** — the real monday.storage race where a
  configured instance transiently reads `success:true, value:null` (this
  shipped an onboarding wizard to configured users in a sibling app; the
  harness lets you reproduce it locally instead of debugging via console
  pastes from an end user)
- GraphQL soft-error (resolves with `{ errors }` — like live) vs hard reject
- theme variations (light/dark/night/black) and role variations
  (admin/member/viewer/guest)

`pnpm dev:mock` renders the app in a plain tab; vitest is permanently aliased
to the stub. Full API in `src/dev-harness/README.md`.

## Key Files Per Feature Type

Feature templates that exist in `./templates/` (this list is reconciled with
the directory — do not promise files that are not there):

### column_view
- `App.jsx` — routes on `context.placement`
- `OnClickDialog.jsx` → `src/components/OnClickDialog/OnClickDialog.jsx`
- `ColumnSettings.jsx` → `src/components/ColumnSettings/ColumnSettings.jsx`

### board_view
- `App.jsx`
- `BoardView.jsx` → `src/components/BoardView/BoardView.jsx`
- `ItemList.jsx` → `src/components/BoardView/ItemList.jsx`

### item_view
- `App.jsx`
- `ItemView.jsx` → `src/components/ItemView/ItemView.jsx`
- `ItemDetails.jsx` → `src/components/ItemView/ItemDetails.jsx`

### dashboard_widget
- `App.jsx`
- `Widget.jsx` → `src/components/Widget/Widget.jsx`
- `WidgetSettings.jsx` → `src/components/Widget/WidgetSettings.jsx`

Additional components (StatusPicker, LabelEditor, ItemCard, ColumnValues, …)
are NOT bundled — if needed, apply REUSE-BEFORE-BUILD first.

## Context Properties Per Feature Type

### column_view

The `placement` property determines which view to render:

| Placement | Description | Key Properties |
|-----------|-------------|----------------|
| `columnPickers` | Cell click dialog | `boardId`, `itemId`, `selectedItemIds`, `columnId`, `columnType` |
| `settings` | Column settings menu | `boardId`, `columnId`, `columnType` (NO `itemId`) |

Common properties in all column_view contexts: `placement`, `boardId`,
`columnId`, `columnType` (e.g. `"color"`, `"text"`), `theme`
(`light`/`dark`/`night`/`black`), `user.id`, `user.currentLanguage`
(e.g. `"en"`, `"he"` — drives the RTL wiring), `user.isAdmin`, `account.id`.

### board_view
| Property | Description |
|----------|-------------|
| `boardId` | Board ID |
| `user`, `account`, `theme` | Common properties |

### item_view
| Property | Description |
|----------|-------------|
| `boardId`, `itemId` | Board + item IDs |
| `user`, `account`, `theme` | Common properties |

### dashboard_widget
| Property | Description |
|----------|-------------|
| `boardIds` | Array of board IDs |
| `user`, `account`, `theme` | Common properties |

The dev-harness fixtures in `templates/shared/dev-harness/fixtures.js` mirror
these shapes exactly — `column_view_settings` deliberately has no `itemId`.

## Template Files Location

```
templates/
├── shared/                      # copied for every feature type
│   ├── package.json.template        ({{APP_NAME}} {{FEATURE_TYPE}} {{DEV_PORT}} {{APP_ID}})
│   ├── vite.config.js.template      ({{DEV_PORT}}; dev-harness alias + vitest config)
│   ├── tailwind.config.js.template
│   ├── postcss.config.js.template
│   ├── gitignore.template           → .gitignore
│   ├── error-guard.marker.template  → .error-guard (root marker, full-tree gate)
│   ├── index.html.template          (lang="he" dir="rtl")
│   ├── index.jsx.template           (error-guard entry: global handlers + root boundary)
│   ├── index.css.template
│   ├── hooks/useMondayContext.js.template   (RTL/theme runtime wiring)
│   ├── hooks/useQuery.js.template
│   ├── hooks/useUiErrorSink.js.template     (error-guard: one ERROR = one toast)
│   ├── services/mondayService.js.template
│   ├── utils/overlayPlacement.js.template
│   ├── utils/logger.js.template             (error-guard: single logging choke-point)
│   ├── utils/globalErrorHandler.js.template (error-guard: window.onerror + rejections)
│   ├── components/LoadingState.jsx.template
│   ├── components/ErrorState.jsx.template
│   ├── components/ErrorBoundary/AppErrorBoundary.jsx.template  → src/components/ErrorBoundary/
│   ├── components/PersonPicker.jsx.template + PersonPicker.module.css.template
│   ├── components/Popover.jsx.template + Popover.module.css.template
│   ├── components/StatusChip.jsx.template + StatusChip.module.css.template
│   ├── components/DateRangeDisplay.jsx.template
│   └── dev-harness/                 (plain files, copied verbatim — NO .template suffix)
│       ├── monday-sdk-stub.js
│       ├── fixtures.js
│       └── README.md
├── column_view/    App.jsx, OnClickDialog.jsx, ColumnSettings.jsx (.template)
├── board_view/     App.jsx, BoardView.jsx, ItemList.jsx (.template)
├── item_view/      App.jsx, ItemView.jsx, ItemDetails.jsx (.template)
└── dashboard_widget/  App.jsx, Widget.jsx, WidgetSettings.jsx (.template)
```

References bundled with this skill:

- `references/rtl-css-checklist.md` — the four recurring CSS/RTL traps
  (fixed-under-transform, sticky-in-overflow, cross-module CSS-module classes,
  bidi quote escaping) + the verify-step walk.
- `references/package-manager.md` — pnpm build-script approval required by a
  fresh standalone scaffold.
- `references/dev-harness.md` — Vite environment handling for selecting the
  correct mock feature context.

## Usage Examples

```bash
/monday-scaffold column_view
/monday-scaffold board_view
/monday-scaffold item_view
/monday-scaffold dashboard_widget
```

## Self-improvement — when the skill itself fails you

When a generated scaffold fails to build/run, a `@vibe/core`/React version pin drifts from what's actually installed, or the RTL checklist misses a real trap:
1. Treat the failure as data about the SKILL, not just an obstacle to the task — do not silently patch the one generated app and move on.
2. Same-session recording is mandatory (standing rule): fix the offending `templates/` file itself (so the next scaffold is born correct), and append the quirk to `references/rtl-css-checklist.md` (or a new references/ page for non-RTL drift) with what was observed and the verified resolution.
3. If a real fix is out of scope right now, record a known-gap note in `references/` with fix directions and surface it to the user.
4. Never skip step 7 (post-generation VERIFY) or weaken the VIBE GUARDRAIL grep just to get a scaffold out the door — narrow either only with proof the skipped check was safe.
