import { describe, expect, it } from 'vitest';
import {
  AUDIT_LOG_VERSION,
  DEFAULT_AUDIT_LOG_LIMIT,
  AuditLogError,
  appendAuditEntry,
  normalizeAuditEntry,
  normalizeAuditLog,
} from './auditLog';

const CANONICAL_ENTRY = {
  id: 'entry-1',
  accountId: 'account-1',
  boardId: 'board-1',
  itemId: 'item-1',
  columnId: 'status',
  actorUserId: 'user-1',
  fromLabelId: '0',
  toLabelId: '2',
  occurredAt: '2026-07-27T09:15:00.000Z',
  source: 'item_view',
  transitionId: 'transition-1',
  formValues: {
    reason: 'Approved',
    urgent: true,
    score: 7,
    tags: ['customer', null],
    details: { locale: 'he-IL' },
  },
};

function makeEntry(index, overrides = {}) {
  return {
    ...CANONICAL_ENTRY,
    id: `entry-${index}`,
    itemId: `item-${index}`,
    transitionId: `transition-${index}`,
    formValues: { sequence: index },
    ...overrides,
  };
}

function expectAuditLogError(action, code) {
  let thrown;

  try {
    action();
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(AuditLogError);
  expect(thrown).toMatchObject({
    name: 'AuditLogError',
    code,
  });
}

describe('audit-log public contract', () => {
  it('exports version 1 and a default retention limit of 200 entries', () => {
    expect({ AUDIT_LOG_VERSION, DEFAULT_AUDIT_LOG_LIMIT }).toEqual({
      AUDIT_LOG_VERSION: 1,
      DEFAULT_AUDIT_LOG_LIMIT: 200,
    });
  });

  it('constructs errors with the stable audit-log name, code, and message', () => {
    const error = new AuditLogError('invalid_entry', 'Entry is invalid');

    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      name: 'AuditLogError',
      code: 'invalid_entry',
      message: 'Entry is invalid',
    });
  });
});

