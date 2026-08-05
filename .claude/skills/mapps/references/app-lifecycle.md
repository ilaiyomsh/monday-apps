# App lifecycle — creating a NEW monday app end-to-end from the CLI/API

The full playbook for registering a brand-new app, its features, build wiring,
manifest, and scopes — without opening the Developer Center UI. Reconstructed
from real sessions (Day-off app 11459177 built 100% via API; Discussions
11457413; discussions-pro 11584336) and verified against
`@mondaycom/apps-cli` 4.10.8 `--help` output on 2026-07-02.

For flag details and the app-id-vs-version-id table, this page defers to
`references/cli.md` — do not guess flags; check there first.

## GATES for this page (read before step 2)

- `mapps app:create`, the `create_app` mutation, and `mapps manifest:import`
  all write to the **real account**. Before running any of them, announce
  intent in one line (e.g. "Registering new app 'X' in the account now").
  For a **brand-new empty app** no confirming question is needed — the
  announcement is enough.
- `manifest:import` targeting an **EXISTING live app** (`-a`/`-i` without
  `-n`) gets **exactly one confirming question** first — it creates/overrides
  a version of a real, installed app.
- Any scope change (step 7) must be accompanied by the **re-auth warning**
  printed to the user, and an agent-inferred scope list needs one explicit
  question naming the exact scopes before executing (verified: Claude Code's
  own permission classifier blocks it otherwise).

---

## 0. Decide first: new app or new feature? Hosted where?

**New app vs. new feature on an existing app:**

| Choose | When |
|---|---|
| New **feature** on an existing app | Same product, same scope footprint, same install lifecycle — e.g. adding an item view next to an existing board view. Run `mapps app-features:list -a <APP_ID> -i <APP_VERSION_ID>` FIRST: features are sometimes pre-registered (discussions-pro's Custom Object already existed — don't blindly re-create). Then jump to step 4. |
| New **app** | Distinct product, different scopes, separate install/versioning lifecycle, or a separate client/demo deliverable. Continue from step 1. |

**Hosting choice — decides the `app-features:build` type AND the deploy path:**

| Hosting | Build type | Deploy | Implies |
|---|---|---|---|
| monday code, server-side | `monday_code` | `code:push` (via ship.sh) | Gets `code:logs`, `code:env`/`code:secret`, scheduler, database |
| monday code, client-side static | `monday_code_cdn` | `code:push --client-side -d <build dir>` (via ship.sh) | Pure CDN; no server logs/secrets |
| External (GitHub Pages, Vercel, …) | `custom_url` | your own pipeline — `code:push` is NOT used | Needed when the monday-code cap bites: **max 5 private apps connected to monday code per account** (this is why Day-off is on GitHub Pages) |

DEV always uses `custom_url` pointing at a tunnel (step 5) regardless of the
production choice.

## 1. Code first

Generate the codebase BEFORE registering anything, so the app id has somewhere
to live:

- **React view/widget apps** (board view, item view, column view, dashboard
  widget) → the `monday-scaffold` skill
  (`.claude/skills/monday-scaffold/SKILL.md`).
  Its final "Developer Center setup" step is replaced by steps 2–5 of this
  page.
- **Integration apps** (workflow triggers/actions) → the
  `integration-scaffold` skill.
- **monday-code server templates** → `mapps app:scaffold <DEST> <TEMPLATE>`
  (e.g. `quickstart-react`, `slack-node`; optional `-s <signingSecret>`,
  `-c <npm script>`). Use only when you want monday's own starter template;
  it installs dependencies and auto-starts the project.

## 2. Register the app

Announce intent in one line, then pick the path:

- **Fresh empty directory, nothing generated yet:** `mapps app:create -n
  "<NAME>"` — but know what it is: **interactive project scaffolding**, not a
  registration-only command. It creates a project directory too.
- **Existing codebase (the normal case here):** `app:create` is the wrong
  tool (an agent had to `pkill` it mid-run). Use the `create_app` GraphQL
  mutation via mapps-api.sh:

```bash
.claude/skills/mapps/mapps-api.sh \
  'mutation { create_app(input: { name: "My App", slug: "yomsheni-il_my-app" }) { id api_app_id } }'
```

**The 3-failures trap (all hit in one real session — skip straight to the
working form above):**

1. `create_app(name: "...")` → fails: the mutation takes a single `input`
   argument (`CreateAppInput`).
