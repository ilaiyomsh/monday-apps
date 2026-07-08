/**
 * W1.3 (Day-off integration) — tightened settings validation. A half-configured
 * board must fail loudly: board id + the five contract-critical column mappings
 * (kind/person/startDate/endDate/approvalStatus) + non-empty kind/status label
 * maps are all required. Label maps accept a stable label ID (W1.2 shape) OR a
 * legacy non-empty text (blobs saved before label IDs existed stay valid).
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, type DayOffSettings } from '../types';
import {
  validateDayOffSettings,
  settingsValidationIssues,
  REQUIRED_COLUMN_FIELDS,
} from '../domain/settingsValidation';

/** A minimal fully-valid configuration (ID-based label maps, W1.2 shape). */
function validSettings(): DayOffSettings {
  return {
    ...DEFAULT_SETTINGS,
    vacationBoardId: '123',
    columns: {
      kindColumnId: 'status_kind',
      personColumnId: 'people_person',
      startDateColumnId: 'date_start',
      endDateColumnId: 'date_end',
      approvalStatusColumnId: 'status_approval',
    },
    kindValues: { general: '', personal: '', generalLabelId: '5', personalLabelId: '7' },
    statusValues: {
      pending: '',
      approved: '',
      rejected: '',
      labelIds: { pending: '0', approved: '1', rejected: '2' },
    },
  };
}

describe('validateDayOffSettings — required mappings (W1.3)', () => {
  it('rejects DEFAULT_SETTINGS with errors for the board, every required column, and both label maps', () => {
    const { isValid, errors } = validateDayOffSettings(DEFAULT_SETTINGS);
    expect(isValid).toBe(false);
    expect(errors.vacationBoardId).toBe('app.notConfigured');
    for (const field of REQUIRED_COLUMN_FIELDS) {
      expect(errors[`columns.${field.key}`]).toBe('settings.validation.columnRequired');
    }
    expect(errors.columns).toBe('settings.validation.columnRequired'); // aggregate (tab dot)
    expect(errors.kindValues).toBe('settings.validation.kindValuesRequired');
    expect(errors.statusValues).toBe('settings.validation.statusValuesRequired');
  });

  it('rejects the pre-W1.3 minimum (board only) — half-configured boards fail loudly', () => {
    const { isValid, errors } = validateDayOffSettings({ ...DEFAULT_SETTINGS, vacationBoardId: '123' });
    expect(isValid).toBe(false);
    expect(errors.vacationBoardId).toBeUndefined();
    expect(errors['columns.kindColumnId']).toBeDefined();
    expect(errors['columns.personColumnId']).toBeDefined();
    expect(errors['columns.startDateColumnId']).toBeDefined();
    expect(errors['columns.endDateColumnId']).toBeDefined();
    expect(errors['columns.approvalStatusColumnId']).toBeDefined();
    expect(errors.kindValues).toBeDefined();
    expect(errors.statusValues).toBeDefined();
  });

  it('accepts a fully configured blob (label IDs, no texts) with zero errors', () => {
    const { isValid, errors } = validateDayOffSettings(validSettings());
    expect(isValid).toBe(true);
    expect(errors).toEqual({});
  });

  it('accepts legacy text-only label maps (settings saved before W1.2 stored label IDs)', () => {
    const legacy: DayOffSettings = {
      ...validSettings(),
      kindValues: { general: 'כללי', personal: 'אישי' },
      statusValues: { pending: 'ממתין לאישור', approved: 'מאושר', rejected: 'נדחה' },
    };
    expect(validateDayOffSettings(legacy).isValid).toBe(true);
  });

  it('accepts a mixed map — label ID for one entry, legacy text for the other', () => {
    const mixed: DayOffSettings = {
      ...validSettings(),
      kindValues: { general: 'כללי', personal: '', generalLabelId: null, personalLabelId: '7' },
    };
    expect(validateDayOffSettings(mixed).isValid).toBe(true);
  });

  it('treats label id "0" as configured (no Number coercion traps)', () => {
    const s = validSettings();
    s.kindValues = { general: '', personal: '', generalLabelId: '0', personalLabelId: '1' };
    expect(validateDayOffSettings(s).isValid).toBe(true);
  });

  it('rejects whitespace-only column ids, label ids, and label texts', () => {
    const s = validSettings();
    s.columns = { ...s.columns, personColumnId: '   ' };
    s.kindValues = { general: '  ', personal: '', generalLabelId: ' ', personalLabelId: '7' };
    const { isValid, errors } = validateDayOffSettings(s);
    expect(isValid).toBe(false);
    expect(errors['columns.personColumnId']).toBeDefined();
    expect(errors.kindValues).toBeDefined();
  });

  it('flags a PARTIAL status map (one of pending/approved/rejected unmapped)', () => {
    const s = validSettings();
    s.statusValues = {
      pending: '',
      approved: '',
      rejected: '',
      labelIds: { pending: '0', approved: '1', rejected: null },
    };
    const { isValid, errors } = validateDayOffSettings(s);
    expect(isValid).toBe(false);
    expect(errors.statusValues).toBe('settings.validation.statusValuesRequired');
  });

  it('flags a PARTIAL kind map (personal mapped, general not)', () => {
    const s = validSettings();
    s.kindValues = { general: '', personal: 'אישי', generalLabelId: null, personalLabelId: '7' };
    const { isValid, errors } = validateDayOffSettings(s);
    expect(isValid).toBe(false);
    expect(errors.kindValues).toBe('settings.validation.kindValuesRequired');
  });

  it('does NOT require the optional columns (workdays/personalType/notes/audit/file/mandatory)', () => {
    const s = validSettings(); // none of the optional columns are mapped
    expect(validateDayOffSettings(s).isValid).toBe(true);
  });

  it('omits the aggregate "columns" key when all required columns are mapped', () => {
    const s = validSettings();
    s.kindValues = { general: '', personal: '' }; // only the label map is broken
    const { errors } = validateDayOffSettings(s);
    expect(errors.columns).toBeUndefined();
    expect(Object.keys(errors)).toEqual(['kindValues']);
  });

  it('survives malformed blobs with missing sub-objects (e.g. a bad JSON import)', () => {
    const broken = {
      ...DEFAULT_SETTINGS,
      vacationBoardId: '123',
      columns: undefined,
      kindValues: undefined,
      statusValues: undefined,
    } as unknown as DayOffSettings;
    const { isValid, errors } = validateDayOffSettings(broken);
    expect(isValid).toBe(false);
    expect(errors.kindValues).toBeDefined();
    expect(errors.statusValues).toBeDefined();
    expect(errors['columns.kindColumnId']).toBeDefined();
  });
});