describe('normalizeAuditEntry', () => {
  it('returns exactly the canonical fields, trims identifiers, canonicalizes zero ids and timestamps, and excludes unknown fields', () => {
    const formValues = {
      reason: 'Approved',
      urgent: true,
      score: 7,
      tags: ['customer', null],
      details: { locale: 'he-IL' },
    };

    const normalized = normalizeAuditEntry({
      unknownBefore: 'excluded',
      id: ' entry-1 ',
      accountId: ' account-1 ',
      boardId: ' board-1 ',
      itemId: ' item-1 ',
      columnId: ' status ',
      actorUserId: ' user-1 ',
      fromLabelId: 0,
      toLabelId: ' 2 ',
      occurredAt: '2026-07-27T12:15:00+03:00',
      source: 'item_view',
      transitionId: ' transition-1 ',
      formValues,
      unknownAfter: { excluded: true },
    });

    expect(normalized).toEqual(CANONICAL_ENTRY);
    expect(Object.keys(normalized.formValues)).toEqual([
      'reason',
      'urgent',
      'score',
      'tags',
      'details',
    ]);
  });

  it('canonicalizes required identifier zero without treating it as absent', () => {
    expect(
      normalizeAuditEntry({
        id: 0,
        accountId: 0,
        boardId: 0,
        itemId: 0,
        columnId: 0,
        actorUserId: 0,
        fromLabelId: 0,
        toLabelId: 0,
        occurredAt: '2026-07-27T09:15:00.000Z',
        source: 'api',
        transitionId: 0,
      }),
    ).toEqual({
      id: '0',
      accountId: '0',
      boardId: '0',
      itemId: '0',
      columnId: '0',
      actorUserId: '0',
      fromLabelId: '0',
      toLabelId: '0',
      occurredAt: '2026-07-27T09:15:00.000Z',
      source: 'api',
      transitionId: '0',
      formValues: {},
    });
  });

  it('defaults omitted nullable fields to null and omitted form values to an empty object', () => {
    expect(
      normalizeAuditEntry({
        id: 'entry-2',
        accountId: 'account-1',
        boardId: 'board-1',
        itemId: 'item-2',
        columnId: 'status',
        occurredAt: '2026-07-27T09:20:00Z',
        source: 'unknown',
      }),
    ).toEqual({
      id: 'entry-2',
      accountId: 'account-1',
      boardId: 'board-1',
      itemId: 'item-2',
      columnId: 'status',
      actorUserId: null,
      fromLabelId: null,
      toLabelId: null,
      occurredAt: '2026-07-27T09:20:00.000Z',
      source: 'unknown',
      transitionId: null,
      formValues: {},
    });
  });

  it.each(['item_view', 'board', 'automation', 'api', 'unknown'])(
    'preserves the supported source %s in an otherwise exact canonical entry',
    (source) => {
      expect(normalizeAuditEntry({ ...CANONICAL_ENTRY, source })).toEqual({
        ...CANONICAL_ENTRY,
        source,
      });
    },
  );

  it.each([null, undefined, 'entry', [], 17])(
    'rejects non-object entry input %# with the invalid_entry code',
    (rawEntry) => {
      expectAuditLogError(() => normalizeAuditEntry(rawEntry), 'invalid_entry');
    },
  );

  it.each([
    ['id', undefined],
    ['id', '   '],
    ['accountId', null],
    ['accountId', ''],
    ['boardId', {}],
    ['itemId', []],
    ['columnId', false],
  ])('rejects invalid required identifier %s=%# with the invalid_identifier code', (field, value) => {
    expectAuditLogError(
      () => normalizeAuditEntry({ ...CANONICAL_ENTRY, [field]: value }),
      'invalid_identifier',
    );
  });

  it.each([
    ['actorUserId', '   '],
    ['actorUserId', {}],
    ['transitionId', ''],
    ['transitionId', []],
    ['fromLabelId', -1],
    ['fromLabelId', '1.5'],
    ['toLabelId', 2.5],
    ['toLabelId', 'not-a-label'],
  ])('rejects invalid optional identifier %s=%# with the invalid_identifier code', (field, value) => {
    expectAuditLogError(
      () => normalizeAuditEntry({ ...CANONICAL_ENTRY, [field]: value }),
      'invalid_identifier',
    );
  });

  it.each([undefined, null, '', 'not-a-date', 1785143700000, new Date('2026-07-27T09:15:00Z')])(
    'rejects invalid timestamp %# with the invalid_timestamp code',
    (occurredAt) => {
      expectAuditLogError(
        () => normalizeAuditEntry({ ...CANONICAL_ENTRY, occurredAt }),
        'invalid_timestamp',
      );
    },
  );

  it.each([undefined, null, '', 'ITEM_VIEW', 'webhook', 0])(
    'rejects unsupported source %# with the invalid_source code',
    (source) => {
      expectAuditLogError(
        () => normalizeAuditEntry({ ...CANONICAL_ENTRY, source }),
        'invalid_source',
      );
    },
  );

  it.each([null, [], 'form', 7, new Date('2026-07-27T09:15:00Z')])(
    'rejects non-plain form values %# with the invalid_form_values code',
    (formValues) => {
      expectAuditLogError(
        () => normalizeAuditEntry({ ...CANONICAL_ENTRY, formValues }),
        'invalid_form_values',
      );
    },
  );
});

describe('normalizeAuditLog', () => {
  it.each([null, undefined])('returns the exact empty version 1 log when input is %#', (rawLog) => {
    expect(normalizeAuditLog(rawLog)).toEqual({
      version: 1,
      entries: [],
    });
  });

  it.each(['log', 1, [], new Date('2026-07-27T09:15:00Z')])(
    'rejects non-plain log input %# with the invalid_log code',
    (rawLog) => {
      expectAuditLogError(() => normalizeAuditLog(rawLog), 'invalid_log');
    },
  );

  it.each([undefined, 2, '1', 0])(
    'rejects missing or unsupported log version %# with the unsupported_version code',
    (version) => {
      expectAuditLogError(
        () => normalizeAuditLog({ version, entries: [] }),
        'unsupported_version',
      );
    },
  );

  it.each([undefined, null, {}, 'entries'])
    ('rejects non-array log entries %# with the invalid_log code', (entries) => {
      expectAuditLogError(
        () => normalizeAuditLog({ version: 1, entries }),
        'invalid_log',
      );
    });

  it('normalizes entries in input order and keeps the first occurrence of each canonical entry id', () => {
    const firstSeven = {
      ...makeEntry(7),
      id: 7,
      itemId: 700,
      occurredAt: '2026-07-27T12:15:00+03:00',
    };
    const duplicateSeven = {
      ...makeEntry(70),
      id: '7',
      itemId: 'duplicate-must-not-win',
    };
    const second = makeEntry(2, {
      actorUserId: null,
      fromLabelId: null,
      toLabelId: null,
      transitionId: null,
      formValues: {},
    });

    expect(
      normalizeAuditLog({
        version: 1,
        entries: [firstSeven, duplicateSeven, second],
        ignored: true,
      }),
    ).toEqual({
      version: 1,
      entries: [
        {
          id: '7',
          accountId: 'account-1',
          boardId: 'board-1',
          itemId: '700',
          columnId: 'status',
          actorUserId: 'user-1',
          fromLabelId: '0',
          toLabelId: '2',
          occurredAt: '2026-07-27T09:15:00.000Z',
          source: 'item_view',
          transitionId: 'transition-7',
          formValues: { sequence: 7 },
        },
        second,
      ],
    });
  });
});

