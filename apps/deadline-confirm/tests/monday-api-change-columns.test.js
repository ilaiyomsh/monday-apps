// TDD — changeColumns: status + note in ONE change_multiple_column_values
// mutation. Atomicity is the point, not economy: the product rule is "a task
// cannot be marked without its note", so two sequential writes could leave a
// marked task with no note when the second call fails.
//
// Write formats per the monday-api skill column-formats reference:
// status → { index: <labelId> }, text → a plain string.

import { describe, it, expect, vi } from 'vitest';
import { createMondayApi, API_VERSION, MondayApiError } from '../src/services/monday-api.js';

const okResponse = (data) => ({
  ok: true,
  status: 200,
  json: async () => ({ data }),
});

function harness(response = okResponse({ change_multiple_column_values: { id: '9001' } })) {
  const fetchImpl = vi.fn(async () => response);
  return { api: createMondayApi({ fetchImpl }), fetchImpl };
}

const callBody = (fetchImpl) => JSON.parse(fetchImpl.mock.calls[0][1].body);

describe('changeColumns', () => {
  it('sends ONE change_multiple_column_values mutation with both values as a JSON string', async () => {
    const { api, fetchImpl } = harness();

    await api.changeColumns({
      token: 'tok-1',
      boardId: '111',
      itemId: '9001',
      values: { status_a: { index: 2 }, text_note: 'התחלתי אתמול' },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = callBody(fetchImpl);
    expect(body.query).toContain('change_multiple_column_values');
    expect(body.variables.boardId).toBe('111');
    expect(body.variables.itemId).toBe('9001');
    // column_values must be a JSON *string*, not a nested object.
    expect(typeof body.variables.columnValues).toBe('string');
    expect(JSON.parse(body.variables.columnValues)).toEqual({
      status_a: { index: 2 },
      text_note: 'התחלתי אתמול',
    });
  });

  it('pins the API version and the auth header like every other funnelled call', async () => {
    const { api, fetchImpl } = harness();
    await api.changeColumns({ token: 'tok-1', boardId: '111', itemId: '9001', values: { c: 'v' } });
    const headers = fetchImpl.mock.calls[0][1].headers;
    expect(headers['API-Version']).toBe(API_VERSION);
    expect(headers.Authorization).toBe('tok-1');
  });

  it('preserves label id 0 — a valid status, and falsy', async () => {
    const { api, fetchImpl } = harness();
    await api.changeColumns({
      token: 'tok-1',
      boardId: '111',
      itemId: '9001',
      values: { status_a: { index: 0 }, text_note: 'n' },
    });
    expect(JSON.parse(callBody(fetchImpl).variables.columnValues).status_a).toEqual({ index: 0 });
  });

  it('throws a MondayApiError on a soft error inside an HTTP 200 (funnel rule)', async () => {
    const { api } = harness({
      ok: true,
      status: 200,
      json: async () => ({ errors: [{ message: 'ColumnValueException' }] }),
    });
    await expect(
      api.changeColumns({ token: 'tok-1', boardId: '111', itemId: '9001', values: { c: 'v' } })
    ).rejects.toBeInstanceOf(MondayApiError);
  });
});
