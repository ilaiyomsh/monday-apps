import { describe, expect, it } from 'vitest';
import {
  createEnforcementService,
  normalizeStatusChangeEvent,
} from './enforcementService';

const NOW = '2026-07-27T10:00:00.000Z';
const TOKEN = 'oauth-token';

const TRANSITION = {
  id: 'approve',
  fromLabelId: '0',
  toLabelId: '1',
  permissions: {
    mode: 'allowlist',
    userIds: ['42'],
    teamIds: ['7'],
  },
  requiredColumnIds: ['owner', 'notes'],
  formFields: [
    { columnId: 'owner', required: true, label: 'Owner' },
    { columnId: 'notes', required: false, label: 'Notes' },
  ],
};

const ENABLED_CONFIG = {
  schemaVersion: 1,
  accountId: '100',
  boardId: '200',
  targetColumnId: 'status_guard',
  hiddenManualLabelIds: ['1'],
  transitions: [TRANSITION],
  enforcement: { enabled: true },
  updatedAt: NOW,
  updatedBy: '42',
};

const EVENT = {
  pulseId: 300,
  boardId: 200,
  columnId: 'status_guard',
  userId: 42,
  previousValue: { index: 0 },
  value: { index: 1 },
  triggerUuid: 'trigger-1',
};

const REQUIRED_VALUES = [
  { id: 'owner', text: 'Ada', value: null },
  { id: 'notes', text: '', value: '{"body":"Approved"}' },
];

function createDependencies({
  config = ENABLED_CONFIG,
  liveLabelId = '1',
  expectedKinds = [],
  actor = { userId: '42', teamIds: ['7'] },
  requiredValues = REQUIRED_VALUES,
  rollbackError = null,
  notificationError = null,
} = {}) {
  const calls = [];

  const store = {
    async getConfig(accountId, boardId) {
      calls.push({ method: 'store.getConfig', accountId, boardId });
      return config;
    },
    async consumeExpectedMarker(candidate) {
      calls.push({ method: 'store.consumeExpectedMarker', candidate });
      return expectedKinds.includes(candidate.kind) ? { ...candidate, expiresAt: 1 } : null;
    },
    async setExpectedMarker(candidate) {
      calls.push({ method: 'store.setExpectedMarker', candidate });
      return candidate;
    },
    async appendAudit(entry) {
      calls.push({ method: 'store.appendAudit', entry });
      return { version: 1, entries: [entry] };
    },
  };

  const mondayApi = {
    async getItemState(request) {
      calls.push({ method: 'mondayApi.getItemState', request });
      return {
        labelId: liveLabelId,
        columnValues: requiredValues,
      };
    },
    async getActor(request) {
      calls.push({ method: 'mondayApi.getActor', request });
      return actor;
    },
    async changeStatus(request) {
      calls.push({ method: 'mondayApi.changeStatus', request });
      if (rollbackError) throw rollbackError;
      return { id: '300' };
    },
    async notifyUser(request) {
      calls.push({ method: 'mondayApi.notifyUser', request });
      if (notificationError) throw notificationError;
      return { id: 'notification-1' };
    },
  };

  return {
    calls,
    service: createEnforcementService({
      store,
      mondayApi,
      now: () => Date.parse(NOW),
      idFactory: () => 'generated-audit-id',
    }),
  };
}

function handle(service, event = EVENT) {
  return service.handleStatusChange({
    accountId: 100,
    event,
    token: TOKEN,
  });
}

const ROLLBACK_MARKER = {
  kind: 'rollback',
  accountId: '100',
  boardId: '200',
  itemId: '300',
  columnId: 'status_guard',
  fromLabelId: '1',
  toLabelId: '0',
};

describe('normalizeStatusChangeEvent', () => {
  it('canonicalizes pulse, board, column, actor, previous/current indices, and trigger UUID while preserving label id zero', () => {
    expect(normalizeStatusChangeEvent({ event: EVENT })).toEqual({
      boardId: '200',
      itemId: '300',
      columnId: 'status_guard',
      actorUserId: '42',
      fromLabelId: '0',
      toLabelId: '1',
      triggerUuid: 'trigger-1',
    });
  });
});

