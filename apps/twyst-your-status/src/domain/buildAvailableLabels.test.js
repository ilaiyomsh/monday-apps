import { describe, expect, it } from 'vitest';
import {
  buildAvailableLabels,
  currentLabelIdFromValue,
  isActorAllowedForLabel,
} from './buildAvailableLabels.js';

const LABELS = [
  { id: '0', index: 0, label: 'ממתין', color: '#fdab3d', isDeactivated: false },
  { id: '1', index: 1, label: 'אוטומציה', color: '#00c875', isDeactivated: false },
  { id: '2', index: 2, label: 'נדחה', color: '#df2f4a', isDeactivated: false },
  { id: '3', index: 3, label: 'ארכיון', color: '#c4c4c4', isDeactivated: true },
];

const SETTINGS = {
  version: 1,
  hiddenLabelIds: ['1'],
  labels: {
    '2': {
      allowedUserIds: ['42'],
      allowedTeamIds: ['7'],
      requiredColumnIds: ['notes'],
    },
  },
};

describe('currentLabelIdFromValue', () => {
  it('reads the status value index as the label id', () => {
    expect(currentLabelIdFromValue({ index: 1, value: '{"index":9}' })).toBe('1');
    expect(currentLabelIdFromValue({ index: null, value: '{"index":0}' })).toBe('0');
  });
});

describe('isActorAllowedForLabel', () => {
  it('allows everyone when allowlists are empty', () => {
    expect(isActorAllowedForLabel(
      { allowedUserIds: [], allowedTeamIds: [], requiredColumnIds: [] },
      { userId: '9', teamIds: [] },
    )).toBe(true);
  });

  it('allows by user id or by team membership', () => {
    const rule = { allowedUserIds: ['42'], allowedTeamIds: ['7'], requiredColumnIds: [] };
    expect(isActorAllowedForLabel(rule, { userId: '42', teamIds: [] })).toBe(true);
    expect(isActorAllowedForLabel(rule, { userId: '99', teamIds: ['7'] })).toBe(true);
    expect(isActorAllowedForLabel(rule, { userId: '99', teamIds: ['8'] })).toBe(false);
  });
});

describe('buildAvailableLabels', () => {
  it('hides deactivated, hidden, and unauthorized labels while keeping a hidden current value visible', () => {
    const model = buildAvailableLabels({
      labels: LABELS,
      settings: SETTINGS,
      actor: { userId: '99', teamIds: [] },
      currentValue: { index: 1, value: '{"index":1}' },
    });

    expect(model).toEqual({
      currentLabelId: '1',
      currentLabel: LABELS[1],
      currentIsHidden: true,
      // label 0 is open (no rule); 1 current+hidden; 2 unauthorized; 3 deactivated
      options: [LABELS[0]],
    });
  });

  it('omits the currently selected label from pickable options', () => {
    const model = buildAvailableLabels({
      labels: LABELS,
      settings: null,
      actor: { userId: '1', teamIds: [] },
      currentValue: { index: 0 },
    });

    expect(model.currentLabelId).toBe('0');
    expect(model.currentLabel).toEqual(LABELS[0]);
    expect(model.options.map((label) => label.id)).toEqual(['1', '2']);
  });

  it('shows an allowlisted label when the actor is on an allowed team', () => {
    const model = buildAvailableLabels({
      labels: LABELS,
      settings: SETTINGS,
      actor: { userId: '99', teamIds: ['7'] },
      currentValue: { index: 0 },
    });

    // current (0) omitted; 2 allowlisted via team
    expect(model.options.map((label) => label.id)).toEqual(['2']);
    expect(model.currentIsHidden).toBe(false);
  });

  it('treats null settings as unconfigured only at the UI layer — filter receives null and shows non-hidden active labels as open', () => {
    const model = buildAvailableLabels({
      labels: LABELS,
      settings: null,
      actor: { userId: '1', teamIds: [] },
      currentValue: null,
    });
    expect(model.options.map((label) => label.id)).toEqual(['0', '1', '2']);
  });
});
