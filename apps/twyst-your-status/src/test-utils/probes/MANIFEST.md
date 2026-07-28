# Probe fixtures — Twyst Your Status

## Live probe status

`probe.sh` could not run in this cloud session (`mapps init` / `.mappsrc` absent;
agents must not use `MONDAY_TOKEN`). Operations were validated against the
checked-in SDL cache:

- Schema: `.claude/skills/monday-api/schema-cache/schema-2026-04.sdl`
- Confirmed: `change_column_value`, `change_multiple_column_values`,
  `StatusValue.index`, `User.teams`, root `users` / `teams` queries.

## Captured fixtures

| File | Origin |
|---|---|
| `status-column-context.json` | Scratch probe 2026-07-27, workspace `16291824`, board deleted after |
| `graphql-ops.json` | Schema-validated operation notes + write formats from `column-formats.md` |
| `required-field-values.json` | Live probe 2026-07-28 via `mapps-api.sh`, workspace `16291824`, board `18424030023` (`WZ-fieldtypes`), item `12646786855`, API 2026-04 — one cell per supported required-field type, read with `ALL_COLUMN_VALUE_FIELDS` |

The 2026-07-28 capture corrected two shapes that hand-written fixtures had wrong:
`DateValue.date`/`.time` arrive in the ACCOUNT timezone (the write is UTC), and
`TimelineValue.from`/`.to` arrive as full ISO timestamps, not `YYYY-MM-DD`. Both are
now recorded in the monday-api skill's `references/column-formats.md`.

Re-run live probes before production scope changes:

```bash
export TEST_WORKSPACE_ID=16291824
bash .claude/skills/monday-api/scripts/probe.sh '<query>' '<variables-json>'
```