describe('createEnforcementService ignore and security boundaries', () => {
  it('ignores an event when its exact account-board namespace has no workflow config', async () => {
    const { service, calls } = createDependencies({ config: null });

    await expect(handle(service)).resolves.toEqual({
      kind: 'ignore',
      code: 'config_not_found',
    });
    expect(calls).toEqual([
      { method: 'store.getConfig', accountId: '100', boardId: '200' },
    ]);
  });

  it('rejects a config from another board before trusting its target column or calling monday', async () => {
    const { service, calls } = createDependencies({
      config: { ...ENABLED_CONFIG, boardId: '201' },
    });

    await expect(handle(service)).resolves.toEqual({
      kind: 'ignore',
      code: 'configuration_scope_mismatch',
    });
    expect(calls).toEqual([
      { method: 'store.getConfig', accountId: '100', boardId: '200' },
    ]);
  });

  it('ignores a disabled workflow before marker or monday reads', async () => {
    const { service, calls } = createDependencies({
      config: { ...ENABLED_CONFIG, enforcement: { enabled: false } },
    });

    await expect(handle(service)).resolves.toEqual({
      kind: 'ignore',
      code: 'enforcement_disabled',
    });
    expect(calls).toEqual([
      { method: 'store.getConfig', accountId: '100', boardId: '200' },
    ]);
  });

  it('ignores a non-target column before marker or monday reads', async () => {
    const { service, calls } = createDependencies();

    await expect(handle(service, { ...EVENT, columnId: 'other_status' })).resolves.toEqual({
      kind: 'ignore',
      code: 'target_column_not_managed',
    });
    expect(calls).toEqual([
      { method: 'store.getConfig', accountId: '100', boardId: '200' },
    ]);
  });

  it('consumes the exact expected rollback without querying live state, actor, or required values', async () => {
    const rollbackEvent = {
      ...EVENT,
      previousValue: { index: 1 },
      value: { index: 0 },
      triggerUuid: 'rollback-trigger',
    };
    const { service, calls } = createDependencies({ expectedKinds: ['rollback'] });

    await expect(handle(service, rollbackEvent)).resolves.toEqual({
      kind: 'ignore',
      code: 'expected_rollback',
    });
    expect(calls).toEqual([
      { method: 'store.getConfig', accountId: '100', boardId: '200' },
      {
        method: 'store.consumeExpectedMarker',
        candidate: ROLLBACK_MARKER,
      },
    ]);
  });

  it('ignores a stale event after both expected-marker kinds miss and live monday has moved on', async () => {
    const { service, calls } = createDependencies({ liveLabelId: '2' });

    await expect(handle(service)).resolves.toEqual({
      kind: 'ignore',
      code: 'stale_event',
    });
    expect(calls).toEqual([
      { method: 'store.getConfig', accountId: '100', boardId: '200' },
      {
        method: 'store.consumeExpectedMarker',
        candidate: {
          ...ROLLBACK_MARKER,
          fromLabelId: '0',
          toLabelId: '1',
        },
      },
      {
        method: 'store.consumeExpectedMarker',
        candidate: {
          ...ROLLBACK_MARKER,
          kind: 'approved_action',
          fromLabelId: '0',
          toLabelId: '1',
        },
      },
      {
        method: 'mondayApi.getItemState',
        request: {
          token: TOKEN,
          boardId: '200',
          itemId: '300',
          statusColumnId: 'status_guard',
          columnIds: ['status_guard', 'owner', 'notes'],
        },
      },
    ]);
  });
});

