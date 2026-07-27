import { describe, expect, it } from 'vitest';
import { createWorkflowStore } from './workflowStore';

const NOW = '2026-07-27T10:00:00.000Z';
const NOW_MS = Date.parse(NOW);

const CONFIG_KEY = 'workflow:v1:100:board:200:config';
const AUDIT_KEY = 'workflow:v1:100:board:200:item:300:audit';
const MARKER_KEY = 'workflow:v1:100:board:200:item:300:column:status_guard:expected';
const OAUTH_TOKEN_KEY = 'workflow:v1:100:oauth-token';
const OAUTH_STATE_KEY = 'workflow:v1:oauth-state:nonce%2Fone';

function rawConfig(overrides = {}) {
  return {
    schemaVersion: 1,
    accountId: '100',
    boardId: '200',
    targetColumnId: 'status_guard',
    hiddenManualLabelIds: [1, '1'],
    transitions: [
      {
        id: ' approve ',
        fromLabelId: 0,
        toLabelId: 1,
        permissions: { mode: 'any' },
        requiredColumnIds: [],
        formFields: [],
      },
    ],
    enforcement: { enabled: true },
    updatedAt: NOW,
    updatedBy: 42,
    ...overrides,
  };
}

const NORMALIZED_CONFIG = {
  schemaVersion: 1,
  accountId: '100',
  boardId: '200',
  targetColumnId: 'status_guard',
  hiddenManualLabelIds: ['1'],
  transitions: [
    {
      id: 'approve',
      fromLabelId: '0',
      toLabelId: '1',
      permissions: { mode: 'any', userIds: [], teamIds: [] },
      requiredColumnIds: [],
      formFields: [],
    },
  ],
  enforcement: { enabled: true },
  updatedAt: NOW,
  updatedBy: '42',
};

function auditEntry(id, overrides = {}) {
  return {
    id: String(id),
    accountId: '100',
    boardId: '200',
    itemId: '300',
    columnId: 'status_guard',
    actorUserId: '42',
    fromLabelId: '0',
    toLabelId: '1',
    occurredAt: NOW,
    source: 'board',
    transitionId: 'approve',
    formValues: {},
    ...overrides,
  };
}

function createBackend(seed = {}) {
  const values = new Map(Object.entries(seed));
  const calls = [];

  return {
    values,
    calls,
    backend: {
      async get(key) {
        calls.push({ method: 'get', key });
        return values.has(key) ? values.get(key) : null;
      },
      async set(key, value) {
        calls.push({ method: 'set', key, value });
        values.set(key, value);
      },
      async delete(key) {
        calls.push({ method: 'delete', key });
        values.delete(key);
      },
    },
  };
}

function createStore(seed) {
  const fake = createBackend(seed);
  return {
    ...fake,
    store: createWorkflowStore({
      backend: fake.backend,
      now: () => NOW_MS,
    }),
  };
}

function marker(overrides = {}) {
  return {
    accountId: '100',
    boardId: '200',
    itemId: '300',
    columnId: 'status_guard',
    fromLabelId: '1',
    toLabelId: '0',
    kind: 'rollback',
    actorUserId: '42',
    ...overrides,
  };
}

const STORED_MARKER = {
  kind: 'rollback',
  accountId: '100',
  boardId: '200',
  itemId: '300',
  columnId: 'status_guard',
  fromLabelId: '1',
  toLabelId: '0',
  actorUserId: '42',
  expiresAt: NOW_MS + 30_000,
};

