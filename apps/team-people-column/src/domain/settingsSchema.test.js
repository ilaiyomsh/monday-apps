import { describe, it, expect, beforeEach, vi } from 'vitest';

import logger from '../utils/logger.js';
import boardColumns from '../test-utils/probes/GetBoardColumns.json';
import {
  DEFAULT_POLICY,
  policyFromSettings,
  migrateSettings,
  validateSettings
} from './settingsSchema.js';

// Columns straight from the GetBoardColumns capture (real API shape).
// boards[0] = WZ-TeamPeople-source (18421604809), boards[1] = WZ-TeamPeople-target (18421604791).
const sourceCols = boardColumns.data.boards[0].columns;
const targetCols = boardColumns.data.boards[1].columns;
// The app knows the union of both boards' columns (relation lives on source, people on target).
const allCols = [...sourceCols, ...targetCols];

// The real, valid app settings (per probes/MANIFEST.md).
const validV1 = () => ({
  version: 1,
  relationColumnId: 'board_relation_mm56dy57',
  linkedBoardId: '18421604791',
  peopleColumnId: 'multiple_person_mm5694pg',
  policy: { selectionMode: 'multi', aggregation: 'union', includeListedPersons: true }
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('policyFromSettings', () => {
  it('returns exactly the default policy for an empty settings object', () => {
    expect(policyFromSettings({})).toEqual({
      selectionMode: 'multi',
      aggregation: 'union',
      includeListedPersons: true
    });
  });

  it('returns a fresh object, not a reference to the exported DEFAULT_POLICY (no shared mutable state)', () => {
    expect(policyFromSettings({})).not.toBe(DEFAULT_POLICY);
  });

  it('fills only the missing policy fields, keeping provided ones', () => {
    expect(policyFromSettings({ policy: { selectionMode: 'single' } })).toEqual({
      selectionMode: 'single',
      aggregation: 'union',
      includeListedPersons: true
    });
  });

  it('preserves includeListedPersons:false rather than defaulting it back to true', () => {
    // Pins nullish-coalescing (??) over OR (||): false must survive.
    expect(policyFromSettings({ policy: { includeListedPersons: false } }).includeListedPersons).toBe(false);
  });

  it('preserves aggregation:strict', () => {
    expect(policyFromSettings({ policy: { aggregation: 'strict' } }).aggregation).toBe('strict');
  });

  it('returns the default policy when settings is null or undefined', () => {
    expect(policyFromSettings(null)).toEqual(DEFAULT_POLICY);
    expect(policyFromSettings(undefined)).toEqual(DEFAULT_POLICY);
  });
});

describe('migrateSettings', () => {
  it('maps null to null (unconfigured)', () => {
    expect(migrateSettings(null)).toBe(null);
  });

  it('maps undefined to null (unconfigured)', () => {
    expect(migrateSettings(undefined)).toBe(null);
  });

  it('passes a complete v1 settings object through unchanged', () => {
    const v1 = validV1();
    expect(migrateSettings(v1)).toEqual(v1);
  });

  it('does not warn when migrating a v1 object', () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    migrateSettings(validV1());
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('best-effort maps a versionless object: known keys kept, version stamped to 1, default policy added', () => {
    const raw = {
      relationColumnId: 'board_relation_mm56dy57',
      linkedBoardId: '18421604791',
      peopleColumnId: 'multiple_person_mm5694pg'
    };
    expect(migrateSettings(raw)).toEqual({
      version: 1,
      relationColumnId: 'board_relation_mm56dy57',
      linkedBoardId: '18421604791',
      peopleColumnId: 'multiple_person_mm5694pg',
      policy: { selectionMode: 'multi', aggregation: 'union', includeListedPersons: true }
    });
  });

  it('does not warn for a versionless (best-effort) object', () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    migrateSettings({ relationColumnId: 'x', linkedBoardId: 'y', peopleColumnId: 'z' });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('downgrades an unknown higher version: keeps known keys and stamps version to 1', () => {
    const raw = {
      version: 99,
      relationColumnId: 'rel-99',
      linkedBoardId: 'board-99',
      peopleColumnId: 'people-99',
      policy: { selectionMode: 'single', aggregation: 'strict', includeListedPersons: false }
    };
    expect(migrateSettings(raw)).toEqual({
      version: 1,
      relationColumnId: 'rel-99',
      linkedBoardId: 'board-99',
      peopleColumnId: 'people-99',
      policy: { selectionMode: 'single', aggregation: 'strict', includeListedPersons: false }
    });
  });

  it('warns exactly once when migrating an unknown higher version', () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    migrateSettings({ version: 99, relationColumnId: 'r', linkedBoardId: 'b', peopleColumnId: 'p' });
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});

describe('validateSettings', () => {
  it('returns ok:true with no problems for valid settings against the real columns', () => {
    expect(validateSettings(validV1(), allCols)).toEqual({ ok: true, problems: [] });
  });

  it('flags RELATION_COLUMN_MISSING when the relation column id is absent from the board', () => {
    const s = { ...validV1(), relationColumnId: 'board_relation_GONE' };
    const result = validateSettings(s, allCols);
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual(['RELATION_COLUMN_MISSING']);
  });

  it('flags RELATION_COLUMN_TYPE_CHANGED when the relation column id now points at a non-board_relation column', () => {
    // multiple_person_mm562c71 exists on the source board but is type "people".
    const s = { ...validV1(), relationColumnId: 'multiple_person_mm562c71' };
    const result = validateSettings(s, allCols);
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual(['RELATION_COLUMN_TYPE_CHANGED']);
  });

  it('flags PEOPLE_COLUMN_MISSING when the people column id is absent from the board', () => {
    const s = { ...validV1(), peopleColumnId: 'multiple_person_GONE' };
    const result = validateSettings(s, allCols);
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual(['PEOPLE_COLUMN_MISSING']);
  });

  it('reports both a missing relation column and a missing people column together', () => {
    const s = { ...validV1(), relationColumnId: 'board_relation_GONE', peopleColumnId: 'multiple_person_GONE' };
    const result = validateSettings(s, allCols);
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual(['RELATION_COLUMN_MISSING', 'PEOPLE_COLUMN_MISSING']);
  });

  it('does not emit RELATION_COLUMN_MISSING when only the type changed (missing and type-changed are distinct)', () => {
    const s = { ...validV1(), relationColumnId: 'multiple_person_mm562c71' };
    const result = validateSettings(s, allCols);
    expect(result.problems).not.toContain('RELATION_COLUMN_MISSING');
  });
});
