# Complexity & Round-Trips — measure, don't guess

All numbers below were measured live (2026-06-14) against a real Planner board
(allocations / time-logs / employees). Fold new measurements in as you make them.

## The budget and how to measure

- Budget: **10M complexity points per 60-second rolling window** for this account's paid
  personal token (per account, not per app). Trial/free = 1M; app tokens = 5M each; single
  query hard cap = 5M. See versioning.md.
- **GATE: measure `complexity {}` before shipping any nested query.** Add a root field to
  the exact payload (probe.sh surfaces it automatically):

```graphql
query {
  complexity { query before after reset_in_x_seconds }
  boards(ids: ["..."]) { ... }
}
```

- **Isolation method:** measure a base query, then add ONE component at a time — the delta
  is that component's cost. Don't assume which part is heavy.
- **Reporting quirk:** a query with 2+ `boards` aliases reports `complexity.query` as ~0
  (e.g. 80) — a monday reporting limitation, not free execution. Measure each alias
  separately and sum.
- Complexity scales **linearly with row count**: the same nested query measured
  4,282 / 8,478 / 12,296 at limit 50/100/500. Always measure at realistic volume.

## Measured nesting cost breakdown (100 allocations + linked project metadata + hours mirror)

| component | complexity | % | why |
|---|---|---|---|
| scalar geometry (dates/hours/ids) | 3,424 | 28% | cheap |
| `linked_items { column_values }` | +4,346 | 35% | resolves the relation PER ROW + all its columns |
| `BoardRelation { id name }` | +2,750 | 22% | resolves each linked item's name |
| sum-type `MirrorValue` | +1,480 | 12% | resolves relation to far board and computes |
| `people` | +296 | 2% | cheap |

Two failure modes nesting hides:
1. **Fan-out duplication** — project-level data fetched once per allocation row (~4x redundant here).
2. **Mirror blow-up over time** — a `sum` mirror's `display_value` returns the FULL
   comma-separated list of every linked source value (70 numbers for one item with 70 logs),
   and its cost scales with the *cumulative linked-row count*, not the items queried. It
   looks fine on a small dataset and explodes later. **`display_value` on mirror/formula
   chains is expensive by default.**

Before removing an expensive component, check in code what it is used for — replace the data
SOURCE, not the feature.

## complexity vs round-trips — two different problems

| | complexity (server compute) | round-trips (wall-clock) |
|---|---|---|
| budget | 10M/min | wall-clock; in an iframe app, proxy overhead |
| nesting | ↑↑ complexity, 1 round-trip | — |
| splitting into N calls | ↓ per call | ↑↑ round-trips |

The `monday-sdk-js` seamless bridge **serializes separate `monday.api()` calls even under
`Promise.allSettled`** — measured: 6 "parallel" calls ≈ 21s waterfall while the heaviest
query cost only 12,296 points (0.12% of budget). Don't "fix" complexity when the real
problem is call count. **Anti-pattern:** a per-row API-call loop ("for each item fetch its
related data") — unbounded round-trips are worse than one measured nested query.

## The fix pattern: consolidate, replace sources, join by id

1. Merge independent data needs into **one GraphQL document** (aliased top-level fields) —
   one round-trip, one proxy hop.
2. Replace `sum`-mirror reads with server-side **`aggregate` (SUM ... GROUP BY ID(relation))**
   — measured 1,480 → ~122, and no longer scales with linked-row count.
3. Replace nested `linked_items{...}` with `linked_item_ids` + ONE batched `items(ids:[...])`
   call for the distinct set (see board-relation.md Rule 7).
4. Join results **by id in client JS, never by name** (names collide/get renamed — a
   name-join silently merges or drops rows).

Measured end-to-end: 12,296 → ~3,130 complexity; API-layer latency 7,575ms → 3,151ms (~2.4x).

## Batching writes

Batch create/update via aliased mutations, **chunked per board at ~10–15 mutations per
request** (and id-batch reads at 100 ids per call):

```graphql
mutation ($b: ID!, $n0: String!, $cv0: JSON!, $n1: String!, $cv1: JSON!) {
  r0: create_item(board_id: $b, item_name: $n0, column_values: $cv0) { id }
  r1: create_item(board_id: $b, item_name: $n1, column_values: $cv1) { id }
}
```

## aggregate() cookbook (verified live)

```graphql
aggregate(query: {
  from:     { type: TABLE, id: "<board_id>" }
  select:   [ ... ]                        # COLUMN (raw) or FUNCTION; EVERY element needs an `as` alias
  group_by: [ { column_id: "<alias>" } ]   # points at the SELECT alias, NOT the board column id
  query:    { rules: [ ... ] }             # standard ItemsQuery filter rules — filter first to cut cost
  limit:    100
})
```

- **Iron rule:** `group_by.column_id` references the `as` alias from `select` — mismatching
  gives `Failed to find a matching select elements for groupBy elements`.
- Result shape: `results[].entries[]`; `value` is a union — `AggregateGroupByResult { value }`
  (group key, JSON) or `AggregateBasicAggregationResult { result }` (the number).
- **status** raw `COLUMN` returns a hex color — wrap in `LABEL` for text.
- **people / board_relation**: use `LABEL` for names; `PERSON` caused a server 500 on a real
  board — prefer `LABEL`. For cross-board JOIN keys use `ID`, not `LABEL` (name collisions).
- **date**: wrap in `DATE_TRUNC_DAY/WEEK/MONTH/QUARTER/YEAR` — returns epoch milliseconds.
- Functions (`AggregateSelectFunctionName`): numeric `SUM AVERAGE MEDIAN MIN MAX COUNT
  COUNT_ITEMS COUNT_SUBITEMS COUNT_DISTINCT`; status/people `LABEL COLOR PERSON IS_DONE`;
  date `DATE_TRUNC_* HOUR DATE START_DATE END_DATE`; text `UPPER LOWER TRIM LENGTH FIRST LEFT`.
- Multi-dimensional group_by (project × day) and filtered aggregates (`operator: between` /
  `any_of`) work as expected.

## Optimization checklist

1. Measure current state in DevTools waterfall, twice (rule out network noise).
2. Isolate the source: app's own await/useEffect chain vs framework (almost always the app).
3. Quantify every suspicion with `complexity {}`, component by component.
4. Check in code what each heavy component is used for before removing it.
5. Replace the data source, not the feature (mirror→aggregate, nested-relation→ids+batch).
6. Consolidate independent parts into one call — not "run in parallel".
7. Join by id, never by name.
8. Do a measurable PoC (wall-clock + complexity, cold and warm) before committing.
