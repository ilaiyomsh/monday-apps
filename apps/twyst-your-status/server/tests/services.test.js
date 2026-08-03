import { describe, it, expect, vi } from 'vitest';
import {
  unwrapStoredValue,
  createTokenStore,
  createRulesStore,
  createEnrollmentStore,
} from '../src/services/stores.js';
import { createMondayApi, MondayApiError, API_VERSION } from '../src/services/monday-api.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a fetch Response-like object. */
function jsonResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

/** fetch mock that resolves the given bodies in order. */
function makeFetch(...responses) {
  const fetchImpl = vi.fn();
  for (const res of responses) fetchImpl.mockResolvedValueOnce(res);
  return fetchImpl;
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeSecureStorage(getResult) {
  return {
    get: vi.fn().mockResolvedValue(getResult),
    set: vi.fn().mockResolvedValue(true),
    delete: vi.fn().mockResolvedValue(true),
  };
}

/** Parse the JSON body of the nth fetch call and return { url, init, body }. */
function fetchCall(fetchImpl, n = 0) {
  const [url, init] = fetchImpl.mock.calls[n];
  return { url, init, body: JSON.parse(init.body) };
}

function apiWith(fetchImpl) {
  return createMondayApi({ fetchImpl, logger: makeLogger() });
}

// ---------------------------------------------------------------------------
// stores.js — unwrapStoredValue
// ---------------------------------------------------------------------------

describe('unwrapStoredValue', () => {
  it('unwraps a { value: string } wrapper to the bare string', () => {
    expect(unwrapStoredValue({ value: 'str' })).toBe('str');
  });

  it('unwraps a { value: object } wrapper to the inner object', () => {
    expect(unwrapStoredValue({ value: { token: 't' } })).toEqual({ token: 't' });
  });

  it('returns a bare string untouched', () => {
    expect(unwrapStoredValue('plain')).toBe('plain');
  });

  it('normalizes null to null', () => {
    expect(unwrapStoredValue(null)).toBeNull();
  });

  it('normalizes undefined to null', () => {
    expect(unwrapStoredValue(undefined)).toBeNull();
  });

  it('returns an object without a value key as-is', () => {
    expect(unwrapStoredValue({ token: 't' })).toEqual({ token: 't' });
  });

  it('unwraps { value: null } to null', () => {
    expect(unwrapStoredValue({ value: null })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// stores.js — createTokenStore
// ---------------------------------------------------------------------------

describe('createTokenStore', () => {
  const record = { token: 'tok-abc', botUserId: '3' };

  it('getActivation reads the exact key <accountId>:activation and returns the record', async () => {
    const secureStorage = makeSecureStorage(record);
    const store = createTokenStore({ secureStorage });

    const result = await store.getActivation('999');

    expect(secureStorage.get).toHaveBeenCalledWith('999:activation');
    expect(result).toEqual({ token: 'tok-abc', botUserId: '3' });
  });

  it('getActivation unwraps a backend-wrapped { value: record } to the record', async () => {
    const secureStorage = makeSecureStorage({ value: record });
    const store = createTokenStore({ secureStorage });

    await expect(store.getActivation('999')).resolves.toEqual({
      token: 'tok-abc',
      botUserId: '3',
    });
  });

  it('getActivation returns null when storage has nothing (null)', async () => {
    const store = createTokenStore({ secureStorage: makeSecureStorage(null) });
    await expect(store.getActivation('999')).resolves.toBeNull();
  });

  it('getActivation returns null when storage has nothing (undefined)', async () => {
    const store = createTokenStore({ secureStorage: makeSecureStorage(undefined) });
    await expect(store.getActivation('999')).resolves.toBeNull();
  });

  it('getActivation returns null for a record with no token field', async () => {
    const store = createTokenStore({ secureStorage: makeSecureStorage({ botUserId: '3' }) });
    await expect(store.getActivation('999')).resolves.toBeNull();
  });

  it('getActivation returns null for a record with an empty-string token', async () => {
    const store = createTokenStore({
      secureStorage: makeSecureStorage({ token: '', botUserId: '3' }),
    });
    await expect(store.getActivation('999')).resolves.toBeNull();
  });

  it('setActivation writes the record under the exact key <accountId>:activation', async () => {
    const secureStorage = makeSecureStorage(null);
    const store = createTokenStore({ secureStorage });

    await store.setActivation('999', record);

    expect(secureStorage.set).toHaveBeenCalledWith('999:activation', record);
  });
});

// ---------------------------------------------------------------------------
// stores.js — createEnrollmentStore
// ---------------------------------------------------------------------------

describe('createEnrollmentStore', () => {
  it('get reads the exact key <account>:enrolled:<board>:<column> and returns the webhookId', async () => {
    const secureStorage = makeSecureStorage('55501');
    const store = createEnrollmentStore({ secureStorage });

    const result = await store.get('999', '5098', 'col');

    expect(secureStorage.get).toHaveBeenCalledWith('999:enrolled:5098:col');
    expect(result).toBe('55501');
  });

  it('get unwraps a wrapped { value: webhookId } to the bare string', async () => {
    const store = createEnrollmentStore({ secureStorage: makeSecureStorage({ value: '55501' }) });
    await expect(store.get('999', '5098', 'col')).resolves.toBe('55501');
  });

  it('get returns null when no enrollment is stored', async () => {
    const store = createEnrollmentStore({ secureStorage: makeSecureStorage(null) });
    await expect(store.get('999', '5098', 'col')).resolves.toBeNull();
  });

  it('set writes the webhookId under the exact key <account>:enrolled:<board>:<column>', async () => {
    const secureStorage = makeSecureStorage(null);
    const store = createEnrollmentStore({ secureStorage });

    await store.set('999', '5098', 'col', '55501');

    expect(secureStorage.set).toHaveBeenCalledWith('999:enrolled:5098:col', '55501');
  });
});

// ---------------------------------------------------------------------------
// stores.js — createRulesStore
// ---------------------------------------------------------------------------

describe('createRulesStore', () => {
  function makeRulesSetup(getResult) {
    const storage = {
      get: vi.fn().mockResolvedValue(getResult),
      set: vi.fn().mockResolvedValue(true),
    };
    const storageFactory = vi.fn(() => storage);
    const logger = makeLogger();
    const store = createRulesStore({ storageFactory, logger });
    return { store, storage, storageFactory, logger };
  }

  it('getRules builds storage from the token and reads the exact shared client key twystStatus:<board>:<column>', async () => {
    const { store, storage, storageFactory } = makeRulesSetup(
      '{"version":1,"hiddenLabelIds":[]}'
    );

    await store.getRules('tok', '5098', 'status_col');

    expect(storageFactory).toHaveBeenCalledWith('tok');
    expect(storage.get).toHaveBeenCalledWith('twystStatus:5098:status_col');
  });

  it('getRules parses a bare JSON string into the rules object', async () => {
    const { store } = makeRulesSetup('{"version":1,"hiddenLabelIds":[]}');

    await expect(store.getRules('tok', '5098', 'status_col')).resolves.toEqual({
      version: 1,
      hiddenLabelIds: [],
    });
  });

  it('getRules parses a platform-wrapped { value: <JSON string> } into the rules object', async () => {
    const { store } = makeRulesSetup({ value: '{"version":1,"hiddenLabelIds":[]}' });

    await expect(store.getRules('tok', '5098', 'status_col')).resolves.toEqual({
      version: 1,
      hiddenLabelIds: [],
    });
  });

  it('getRules returns null when storage holds null', async () => {
    const { store } = makeRulesSetup(null);
    await expect(store.getRules('tok', '5098', 'status_col')).resolves.toBeNull();
  });

  it('getRules returns null when storage holds undefined', async () => {
    const { store } = makeRulesSetup(undefined);
    await expect(store.getRules('tok', '5098', 'status_col')).resolves.toBeNull();
  });

  it('getRules returns null when storage holds an empty string', async () => {
    const { store } = makeRulesSetup('');
    await expect(store.getRules('tok', '5098', 'status_col')).resolves.toBeNull();
  });

  it('getRules returns null AND logs when the stored JSON is corrupted — never throws', async () => {
    const { store, logger } = makeRulesSetup('{oops');

    await expect(store.getRules('tok', '5098', 'status_col')).resolves.toBeNull();

    const logCalls = logger.error.mock.calls.length + logger.warn.mock.calls.length;
    expect(logCalls).toBeGreaterThanOrEqual(1);
  });

  it('getRules rethrows when storage.get rejects — infrastructure errors are not swallowed', async () => {
    const infraError = new Error('storage backend down');
    const storage = { get: vi.fn().mockRejectedValue(infraError) };
    const storageFactory = vi.fn(() => storage);
    const store = createRulesStore({ storageFactory, logger: makeLogger() });

    await expect(store.getRules('tok', '5098', 'status_col')).rejects.toThrow(
      'storage backend down'
    );
  });
});

// ---------------------------------------------------------------------------
// monday-api.js — transport contract
// ---------------------------------------------------------------------------

describe('createMondayApi — transport', () => {
  it('pins API_VERSION to 2026-04', () => {
    expect(API_VERSION).toBe('2026-04');
  });

  it('query posts to https://api.monday.com/v2 with Authorization, API-Version and Content-Type headers', async () => {
    const fetchImpl = makeFetch(jsonResponse({ data: { me: { id: '1' } } }));
    const api = apiWith(fetchImpl);

    await api.query('tok-abc', 'query { me { id } }', {});

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const { url, init } = fetchCall(fetchImpl);
    expect(url).toBe('https://api.monday.com/v2');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual(
      expect.objectContaining({
        Authorization: 'tok-abc',
        'API-Version': API_VERSION,
        'Content-Type': 'application/json',
      })
    );
  });

  it('query resolves the data object from a 200 { data } response', async () => {
    const fetchImpl = makeFetch(jsonResponse({ data: { me: { id: '41' } } }));
    const api = apiWith(fetchImpl);

    await expect(api.query('tok', 'query { me { id } }', {})).resolves.toEqual({
      me: { id: '41' },
    });
  });

  it('query sends the GraphQL query text and variables in the request body', async () => {
    const fetchImpl = makeFetch(jsonResponse({ data: { ok: true } }));
    const api = apiWith(fetchImpl);

    await api.query('tok', 'query ($id: ID!) { items (ids: [$id]) { id } }', { id: '777' });

    const { body } = fetchCall(fetchImpl);
    expect(body.query).toBe('query ($id: ID!) { items (ids: [$id]) { id } }');
    expect(body.variables).toEqual({ id: '777' });
  });
});

// ---------------------------------------------------------------------------
// monday-api.js — error funnel
// ---------------------------------------------------------------------------

describe('createMondayApi — error funnel', () => {
  it('rejects with MondayApiError when a 200 body carries soft GraphQL errors', async () => {
    const fetchImpl = makeFetch(
      jsonResponse({ errors: [{ message: 'Column not found' }], data: null })
    );
    const api = apiWith(fetchImpl);

    const err = await api.query('tok', 'query { boards { id } }', {}).catch((e) => e);

    expect(err).toBeInstanceOf(MondayApiError);
    expect(err.message).toContain('Column not found');
  });

  it('rejects with MondayApiError carrying status 401 on an HTTP 401 response', async () => {
    const fetchImpl = makeFetch(
      jsonResponse({ error_message: 'Not authenticated' }, { status: 401 })
    );
    const api = apiWith(fetchImpl);

    const err = await api.query('bad-tok', 'query { me { id } }', {}).catch((e) => e);

    expect(err).toBeInstanceOf(MondayApiError);
    expect(err.status).toBe(401);
  });

  it('rejects when fetch itself rejects (network failure)', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    const api = apiWith(fetchImpl);

    await expect(api.query('tok', 'query { me { id } }', {})).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// monday-api.js — revertStatus
// ---------------------------------------------------------------------------

describe('createMondayApi — revertStatus', () => {
  it('sends a mutation whose variables carry boardId, itemId, columnId and value {"index":0} for label id "0"', async () => {
    const fetchImpl = makeFetch(
      jsonResponse({ data: { change_column_value: { id: '777' } } })
    );
    const api = apiWith(fetchImpl);

    await api.revertStatus('tok', '5098', '777', 'status_col', '0');

    const { body } = fetchCall(fetchImpl);
    expect(body.variables).toEqual(
      expect.objectContaining({
        boardId: '5098',
        itemId: '777',
        columnId: 'status_col',
      })
    );
    expect(typeof body.variables.value).toBe('string');
    expect(JSON.parse(body.variables.value)).toEqual({ index: 0 });
  });

  it('sends value "{}" (clear the status cell) when the previous label id is null', async () => {
    const fetchImpl = makeFetch(
      jsonResponse({ data: { change_column_value: { id: '777' } } })
    );
    const api = apiWith(fetchImpl);

    await api.revertStatus('tok', '5098', '777', 'status_col', null);

    const { body } = fetchCall(fetchImpl);
    expect(typeof body.variables.value).toBe('string');
    expect(JSON.parse(body.variables.value)).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// monday-api.js — notifyUser
// ---------------------------------------------------------------------------

describe('createMondayApi — notifyUser', () => {
  it('issues create_notification with userId, targetId, text and targetType Project', async () => {
    const fetchImpl = makeFetch(
      jsonResponse({ data: { create_notification: { text: 'טקסט' } } })
    );
    const api = apiWith(fetchImpl);

    await api.notifyUser('tok', 41, 777, 'טקסט');

    const { body } = fetchCall(fetchImpl);
    expect(body.query).toContain('create_notification');
    expect(body.variables).toEqual(
      expect.objectContaining({
        userId: 41,
        targetId: 777,
        text: 'טקסט',
        targetType: 'Project',
      })
    );
  });
});

// ---------------------------------------------------------------------------
// monday-api.js — createColumnWebhook
// ---------------------------------------------------------------------------

describe('createMondayApi — createColumnWebhook', () => {
  it('issues a change_status_column_value webhook mutation with boardId, url and a config JSON scoping to the column', async () => {
    const fetchImpl = makeFetch(
      jsonResponse({ data: { create_webhook: { id: 55501 } } })
    );
    const api = apiWith(fetchImpl);

    await api.createColumnWebhook('tok', '5098', 'status_col', 'https://guard.example/hook');

    const { body } = fetchCall(fetchImpl);
    expect(body.query).toContain('create_webhook');
    expect(body.query).toContain('change_status_column_value');
    expect(body.variables).toEqual(
      expect.objectContaining({
        boardId: '5098',
        url: 'https://guard.example/hook',
      })
    );
    expect(typeof body.variables.config).toBe('string');
    expect(body.variables.config).toContain('"columnId":"status_col"');
  });

  it('resolves the created webhook id as a STRING even when the API returns a number', async () => {
    const fetchImpl = makeFetch(
      jsonResponse({ data: { create_webhook: { id: 55501 } } })
    );
    const api = apiWith(fetchImpl);

    await expect(
      api.createColumnWebhook('tok', '5098', 'status_col', 'https://guard.example/hook')
    ).resolves.toBe('55501');
  });
});

// ---------------------------------------------------------------------------
// monday-api.js — getCurrentStatusLabelId
// ---------------------------------------------------------------------------

describe('createMondayApi — getCurrentStatusLabelId', () => {
  it('returns the label index as a string when the status cell holds index 2', async () => {
    const fetchImpl = makeFetch(
      jsonResponse({
        data: {
          items: [{ id: '777', column_values: [{ id: 'status_col', index: 2 }] }],
        },
      })
    );
    const api = apiWith(fetchImpl);

    await expect(api.getCurrentStatusLabelId('tok', 777, 'status_col')).resolves.toBe('2');
  });

  it('returns null when the status cell is empty (index null)', async () => {
    const fetchImpl = makeFetch(
      jsonResponse({
        data: {
          items: [{ id: '777', column_values: [{ id: 'status_col', index: null }] }],
        },
      })
    );
    const api = apiWith(fetchImpl);

    await expect(api.getCurrentStatusLabelId('tok', 777, 'status_col')).resolves.toBeNull();
  });

  it('returns undefined (not null) when no item is found — "item gone" must stay distinct from "empty cell"', async () => {
    const fetchImpl = makeFetch(jsonResponse({ data: { items: [] } }));
    const api = apiWith(fetchImpl);

    await expect(api.getCurrentStatusLabelId('tok', 777, 'status_col')).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// monday-api.js — getColumnLabels
// ---------------------------------------------------------------------------

describe('createMondayApi — getColumnLabels', () => {
  it('parses settings_str into label objects with STRING ids and an isDeactivated flag', async () => {
    const settings = JSON.stringify({
      labels: [
        { id: 0, index: 0, label: 'ממתין' },
        { id: 2, index: 1, label: 'בוצע', is_deactivated: true },
      ],
    });
    const fetchImpl = makeFetch(
      jsonResponse({
        data: {
          boards: [{ columns: [{ id: 'status_col', settings_str: settings }] }],
        },
      })
    );
    const api = apiWith(fetchImpl);

    const labels = await api.getColumnLabels('tok', '5098', 'status_col');

    expect(labels).toHaveLength(2);
    expect(labels[0]).toEqual(expect.objectContaining({ id: '0' }));
    expect(labels[0].isDeactivated).not.toBe(true);
    expect(labels[1]).toEqual(expect.objectContaining({ id: '2', isDeactivated: true }));
  });
});

// ---------------------------------------------------------------------------
// monday-api.js — getItemGuardContext
// ---------------------------------------------------------------------------

describe('createMondayApi — getItemGuardContext', () => {
  const guardItemResponse = {
    data: {
      items: [
        {
          id: '777',
          column_values: [
            {
              id: 'p',
              type: 'people',
              persons_and_teams: [
                { id: 7, kind: 'person' },
                { id: 9, kind: 'team' },
              ],
            },
            { id: 'd', type: 'date', text: '', date: null },
          ],
        },
      ],
    },
  };

  it('splits people cells into string personIds/teamIds and collects required field values', async () => {
    const fetchImpl = makeFetch(jsonResponse(guardItemResponse));
    const api = apiWith(fetchImpl);

    const ctx = await api.getItemGuardContext('tok', 777, {
      peopleColumnIds: ['p'],
      requiredColumnIds: ['d'],
    });

    expect(ctx.peopleByColumnId).toEqual({ p: { personIds: ['7'], teamIds: ['9'] } });
    expect(ctx.requiredFieldValues).toHaveLength(1);
    expect(ctx.requiredFieldValues[0]).toEqual(
      expect.objectContaining({ columnId: 'd', type: 'date' })
    );
  });

  it('returns null when the item no longer exists (items: [])', async () => {
    const fetchImpl = makeFetch(jsonResponse({ data: { items: [] } }));
    const api = apiWith(fetchImpl);

    await expect(
      api.getItemGuardContext('tok', 777, { peopleColumnIds: ['p'], requiredColumnIds: ['d'] })
    ).resolves.toBeNull();
  });
});
