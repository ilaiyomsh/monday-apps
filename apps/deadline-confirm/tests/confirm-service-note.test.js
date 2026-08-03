// TDD — performAction with a required note. The invariant under test: a status
// change and its note land in ONE write, so a task can never end up marked
// without the note that authorized the mark.

import { describe, it, expect, vi } from 'vitest';
import { performAction } from '../src/services/confirm-service.js';

const BUTTON = {
  id: 'b_done0001',
  name: 'סיימתי',
  statusColumnId: 'status_a',
  targetIndex: 2,
  targetLabel: 'בוצע',
  style: { color: '#00854d', icon: '✓', size: 'sm' },
};

const CONFIG = {
  boardId: '111',
  peopleColumnId: 'people_t',
  buttons: [BUTTON],
};

function harness({ item, changeColumns, changeStatus } = {}) {
  const storage = {
    getConfig: vi.fn(async () => CONFIG),
    getOauthToken: vi.fn(async () => 'tok-1'),
  };
  const api = {
    getItemState: vi.fn(async () => ({
      found: true,
      boardId: '111',
      statusLabelId: 0,
      peopleText: 'דנה כהן',
      peoplePersonIds: ['501'],
      ...item,
    })),
    changeStatus: changeStatus ?? vi.fn(async () => {}),
    changeColumns: changeColumns ?? vi.fn(async () => {}),
    createUpdate: vi.fn(async () => {}),
  };
  return { storage, api };
}

const act = (deps, over = {}) =>
  performAction({
    storage: deps.storage,
    api: deps.api,
    itemId: '9001',
    btnId: 'b_done0001',
    expectedPersonId: '501',
    ...over,
  });

describe('performAction with a note', () => {
  it('writes status AND note in a single changeColumns call, never changeStatus', async () => {
    const deps = harness();
    const result = await act(deps, { noteColumnId: 'text_note', note: 'סיימתי אתמול' });

    expect(result.outcome).toBe('ok');
    expect(deps.api.changeStatus).not.toHaveBeenCalled();
    expect(deps.api.changeColumns).toHaveBeenCalledTimes(1);
    expect(deps.api.changeColumns).toHaveBeenCalledWith({
      token: 'tok-1',
      boardId: '111',
      itemId: '9001',
      values: { status_a: { index: 2 }, text_note: 'סיימתי אתמול' },
    });
  });

  it('keeps the single-column path when no note column is mapped', async () => {
    const deps = harness();
    const result = await act(deps);

    expect(result.outcome).toBe('ok');
    expect(deps.api.changeColumns).not.toHaveBeenCalled();
    expect(deps.api.changeStatus).toHaveBeenCalledWith({
      token: 'tok-1',
      boardId: '111',
      itemId: '9001',
      columnId: 'status_a',
      toLabelId: 2,
    });
  });

  it('a mapped column with an EMPTY note never writes — the guard is not bypassable here either', async () => {
    const deps = harness();
    const result = await act(deps, { noteColumnId: 'text_note', note: '' });

    expect(result.outcome).toBe('note_required');
    expect(deps.api.changeColumns).not.toHaveBeenCalled();
    expect(deps.api.changeStatus).not.toHaveBeenCalled();
    expect(deps.api.createUpdate).not.toHaveBeenCalled();
  });

  it('a failed combined write reports api_error and posts NO attribution update', async () => {
    const deps = harness({ changeColumns: vi.fn(async () => { throw new Error('ColumnValueException'); }) });
    const result = await act(deps, { noteColumnId: 'text_note', note: 'טקסט' });

    expect(result.outcome).toBe('api_error');
    expect(deps.api.createUpdate).not.toHaveBeenCalled();
  });

  it('quotes the note in the attribution update so the board audit carries it', async () => {
    const deps = harness();
    await act(deps, { noteColumnId: 'text_note', note: 'ממתין לספק' });

    const body = deps.api.createUpdate.mock.calls[0][0].body;
    expect(body).toContain('בוצע');
    expect(body).toContain('דנה כהן');
    expect(body).toContain('ממתין לספק');
  });

  it('already_done still short-circuits with a note present — no write, no overwrite', async () => {
    const deps = harness({ item: { statusLabelId: 2 } });
    const result = await act(deps, { noteColumnId: 'text_note', note: 'טקסט' });

    expect(result.outcome).toBe('already_done');
    expect(deps.api.changeColumns).not.toHaveBeenCalled();
    expect(deps.api.changeStatus).not.toHaveBeenCalled();
  });

  it('the assignee guard still runs first — a note cannot buy access to another person task', async () => {
    const deps = harness({ item: { peoplePersonIds: ['999'] } });
    const result = await act(deps, { noteColumnId: 'text_note', note: 'טקסט' });

    expect(result.outcome).toBe('not_assignee');
    expect(deps.api.changeColumns).not.toHaveBeenCalled();
  });
});
