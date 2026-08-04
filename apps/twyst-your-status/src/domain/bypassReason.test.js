/**
 * bypassReason — attributes a guard verdict to the SPECIFIC rule it broke, and
 * renders the owner-facing Hebrew explanation (round323). classifyViolation is
 * characterized against the shipped rule modules; estimateSurface is the honest
 * api-vs-native split (the webhook cannot tell mobile from cold-load).
 */

import { describe, expect, it } from 'vitest';

import { classifyViolation, describeViolation, estimateSurface } from './bypassReason.js';

const settingsWith = (labels, extra = {}) => ({ version: 1, hiddenLabelIds: [], labels, ...extra });
const ACTOR = { userId: '7', teamIds: ['20'] };

describe('classifyViolation — which rule the change broke', () => {
  it('flags a hidden target label', () => {
    const c = classifyViolation({
      settings: settingsWith({}, { hiddenLabelIds: ['2'] }),
      actor: ACTOR, previousLabelId: '0', newLabelId: '2',
    }, { reason: 'not-offered' });
    expect(c).toEqual({ code: 'hidden', labelId: '2' });
  });

  it('flags a disallowed transition and reports which labels WERE allowed and the source', () => {
    const c = classifyViolation({
      settings: settingsWith({ 0: { nextLabelIds: ['1', '3'] } }),
      actor: ACTOR, previousLabelId: '0', newLabelId: '2',
    }, { reason: 'not-offered' });
    expect(c).toEqual({ code: 'transition', allowed: ['1', '3'], labelId: '2', sourceId: '0' });
  });

  it('governs the empty source via the reserved id 5', () => {
    const c = classifyViolation({
      settings: settingsWith({ 5: { nextLabelIds: ['0'] } }),
      actor: ACTOR, previousLabelId: null, newLabelId: '2',
    }, { reason: 'not-offered' });
    expect(c).toEqual({ code: 'transition', allowed: ['0'], labelId: '2', sourceId: '5' });
  });

  it('flags an actor outside the target label allowlist', () => {
    const c = classifyViolation({
      settings: settingsWith({ 2: { allowedUserIds: ['999'], allowedTeamIds: [] } }),
      actor: ACTOR, previousLabelId: '0', newLabelId: '2',
    }, { reason: 'not-offered' });
    expect(c).toEqual({ code: 'allowlist', labelId: '2' });
  });

  it('flags a failed people-column gate and names the column, when the allowlist itself passes', () => {
    const c = classifyViolation({
      settings: settingsWith({ 2: { requiredPeopleColumnIds: ['people_col'] } }),
      actor: ACTOR, previousLabelId: '0', newLabelId: '2',
      peopleByColumnId: { people_col: { personIds: ['999'], teamIds: [] } },
    }, { reason: 'not-offered' });
    expect(c).toEqual({ code: 'people', peopleColumnId: 'people_col', labelId: '2' });
  });

  it('flags empty required fields for a required-fields verdict, carrying the empty ids', () => {
    const c = classifyViolation({
      settings: settingsWith({ 2: { requiredColumnIds: ['d', 'p'] } }),
      actor: ACTOR, previousLabelId: '0', newLabelId: '2', emptyFieldIds: ['d', 'p'],
    }, { reason: 'required-fields-empty' });
    expect(c).toEqual({ code: 'required', fields: ['d', 'p'], labelId: '2' });
  });
});

describe('describeViolation — the Hebrew technical text', () => {
  const labels = { 0: 'ממתין', 1: 'בעבודה', 2: 'בוצע', 3: 'נדחה' };

  it('names the source, the allowed set, and the blocked target for a transition', () => {
    const text = describeViolation(
      { code: 'transition', allowed: ['1', '3'], labelId: '2', sourceId: '0' }, labels,
    );
    expect(text).toContain('אחרי הלייבל "ממתין"');
    expect(text).toContain('"בעבודה", "נדחה"');
    expect(text).toContain('הלייבל "בוצע" אינו ברשימה');
  });

  it('names the empty required columns by their titles', () => {
    const text = describeViolation(
      { code: 'required', fields: ['d'], labelId: '2' }, labels, { d: 'תאריך יעד' },
    );
    expect(text).toContain('"בוצע"');
    expect(text).toContain('"תאריך יעד"');
  });

  it('names the actor for an allowlist violation', () => {
    const text = describeViolation({ code: 'allowlist', labelId: '2' }, labels, {}, 'דנה כהן');
    expect(text).toContain('דנה כהן');
    expect(text).toContain('"בוצע"');
  });
});

describe('estimateSurface — honest api-vs-native split', () => {
  it('treats an empty or monday app as a native-editor change', () => {
    expect(estimateSurface(undefined)).toBe('native');
    expect(estimateSurface('')).toBe('native');
    expect(estimateSurface('monday')).toBe('native');
    expect(estimateSurface('MONDAY')).toBe('native');
  });

  it('treats any other app value as an api/integration change', () => {
    expect(estimateSurface('integration')).toBe('api');
    expect(estimateSurface('some-external-app')).toBe('api');
  });
});