2. `input` without `slug` → fails: `"App slug is required"`.
3. Slug without the account prefix → fails: `"Invalid App Slug format.
   Please use the format {yomsheni-il}_{your-app-slug}"`. **Slug rule:
   `{account}_{slug}`**, e.g. `yomsheni-il_my-app`. The error message hands
   you the corrected value.

Also: `CreateAppResponse` has **no `name` field** — request `id` and
`api_app_id` only.

Immediately record the returned ids in the project's `CLAUDE.md` (app id,
slug, and — after step 3 — version and feature ids) so they survive context
resets, and wire the app id into `package.json` scripts / `.env`.

## 3. Get the ids

```bash
mapps app-version:list -i <APP_ID>     # yes, -i means APP id on this command
```

Every new app starts with exactly **one draft version** — note its id. Most
`app-features:*` and `code:*` commands want the **version** id, others the
**app** id, and the `-i` flag flips meaning between them: check the
"App id vs version id per subcommand" table in `references/cli.md` before
constructing any command.

## 4. Create features

One feature per product surface, created against the draft version:

```bash
mapps app-features:create -a <APP_ID> -i <APP_VERSION_ID> -n "<Display Name>" -t <TYPE>
```

- `-t` takes the `AppFeatureXxx` form — `AppFeatureBoardView`,
  `AppFeatureItemView`, `AppFeatureDashboardWidget`, `AppFeatureObject`
  (= "Custom Object" in Developer Center wording), `AppFeatureIntegration`,
  `AppFeatureWorkspaceView`, `AppFeatureItemMenuAction`, … — full list in
  `references/cli.md` § app-features.
- Naming: `-n` is what users see in monday's pickers (board-view "+ Add
  view", object search). Use the product name, not an internal slug.
- Two representations exist for the same types: the CLI and the manifest use
  `AppFeatureBoardView`-style names; the GraphQL `AppFeatureTypeE` enum uses
  `BOARD_VIEW` / `ITEM_VIEW` / `OBJECT` / `DASHBOARD_WIDGET`-style names
  (55 values, introspected live 2026-07-02). Don't mix them.
- Note the returned **feature id** — `app-features:build` needs it as `-d`.

Verify with `mapps app-features:list -a <APP_ID> -i <APP_VERSION_ID>`.

## 5. Wire the build per environment

**DEV — tunnel as a custom_url build:**

```bash
mapps tunnel:create -p <PORT> -a <APP_ID>
mapps app-features:build -a <APP_ID> -i <APP_VERSION_ID> -d <APP_FEATURE_ID> \
  -t custom_url --customUrl="https://<tunnel-host>"
```

**Trap:** the URL must be passed as `--customUrl=<url>` (or `-u <url>`) — a
positional-looking URL after `-t custom_url` fails. (`references/cli.md`
section 1 carries this as a verified fact.)

**PROD — depends on the step-0 hosting decision:**

- `monday_code_cdn` (client-side) or `monday_code` (server): run the first
  deploy **through `scripts/ship.sh`** (the only sanctioned push path), then
  point the feature at it:

  ```bash
  mapps app-features:build -a <APP_ID> -i <APP_VERSION_ID> -d <APP_FEATURE_ID> -t monday_code_cdn
  ```

  Build wiring is one-time; subsequent ships reuse it — ship.sh only pushes
  code, it never touches feature builds.
- `custom_url` (external hosting): deploy with your own pipeline, then set
  `--customUrl=` to the public URL. ship.sh / `code:push` are not involved.

**Server apps only — secrets ordering trap:** `code:secret -i <APP_ID> -m set`
fails with `"No monday code release found for this app"` until at least one
deployment exists. Correct order: push once → set secrets → push again. (And
`-i` means APP id for `code:secret`/`code:env` but VERSION id for
`code:status`/`code:logs` — the cli.md table again.)

## 6. Manifest — export, edit, import

**When to use which:**

- **Per-command CLI** (steps 2–5) — for creating things incrementally; the
  default path.
- **`manifest:export` → edit → `manifest:import`** — for bulk edits (rename,
  many `data.*` flags at once), reviewing the full app definition, or cloning.
- **`manifest:import -n/--newApp`** — creates a **new app** from a manifest
  file: the clone path, and an alternative to the whole
  `create_app` → `app-features:create` sequence when you already have a
  known-good manifest. `-a <APP_ID>` instead creates a new draft version on
  an existing app; `-i <APP_VERSION_ID>` overrides that version (gated — one
  question, see GATES). `-m/--allowMissingVariables` tolerates unresolved
  template variables.