describe('settingsValidationIssues — human-readable issue list', () => {
  it('returns one issue per failure; column issues carry the settings.fields.* label key', () => {
    const { errors } = validateDayOffSettings({ ...DEFAULT_SETTINGS, vacationBoardId: '123' });
    const issues = settingsValidationIssues(errors);
    // 5 columns + kindValues + statusValues (no board issue — board is set)
    expect(issues).toHaveLength(7);
    const columnIssues = issues.filter((i) => i.fieldLabelKey);
    expect(columnIssues.map((i) => i.fieldLabelKey)).toEqual([
      'settings.fields.kind',
      'settings.fields.person',
      'settings.fields.startDate',
      'settings.fields.endDate',
      'settings.fields.approvalStatus',
    ]);
    expect(columnIssues.every((i) => i.messageKey === 'settings.validation.columnMissing')).toBe(true);
    expect(issues.map((i) => i.messageKey)).toContain('settings.validation.kindValuesRequired');
    expect(issues.map((i) => i.messageKey)).toContain('settings.validation.statusValuesRequired');
  });

  it('includes the board issue when the board is missing', () => {
    const { errors } = validateDayOffSettings(DEFAULT_SETTINGS);
    const issues = settingsValidationIssues(errors);
    expect(issues[0]).toEqual({ messageKey: 'app.notConfigured' });
  });

  it('returns an empty list for a valid configuration', () => {
    const { errors } = validateDayOffSettings(validSettings());
    expect(settingsValidationIssues(errors)).toEqual([]);
  });

  it('ignores the aggregate "columns" key (no duplicate lines)', () => {
    const { errors } = validateDayOffSettings(DEFAULT_SETTINGS);
    const issues = settingsValidationIssues(errors);
    // board + 5 columns + 2 label maps = 8 lines, even though errors has 9 keys
    expect(Object.keys(errors)).toHaveLength(9);
    expect(issues).toHaveLength(8);
  });
});

describe('validateDayOffSettings — duplicate column mappings (change #75)', () => {
  it('flags every field in a collision (the incident: workdays mapped to the end-date column)', () => {
    const s = validSettings();
    s.columns = { ...s.columns, workdaysColumnId: s.columns.endDateColumnId };
    const { isValid, errors } = validateDayOffSettings(s);
    expect(isValid).toBe(false);
    expect(errors['columns.workdaysColumnId']).toBe('settings.validation.columnDuplicate');
    expect(errors['columns.endDateColumnId']).toBe('settings.validation.columnDuplicate');
    expect(errors.columns).toBeTruthy(); // aggregate lights the tab dot
  });

  it('flags duplicates between optional fields too', () => {
    const s = validSettings();
    s.columns = { ...s.columns, empNoteColumnId: 'long_text_1', mgrNoteColumnId: 'long_text_1' };
    const { isValid, errors } = validateDayOffSettings(s);
    expect(isValid).toBe(false);
    expect(errors['columns.empNoteColumnId']).toBe('settings.validation.columnDuplicate');
    expect(errors['columns.mgrNoteColumnId']).toBe('settings.validation.columnDuplicate');
  });

  it('accepts a fully distinct mapping', () => {
    const { isValid } = validateDayOffSettings(validSettings());
    expect(isValid).toBe(true);
  });
});

describe('validateDayOffSettings — column type checks with board metadata (change #75)', () => {
  const types = {
    status_kind: 'color',
    people_person: 'multiple-person',
    date_start: 'date',
    date_end: 'date',
    status_approval: 'color',
  };

  it('passes when every mapped column has the expected type', () => {
    const { isValid, errors } = validateDayOffSettings(validSettings(), types);
    expect(errors).toEqual({});
    expect(isValid).toBe(true);
  });

  it('rejects a date field mapped to a non-date column', () => {
    const { isValid, errors } = validateDayOffSettings(validSettings(), {
      ...types,
      date_end: 'numbers',
    });
    expect(isValid).toBe(false);
    expect(errors['columns.endDateColumnId']).toBe('settings.validation.columnWrongType');
  });

  it('normalizes type spelling (underscores, case) before comparing', () => {
    const { isValid } = validateDayOffSettings(validSettings(), {
      ...types,
      people_person: 'Multiple_Person',
    });
    expect(isValid).toBe(true);
  });

  it('skips the type check entirely when no metadata is supplied (boot-time path)', () => {
    const { isValid } = validateDayOffSettings(validSettings());
    expect(isValid).toBe(true);
  });

  it('does not flag columns missing from the metadata map (deleted-column detection is separate)', () => {
    const { isValid } = validateDayOffSettings(validSettings(), { date_start: 'date' });
    expect(isValid).toBe(true);
  });
});
