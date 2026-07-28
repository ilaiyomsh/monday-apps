import { describe, expect, it } from 'vitest';
import {
  CURRENT_VERSION,
  collectRequiredPeopleColumnIds,
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

  it('normalizes a v1 settings object including requiredPeopleColumnIds', () => {
    expect(
      migrateSettings({
        version: 1,
        hiddenLabelIds: [1, '1', ' 2 ', 'abc', -1],
        labels: {
          '0': {
            allowedUserIds: [' 10 ', 10, ''],
            allowedTeamIds: [20],
            requiredColumnIds: [' text ', 'date4', 'text'],
            requiredPeopleColumnIds: [' person ', 'person', 'owner'],
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
          requiredPeopleColumnIds: ['person', 'owner'],
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
  it('treats empty allowlists as open to everyone (people gate is separate)', () => {
    expect(isOpenAllowlist(emptyLabelRule())).toBe(true);
    expect(isOpenAllowlist(normalizeLabelRule({ allowedUserIds: [], allowedTeamIds: [] }))).toBe(true);
    expect(isOpenAllowlist(normalizeLabelRule({
      allowedUserIds: [],
      allowedTeamIds: [],
      requiredPeopleColumnIds: ['owner'],
    }))).toBe(true);
    expect(isOpenAllowlist(normalizeLabelRule({ allowedUserIds: ['1'], allowedTeamIds: [] }))).toBe(false);
    expect(isOpenAllowlist(normalizeLabelRule({ allowedUserIds: [], allowedTeamIds: ['9'] }))).toBe(false);
  });

  it('returns an empty rule for missing label keys', () => {
    const settings = migrateSettings({ version: 1, hiddenLabelIds: [], labels: {} });
    expect(getLabelRule(settings, '3')).toEqual(emptyLabelRule());
    expect(getLabelRule(null, '3')).toEqual(emptyLabelRule());
  });
});

describe('collectRequiredPeopleColumnIds', () => {
  it('returns unique people-column ids across all label rules', () => {
    expect(collectRequiredPeopleColumnIds({
      version: 1,
      hiddenLabelIds: [],
      labels: {
        '0': { allowedUserIds: [], allowedTeamIds: [], requiredColumnIds: [], requiredPeopleColumnIds: ['owner'] },
        '1': { allowedUserIds: [], allowedTeamIds: [], requiredColumnIds: [], requiredPeopleColumnIds: ['owner', 'qa'] },
      },
    })).toEqual(['owner', 'qa']);
    expect(collectRequiredPeopleColumnIds(null)).toEqual([]);
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
          requiredPeopleColumnIds: [],
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

  it('flags missing or non-people gate columns', () => {
    const settings = {
      version: 1,
      hiddenLabelIds: [],
      labels: {
        '0': {
          allowedUserIds: [],
          allowedTeamIds: [],
          requiredColumnIds: [],
          requiredPeopleColumnIds: ['owner', 'status'],
        },
      },
    };
    expect(validateSettings(settings, [
      { id: 'status', type: 'status' },
    ])).toEqual({
      ok: false,
      problems: [
        'REQUIRED_PEOPLE_COLUMN_MISSING:owner',
        'REQUIRED_PEOPLE_COLUMN_NOT_PEOPLE:status',
      ],
    });
    expect(validateSettings(settings, [
      { id: 'owner', type: 'people' },
      { id: 'status', type: 'people' },
    ]).ok).toBe(true);
  });
});