```bash
mapps manifest:export -a <APP_ID> -p <DIR>   # -a alone = live version; -i for a specific version
# edit <DIR>/manifest.json
mapps manifest:import -p <DIR>/manifest.json -a <APP_ID>
```

**`-p` on export takes a DIRECTORY** — the CLI writes `manifest.json` inside
it.

**Anatomy** (real export, app "Discussions" 11457413, trimmed):

```json
{
  "version": "1.0.0",                       // manifest schema version
  "app": {
    "name": "Discussions",
    "slug": "yomsheni-il_discussions",      // the {account}_{slug} rule again
    "color": "#D8871E",
    "oauth": { "scopes": ["me:read", "boards:read", "boards:write", "..."] },
    "features": [
      {
        "key": "discussions-view",          // manifest-local key, NOT the numeric feature id
        "type": "AppFeatureBoardView",      // same AppFeatureXxx names as app-features:create -t
        "name": "Discussions",              // display name in monday UI
        "schemaVersion": "18",              // per-feature-type, evolves independently
        "build": { "kind": "view" },
        "data": {
          "mode": "iframe",
          "hideSidekick": true,
          "query_parmas": true,             // REAL upstream typo — preserve verbatim
          "hideBoardControls": true,
          "isMobileSupported": true,
          "iconUrl": "https://cdn.monday.com/apps/photos/.../....png"
        }
      }
    ]
  }
}
```

`AppFeatureObject` features add `hide_object_from_search` and
`should_resolve_relations_redirect` under `data`.

**Validation gotchas:**

- `query_parmas` is a genuine typo in monday's schema — keep it exactly.
- Scopes in the manifest are the lowercase-colon form (`boards:read`); the
  `update_app` mutation input needs the ENUM form instead (step 7). Same
  data, two shapes.
- The export observed so far does **not** include the feature's build URL
  (`build.kind` only) — do not rely on export→import to round-trip
  `custom_url` targets; re-run `app-features:build` after an import if in
  doubt.
- `manifest:export` intermittently fails with the generic `"Unexpected error
  occurred while communicating with the remote server"` (seen on 2 of 3 apps;
  transient). Retry after a short wait before concluding anything is broken.
- No authoritative full manifest schema exists in the docs
  (`ask_developer_docs` explicitly came back empty on it) — treat the export
  of a similar app as the ground truth for structure.

## 7. Permissions & scopes — and THE RE-AUTH TRAP

Scopes live in `app.oauth.scopes` in the manifest, and are changed
programmatically via `update_app`:

```bash
.claude/skills/mapps/mapps-api.sh \
  'mutation ($id: ID!, $input: UpdateAppInput!) { update_app(id: $id, input: $input) { id permissions } }' \
  '{"id":"<APP_ID>","input":{"permissions":["BOARDS_READ","BOARDS_WRITE","USERS_READ","ME_READ"]}}'
```

- **Input is the `AppPermission` ENUM form** (`BOARDS_READ`,
  `NOTIFICATIONS_WRITE`, …) — NOT the `boards:read` strings the manifest and
  the mutation's own response use. Passing strings fails with
  `VALIDATION_INVALID_TYPE_VARIABLE`.
- **`permissions` REPLACES the whole list** — not additive. Always submit the
  full desired set (read the current set first: `query { apps(ids: [<id>]) }`
  or a manifest export).
- Gate: if the user said "add permissions" without naming scopes, ask ONE
  explicit question listing the exact scopes + justification before mutating.

**THE RE-AUTH TRAP (verified in production):** adding a scope (e.g.
`notifications:write`) does **NOT** extend already-issued OAuth tokens.
Every existing installation keeps its previously-approved scope set until the
human re-approves via monday's in-app banner. Until then, API calls needing
the new scope fail with **`UNAUTHORIZED_FIELD_OR_TYPE` — delivered inside an
HTTP 200 response** (see
`.claude/skills/monday-api/references/errors-and-auth.md`).
Consequences to print to the user with every scope change:

- Old code paths keep working; only new-scope code paths fail until
  re-approval — code must tolerate that state gracefully.
- Check approval state at runtime via the view context's
  `permissions: { approvedScopes, requiredScopes }` or the
  `AppInstallPermissions` API type.

## 8. Install & verify

