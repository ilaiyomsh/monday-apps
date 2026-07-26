import { describe, expect, it } from 'vitest';
import statusColumnProbe from '../test-utils/probes/status-column-context.json';
import {
  STATUS_GUARD_CONFIG_VERSION,
  buildStatusPickerModel,
  makeStatusGuardStorageKey,
  normalizeStatusGuardConfig,
  normalizeStatusLabels,
  serializeStatusMutationValue,
} from './statusPolicy';

const WAITING_LABEL = {
  id: '0',
  index: 0,
  label: '\u05de\u05de\u05ea\u05d9\u05df',
  color: '#fdab3d',
  isDone: false,
  isDeactivated: false,
};

const AUTOMATION_ONLY_LABEL = {
  id: '1',
  index: 1,
  label: '\u05de\u05d0\u05d5\u05e9\u05e8 \u05d0\u05d5\u05d8\u05d5\u05de\u05d8\u05d9\u05ea',
  color: '#00c875',
  isDone: true,
  isDeactivated: false,
};

const REJECTED_LABEL = {
  id: '2',
  index: 2,
  label: '\u05e0\u05d3\u05d7\u05d4',
  color: '#df2f4a',
  isDone: false,
  isDeactivated: false,
};

const DEACTIVATED_LABEL = {
  id: '3',
  index: 3,
  label: 'Archived',
  color: '#c4c4c4',
  isDone: false,
  isDeactivated: true,
};

const EMPTY_CONFIG = {
  version: STATUS_GUARD_CONFIG_VERSION,
  restrictedLabelIds: [],
};

const capturedColumnSettings =
  statusColumnProbe.query.boards[0].columns[0].settings;

describe('makeStatusGuardStorageKey', () => {
  it('returns the versioned board-and-column key when both identifiers are present', () => {
    expect(makeStatusGuardStorageKey('18423828028', 'status_guard')).toBe(
      'status-guard:v1:18423828028:status_guard',
    );
  });

  it.each([
    ['missing board id', null, 'status_guard', 'boardId is required'],
    ['undefined board id', undefined, 'status_guard', 'boardId is required'],
    ['empty board id', '', 'status_guard', 'boardId is required'],
    ['blank board id', '   ', 'status_guard', 'boardId is required'],
    ['missing column id', '18423828028', null, 'columnId is required'],
    ['undefined column id', '18423828028', undefined, 'columnId is required'],
    ['empty column id', '18423828028', '', 'columnId is required'],
    ['blank column id', '18423828028', '   ', 'columnId is required'],
  ])('throws the named validation error for a %s', (_caseName, boardId, columnId, message) => {
    expect(() => makeStatusGuardStorageKey(boardId, columnId)).toThrow(message);
  });
});

describe('normalizeStatusGuardConfig', () => {
  it('returns an empty v1 config when persisted config is absent', () => {
    expect(normalizeStatusGuardConfig(null)).toEqual({
      version: 1,
      restrictedLabelIds: [],
    });
  });

  it.each([
    undefined,
    'malformed',
    [],
    { restrictedLabelIds: ['1'] },
    { version: 2, restrictedLabelIds: ['1'] },
    { version: '1', restrictedLabelIds: ['1'] },
    { version: 1, restrictedLabelIds: '1' },
  ])('falls back to an empty v1 config for malformed or unsupported input %#', (rawConfig) => {
    expect(normalizeStatusGuardConfig(rawConfig)).toEqual({
      version: 1,
      restrictedLabelIds: [],
    });
  });

  it('canonicalizes numeric label ids, removes invalid ids, and deduplicates without reordering', () => {
    expect(
      normalizeStatusGuardConfig({
        version: 1,
        restrictedLabelIds: [
          2,
          '1',
          2,
          '2',
          0,
          '0',
          ' 3 ',
          '',
          '   ',
          null,
          undefined,
          -1,
          1.5,
          '1.5',
          'abc',
          {},
          [],
          true,
        ],
      }),
    ).toEqual({
      version: 1,
      restrictedLabelIds: ['2', '1', '0', '3'],
    });
  });
});

