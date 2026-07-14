// Retrofit characterization tests (test-guard): draft.ts was written before
// its gate — red-equivalents are the killed mutations recorded via redgreen.sh.

import { describe, it, expect } from 'vitest';
import { draftFromConfig, draftIsComplete, draftToConfig, type ConfigDraft } from './draft';
import type { AppConfig, BoardColumn } from './types';

const storedConfig: AppConfig = {
  boardId: '18422009734',
  statusColumnId: 'color_mm58mbec',
  fromIndex: 0,
  fromLabel: 'בעבודה',
  toIndex: 1,
  toLabel: 'בוצע',
  peopleColumnId: 'multiple_person_mm582h4p',
  expiryDateColumnId: null,
  expiryGraceDays: 0,
};

const columns: BoardColumn[] = [
  {
    id: 'color_mm58mbec',
    title: 'סטטוס',
    type: 'status',
    labels: [
      { id: 0, label: 'בעבודה', index: 0, isDeactivated: false },
      { id: 1, label: 'בוצע', index: 1, isDeactivated: false },
    ],
  },
];

function completeDraft(overrides: Partial<ConfigDraft> = {}): ConfigDraft {
  return {
    boardId: '18422009734',
    statusColumnId: 'color_mm58mbec',
    fromIndex: 0,
    toIndex: 1,
    peopleColumnId: 'multiple_person_mm582h4p',
    expiryDateColumnId: null,
    expiryGraceDays: 0,
    ...overrides,
  };
}

describe('draftFromConfig', () => {
  it('maps a null stored config to an all-null draft with grace 0', () => {
    expect(draftFromConfig(null)).toStrictEqual({
      boardId: null,
      statusColumnId: null,
      fromIndex: null,
      toIndex: null,
      peopleColumnId: null,
      expiryDateColumnId: null,
      expiryGraceDays: 0,
    });
  });

  it('copies every stored field, keeping label id 0 (not nulling falsy ids)', () => {
    expect(draftFromConfig(storedConfig)).toStrictEqual({
      boardId: '18422009734',
      statusColumnId: 'color_mm58mbec',
      fromIndex: 0,
      toIndex: 1,
      peopleColumnId: 'multiple_person_mm582h4p',
      expiryDateColumnId: null,
      expiryGraceDays: 0,
    });
  });
});

describe('draftIsComplete', () => {
  it('accepts a complete draft with fromIndex 0', () => {
    expect(draftIsComplete(completeDraft())).toBe(true);
  });

  it.each([
    ['boardId', { boardId: null }],
    ['statusColumnId', { statusColumnId: null }],
    ['fromIndex', { fromIndex: null }],
    ['toIndex', { toIndex: null }],
  ] as const)('rejects a draft missing %s', (_field, patch) => {
    expect(draftIsComplete(completeDraft(patch))).toBe(false);
  });

  it('rejects equal from/to label ids', () => {
    expect(draftIsComplete(completeDraft({ fromIndex: 1, toIndex: 1 }))).toBe(false);
  });
});

describe('draftToConfig', () => {
  it('resolves fromLabel/toLabel by label ID on the picked status column', () => {
    expect(draftToConfig(completeDraft(), columns)).toStrictEqual(storedConfig);
  });

  it('returns null while the draft is incomplete', () => {
    expect(draftToConfig(completeDraft({ toIndex: null }), columns)).toBeNull();
  });

  it('returns null when a picked label id no longer exists on the column (stale draft)', () => {
    expect(draftToConfig(completeDraft({ toIndex: 99 }), columns)).toBeNull();
  });

  it('zeroes expiryGraceDays when no expiry column is picked', () => {
    const result = draftToConfig(completeDraft({ expiryGraceDays: 5 }), columns);
    expect(result?.expiryGraceDays).toBe(0);
  });

  it('keeps expiryGraceDays when an expiry column IS picked', () => {
    const dateColumns: BoardColumn[] = [
      ...columns,
      { id: 'date_mm58ej61', title: 'דדליין', type: 'date', labels: [] },
    ];
    const result = draftToConfig(
      completeDraft({ expiryDateColumnId: 'date_mm58ej61', expiryGraceDays: 5 }),
      dateColumns
    );
    expect(result?.expiryDateColumnId).toBe('date_mm58ej61');
    expect(result?.expiryGraceDays).toBe(5);
  });
});
