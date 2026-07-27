// TDD red phase — contract tests for src/services/monday-api.js (spec §11).
// Every monday response double is built from a probe-captured fixture
// (tests/fixtures/*.probe.json, captured 2026-07-14 against API 2026-07,
// sandbox board WZ-deadline-confirm-probe) — never a hand-written shape.

import { describe, it, expect } from 'vitest';
import {
  createMondayApi,
  MondayApiError,
  MONDAY_API_URL,
} from '../src/services/monday-api.js';

import getItemFx from './fixtures/get-item.probe.json';
import getItemEmptyFx from './fixtures/get-item-empty.probe.json';
import getItemNotFoundFx from './fixtures/get-item-not-found.probe.json';
import setStatusFx from './fixtures/set-status.probe.json';
import createUpdateFx from './fixtures/create-update.probe.json';
import boardColumnsFx from './fixtures/board-columns-settings.probe.json';

const TOKEN = 'tok-test';
const ITEM_ID = getItemFx.data.items[0].id; // '12532634009'
const BOARD_ID = getItemFx.data.items[0].board.id; // '18422009734'
const STATUS_COL = 'color_mm58mbec';
const PEOPLE_COL = 'multiple_person_mm582h4p';
const DATE_COL = 'date_mm58ej61';

/** Fetch fake: records every (url, init) call, answers with a fresh Response. */
function fetchReturning(body, { status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const isText = typeof body === 'string';
    return new Response(isText ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': isText ? 'text/plain' : 'application/json' },
    });
  };
  return { calls, fetchImpl };
}

function parsedRequest(call) {
  return {
    url: call.url,
    method: call.init.method,
    headers: new Headers(call.init.headers || {}),
    body: JSON.parse(call.init.body),
  };
}

async function rejectionOf(promise) {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected the promise to reject, but it resolved');
}

function getItemParams(overrides = {}) {
  return {
    token: TOKEN,
    itemId: ITEM_ID,
    statusColumnId: STATUS_COL,
    peopleColumnId: PEOPLE_COL,
    expiryDateColumnId: null,
    ...overrides,
  };
}

/**
 * V6/D11: the GetItem probe capture predates the persons_and_teams read —
 * derive a double by adding the DOCUMENTED PeopleValue shape (same one the
 * board-items doubles use: { id, kind }) onto the captured people column.
 * Pre-release probe gate recorded in tests/fixtures/README.md.
 */
function withPersons(fx, persons) {
  const clone = structuredClone(fx);
  const people = clone.data.items[0].column_values.find((cv) => cv.id === PEOPLE_COL);
  people.persons_and_teams = persons;
  return clone;
}