describe('createWorkflowStore config persistence', () => {
  it('returns null and reads only the structurally namespaced account-board config key when no config exists', async () => {
    const { store, calls } = createStore();

    await expect(store.getConfig('100', '200')).resolves.toBe(null);
    expect(calls).toEqual([{ method: 'get', key: CONFIG_KEY }]);
  });

  it('returns a normalized config loaded from the exact account-board namespace', async () => {
    const { store, calls } = createStore({ [CONFIG_KEY]: rawConfig() });

    await expect(store.getConfig(100, 200)).resolves.toEqual(NORMALIZED_CONFIG);
    expect(calls).toEqual([{ method: 'get', key: CONFIG_KEY }]);
  });

  it('normalizes before saving and writes only the canonical config to its own account-board namespace', async () => {
    const { store, values, calls } = createStore();

    await expect(store.saveConfig(rawConfig())).resolves.toEqual(NORMALIZED_CONFIG);
    expect(values.get(CONFIG_KEY)).toEqual(NORMALIZED_CONFIG);
    expect(calls).toEqual([
      {
        method: 'set',
        key: CONFIG_KEY,
        value: NORMALIZED_CONFIG,
      },
    ]);
  });

  it('rejects invalid config before making any backend write', async () => {
    const { store, calls } = createStore();

    await expect(store.saveConfig(rawConfig({ accountId: ' ' }))).rejects.toMatchObject({
      name: 'WorkflowConfigError',
      code: 'invalid_identifier',
    });
    expect(calls).toEqual([]);
  });

  it('keeps equal board ids in different account namespaces structurally isolated', async () => {
    const { store, calls } = createStore();

    await store.saveConfig(rawConfig({ accountId: 'tenant/one' }));
    await store.saveConfig(rawConfig({ accountId: 'tenant/two' }));

    expect(calls.map(({ method, key }) => ({ method, key }))).toEqual([
      {
        method: 'set',
        key: 'workflow:v1:tenant%2Fone:board:200:config',
      },
      {
        method: 'set',
        key: 'workflow:v1:tenant%2Ftwo:board:200:config',
      },
    ]);
  });
});

describe('createWorkflowStore audit persistence', () => {
  it('prepends a normalized audit entry and retains exactly the newest 200 entries', async () => {
    const existingEntries = Array.from({ length: 200 }, (_, index) => auditEntry(`old-${index}`));
    const existingLog = { version: 1, entries: existingEntries };
    const added = auditEntry('new', { actorUserId: 0, formValues: { notes: 'Approved' } });
    const expectedLog = {
      version: 1,
      entries: [
        auditEntry('new', { actorUserId: '0', formValues: { notes: 'Approved' } }),
        ...existingEntries.slice(0, 199),
      ],
    };
    const { store, calls } = createStore({ [AUDIT_KEY]: existingLog });

    await expect(store.appendAudit(added)).resolves.toEqual(expectedLog);
    expect(calls).toEqual([
      { method: 'get', key: AUDIT_KEY },
      { method: 'set', key: AUDIT_KEY, value: expectedLog },
    ]);
  });

  it('keeps append idempotent by entry id without duplicating or replacing the original entry', async () => {
    const existing = auditEntry('trigger-1');
    const existingLog = { version: 1, entries: [existing] };
    const { store, calls } = createStore({ [AUDIT_KEY]: existingLog });

    await expect(
      store.appendAudit({ ...existing, actorUserId: 99 }),
    ).resolves.toEqual(existingLog);
    expect(calls).toEqual([
      { method: 'get', key: AUDIT_KEY },
      { method: 'set', key: AUDIT_KEY, value: existingLog },
    ]);
  });

  it('reads an item audit log only from the account-board-item namespace', async () => {
    const log = { version: 1, entries: [auditEntry('trigger-1')] };
    const { store, calls } = createStore({ [AUDIT_KEY]: log });

    await expect(store.getAudit('100', '200', '300')).resolves.toEqual(log);
    expect(calls).toEqual([{ method: 'get', key: AUDIT_KEY }]);
  });
});

