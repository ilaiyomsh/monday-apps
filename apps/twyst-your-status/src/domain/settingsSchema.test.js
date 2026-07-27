import { describe, expect, it } from 'vitest';
import {
  CURRENT_VERSION,
  emptyLabelRule,
  getLabelRule,
  isOpenAllowlist,
  migrateSettings,
  normalizeLabelRule,
  validateSettings,
} from './settingsSchema.js';

describe('migrateSettings', () => {
  it('returns null for unconfigured storage values', () => {
    expect(migrateSettings(null)).toBeNull();
    expect(migrateSettings(undefined)).toBeNull();
    expect(migrateSettings('x')).toBeNull();
    expect(migrateSettings([])).toBeNull();
  });

  it('normalizes a v1 settings object and drops unknown fields', () => {
    expect(
      migrateSettings({
        version: 1,
        hiddenLabelIds: [1, '1', ' 2 ', 'abc', -1],
        labels: {
          '0': {
            allowedUserIds: [' 10 ', 10, ''],
            allowedTeamIds: [20],
            requiredColumnIds: [' text ', 'date4', 'text'],
            ignored: true,
          },
          bad: { allowedUserIds: ['1'] },
        },
        extra: true,
      }),
    ).toEqual({
      version: CURRENT_VERSION,
      hiddenLabelIds: ['1', '2'],
      labels: {
        '0': {
          allowedUserIds: ['10'],
          allowedTeamIds: ['20'],
          requiredColumnIds: ['text', 'date4'],
        },
      },
    });
  });

  it('migrates legacy restrictedLabelIds status-guard config', () => {
    expect(
      migrateSettings({ version: 1, restrictedLabelIds: ['7', 7, '8'] }),
    ).toEqual({
      version: 1,
      hiddenLabelIds: ['7', '8'],
      labels: {},
    });
  });
});

describe('normalizeLabelRule / isOpenAllowlist / getLabelRule', () => {
  it('treats empty allowlists as open to everyone', () => {
    expect(isOpenAllowlist(emptyLabelRule())).toBe(true);
    expect(isOpenAllowlist(normalizeLabelRule({ allowedUserIds: [], allowedTeamIds: [] }))).toBe(true);
    expect(isOpenAllowlist(normalizeLabelRule({ allowedUserIds: ['1'], allowedTeamIds: [] }))).toBe(false);
    expect(isOpenAllowlist(normalizeLabelRule({ allowedUserIds: [], allowedTeamIds: ['9'] }))).toBe(false);
  });

  it('returns an empty rule for missing label keys', () => {
    const settings = migrateSettings({ version: 1, hiddenLabelIds: [], labels: {} });
    expect(getLabelRule(settings, '3')).toEqual(emptyLabelRule());
    expect(getLabelRule(null, '3')).toEqual(emptyLabelRule());
  });
});

describe('validateSettings', () => {
  it('flags missing required columns against live board columns', () => {
    const settings = {
      version: 1,
      hiddenLabelIds: [],
      labels: {
        '0': {
          allowedUserIds: [],
          allowedTeamIds: [],
          requiredColumnIds: ['text', 'gone'],
        },
      },
    };
    expect(validateSettings(settings, [{ id: 'text', type: 'text' }])).toEqual({
      ok: false,
      problems: ['REQUIRED_COLUMN_MISSING:gone'],
    });
    expect(validateSettings(settings, [
      { id: 'text', type: 'text' },
      { id: 'gone', type: 'date' },
    ]).ok).toBe(true);
  });
});
