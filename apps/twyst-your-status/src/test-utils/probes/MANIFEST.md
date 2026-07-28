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

Re-run live probes before production scope changes:

```bash
export TEST_WORKSPACE_ID=16291824
bash .claude/skills/monday-api/scripts/probe.sh '<query>' '<variables-json>'
```
