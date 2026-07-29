/**
 * The GraphQL documents. Every assertion here corresponds to a live-probed fact
 * (2026-07-29, API 2026-04) or to a monday platform contract that silently
 * degrades when broken:
 *
 *  - `$variables` only. String interpolation is how `ids: [undefined]` reaches
 *    the wire.
 *  - MirrorValue: `text`/`value` are ALWAYS null, so the selection must read
 *    `display_value` AND `mirrored_items` — comma-splitting `display_value` is
 *    provably ambiguous (a single source value may itself contain ", ").
 *  - PeopleValue needs `persons_and_teams { id kind }` (`kind` is an enum with
 *    person|team|agent — client code must switch on it, not assume person).
 *  - `next_items_page` is a ROOT field. Nesting it under `boards` is a schema
 *    error, and it is the classic pagination bug.
 */
import { describe, it, expect } from 'vitest';
import {
  BOARD_META_QUERY,
  BOARD_OWNERS_QUERY,
  rangeItemsQuery,
  nextItemsQuery,
} from '../queries';

/*
 * The column-value SELECTION itself is not built here — it comes from
 * domain/columnText.js's cvSelection, which is covered by
 * domain/__tests__/columnText.test.js. What remains this module's job, and is
 * pinned below, is that both documents drop that selection into the right place:
 * inside `column_values(ids: $ids) { … }`. Interpolating it anywhere else yields a
 * document that either fetches nothing useful or fails validation outright.
 */
describe('the caller-supplied column_values selection', () => {
  it.each([
    ['rangeItemsQuery', rangeItemsQuery],
    ['nextItemsQuery', nextItemsQuery],
  ])('%s embeds it inside column_values(ids: $ids) and nowhere else', (_name, build) => {
    const q = build('id text ... on TimelineValue { from to }');
    expect(q).toMatch(
      /column_values\(ids: \$ids\)\s*{\s*id text \.\.\. on TimelineValue { from to }\s*}/
    );
    expect(q.match(/\.\.\. on TimelineValue/g)).toHaveLength(1);
  });
});

describe('BOARD_META_QUERY', () => {
  it('reads name plus every column id/title/type through a variable', () => {
    expect(BOARD_META_QUERY).toContain('$boardId');
    expect(BOARD_META_QUERY).toContain('boards(ids: $boardId)');
    expect(BOARD_META_QUERY).toMatch(/columns\s*{[^}]*id[^}]*title[^}]*type[^}]*}/);
  });
});

describe('BOARD_OWNERS_QUERY', () => {
  it('reads the board owner ids through a variable (a board_view context has no permissions)', () => {
    expect(BOARD_OWNERS_QUERY).toContain('$boardId');
    expect(BOARD_OWNERS_QUERY).toContain('boards(ids: $boardId)');
    expect(BOARD_OWNERS_QUERY).toMatch(/owners\s*{\s*id\s*}/);
  });
});

describe('rangeItemsQuery', () => {
  it('embeds the caller-built column_values selection', () => {
    const q = rangeItemsQuery('id text ... on DateValue { date time }');
    expect(q).toContain('... on DateValue { date time }');
  });

  it('declares every input as a variable — query_params, limit, board and column ids', () => {
    const q = rangeItemsQuery('id text');
    expect(q).toContain('$qp: ItemsQuery');
    expect(q).toContain('$limit: Int!');
    expect(q).toContain('$boardId: [ID!]');
    expect(q).toContain('$ids: [String!]');
    expect(q).toContain('items_page(limit: $limit, query_params: $qp)');
    expect(q).toContain('column_values(ids: $ids)');
  });

  it('selects the cursor so the caller can drain the pages', () => {
    expect(rangeItemsQuery('id text')).toContain('cursor');
  });
});

describe('nextItemsQuery', () => {
  it('uses next_items_page as a ROOT field, never nested under boards', () => {
    const q = nextItemsQuery('id text');
    expect(q).toContain('next_items_page(cursor: $cursor, limit: $limit)');
    // `boards` must not appear AT ALL — the wrong nesting is written both as
    // `boards(ids: …) { next_items_page … }` and as a bare `boards { … }`, and a
    // rule that only looks for the parenthesised form misses the bare one.
    expect(q).not.toMatch(/\bboards\b/);
    // …and next_items_page must sit directly under the operation's own brace, i.e.
    // exactly one `{` may precede it.
    expect(q.slice(0, q.indexOf('next_items_page')).match(/{/g)).toHaveLength(1);
  });

  it('takes the cursor and the column ids as variables', () => {
    const q = nextItemsQuery('id text');
    expect(q).toContain('$cursor: String!');
    expect(q).toContain('$ids: [String!]');
    expect(q).toContain('cursor');
  });

  it('does NOT accept query_params — monday rejects it on the continuation page', () => {
    expect(nextItemsQuery('id text')).not.toContain('query_params');
  });
});
