import { describe, it, expect, vi, afterEach } from 'vitest';

import boardColumns from '../test-utils/probes/GetBoardColumns.json';
import logger from '../utils/logger.js';
import {
  isBoardRelationColumn,
  isPeopleColumn,
  getLinkedBoardIds,
} from './columnClassifiers.js';

// --- Real fixture slices (from the captured GetBoardColumns probe) ---
// Source board 18421604809 holds the real board_relation column pointing at
// the target board 18421604791, plus a real people column.
const sourceBoard = boardColumns.data.boards.find((b) => b.id === '18421604809');
const realRelationColumn = sourceBoard.columns.find(
  (c) => c.id === 'board_relation_mm56dy57',
);
const realPeopleColumn = sourceBoard.columns.find(
  (c) => c.id === 'multiple_person_mm562c71',
);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getLinkedBoardIds', () => {
  it('returns the linked board id as a string array from the settings object of the real board_relation column', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    // The real fixture's settings.boardIds is [18421604791] (a NUMBER).
    expect(realRelationColumn.settings.boardIds).toEqual([18421604791]);

    const result = getLinkedBoardIds(realRelationColumn);

    // Exact string array — pins the number→string coercion (toEqual is type-strict).
    expect(result).toEqual(['18421604791']);
    expect(warn).not.toHaveBeenCalled();
  });

  it('returns [] and logs a warn when settings.boardIds is present but is not an array', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    // A configured relation column always carries an array here; a present-but-
    // non-array boardIds is genuine corruption/drift, not an unconfigured column.
    const corrupt = {
      id: 'board_relation_broken',
      type: 'board_relation',
      settings: { boardIds: '18421604791' },
    };

    const result = getLinkedBoardIds(corrupt);

    expect(result).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    // The module tags its own name so status-hub log filtering works.
    expect(warn.mock.calls[0][0]).toBe('columnClassifiers');
  });

  it('returns [] without warning when the settings object is absent (unconfigured column)', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    const result = getLinkedBoardIds({ id: 'x', type: 'board_relation' });

    // Missing config is not corruption — no warn.
    expect(result).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('returns [] without warning when settings has no boardIds key (still unconfigured)', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    // settings present but boardIds simply absent = benign unconfigured, not corrupt.
    const result = getLinkedBoardIds({ id: 'x', type: 'board_relation', settings: {} });

    expect(result).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('returns every id as a string when settings.boardIds holds multiple numeric ids', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    const multi = {
      id: 'board_relation_multi',
      type: 'board_relation',
      settings: { boardIds: [18421604791, 18421604809] },
    };

    expect(getLinkedBoardIds(multi)).toEqual(['18421604791', '18421604809']);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('isBoardRelationColumn', () => {
  it('is true for a real board_relation column and false for a people column', () => {
    expect(isBoardRelationColumn(realRelationColumn)).toBe(true);
    expect(isBoardRelationColumn(realPeopleColumn)).toBe(false);
  });

  it('is false for a dependency column (dependency is relation-like but excluded)', () => {
    expect(isBoardRelationColumn({ type: 'dependency' })).toBe(false);
  });
});

describe('isPeopleColumn', () => {
  it('is true for people, person, and multiple_person types', () => {
    expect(isPeopleColumn({ type: 'people' })).toBe(true);
    expect(isPeopleColumn({ type: 'person' })).toBe(true);
    expect(isPeopleColumn({ type: 'multiple_person' })).toBe(true);
  });

  it('is true for the real people column from the fixture', () => {
    expect(isPeopleColumn(realPeopleColumn)).toBe(true);
  });

  it('is false for board_relation and for the excluded dependency type', () => {
    expect(isPeopleColumn(realRelationColumn)).toBe(false);
    expect(isPeopleColumn({ type: 'dependency' })).toBe(false);
  });
});
