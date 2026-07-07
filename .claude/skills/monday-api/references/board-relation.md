# board_relation (Connect Boards) — the 7 verified rules

Every rule below was verified live in real sessions (discussions, Axis/Planner,
monday-provision). This column type has cost more re-derivation time than any other —
follow the rules, don't re-discover them.

## Rule 1 — `text`/`value` are `null` on API 2025-04+ → read `linked_item_ids`

Since 2025-04, `board_relation` (and dependency/subtasks) columns return **`null` for
`text` and `value` even when links exist**. `JSON.parse(cv.value)` silently shows zero
links. Read the typed fields:

```graphql
column_values(ids: ["connect_boards"]) {
  id
  ... on BoardRelationValue {
    linked_item_ids          # cheap — prefer this
    linked_items { id name } # more expensive — resolves each linked item
  }
}
```

## Rule 2 — `create_item` silently DROPS board_relation values → write after create

A `board_relation` key inside `create_item`'s `column_values` is ignored with no error.
Always set it in a follow-up mutation:

```graphql
mutation ($boardId: ID!, $itemId: ID!, $cv: JSON!) {
  change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $cv) { id }
}
```
```js
const cv = JSON.stringify({
  connect_boards: { item_ids: [123456789] }   // integers, not strings
});
// classic form also works: { linkedPulseIds: [{ linkedPulseId: 123456789 }] }
```

## Rule 3 — writes REPLACE the full item_ids set → read-merge-write

A relation write is not additive: sending `{ item_ids: [C] }` on an item linked to A and B
leaves it linked ONLY to C. To add a link:

```js
// 1. READ current links
//    query { items(ids: [$itemId]) { column_values(ids: ["connect_boards"]) {
//      ... on BoardRelationValue { linked_item_ids } } } }
// 2. MERGE in JS
const next = [...new Set([...currentIds.map(Number), newId])];
// 3. WRITE the full set back
const cv = JSON.stringify({ connect_boards: { item_ids: next } });
```

## Rule 4 — writes only succeed on the VERIFIED (forward) side

A connect-boards column create auto-creates a **reflection column** on the target board
(when `allowCreateReflectionColumn: true`). That reflection IS the back-link — map it, don't
create a separate column. Only the forward side is writable; the reflection/mirror side
auto-fills and **rejects direct writes**. To find the reverse column on the far board (it is
NOT derivable from the near side's `settings` — both sides only expose `boardIds`): scan the
far board's `board_relation` columns and filter for `settings.boardIds` containing the
original board id; if 2+ candidates, ask the user.

Create defaults: `{"boardIds":[<int>],"allowMultipleItems":<bool>,"allowCreateReflectionColumn":true}` —
keep `allowCreateReflectionColumn: true` whenever a mirror on the other board must aggregate
through the link, and build the relation BEFORE the mirror that depends on it.

## Rule 5 — `items_page` `query_params` board_relation filtering: verify before trusting either way

**History matters here.** In June 2026, id-based filtering (`operator: any_of`,
`compare_value: [<item id>]`) on a `board_relation` column silently returned nothing
(session-verified), and only name matching worked. **Re-verified live 2026-07-02: FIXED
platform-side** — `any_of` by linked item id now returns the correct rows (probed on API
2026-07 AND 2025-04, so it was a server fix, not a version change), and `contains_text`
by name works too, matching the docs table (any_of / not_any_of by id, contains_text /
not_contains_text by name, is_empty / is_not_empty).

Practical guidance: id-based `any_of` filtering is now legitimate — but this area has
flipped once already, so on first use in new code run one scratch-board probe
(`scripts/probe.sh`) before relying on it. The `linked_item_ids` + client-side-filter
pattern (Rule 7) remains the safe fallback and is still cheaper on large boards.
`items_page_by_column_values` does NOT support board_relation columns at all — use
`items_page` with `query_params`.

Still true in `aggregate()`: `GROUP BY` a relation with `function: ID` (the far-side item
id), never `LABEL` — LABEL silently merges/drops groups on duplicate display names.

## Rule 6 — SDK `parseValue` returns `linkedItems`, not `items`

When parsing a board_relation column value through the SDK/services layer, the parsed shape
uses the key `linkedItems` (camelCase), not `items`. Code that destructures `{ items }` gets
`undefined` with no error.

## Rule 7 — prefer `linked_item_ids` + one batched `items(ids: [...])` over nested traversal

Nested `linked_items { column_values { ... } }` resolves the relation **per row** — measured
at +4,346 complexity (plus +2,750 just for `{ id name }`) on a 100-row query, with fan-out
duplication when many rows link the same target. The cheap pattern:

```graphql
# pass 1 — cheap: collect ids
boards(ids: [$boardId]) { items_page(limit: 100) { items {
  id
  column_values(ids: ["connect_boards"]) { ... on BoardRelationValue { linked_item_ids } }
} } }
```
```graphql
# pass 2 — one batch for the DISTINCT id set (chunk at 100 ids per call)
items(ids: $distinctLinkedIds) { id name column_values(ids: [...]) { id text } }
```
Join in client JS **by id, never by name**. Measured result of this refactor: 12,296 → ~3,130
complexity on the critical query (see complexity.md).

## Related: the `subtasks` column type is not creatable via the API

`create_column(column_type: subtasks)` fails ("not supported yet"). Workaround: create a
throwaway item + `create_subitem` (auto-creates the subitems board), read the subitems-board
id from the parent's `subtasks` column settings `boardIds[0]`, then `delete_item` the
throwaway.