1. Confirm registration: `mapps app:list` shows the new app;
   `app-features:list` shows each feature `status: active` with the expected
   build target.
2. In the developer's own account, an active feature is immediately usable on
   its surface: board views under board "+ Add view → Apps", item views in
   the item card's view picker, widgets in dashboards "+ Add widget → Apps",
   custom objects via workspace "+ Add". Add it to a real (or `WZ-` test)
   board.
3. First-run verification per `references/verify-live.md` — drive the actual
   surface in the browser, screenshot + console check; not just "the URL
   loads".
4. **Promote** only applies when a separate draft version exists:
   `mapps app:promote -a <APP_ID> -i <APP_VERSION_ID>` (gated — production).
   A brand-new single-version app has nothing to promote — `app:promote`
   fails with `"Cannot find draft app version to promote"`, and for
   single-live-version apps the push itself is the publish (see ship.sh).

## 9. Worked example — the real Day-off flow, condensed

The happy path as it should have been (traps annotated where the real session
lost time). App: Day-off, externally hosted on GitHub Pages because the
account was at the 5-private-app monday-code cap.

```bash
# 0. Decision: new app; external hosting (monday-code cap) → custom_url build.
# 1. Code already scaffolded in the repo. Announce: "Registering new app 'Day-off'."

# 2. Register (create_app, NOT app:create — existing repo).
#    Trap avoided: input-wrapped args + {account}_{slug} slug + no `name` in response.
.claude/skills/mapps/mapps-api.sh \
  'mutation { create_app(input: { name: "Day-off", slug: "yomsheni-il_day-off" }) { id api_app_id } }'
# → {"id":"11459177","api_app_id":"1560017"}

# 3. Draft version id (every new app has exactly one).
mapps app-version:list -i 11459177          # → version 15124901 (draft, v1)

# 4. Feature — Custom Object surface.
mapps app-features:create -a 11459177 -i 15124901 -n "Day-off" -t AppFeatureObject
# → feature 22016827

# 5. Build wiring — external hosting. Trap avoided: --customUrl= form, not positional.
mapps app-features:build -a 11459177 -i 15124901 -d 22016827 \
  -t custom_url --customUrl="https://ilaiyomsh.github.io/day-off/"
mapps app-features:list -a 11459177 -i 15124901   # verify: build URL set, status active

# 6. Record ids in the project CLAUDE.md (app 11459177, version 15124901,
#    feature 22016827, slug yomsheni-il_day-off, hosting rationale).

# 7. (Later) scopes — gate: one question naming the exact scopes, then:
#    ENUM form, full replacement list, re-auth warning printed.
.claude/skills/mapps/mapps-api.sh \
  'mutation ($id: ID!, $input: UpdateAppInput!) { update_app(id: $id, input: $input) { id permissions } }' \
  '{"id":"11459177","input":{"permissions":["BOARDS_READ","BOARDS_WRITE","USERS_READ","ME_READ"]}}'

# 8. Verify live per references/verify-live.md (add the object in a workspace,
#    drive it in the browser).
```

Real-session cost of the traps this page removes: ~14 minutes of
reconnaissance and 5 failed calls for what is under one minute of API time.

## 10. Feature lifecycle subscriptions — verified facts (2026-07-24)

- `update_app_lifecycle_subscription` accepts **only `entity_type: "appFeature"`**
  (error-echo probe: `allowedEntityTypes: ["appFeature"]`). App-level webhooks
  (install/uninstall/subscription) have **no API** — they are set manually in
  the Developer Center per app.
- **Live versions are immutable**: mutating a live version's feature fails with
  403 `"Lifecycle subscriptions cannot be modified for live app versions"`.
  Register the DRAFT version's features; live coverage arrives when that draft
  is promoted. Live registrations that existed earlier (2026-07-19) were wiped
  server-side when this model landed.
- `get_app_lifecycle_subscriptions(app_id, version_id)` — `version_id` is
  undocumented (schema-introspected) but **required in practice**: without it
  the result is NOT the union of all versions (a draft registered seconds
  earlier came back empty). Always query per version.
- Full event catalog per feature kind (incl. `hard_delete`,
  `multiple_duplicate` missing from docs): see
  `apps/telemetry-dashboard/scripts/lifecycle-kinds.mjs` — live-verified enum.
- Working registration/verification tooling: `apps/telemetry-dashboard/scripts/
  {resolve-lifecycle-features,register-lifecycle-subscriptions}.mjs`.