describe('createMondayApi — getItemState parsing', () => {
  it('parses a populated item into the exact ItemState (status 0, assignee name, deadline date)', async () => {
    const { fetchImpl } = fetchReturning(getItemFx);
    const api = createMondayApi({ fetchImpl });

    const state = await api.getItemState(getItemParams({ expiryDateColumnId: DATE_COL }));

    expect(state).toEqual({
      found: true,
      boardId: '18422009734',
      statusLabelId: 0,
      peopleText: 'עילי שלם',
      peoplePersonIds: [],
      deadlineDate: '2026-07-20',
    });
  });

  it('parses persons_and_teams into peoplePersonIds as STRINGS, filtering kind "team" entries out (D11)', async () => {
    const fx = withPersons(getItemFx, [
      { id: '48274917', kind: 'person' },
      { id: '77', kind: 'team' },
    ]);
    const { fetchImpl } = fetchReturning(fx);
    const api = createMondayApi({ fetchImpl });

    const state = await api.getItemState(getItemParams());

    expect(state.peoplePersonIds).toEqual(['48274917']);
  });

  it('normalizes NUMERIC persons_and_teams ids to strings in peoplePersonIds', async () => {
    const fx = withPersons(getItemFx, [{ id: 48274917, kind: 'person' }]);
    const { fetchImpl } = fetchReturning(fx);
    const api = createMondayApi({ fetchImpl });

    const state = await api.getItemState(getItemParams());

    expect(state.peoplePersonIds).toEqual(['48274917']);
  });

  it('normalizes never-set columns: status index null, people text "", ids [], empty-string date → null', async () => {
    const { fetchImpl } = fetchReturning(getItemEmptyFx);
    const api = createMondayApi({ fetchImpl });

    const state = await api.getItemState(
      getItemParams({ itemId: getItemEmptyFx.data.items[0].id, expiryDateColumnId: DATE_COL })
    );

    expect(state).toEqual({
      found: true,
      boardId: '18422009734',
      statusLabelId: null,
      peopleText: '',
      peoplePersonIds: [],
      deadlineDate: null,
    });
  });

  it('returns peoplePersonIds [] when no people column is configured (peopleColumnId null)', async () => {
    const { fetchImpl } = fetchReturning(getItemFx);
    const api = createMondayApi({ fetchImpl });

    const state = await api.getItemState(getItemParams({ peopleColumnId: null }));

    expect(state.peoplePersonIds).toEqual([]);
  });

  it('returns { found: false } when the items array is empty (nonexistent item)', async () => {
    const { fetchImpl } = fetchReturning(getItemNotFoundFx);
    const api = createMondayApi({ fetchImpl });

    const state = await api.getItemState(getItemParams());

    expect(state).toEqual({ found: false });
  });
});

describe('createMondayApi — request shape (spec §11.1)', () => {
  it('POSTs to the monday v2 endpoint with Authorization, pinned API-Version 2026-07 and JSON content type', async () => {
    const { calls, fetchImpl } = fetchReturning(getItemFx);
    const api = createMondayApi({ fetchImpl });

    await api.getItemState(getItemParams({ expiryDateColumnId: DATE_COL }));

    expect(calls).toHaveLength(1);
    const req = parsedRequest(calls[0]);
    expect(req.url).toBe(MONDAY_API_URL);
    expect(req.url).toBe('https://api.monday.com/v2');
    expect(req.method).toBe('POST');
    expect(req.headers.get('authorization')).toBe(TOKEN);
    expect(req.headers.get('api-version')).toBe('2026-07');
    expect(req.headers.get('content-type')).toContain('application/json');
  });

  it('sends the GetItem query with typed fragments and appends the expiry column to columnIds when provided', async () => {
    const { calls, fetchImpl } = fetchReturning(getItemFx);
    const api = createMondayApi({ fetchImpl });

    await api.getItemState(getItemParams({ expiryDateColumnId: DATE_COL }));

    const req = parsedRequest(calls[0]);
    expect(req.body.query).toContain('items(ids: $itemIds');
    expect(req.body.query).toContain('... on StatusValue');
    expect(req.body.query).toContain('... on DateValue');
    // V6/D11: the runtime assignee check needs the person IDS, not just text.
    expect(req.body.query).toContain('... on PeopleValue { persons_and_teams { id kind } }');
    expect(req.body.variables).toEqual({
      itemIds: [ITEM_ID],
      columnIds: [STATUS_COL, PEOPLE_COL, DATE_COL],
    });
  });

  it('omits the expiry column from columnIds when expiryDateColumnId is null', async () => {
    const { calls, fetchImpl } = fetchReturning(getItemFx);
    const api = createMondayApi({ fetchImpl });

    await api.getItemState(getItemParams({ expiryDateColumnId: null }));

    const req = parsedRequest(calls[0]);
    expect(req.body.variables).toEqual({
      itemIds: [ITEM_ID],
      columnIds: [STATUS_COL, PEOPLE_COL],
    });
  });
});