describe('normalizeStatusLabels', () => {
  it('maps every captured monday status-label field and preserves API order', () => {
    expect(normalizeStatusLabels(capturedColumnSettings)).toEqual([
      WAITING_LABEL,
      AUTOMATION_ONLY_LABEL,
      REJECTED_LABEL,
    ]);
  });

  it('preserves deactivation state and skips entries without non-negative integer id and index values', () => {
    expect(
      normalizeStatusLabels({
        labels: [
          ...capturedColumnSettings.labels,
          {
            id: 3,
            index: 3,
            label: 'Archived',
            hex: '#c4c4c4',
            is_done: false,
            is_deactivated: true,
          },
          { index: 4, label: 'Missing id', hex: '#000000' },
          { id: 5, label: 'Missing index', hex: '#000000' },
          { id: -1, index: -1, label: 'Negative', hex: '#000000' },
          { id: 6.5, index: 6.5, label: 'Fractional', hex: '#000000' },
          { id: '7', index: '7', label: 'String identity', hex: '#000000' },
        ],
      }),
    ).toEqual([
      WAITING_LABEL,
      AUTOMATION_ONLY_LABEL,
      REJECTED_LABEL,
      DEACTIVATED_LABEL,
    ]);
  });
});

describe('buildStatusPickerModel', () => {
  const labels = [
    WAITING_LABEL,
    AUTOMATION_ONLY_LABEL,
    REJECTED_LABEL,
    DEACTIVATED_LABEL,
  ];

  it('hides restricted and deactivated options while exposing the restricted current value', () => {
    expect(
      buildStatusPickerModel({
        labels,
        currentValue: statusColumnProbe.query.items[0].column_values[0],
        config: { version: 1, restrictedLabelIds: ['1'] },
      }),
    ).toEqual({
      currentLabelId: '1',
      currentLabel: AUTOMATION_ONLY_LABEL,
      currentIsRestricted: true,
      options: [WAITING_LABEL, REJECTED_LABEL],
    });
  });

  it('keeps a deactivated current value visible without offering it as an option', () => {
    expect(
      buildStatusPickerModel({
        labels,
        currentValue: { index: 3, value: '{"index":3}' },
        config: EMPTY_CONFIG,
      }),
    ).toEqual({
      currentLabelId: '3',
      currentLabel: DEACTIVATED_LABEL,
      currentIsRestricted: false,
      options: [WAITING_LABEL, AUTOMATION_ONLY_LABEL, REJECTED_LABEL],
    });
  });

  it('uses the direct current index before a conflicting JSON fallback value', () => {
    expect(
      buildStatusPickerModel({
        labels: labels.slice(0, 3),
        currentValue: { index: 2, value: '{"index":0}' },
        config: EMPTY_CONFIG,
      }),
    ).toEqual({
      currentLabelId: '2',
      currentLabel: REJECTED_LABEL,
      currentIsRestricted: false,
      options: [WAITING_LABEL, AUTOMATION_ONLY_LABEL, REJECTED_LABEL],
    });
  });

  it('extracts current label id zero from the JSON value when the direct index is absent', () => {
    expect(
      buildStatusPickerModel({
        labels: labels.slice(0, 3),
        currentValue: {
          index: null,
          value: statusColumnProbe.readback.value,
        },
        config: EMPTY_CONFIG,
      }),
    ).toEqual({
      currentLabelId: '0',
      currentLabel: WAITING_LABEL,
      currentIsRestricted: false,
      options: [WAITING_LABEL, AUTOMATION_ONLY_LABEL, REJECTED_LABEL],
    });
  });

  it('returns no current selection while retaining all active options when the cell is empty', () => {
    expect(
      buildStatusPickerModel({
        labels: labels.slice(0, 3),
        currentValue: { index: null, value: null },
        config: EMPTY_CONFIG,
      }),
    ).toEqual({
      currentLabelId: null,
      currentLabel: null,
      currentIsRestricted: false,
      options: [WAITING_LABEL, AUTOMATION_ONLY_LABEL, REJECTED_LABEL],
    });
  });

  it('returns an exact empty model when labels and current value are absent', () => {
    expect(
      buildStatusPickerModel({
        labels: [],
        currentValue: null,
        config: EMPTY_CONFIG,
      }),
    ).toEqual({
      currentLabelId: null,
      currentLabel: null,
      currentIsRestricted: false,
      options: [],
    });
  });
});

describe('serializeStatusMutationValue', () => {
  it.each([
    [0, '{"index":0}'],
    ['0', '{"index":0}'],
    [2, '{"index":2}'],
    [' 2 ', '{"index":2}'],
  ])('serializes valid label id %j to the exact monday status payload', (labelId, expected) => {
    expect(serializeStatusMutationValue(labelId)).toBe(expected);
  });

  it.each([null, undefined, '', '   ', -1, '-1', 1.5, '1.5', 'abc', {}, []])(
    'throws instead of serializing invalid label id %j',
    (labelId) => {
      expect(() => serializeStatusMutationValue(labelId)).toThrow('labelId must be a non-negative integer');
    },
  );
});
