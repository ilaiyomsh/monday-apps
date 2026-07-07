# API Versioning — the ONE place a version is declared

<!-- VERIFIED AGAINST: live `{ versions { kind value } }` query on 2026-07-02 (post the 2026-07-01 quarterly rotation).
     STALENESS RULE: if that date is more than 60 days ago, DO NOT trust this file's version
     table — re-run the live query below (or check the api-versioning page + changelog) and
     update this file before using any version string from it. -->

RECOMMENDED_VERSION: 2026-04

That line is machine-read by `scripts/schema.sh`, `scripts/probe.sh` and `scripts/check.py`.
**No other file in this skill — and no code example anywhere in the references — may
hardcode a "current" API version.** When examples need a version they say "the
RECOMMENDED_VERSION from versioning.md".

Why 2026-04 and not the current 2026-07: every verified rule in these references was
confirmed against 2026-04, and 2026-07 ships the User-entity breaking changes below.
2026-04 is maintenance-tier (fully supported, bug fixes only). **Planned migration:** bump
to 2026-07 after auditing every User-entity field usage across the codebase
(`/monday-api check` flags the deprecated flat photo/boolean fields); do it well before the
flat fields are removed in 2026-10.

## Live source of truth (never scrape the docs page first)

```bash
.claude/skills/mapps/mapps-api.sh '{ versions { kind value display_name } }'
```

Verified live 2026-07-02: maintenance = `2025-04, 2025-07, 2025-10, 2026-01, 2026-04`;
current = `2026-07`; release_candidate = `2026-10, 2027-01` (plus internal `dev`).
The docs page (api-versioning) still showed current = 2026-04 on the same day — the docs
lag the rotation and undercount maintenance versions. **The API response is truth; the docs
page is fallback only.**

## Lifecycle (quarterly)

New versions ship on the first day of each quarter (name = the month they become current,
`YYYY-MM`). RC → Current (≥6 months stable) → Maintenance (bug fixes only) → Deprecated.

Header behavior — this is why stale pins are silent time bombs:
- **No `API-Version` header** → request rides **Current** (absorbs each quarterly breaking change unannounced).
- **Deprecated version** → silently rerouted to a Maintenance version.
- **Nonexistent version** (e.g. `2024-02`) → silently falls back to Current.
- **Malformed version** (e.g. `2023`) → `InvalidVersionException`.

So a pin older than the oldest maintenance version is *not honored at all* — the code runs
against a schema it was never written for, with no error. `/monday-api check` flags exactly
this (plus unpinned files and maintenance/RC pins).

## When bumping a pinned version

Grep the WHOLE codebase for every field affected by that version's changelog, not just the
code you are touching — a version bump silently breaks unrelated queries (real incident: one
bump broke every avatar-fetching query in an app after only one call site was migrated).

## Where you can and cannot control the version

- Raw token + header calls (mapps-api.sh, curl, `@mondaydotcomorg/api` ApiClient): the
  `API-Version` header works — always pin it.
- **Seamless/iframe `monday-sdk-js` calls IGNORE `setApiVersion()` and per-call `apiVersion`**
  (observed at SDK v0.5.8) — the parent monday window negotiates the effective version. A
  field that only exists at a newer version fails in the live iframe even though your code
  "requested" it. Changing the effective version requires bumping the app version in the
  Developer Center / upgrading the SDK, not app code. Verify empirically from the iframe
  devtools if in doubt (see errors-and-auth.md).

## Known version-gated changes (dated)

| Version | Change |
|---|---|
| 2025-04 | `board_relation` / dependency / subtasks columns return `null` for legacy `text`/`value` — read typed fields (`linked_item_ids`, `linked_items`, `display_value`, `persons_and_teams`, `checked`). |
| 2025-10 | `settings_str` deprecated — use the typed `settings` field on columns. |
| 2025-10 | `REQUEST_MAX_COMPLEXITY_EXCEEDED` introduced for single over-budget requests. |
| 2026-07 (Current since 2026-07-01) | **User entity breaking changes**: flat photo fields (`photo_thumb`, `photo_original`, `photo_small`, `photo_thumb_small`, `photo_tiny`) deprecated → `photo_url { original small thumb thumb_small tiny }`; boolean flags `is_admin`/`is_guest`/`is_view_only` → `kind` string; `is_pending`/`enabled` → `status` enum. Flat fields REMOVED in 2026-10. |

2026-07 rotated to Current on **2026-07-01** — every UNPINNED app is riding its Users
deprecations ALREADY, and absorbs the flat-field REMOVAL around **2026-10-01** when 2026-10
goes Current. Pin now.

## Complexity budgets differ by token type (why probes stay minimal)

| Token | Budget / minute |
|---|---|
| Personal token (paid account) | 10M points |
| Personal token (trial / free / NGO) | 1M points |
| App token | 5M points per app |
| Single query hard cap | 5M points |

This account uses one paid personal token (10M/min) shared between production apps and agent
probes — keep probes at `limit: 1` / single-item mutations (see `.claude/CLAUDE.md` at the project root).