describe('createMondayApi — changeStatus (spec §11.2)', () => {
  it('sends change_column_value with value as a JSON *string* {"index":<toLabelId>}', async () => {
    const { calls, fetchImpl } = fetchReturning(setStatusFx);
    const api = createMondayApi({ fetchImpl });

    await api.changeStatus({
      token: TOKEN,
      boardId: BOARD_ID,
      itemId: ITEM_ID,
      columnId: STATUS_COL,
      toLabelId: 1,
    });

    expect(calls).toHaveLength(1);
    const req = parsedRequest(calls[0]);
    expect(req.body.query).toContain('change_column_value');
    expect(req.body.variables).toEqual({
      boardId: BOARD_ID,
      itemId: ITEM_ID,
      columnId: STATUS_COL,
      value: '{"index":1}',
    });
    expect(typeof req.body.variables.value).toBe('string');
    expect(JSON.parse(req.body.variables.value)).toEqual({ index: 1 });
  });
});

describe('createMondayApi — createUpdate (spec §11.3)', () => {
  it('sends create_update with itemId and the Hebrew body as GraphQL variables', async () => {
    const { calls, fetchImpl } = fetchReturning(createUpdateFx);
    const api = createMondayApi({ fetchImpl });

    await api.createUpdate({ token: TOKEN, itemId: ITEM_ID, body: 'אושר במייל על ידי עילי שלם' });

    const req = parsedRequest(calls[0]);
    expect(req.body.query).toContain('create_update');
    expect(req.body.variables).toEqual({ itemId: ITEM_ID, body: 'אושר במייל על ידי עילי שלם' });
  });
});

describe('createMondayApi — fetchMe', () => {
  it('returns { id, name } parsed from the me response, authenticated with the given token', async () => {
    const meResponse = { data: { me: boardColumnsFx.data.me } };
    const { calls, fetchImpl } = fetchReturning(meResponse);
    const api = createMondayApi({ fetchImpl });

    const me = await api.fetchMe({ token: TOKEN });

    expect(me).toEqual({ id: '48274917', name: 'עילי שלם' });
    const req = parsedRequest(calls[0]);
    expect(req.method).toBe('POST');
    expect(req.headers.get('authorization')).toBe(TOKEN);
    expect(req.body.query).toContain('me');
  });
});

describe('createMondayApi — error funnel', () => {
  it('throws MondayApiError with status 500 on an HTTP 500 response', async () => {
    const { fetchImpl } = fetchReturning('Internal Server Error', { status: 500 });
    const api = createMondayApi({ fetchImpl });

    const err = await rejectionOf(api.getItemState(getItemParams()));

    expect(err).toBeInstanceOf(MondayApiError);
    expect(err.status).toBe(500);
  });

  it('throws MondayApiError with unauthorized=true on an HTTP 401 response', async () => {
    const { fetchImpl } = fetchReturning('Unauthorized', { status: 401 });
    const api = createMondayApi({ fetchImpl });

    const err = await rejectionOf(api.getItemState(getItemParams()));

    expect(err).toBeInstanceOf(MondayApiError);
    expect(err.status).toBe(401);
    expect(err.unauthorized).toBe(true);
  });

  it('throws MondayApiError carrying extensions.code for GraphQL errors inside an HTTP 200', async () => {
    const soft = { errors: [{ message: 'x', extensions: { code: 'SomeError' } }] };
    const { fetchImpl } = fetchReturning(soft, { status: 200 });
    const api = createMondayApi({ fetchImpl });

    const err = await rejectionOf(api.getItemState(getItemParams()));

    expect(err).toBeInstanceOf(MondayApiError);
    expect(err.code).toBe('SomeError');
  });

  it('throws MondayApiError when an HTTP 200 response carries no data (malformed payload)', async () => {
    const { fetchImpl } = fetchReturning({}, { status: 200 });
    const api = createMondayApi({ fetchImpl });

    const err = await rejectionOf(api.getItemState(getItemParams()));

    expect(err).toBeInstanceOf(MondayApiError);
  });
});