describe('createWorkflowStore expected-change markers', () => {
  it('stores a canonical TTL marker in the exact account-board-item-column namespace', async () => {
    const { store, values, calls } = createStore();

    await expect(store.setExpectedMarker(marker(), 30_000)).resolves.toEqual(STORED_MARKER);
    expect(values.get(MARKER_KEY)).toEqual(STORED_MARKER);
    expect(calls).toEqual([
      {
        method: 'set',
        key: MARKER_KEY,
        value: STORED_MARKER,
      },
    ]);
  });

  it('returns true and deletes the marker only when item, column, from, to, and kind match exactly', async () => {
    const { store, values, calls } = createStore({ [MARKER_KEY]: STORED_MARKER });

    await expect(store.consumeExpectedMarker(marker())).resolves.toEqual(STORED_MARKER);
    expect(values.has(MARKER_KEY)).toBe(false);
    expect(calls).toEqual([
      { method: 'get', key: MARKER_KEY },
      { method: 'delete', key: MARKER_KEY },
    ]);
  });

  it.each([
    ['item id', { itemId: '301' }],
    ['column id', { columnId: 'other_status' }],
    ['from label id', { fromLabelId: '2' }],
    ['to label id', { toLabelId: '2' }],
    ['marker kind', { kind: 'manual' }],
  ])('returns false and leaves the stored marker untouched when %s mismatches', async (_axis, override) => {
    const { store, values, calls } = createStore({ [MARKER_KEY]: STORED_MARKER });

    await expect(
      store.consumeExpectedMarker(marker(override)),
    ).resolves.toBe(null);
    expect(values.get(MARKER_KEY)).toEqual(STORED_MARKER);

    if (override.itemId !== undefined || override.columnId !== undefined) {
      expect(calls).toEqual([
        {
          method: 'get',
          key: `workflow:v1:100:board:200:item:${override.itemId ?? '300'}:column:${override.columnId ?? 'status_guard'}:expected`,
        },
      ]);
    } else {
      expect(calls).toEqual([{ method: 'get', key: MARKER_KEY }]);
    }
  });

  it('deletes an expired marker and returns false instead of consuming it', async () => {
    const expired = {
      ...STORED_MARKER,
      expiresAt: NOW_MS - 1,
    };
    const { store, values, calls } = createStore({ [MARKER_KEY]: expired });

    await expect(store.consumeExpectedMarker(marker())).resolves.toBe(null);
    expect(values.has(MARKER_KEY)).toBe(false);
    expect(calls).toEqual([
      { method: 'get', key: MARKER_KEY },
      { method: 'delete', key: MARKER_KEY },
    ]);
  });
});

describe('createWorkflowStore OAuth persistence', () => {
  it('reads a legacy token without silently inventing refresh or expiry metadata', async () => {
    const { store, calls } = createStore({ [OAUTH_TOKEN_KEY]: ' legacy-access ' });

    await expect(store.getOAuthTokenRecord('100')).resolves.toEqual({
      v: 1,
      accessToken: 'legacy-access',
      refreshToken: null,
      expiresAt: null,
      obtainedAt: null,
      status: 'active',
    });
    expect(calls).toEqual([{ method: 'get', key: OAUTH_TOKEN_KEY }]);
  });

  it('persists only a canonical version-two rotating token record', async () => {
    const { store, values } = createStore();
    const record = {
      v: 2,
      accessToken: ' access ',
      refreshToken: ' refresh ',
      expiresAt: NOW_MS + 3_600_000,
      obtainedAt: NOW_MS,
      status: 'active',
    };

    await expect(store.saveOAuthTokenRecord(100, record)).resolves.toEqual({
      ...record,
      accessToken: 'access',
      refreshToken: 'refresh',
    });
    expect(values.get(OAUTH_TOKEN_KEY)).toEqual({
      ...record,
      accessToken: 'access',
      refreshToken: 'refresh',
    });
  });

  it('clears the complete OAuth record for an account', async () => {
    const { store, values, calls } = createStore({ [OAUTH_TOKEN_KEY]: 'access' });

    await store.clearOAuthToken('100');

    expect(values.has(OAUTH_TOKEN_KEY)).toBe(false);
    expect(calls).toEqual([{ method: 'delete', key: OAUTH_TOKEN_KEY }]);
  });

  it('stores a short-lived PKCE state and consumes it exactly once', async () => {
    const { store, calls } = createStore();
    await store.issueOAuthState('nonce/one', {
      verifier: 'verifier-secret', accountId: 100, userId: 42,
    });

    await expect(store.consumeOAuthState('nonce/one')).resolves.toEqual({
      verifier: 'verifier-secret',
      accountId: '100',
      userId: '42',
      expiresAt: NOW_MS + 600_000,
    });
    await expect(store.consumeOAuthState('nonce/one')).resolves.toBe(null);
    expect(calls.map(({ method, key }) => ({ method, key }))).toEqual([
      { method: 'set', key: OAUTH_STATE_KEY },
      { method: 'get', key: OAUTH_STATE_KEY },
      { method: 'delete', key: OAUTH_STATE_KEY },
      { method: 'get', key: OAUTH_STATE_KEY },
      { method: 'delete', key: OAUTH_STATE_KEY },
    ]);
  });

  it('deletes and rejects an expired PKCE state', async () => {
    const expired = {
      verifier: 'verifier-secret', accountId: '100', userId: '42', expiresAt: NOW_MS - 1,
    };
    const { store, values } = createStore({ [OAUTH_STATE_KEY]: expired });

    await expect(store.consumeOAuthState('nonce/one')).resolves.toBe(null);
    expect(values.has(OAUTH_STATE_KEY)).toBe(false);
  });
});
