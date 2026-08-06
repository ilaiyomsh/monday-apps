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
  // A non-rotating record (no refreshToken) — resolves straight to its .token.
  const record = { token: 'tok-abc', botUserId: '3' };

  /** A secureStorage double backed by a key→value map (per-key reads + write capture). */
  function makeKeyedStorage(initial = {}) {
    const map = new Map(Object.entries(initial));
    return {
      get: vi.fn(async (key) => (map.has(key) ? map.get(key) : null)),
      set: vi.fn(async (key, value) => { map.set(key, value); return true; }),
      delete: vi.fn(async (key) => { map.delete(key); return true; }),
      _map: map,
    };
  }

  // -- getOwnerToken (non-rotating / absent) ---------------------------------

  it('getOwnerToken reads the exact key <accountId>:token:<userId> and returns the bare token of a non-rotating record', async () => {
    const secureStorage = makeSecureStorage(record);
    const store = createTokenStore({ secureStorage });

    const result = await store.getOwnerToken('999', '41');

    expect(secureStorage.get).toHaveBeenCalledWith('999:token:41');
    expect(result).toBe('tok-abc');
  });

  it('getOwnerToken unwraps a backend-wrapped { value: record } to the bare token string', async () => {
    const store = createTokenStore({ secureStorage: makeSecureStorage({ value: record }) });
    await expect(store.getOwnerToken('999', '41')).resolves.toBe('tok-abc');
  });

  it('getOwnerToken returns null when storage has nothing (null)', async () => {
    const store = createTokenStore({ secureStorage: makeSecureStorage(null) });
    await expect(store.getOwnerToken('999', '41')).resolves.toBeNull();
  });

  it('getOwnerToken returns null for a record with an empty-string token', async () => {
    const store = createTokenStore({ secureStorage: makeSecureStorage({ token: '', botUserId: '3' }) });
    await expect(store.getOwnerToken('999', '41')).resolves.toBeNull();
  });

  it('getOwnerToken returns null for a record already flagged reauth_required', async () => {
    const store = createTokenStore({
      secureStorage: makeSecureStorage({ token: null, refreshToken: 'r', status: 'reauth_required' }),
    });
    await expect(store.getOwnerToken('999', '41')).resolves.toBeNull();
  });

  // -- getOwnerToken (OAuth 2.1 refresh path) --------------------------------

  it('getOwnerToken returns the access token as-is while it is still fresh (no refresh call)', async () => {
    const now = () => 1_000_000;
    const secureStorage = makeKeyedStorage({
      '999:token:41': { token: 'fresh', refreshToken: 'r1', expiresAt: 1_000_000 + 10 * 60_000 },
    });
    const oauthClient = { refresh: vi.fn() };
    const store = createTokenStore({ secureStorage, oauthClient, now });

    await expect(store.getOwnerToken('999', '41')).resolves.toBe('fresh');
    expect(oauthClient.refresh).not.toHaveBeenCalled();
  });

  it('getOwnerToken refreshes a STALE record, persists the ROTATED pair, and returns the new access token', async () => {
    const now = () => 1_000_000;
    const secureStorage = makeKeyedStorage({
      '999:token:41': { token: 'old', refreshToken: 'r1', expiresAt: 1_000_000 + 60_000, userId: '41' },
    });
    const oauthClient = {
      refresh: vi.fn().mockResolvedValue({ accessToken: 'new', refreshToken: 'r2', expiresAtMs: 5_000_000 }),
    };
    const store = createTokenStore({ secureStorage, oauthClient, now });

    await expect(store.getOwnerToken('999', '41')).resolves.toBe('new');
    expect(oauthClient.refresh).toHaveBeenCalledWith('r1');
    // The rotated pair (new access + new refresh) is persisted for next time.
    const persisted = secureStorage._map.get('999:token:41');
    expect(persisted.token).toBe('new');
    expect(persisted.refreshToken).toBe('r2');
    expect(persisted.expiresAt).toBe(5_000_000);
  });

  it('getOwnerToken flags the record reauth_required and returns null on invalid_grant', async () => {
    const now = () => 1_000_000;
    const secureStorage = makeKeyedStorage({
      '999:token:41': { token: 'old', refreshToken: 'dead', expiresAt: 1_000_000 + 60_000 },
    });
    const oauthClient = {
      refresh: vi.fn().mockRejectedValue(Object.assign(new Error('x'), { code: 'refresh_token_invalid' })),
    };
    const store = createTokenStore({ secureStorage, oauthClient, now, logger: makeLogger() });

    await expect(store.getOwnerToken('999', '41')).resolves.toBeNull();
    expect(secureStorage._map.get('999:token:41').status).toBe('reauth_required');
  });

  it('getOwnerToken returns the still-valid token on a TRANSIENT refresh failure (does not flag reauth)', async () => {
    const now = () => 1_000_000;
    const secureStorage = makeKeyedStorage({
      '999:token:41': { token: 'stale-but-valid', refreshToken: 'r1', expiresAt: 1_000_000 + 60_000 },
    });
    const oauthClient = {
      refresh: vi.fn().mockRejectedValue(Object.assign(new Error('502'), { code: 'refresh_transient' })),
    };
    const store = createTokenStore({ secureStorage, oauthClient, now, logger: makeLogger() });

    await expect(store.getOwnerToken('999', '41')).resolves.toBe('stale-but-valid');
    expect(secureStorage._map.get('999:token:41').status).not.toBe('reauth_required');
  });

  it('getOwnerToken serializes concurrent stale reads through ONE refresh (single-use rotation safe)', async () => {
    const now = () => 1_000_000;
    const secureStorage = makeKeyedStorage({
      '999:token:41': { token: 'old', refreshToken: 'r1', expiresAt: 1_000_000 + 60_000 },
    });
    let resolveRefresh;
    const oauthClient = {
      refresh: vi.fn(() => new Promise((res) => { resolveRefresh = res; })),
    };
    const store = createTokenStore({ secureStorage, oauthClient, now });

    const p1 = store.getOwnerToken('999', '41');
    const p2 = store.getOwnerToken('999', '41');
    // The refresh call sits behind async reads — wait until it is actually invoked
    // before releasing it, so both reads have already joined the single lane.
    while (oauthClient.refresh.mock.calls.length === 0) {
      await new Promise((r) => setImmediate(r));
    }
    resolveRefresh({ accessToken: 'new', refreshToken: 'r2', expiresAtMs: 5_000_000 });
    const [a, b] = await Promise.all([p1, p2]);

    expect(a).toBe('new');
    expect(b).toBe('new');
    expect(oauthClient.refresh).toHaveBeenCalledTimes(1); // NOT twice
  });

  // -- getReaderToken (pointer model) ----------------------------------------

  it('getReaderToken resolves the reader POINTER to the pointed owner and returns { token, userId }', async () => {
    const now = () => 1_000_000;
    const secureStorage = makeKeyedStorage({
      '999:token:default': { userId: '41' },
      '999:token:41': { token: 'owner-fresh', refreshToken: 'r1', expiresAt: 1_000_000 + 10 * 60_000 },
    });
    const store = createTokenStore({ secureStorage, oauthClient: { refresh: vi.fn() }, now });

    await expect(store.getReaderToken('999')).resolves.toEqual({ token: 'owner-fresh', userId: '41' });
  });

  it('getReaderToken returns null when no reader pointer is stored', async () => {
    const store = createTokenStore({ secureStorage: makeKeyedStorage({}) });
    await expect(store.getReaderToken('999')).resolves.toBeNull();
  });

  it('getReaderToken honors a LEGACY copy record (token, no pointer userId) directly', async () => {
    const store = createTokenStore({
      secureStorage: makeKeyedStorage({ '999:token:default': { token: 'legacy', botUserId: '3' } }),
    });
    await expect(store.getReaderToken('999')).resolves.toEqual({ token: 'legacy', userId: null });
  });

  it('getReaderToken returns null when the pointed owner needs re-authorization', async () => {
    const secureStorage = makeKeyedStorage({
      '999:token:default': { userId: '41' },
      '999:token:41': { token: null, refreshToken: 'r', status: 'reauth_required' },
    });
    const store = createTokenStore({ secureStorage });
    await expect(store.getReaderToken('999')).resolves.toBeNull();
  });

  // -- setOwnerToken (owner record + reader pointer) -------------------------

  it('setOwnerToken writes the owner record under the exact key <accountId>:token:<userId>', async () => {
    const secureStorage = makeSecureStorage(null);
    const store = createTokenStore({ secureStorage });

    await store.setOwnerToken('999', '41', record);

    expect(secureStorage.set).toHaveBeenCalledWith('999:token:41', record);
  });

  it('setOwnerToken points the reader key at the owner (a { userId } POINTER, not a token copy)', async () => {
    const secureStorage = makeSecureStorage(null);
    const store = createTokenStore({ secureStorage });

    await store.setOwnerToken('999', 41, record);

    const readerCall = secureStorage.set.mock.calls.find(([key]) => key === '999:token:default');
    expect(readerCall).toBeDefined();
    expect(readerCall[1]).toEqual({ userId: '41' }); // stringified, and NO token material copied
    expect(readerCall[1].token).toBeUndefined();
  });

  it('setOwnerToken performs BOTH writes — owner key and reader key', async () => {
    const secureStorage = makeSecureStorage(null);
    const store = createTokenStore({ secureStorage });

    await store.setOwnerToken('999', '41', record);

    const keysWritten = secureStorage.set.mock.calls.map(([key]) => key);
    expect(keysWritten).toContain('999:token:41');
    expect(keysWritten).toContain('999:token:default');
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
    // The config MUST carry both keys: change_status_column_value rejects a
    // `{columnId}`-only config ("This config for this event is invalid"), which
    // makes create_webhook throw and enroll answer 502 (verified live 2026-08-05).
    const config = JSON.parse(body.variables.config);
    expect(config.columnId).toBe('status_col');
    // `columnValue` is REQUIRED alongside columnId; {$any$: true} = any new label.
    expect(config.columnValue).toEqual({ $any$: true });
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
  // amend-intent round360: the old fixtures locked a wire shape that was
  // factually WRONG — they fed `settings_str` (legacy stringified blob whose
  // "labels" is a MAP {"0":"בעבודה",...}). normalizeStatusLabels only reads the
  // TYPED ARRAY shape, so against the real API the evaluator got [] and the
  // guard blocked EVERY transition on the column. The guard now reads the typed
  // `settings` field (verified live on API 2026-04 — same field the client
  // picker reads), so the fixtures lock THAT shape instead.

  it('selects the typed `settings` field in the labels query — never legacy settings_str', async () => {
    const fetchImpl = makeFetch(
      jsonResponse({
        data: { boards: [{ columns: [{ id: 'status_col', settings: { labels: [] } }] }] },
      })
    );
    const api = apiWith(fetchImpl);

    await api.getColumnLabels('tok', '5098', 'status_col');

    const { body } = fetchCall(fetchImpl);
    // settings_str's map-shaped "labels" normalizes to [] and turned the guard
    // into a block-everything wall (round360) — the query must never regress.
    expect(body.query).not.toContain('settings_str');
    expect(body.query).toMatch(/\bsettings\b/);
  });

  it('normalizes the real live `settings` OBJECT (API 2026-04) into STRING ids with isDeactivated/isDone mapped', async () => {
    // Verbatim live shape (probe on API 2026-04, round360): `settings` arrives
    // as a JSON OBJECT whose labels is an ARRAY — no string parsing involved.
    const settings = {
      labels: [
        { id: 0, color: 0, label: 'בעבודה', index: 0, is_done: false, is_deactivated: false, hex: '#fdab3d' },
        { id: 1, color: 1, label: 'תקוע', index: 1, is_done: false, is_deactivated: true, hex: '#e2445c' },
        { id: 2, color: 2, label: 'בוצע', index: 2, is_done: true, is_deactivated: false, hex: '#00c875' },
      ],
    };
    const fetchImpl = makeFetch(
      jsonResponse({
        data: { boards: [{ columns: [{ id: 'status_col', settings }] }] },
      })
    );
    const api = apiWith(fetchImpl);

    const labels = await api.getColumnLabels('tok', '5098', 'status_col');

    expect(labels).toHaveLength(3);
    expect(labels[0]).toEqual(expect.objectContaining({ id: '0', label: 'בעבודה' }));
    expect(labels[0].isDeactivated).not.toBe(true);
    expect(labels[1]).toEqual(expect.objectContaining({ id: '1', isDeactivated: true }));
    expect(labels[2]).toEqual(expect.objectContaining({ id: '2', isDone: true }));
  });

  it('defensively parses `settings` when it arrives as a JSON STRING', async () => {
    const settings = JSON.stringify({
      labels: [{ id: 4, index: 0, label: 'ממתין' }],
    });
    const fetchImpl = makeFetch(
      jsonResponse({
        data: { boards: [{ columns: [{ id: 'status_col', settings }] }] },
      })
    );
    const api = apiWith(fetchImpl);

    const labels = await api.getColumnLabels('tok', '5098', 'status_col');

    expect(labels).toHaveLength(1);
    expect(labels[0]).toEqual(expect.objectContaining({ id: '4', label: 'ממתין' }));
  });

  it('returns [] when the column has no settings (unchanged contract)', async () => {
    const fetchImpl = makeFetch(
      jsonResponse({
        data: { boards: [{ columns: [{ id: 'status_col', settings: null }] }] },
      })
    );
    const api = apiWith(fetchImpl);

    await expect(api.getColumnLabels('tok', '5098', 'status_col')).resolves.toEqual([]);
  });

  it('rejects with MondayApiError when a string settings payload is unparseable', async () => {
    const fetchImpl = makeFetch(
      jsonResponse({
        data: { boards: [{ columns: [{ id: 'status_col', settings: '{not json' }] }] },
      })
    );
    const api = apiWith(fetchImpl);

    const err = await api.getColumnLabels('tok', '5098', 'status_col').catch((e) => e);
    expect(err).toBeInstanceOf(MondayApiError);
    expect(err.message).toContain('status_col');
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