describe('appendAuditEntry', () => {
  it('normalizes the log and entry, then prepends the new entry without changing existing order', () => {
    const existing = makeEntry(1, {
      id: 1,
      itemId: 1,
      occurredAt: '2026-07-27T12:15:00+03:00',
    });
    const added = makeEntry(2, {
      id: 2,
      itemId: 2,
      actorUserId: undefined,
      fromLabelId: undefined,
      toLabelId: undefined,
      transitionId: undefined,
      formValues: undefined,
    });

    expect(appendAuditEntry({ version: 1, entries: [existing] }, added)).toEqual({
      version: 1,
      entries: [
        {
          id: '2',
          accountId: 'account-1',
          boardId: 'board-1',
          itemId: '2',
          columnId: 'status',
          actorUserId: null,
          fromLabelId: null,
          toLabelId: null,
          occurredAt: '2026-07-27T09:15:00.000Z',
          source: 'item_view',
          transitionId: null,
          formValues: {},
        },
        {
          ...makeEntry(1),
          id: '1',
          itemId: '1',
        },
      ],
    });
  });

  it('is idempotent for an existing canonical id and preserves the first existing duplicate', () => {
    const firstExisting = makeEntry(7, {
      id: 7,
      itemId: 700,
      source: 'board',
    });
    const laterDuplicate = makeEntry(70, {
      id: '7',
      itemId: 'duplicate-existing',
      source: 'automation',
    });
    const attemptedReplacement = makeEntry(700, {
      id: ' 7 ',
      itemId: 'replacement',
      source: 'api',
    });

    expect(
      appendAuditEntry(
        { version: 1, entries: [firstExisting, laterDuplicate, makeEntry(8)] },
        attemptedReplacement,
      ),
    ).toEqual({
      version: 1,
      entries: [
        {
          ...makeEntry(7),
          id: '7',
          itemId: '700',
          source: 'board',
        },
        makeEntry(8),
      ],
    });
  });

  it('keeps exactly the prepended entry when the explicit limit is 1', () => {
    const added = makeEntry('new');

    expect(
      appendAuditEntry(
        { version: 1, entries: [makeEntry(1), makeEntry(2)] },
        added,
        1,
      ),
    ).toEqual({
      version: 1,
      entries: [added],
    });
  });

  it('uses the default limit of 200 and retains the newest 199 existing entries after prepending', () => {
    const existing = Array.from({ length: 200 }, (_, index) => makeEntry(index + 1));
    const added = makeEntry('new');

    expect(appendAuditEntry({ version: 1, entries: existing }, added)).toEqual({
      version: 1,
      entries: [added, ...existing.slice(0, 199)],
    });
  });

  it('accepts the maximum limit of 1000 and retains the newest 999 existing entries after prepending', () => {
    const existing = Array.from({ length: 1000 }, (_, index) => makeEntry(index + 1));
    const added = makeEntry('new');

    expect(appendAuditEntry({ version: 1, entries: existing }, added, 1000)).toEqual({
      version: 1,
      entries: [added, ...existing.slice(0, 999)],
    });
  });

  it.each([0, -1, 1001, 1.5, '200', null, Number.NaN])(
    'rejects invalid limit %# with the invalid_limit code',
    (limit) => {
      expectAuditLogError(
        () => appendAuditEntry(null, CANONICAL_ENTRY, limit),
        'invalid_limit',
      );
    },
  );
});
