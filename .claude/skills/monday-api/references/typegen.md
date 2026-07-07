# TypeScript Codegen — optional post-TEST phase (absorbed from the retired genapi skill)

Run this ONLY after the workflow's TEST step passed — generate types from operations that
were already validated against the live schema and probed. Codegen is a transcription aid,
not a validation substitute.

## Key principle: minimal operations

Generate the leanest possible query — only fields the use case directly needs.
- No fields "just in case" (`name`, `text`, `type`, `value`, `cursor` only when required).
- Mutations return only what confirms success (usually just `id`).
- No pagination plumbing unless asked.
- When in doubt, fewer fields — this is also the cheap-complexity choice (complexity.md).

## Schema source

Point codegen at the skill's freshness-gated cache — run `scripts/schema.sh` first and use
the path it prints (`.claude/skills/monday-api/schema-cache/schema-<version>.sdl`, refuses
to serve a copy >30 days old).

Legacy note: `genAPI/src/schema.graphql` (the retired genAPI project at the project root)
was the old shared schema (advisory freshness only — it sat 140 days stale). Prefer the
gated cache; if a project's codegen.yml still points at genAPI, refresh that file
(`npm run fetch:schema --prefix <path-to>/genAPI`) or repoint it.

## Per-project layout

| Path (relative to the project) | Purpose |
|---|---|
| `src/queries.graphql.ts` | GraphQL operations |
| `codegen.yml` | Codegen config |
| `src/generated/graphql.ts` | Generated types — never edit manually |

**codegen.yml template** (fix the schema path for the project's depth):

```yaml
overwrite: true
schema: "../../.claude/skills/monday-api/schema-cache/schema-<VERSION>.sdl"  # exact path printed by scripts/schema.sh — version per references/versioning.md
documents: "src/**/*.graphql.ts"
generates:
  src/generated/graphql.ts:
    plugins:
      - typescript
      - typescript-operations
```

**`src/queries.graphql.ts` starter:** `import { gql } from "graphql-request";`

## Procedure

1. Read `src/queries.graphql.ts` first — reuse/extend existing operations, avoid duplicates.
2. Add the new operation. Naming: operation names `PascalCase` (`GetBoardItems`), export
   variables `camelCase` (`getBoardItems`), `gql` tag from `graphql-request`.

```typescript
export const getBoardItemIds = gql`
  query GetBoardItemIds($boardId: ID!) {
    boards(ids: [$boardId]) {
      items_page { items { id } }
    }
  }
`;
```

3. Run codegen: `npm run codegen` (or `npx graphql-codegen` if no script). A codegen failure
   usually means a field/argument doesn't exist in the schema — but since the operation was
   VALIDATE'd already, first suspect a stale schema file: re-run `scripts/schema.sh`.
4. Show usage:

```typescript
import type { GetBoardItemIdsQuery, GetBoardItemIdsQueryVariables } from "./generated/graphql";
import { getBoardItemIds } from "./queries.graphql";
```

Notes: monday fields are `snake_case`; the `documents` glob means all operations must live
in `.graphql.ts` files under `src/`; if the schema doesn't support a request, say so and
suggest alternatives — never invent fields.
