import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * round313 (PR review) — a relation may only be reused when it actually points at the
 * intended board.
 *
 * ensureRelationColumn reused any board_relation matching on (title, type). The tasks
 * board can be an EXISTING board the owner connected (tasks.mode 'connect'), where a
 * relation already titled "נושאים לדיון" pointing somewhere else is entirely
 * plausible. Adopting it persists an unrelated column as topicsLinkID, and then every
 * task→topic write in useTasks lands on the wrong board — a worse failure than the
 * missing column round313 set out to fix.
 *
 * The second half is subtler: after rejecting such a column, creation must NOT go
 * through ensureColumn, which reuses by (title, type) and would hand back the very
 * column just rejected.
 */

const { api, state } = vi.hoisted(() => {
  const state = { calls: [], nextId: 0 };
  return {
    state,
    api: vi.fn(async (q, vars) => {
      const s = String(q);
      state.calls.push({ q: s, vars });
      if (s.includes('create_column')) {
        state.nextId += 1;
        return { create_column: { id: `new-col-${state.nextId}` } };
      }
      return {};
    }),
  };
});
vi.mock('../monday-client.js', () => ({ api }));
vi.mock('../../logger.js', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { ensureRelationColumn } from '../provisionBoards.js';

const TOPICS = '777';
const OTHER = '888';
const TITLE = 'נושאים לדיון';
const relCol = (id, boardIds) => ({
  id,
  title: TITLE,
  type: 'board_relation',
  settings_str: JSON.stringify({ boardIds }),
});
const creates = () => state.calls.filter((c) => c.q.includes('create_column'));

beforeEach(() => {
  api.mockClear();
  state.calls = [];
  state.nextId = 0;
});

describe('ensureRelationColumn — reuse requires the right target', () => {
  it('reuses a relation whose settings point at the target board', async () => {
    const existing = [relCol('col-good', [Number(TOPICS)])];
    expect(await ensureRelationColumn('1', existing, TITLE, TOPICS)).toBe('col-good');
    expect(creates()).toHaveLength(0);
  });

  it('reuses it when the target is one of SEVERAL linked boards', async () => {
    const existing = [relCol('col-multi', [Number(OTHER), Number(TOPICS)])];
    expect(await ensureRelationColumn('1', existing, TITLE, TOPICS)).toBe('col-multi');
    expect(creates()).toHaveLength(0);
  });

  it('does NOT hijack a same-titled relation pointing at another board', async () => {
    // THE REPORTED BUG: this used to return 'col-wrong'
    const existing = [relCol('col-wrong', [Number(OTHER)])];
    const id = await ensureRelationColumn('1', existing, TITLE, TOPICS);
    expect(id).not.toBe('col-wrong');
    expect(id).toBe('new-col-1');
  });

  it('creates the intended relation instead of falling back into title reuse', async () => {
    // the second half of the fix: creation must not route through ensureColumn
    const existing = [relCol('col-wrong', [Number(OTHER)])];
    await ensureRelationColumn('1', existing, TITLE, TOPICS);
    const [create] = creates();
    expect(create).toBeTruthy();
    expect(JSON.parse(create.vars.defaults).boardIds).toEqual([Number(TOPICS)]);
    expect(create.vars.title).toBe(TITLE);
    expect(create.vars.type).toBe('board_relation');
  });

  it('leaves the unrelated column untouched — it is someone else’s data', async () => {
    const existing = [relCol('col-wrong', [Number(OTHER)])];
    await ensureRelationColumn('1', existing, TITLE, TOPICS);
    expect(state.calls.some((c) => c.q.includes('change_column_title'))).toBe(false);
    expect(existing.find((c) => c.id === 'col-wrong').settings_str)
      .toBe(JSON.stringify({ boardIds: [Number(OTHER)] }));
  });

  it('does not reuse an UNLINKED same-titled relation (no boardIds at all)', async () => {
    const existing = [{ id: 'col-bare', title: TITLE, type: 'board_relation' }];
    expect(await ensureRelationColumn('1', existing, TITLE, TOPICS)).toBe('new-col-1');
  });

  it('does not reuse a non-relation column that happens to share the title', async () => {
    const existing = [{ id: 'col-text', title: TITLE, type: 'text' }];
    expect(await ensureRelationColumn('1', existing, TITLE, TOPICS)).toBe('new-col-1');
  });

  it('recognises a relation it created EARLIER IN THE SAME RUN — no duplicate', async () => {
    // the created column is cached with its defaults as settings_str, so the second
    // call resolves it by target instead of creating a second identical relation
    const existing = [];
    const first = await ensureRelationColumn('1', existing, TITLE, TOPICS);
    const second = await ensureRelationColumn('1', existing, TITLE, TOPICS);
    expect(second).toBe(first);
    expect(creates()).toHaveLength(1);
  });

  it('tolerates a malformed settings_str instead of throwing', async () => {
    const existing = [{ id: 'col-bad', title: TITLE, type: 'board_relation', settings_str: '{not json' }];
    expect(await ensureRelationColumn('1', existing, TITLE, TOPICS)).toBe('new-col-1');
  });

  it('compares board ids across string/number forms', async () => {
    // readColumns returns whatever monday sent; the spec passes ids as strings
    const existing = [relCol('col-str', ['777'])];
    expect(await ensureRelationColumn('1', existing, TITLE, TOPICS)).toBe('col-str');
  });
});