describe('createEnforcementService transition decisions', () => {
  it('queries live required values and actor teams, then appends the exact idempotent audit entry for an allowed transition', async () => {
    const { service, calls } = createDependencies();

    await expect(handle(service)).resolves.toEqual({
      kind: 'allow',
      code: 'transition_allowed',
      transition: TRANSITION,
    });
    expect(calls).toEqual([
      { method: 'store.getConfig', accountId: '100', boardId: '200' },
      {
        method: 'store.consumeExpectedMarker',
        candidate: { ...ROLLBACK_MARKER, fromLabelId: '0', toLabelId: '1' },
      },
      {
        method: 'store.consumeExpectedMarker',
        candidate: {
          ...ROLLBACK_MARKER,
          kind: 'approved_action',
          fromLabelId: '0',
          toLabelId: '1',
        },
      },
      {
        method: 'mondayApi.getItemState',
        request: {
          token: TOKEN,
          boardId: '200',
          itemId: '300',
          statusColumnId: 'status_guard',
          columnIds: ['status_guard', 'owner', 'notes'],
        },
      },
      {
        method: 'mondayApi.getActor',
        request: { token: TOKEN, userId: '42' },
      },
      {
        method: 'store.appendAudit',
        entry: {
          id: 'trigger-1',
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
        },
      },
    ]);
  });

  it('uses the injected id factory when an allowed event has no trigger UUID', async () => {
    const { service, calls } = createDependencies();

    await expect(handle(service, { ...EVENT, triggerUuid: undefined })).resolves.toEqual({
      kind: 'allow',
      code: 'transition_allowed',
      transition: TRANSITION,
    });
    expect(calls.find(({ method }) => method === 'store.appendAudit')?.entry.id).toBe(
      'generated-audit-id',
    );
  });

  it('sets the rollback marker before GraphQL rollback, notifies the actor, and never audits a denial', async () => {
    const { service, calls } = createDependencies({ requiredValues: [] });

    await expect(handle(service)).resolves.toEqual({
      kind: 'deny',
      code: 'required_fields_missing',
      transitionId: 'approve',
      missingColumnIds: ['owner', 'notes'],
      rolledBack: true,
    });
    expect(
      calls.filter(({ method }) => [
        'store.setExpectedMarker',
        'mondayApi.changeStatus',
        'mondayApi.notifyUser',
      ].includes(method)),
    ).toEqual([
      {
        method: 'store.setExpectedMarker',
        candidate: {
          ...ROLLBACK_MARKER,
          actorUserId: '42',
        },
      },
      {
        method: 'mondayApi.changeStatus',
        request: {
          token: TOKEN,
          boardId: '200',
          itemId: '300',
          columnId: 'status_guard',
          labelId: '0',
        },
      },
      {
        method: 'mondayApi.notifyUser',
        request: {
          token: TOKEN,
          userId: '42',
          boardId: '200',
          text: '\u05d4\u05e4\u05e2\u05d5\u05dc\u05d4 \u05e0\u05d7\u05e1\u05de\u05d4: \u05d7\u05e1\u05e8\u05d9\u05dd \u05e9\u05d3\u05d5\u05ea \u05d7\u05d5\u05d1\u05d4 (owner, notes).',
        },
      },
    ]);
    expect(calls.some(({ method }) => method === 'store.appendAudit')).toBe(false);
  });

  it('still attempts notification after rollback failure and throws one stable AggregateError', async () => {
    const rollbackError = new Error('rollback failed');
    const { service, calls } = createDependencies({
      requiredValues: [],
      rollbackError,
    });

    let thrown = null;
    try {
      await handle(service);
    } catch (error) {
      thrown = error;
    }

    expect({
      isAggregateError: thrown instanceof AggregateError,
      name: thrown?.name,
      message: thrown?.message,
      errors: thrown?.errors,
    }).toEqual({
      isAggregateError: true,
      name: 'AggregateError',
      message: 'Status transition denial could not be completed safely.',
      errors: [rollbackError],
    });
    expect(
      calls
        .filter(({ method }) => [
          'store.setExpectedMarker',
          'mondayApi.changeStatus',
          'mondayApi.notifyUser',
        ].includes(method))
        .map(({ method }) => method),
    ).toEqual([
      'store.setExpectedMarker',
      'mondayApi.changeStatus',
      'mondayApi.notifyUser',
    ]);
    expect(calls.some(({ method }) => method === 'store.appendAudit')).toBe(false);
  });

  it('aggregates both rollback and notification failures without hiding either cause', async () => {
    const rollbackError = new Error('rollback failed');
    const notificationError = new Error('notification failed');
    const { service, calls } = createDependencies({
      requiredValues: [],
      rollbackError,
      notificationError,
    });

    let thrown = null;
    try {
      await handle(service);
    } catch (error) {
      thrown = error;
    }

    expect({
      isAggregateError: thrown instanceof AggregateError,
      name: thrown?.name,
      message: thrown?.message,
      errors: thrown?.errors,
    }).toEqual({
      isAggregateError: true,
      name: 'AggregateError',
      message: 'Status transition denial could not be completed safely.',
      errors: [rollbackError, notificationError],
    });
    expect(calls.filter(({ method }) => method === 'mondayApi.notifyUser')).toHaveLength(1);
    expect(calls.some(({ method }) => method === 'store.appendAudit')).toBe(false);
  });
});
