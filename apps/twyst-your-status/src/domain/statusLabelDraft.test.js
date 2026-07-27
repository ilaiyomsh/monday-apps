import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetNewLabelSeqForTests,
  buildStatusLabelsUpdatePayload,
  buildUpdateStatusColumnMutation,
  createBlankLabelDraft,
  createLabelsDraft,
  hasPendingLabelEdits,
  pruneSettingsForActiveLabels,
} from './statusLabelDraft.js';

const LIVE = [
  {
    id: '0',
    index: 0,
    label: 'ממתין',
    color: '#fdab3d',
    colorValue: 0,
    isDeactivated: false,
  },
  {
    id: '1',
    index: 1,
    label: 'בוצע',
    color: '#00c875',
    colorValue: 1,
    isDeactivated: false,
  },
  {
    id: '2',
    index: 2,
    label: 'ארכיון',
    color: '#808080',
    colorValue: 17,
    isDeactivated: true,
  },
];

describe('createLabelsDraft', () => {
  it('keeps only active labels and normalizes colorValue to enum names', () => {
    expect(createLabelsDraft(LIVE)).toEqual([
      {
        clientKey: '0',
        id: '0',
        index: 0,
        label: 'ממתין',
        color: '#fdab3d',
        colorValue: 'working_orange',
        isNew: false,
      },
      {
        clientKey: '1',
        id: '1',
        index: 1,
        label: 'בוצע',
        color: '#00c875',
        colorValue: 'done_green',
        isNew: false,
      },
    ]);
  });
});

describe('hasPendingLabelEdits', () => {
  it('detects rename, recolor, add, remove, and reports false for identical drafts', () => {
    const baseline = createLabelsDraft(LIVE);
    expect(hasPendingLabelEdits(baseline, baseline)).toBe(false);
    expect(hasPendingLabelEdits(
      [{ ...baseline[0], label: 'חדש' }, baseline[1]],
      baseline,
    )).toBe(true);
    expect(hasPendingLabelEdits(
      [{ ...baseline[0], colorValue: 'stuck_red' }, baseline[1]],
      baseline,
    )).toBe(true);
    expect(hasPendingLabelEdits([baseline[0]], baseline)).toBe(true);
    expect(hasPendingLabelEdits([...baseline, createBlankLabelDraft(baseline)], baseline)).toBe(true);
  });
});

describe('buildStatusLabelsUpdatePayload', () => {
  beforeEach(() => {
    __resetNewLabelSeqForTests();
  });

  it('keeps existing ids, omits id for new labels, and deactivates removed live labels', () => {
    const draft = [
      {
        clientKey: '0',
        id: '0',
        index: 0,
        label: 'ממתין מחדש',
        color: '#fdab3d',
        colorValue: 'working_orange',
        isNew: false,
      },
      {
        clientKey: 'new:1',
        id: 'new:1',
        index: 2,
        label: 'חדש',
        color: '#00c875',
        colorValue: 'done_green',
        isNew: true,
      },
    ];

    // monday requires unique colors across the full payload (incl. deactivated).
    // Active keeps done_green; deactivated id:1 is remapped off the collision.
    expect(buildStatusLabelsUpdatePayload(draft, LIVE)).toEqual([
      {
        id: 0,
        color: 'working_orange',
        label: 'ממתין מחדש',
        index: 0,
        isDeactivated: false,
      },
      {
        color: 'done_green',
        label: 'חדש',
        index: 2,
        isDeactivated: false,
      },
      {
        id: 1,
        color: 'stuck_red',
        label: 'בוצע',
        index: 1,
        isDeactivated: true,
      },
      {
        id: 2,
        color: 'american_gray',
        label: 'ארכיון',
        index: 2,
        isDeactivated: true,
      },
    ]);
  });

  it('remaps duplicate colors on active labels so the second keeps a free enum', () => {
    const draft = [
      {
        clientKey: '0',
        id: '0',
        index: 0,
        label: 'א',
        color: '#00c875',
        colorValue: 'done_green',
        isNew: false,
      },
      {
        clientKey: '1',
        id: '1',
        index: 1,
        label: 'ב',
        color: '#00c875',
        colorValue: 'done_green',
        isNew: false,
      },
    ];
    const live = [
      { id: '0', index: 0, label: 'א', color: '#00c875', colorValue: 1 },
      { id: '1', index: 1, label: 'ב', color: '#00c875', colorValue: 1 },
    ];
    expect(buildStatusLabelsUpdatePayload(draft, live)).toEqual([
      {
        id: 0,
        color: 'done_green',
        label: 'א',
        index: 0,
        isDeactivated: false,
      },
      {
        id: 1,
        color: 'working_orange',
        label: 'ב',
        index: 1,
        isDeactivated: false,
      },
    ]);
  });
});

describe('buildUpdateStatusColumnMutation', () => {
  it('emits unquoted StatusColumnColors enums and includes deactivated flags', () => {
    const mutation = buildUpdateStatusColumnMutation([
      {
        id: 0,
        color: 'working_orange',
        label: 'ממתין',
        index: 0,
        isDeactivated: false,
      },
      {
        color: 'done_green',
        label: 'חדש',
        index: 1,
        isDeactivated: false,
      },
      {
        id: 2,
        color: 'american_gray',
        label: 'ישן',
        index: 2,
        isDeactivated: true,
      },
    ]);

    expect(mutation).toContain('update_status_column(');
    expect(mutation).toContain('color: working_orange');
    expect(mutation).toContain('color: done_green');
    expect(mutation).toContain('is_deactivated: true');
    expect(mutation).not.toContain('id: undefined');
    expect(mutation).toContain('label: "ממתין"');
    // New label must not invent an id field.
    expect(mutation).toMatch(/\{\s*color: done_green, label: "חדש"/);
  });
});

describe('pruneSettingsForActiveLabels', () => {
  it('drops rules and hidden ids for labels that are no longer active', () => {
    expect(pruneSettingsForActiveLabels(
      {
        version: 1,
        hiddenLabelIds: ['0', '1'],
        labels: {
          0: { allowedUserIds: ['1'], allowedTeamIds: [], requiredColumnIds: [] },
          1: { allowedUserIds: [], allowedTeamIds: ['9'], requiredColumnIds: ['text'] },
        },
      },
      ['0'],
    )).toEqual({
      version: 1,
      hiddenLabelIds: ['0'],
      labels: {
        0: { allowedUserIds: ['1'], allowedTeamIds: [], requiredColumnIds: [] },
      },
    });
  });

  it('treats null settings as empty rules when pruning', () => {
    expect(pruneSettingsForActiveLabels(null, ['0', '1'])).toEqual({
      version: 1,
      hiddenLabelIds: [],
      labels: {},
    });
  });
});
