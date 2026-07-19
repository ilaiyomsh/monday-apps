// Contract tests for src/services/monday-api.js (lifecycle spec — Tests bullet 5):
// GraphQL soft errors[] inside HTTP 200 → MondayApiError (error-guard funnel rule),
// createItem request shape (JSON.stringify'd column_values + group_id), and
// api_latency health emission via the injected logger (spy on logger.health).
// All monday traffic goes through an injected fetchImpl — zero network, zero env.
//
// Token resolution (Change #143 continuation — app-identity OAuth): the
// factory takes `getToken` (async, resolved PER REQUEST) instead of a static
// `token` — see the "token resolution" describe block below.

import { describe, it, expect, vi } from 'vitest';
import {
  createMondayApi,
  MondayApiError,
  MONDAY_API_URL,
  API_VERSION,
} from '../src/services/monday-api.js';

const TOKEN = 'tok-test-lifecycle';
const BOARD_ID = '1234567890';
const GROUP_ID = 'group_axis_tracker';

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

function makeLogger() {
  return { health: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() };
}

function makeApi(body, opts = {}) {
  const { calls, fetchImpl } = fetchReturning(body, opts);
  const logger = makeLogger();
  const api = createMondayApi({ getToken: async () => TOKEN, fetchImpl, logger });
  return { api, calls, logger };
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

describe('createMondayApi — graphql soft errors (HTTP 200 is not success)', () => {
  it('throws MondayApiError when an HTTP 200 body carries errors[], with code from extensions and status 200', async () => {
    const soft = {
      errors: [{ message: 'Column not found', extensions: { code: 'ColumnValueException' } }],
      data: null,
    };
    const { api } = makeApi(soft, { status: 200 });

    const err = await rejectionOf(api.graphql('query Ping { boards { id } }'));

    expect(err).toBeInstanceOf(MondayApiError);
    expect(err.name).toBe('MondayApiError');
    expect(err.code).toBe('ColumnValueException');
    expect(err.status).toBe(200);
    expect(err.message).toContain('Column not found');
  });

  it('flags unauthorized=true when the soft error code is auth-shaped', async () => {
    const soft = {
      errors: [{ message: 'Not authenticated', extensions: { code: 'UNAUTHORIZED_FIELD_OR_TYPE' } }],
    };
    const { api } = makeApi(soft, { status: 200 });

    const err = await rejectionOf(api.graphql('query Ping { me { id } }'));

    expect(err).toBeInstanceOf(MondayApiError);
    expect(err.unauthorized).toBe(true);
  });

  it('soft errors from createItem surface as MondayApiError too (funnel covers every method)', async () => {
    const soft = { errors: [{ message: 'Board not found' }] };
    const { api } = makeApi(soft, { status: 200 });

    const err = await rejectionOf(
      api.createItem({ boardId: BOARD_ID, itemName: 'x', columnValues: {} })
    );

    expect(err).toBeInstanceOf(MondayApiError);
    expect(err.message).toContain('Board not found');
  });

  it('throws MondayApiError when an HTTP 200 response has no data at all (malformed payload)', async () => {
    const { api } = makeApi({}, { status: 200 });

    const err = await rejectionOf(api.graphql('query Ping { boards { id } }'));

    expect(err).toBeInstanceOf(MondayApiError);
  });

  it('throws MondayApiError with status + unauthorized on an HTTP 401 response', async () => {
    const { api } = makeApi('Unauthorized', { status: 401 });

    const err = await rejectionOf(api.graphql('query Ping { me { id } }'));

    expect(err).toBeInstanceOf(MondayApiError);
    expect(err.status).toBe(401);
    expect(err.unauthorized).toBe(true);
  });
});

describe('createMondayApi — createItem request shape', () => {
  const created = { data: { create_item: { id: 9876543210 } } };

  it('POSTs to the monday v2 endpoint with raw-token Authorization, pinned API-Version 2026-04 and JSON content type', async () => {
    const { api, calls } = makeApi(created);

    await api.createItem({ boardId: BOARD_ID, itemName: 'install · deadline-confirm' });

    expect(calls).toHaveLength(1);
    const req = parsedRequest(calls[0]);
    expect(req.url).toBe(MONDAY_API_URL);
    expect(req.url).toBe('https://api.monday.com/v2');
    expect(req.method).toBe('POST');
    expect(req.headers.get('authorization')).toBe(TOKEN); // raw token, no Bearer
    expect(req.headers.get('api-version')).toBe(API_VERSION);
    expect(req.headers.get('api-version')).toBe('2026-04');
    expect(req.headers.get('content-type')).toContain('application/json');
  });

  it('sends create_item with group_id and column_values as a JSON *string* via GraphQL variables', async () => {
    const { api, calls } = makeApi(created);
    const columnValues = {
      date_col: { date: '2026-07-19', time: '10:15:00' },
      status_col: { label: 'Lifecycle' },
      text_col: 'axis-tracker',
    };

    const id = await api.createItem({
      boardId: BOARD_ID,
      groupId: GROUP_ID,
      itemName: 'delete · axis-tracker',
      columnValues,
    });

    const req = parsedRequest(calls[0]);
    expect(req.body.query).toContain('create_item');
    expect(req.body.query).toContain('group_id: $groupId');
    expect(req.body.variables.boardId).toBe(BOARD_ID);
    expect(req.body.variables.groupId).toBe(GROUP_ID);
    expect(req.body.variables.itemName).toBe('delete · axis-tracker');
    expect(typeof req.body.variables.columnValues).toBe('string');
    expect(JSON.parse(req.body.variables.columnValues)).toEqual(columnValues);
    expect(id).toBe('9876543210'); // id normalized to string
  });

  it('omitted groupId travels as null (board default group) and null columnValues stays null, not "null"-string', async () => {
    const { api, calls } = makeApi(created);

    await api.createItem({ boardId: BOARD_ID, itemName: 'ungrouped' });

    const req = parsedRequest(calls[0]);
    expect(req.body.variables.groupId).toBeNull();
    expect(req.body.variables.columnValues).toBeNull();
  });

  it('returns null when the response carries no created-item id', async () => {
    const { api } = makeApi({ data: { create_item: null } });

    const id = await api.createItem({ boardId: BOARD_ID, itemName: 'ghost' });

    expect(id).toBeNull();
  });
});

describe('createMondayApi — createBoard', () => {
  it('creates a PRIVATE board by default and returns id + groups (normalized to strings)', async () => {
    const { api, calls } = makeApi({
      data: { create_board: { id: 555, groups: [{ id: 'grp1', title: 'Group Title' }] } },
    });

    const board = await api.createBoard({ name: 'App Lifecycle Events' });

    const req = parsedRequest(calls[0]);
    expect(req.body.query).toContain('create_board');
    expect(req.body.variables.name).toBe('App Lifecycle Events');
    expect(req.body.variables.kind).toBe('private'); // default is private, never public
    expect(req.body.variables.workspaceId).toBeNull();
    expect(board).toEqual({ id: '555', groups: [{ id: 'grp1', title: 'Group Title' }] });
  });

  it('forwards a workspaceId when given', async () => {
    const { api, calls } = makeApi({ data: { create_board: { id: 1, groups: [] } } });

    await api.createBoard({ name: 'x', workspaceId: 42 });

    expect(parsedRequest(calls[0]).body.variables.workspaceId).toBe(42);
  });

  it('throws MondayApiError when create_board returns no id', async () => {
    const { api } = makeApi({ data: { create_board: null } });

    const err = await rejectionOf(api.createBoard({ name: 'x' }));

    expect(err).toBeInstanceOf(MondayApiError);
    expect(err.message).toContain('no id');
  });
});

describe('createMondayApi — createColumn', () => {
  it('sends defaults as a JSON *string* and returns the created column id', async () => {
    const { api, calls } = makeApi({ data: { create_column: { id: 'status_1' } } });

    const id = await api.createColumn({
      boardId: BOARD_ID,
      title: 'Category',
      columnType: 'status',
      defaults: { labels: { 1: 'Lifecycle' } },
    });

    const req = parsedRequest(calls[0]);
    expect(req.body.query).toContain('create_column');
    expect(req.body.variables.columnType).toBe('status');
    expect(typeof req.body.variables.defaults).toBe('string');
    expect(JSON.parse(req.body.variables.defaults)).toEqual({ labels: { 1: 'Lifecycle' } });
    expect(id).toBe('status_1');
  });

  it('passes null defaults through as null (not the "null" string)', async () => {
    const { api, calls } = makeApi({ data: { create_column: { id: 'text_1' } } });

    await api.createColumn({ boardId: BOARD_ID, title: 'App', columnType: 'text' });

    expect(parsedRequest(calls[0]).body.variables.defaults).toBeNull();
  });

  it('throws MondayApiError (naming the column) when create_column returns no id', async () => {
    const { api } = makeApi({ data: { create_column: null } });

    const err = await rejectionOf(
      api.createColumn({ boardId: BOARD_ID, title: 'Event ID', columnType: 'text' })
    );

    expect(err).toBeInstanceOf(MondayApiError);
    expect(err.message).toContain('Event ID');
  });
});

describe('createMondayApi — api_latency health signal', () => {
  it('emits api_latency with op name, numeric ms and ok:true on success', async () => {
    const { api, logger } = makeApi({ data: { create_item: { id: '1' } } });

    await api.createItem({ boardId: BOARD_ID, itemName: 'x' });

    expect(logger.health).toHaveBeenCalledTimes(1);
    const [signal, dims] = logger.health.mock.calls[0];
    expect(signal).toBe('api_latency');
    expect(dims.op).toBe('CreateItem');
    expect(dims.ok).toBe(true);
    expect(typeof dims.ms).toBe('number');
    expect(dims.ms).toBeGreaterThanOrEqual(0);
  });

  it('emits api_latency with ok:false when the call fails on a soft error — and still rethrows', async () => {
    const { api, logger } = makeApi({ errors: [{ message: 'boom' }] }, { status: 200 });

    const err = await rejectionOf(api.graphql('mutation CreateGroup { create_group { id } }'));

    expect(err).toBeInstanceOf(MondayApiError);
    expect(logger.health).toHaveBeenCalledTimes(1);
    const [signal, dims] = logger.health.mock.calls[0];
    expect(signal).toBe('api_latency');
    expect(dims.op).toBe('CreateGroup');
    expect(dims.ok).toBe(false);
    expect(typeof dims.ms).toBe('number');
  });

  it('emits api_latency ok:false on network failure (fetch rejects) wrapped as MondayApiError', async () => {
    const logger = makeLogger();
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const api = createMondayApi({ getToken: async () => TOKEN, fetchImpl, logger });

    const err = await rejectionOf(api.graphql('query GetBoardGroups { boards { id } }'));

    expect(err).toBeInstanceOf(MondayApiError);
    expect(err.message).toContain('ECONNREFUSED');
    expect(logger.health).toHaveBeenCalledWith(
      'api_latency',
      expect.objectContaining({ op: 'GetBoardGroups', ok: false })
    );
  });

  it('uses "anon" as the op for unnamed GraphQL documents', async () => {
    const { api, logger } = makeApi({ data: { boards: [] } });

    await api.graphql('{ boards { id } }');

    expect(logger.health).toHaveBeenCalledWith(
      'api_latency',
      expect.objectContaining({ op: 'anon', ok: true })
    );
  });
});

describe('createMondayApi — getToken resolution (Change #143 continuation)', () => {
  it('calls getToken and sends its resolved value as the raw Authorization header, PER REQUEST', async () => {
    const { calls, fetchImpl } = fetchReturning({ data: { boards: [] } });
    const logger = makeLogger();
    const tokens = ['tok-first', 'tok-second'];
    const getToken = vi.fn(async () => tokens.shift());
    const api = createMondayApi({ getToken, fetchImpl, logger });

    await api.graphql('query GetBoardGroups { boards { id } }');
    await api.graphql('query GetBoardGroups { boards { id } }');

    expect(getToken).toHaveBeenCalledTimes(2);
    expect(calls).toHaveLength(2);
    expect(new Headers(calls[0].init.headers).get('authorization')).toBe('tok-first');
    expect(new Headers(calls[1].init.headers).get('authorization')).toBe('tok-second');
  });

  it('never calls fetch and throws MondayApiError("no_write_token") when getToken resolves null', async () => {
    const fetchImpl = vi.fn();
    const logger = makeLogger();
    const api = createMondayApi({ getToken: async () => null, fetchImpl, logger });

    const err = await rejectionOf(api.graphql('query Ping { boards { id } }'));

    expect(err).toBeInstanceOf(MondayApiError);
    expect(err.message).toBe('no_write_token');
    expect(err.code).toBe('no_write_token');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('still emits an api_latency ok:false signal when there is no write token', async () => {
    const logger = makeLogger();
    const api = createMondayApi({ getToken: async () => null, fetchImpl: vi.fn(), logger });

    await rejectionOf(api.graphql('query Ping { boards { id } }'));

    expect(logger.health).toHaveBeenCalledWith(
      'api_latency',
      expect.objectContaining({ op: 'Ping', ok: false })
    );
  });

  it('treats an empty-string token the same as null (no fetch, no_write_token)', async () => {
    const fetchImpl = vi.fn();
    const logger = makeLogger();
    const api = createMondayApi({ getToken: async () => '', fetchImpl, logger });

    const err = await rejectionOf(api.createItem({ boardId: BOARD_ID, itemName: 'x' }));

    expect(err).toBeInstanceOf(MondayApiError);
    expect(err.message).toBe('no_write_token');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
