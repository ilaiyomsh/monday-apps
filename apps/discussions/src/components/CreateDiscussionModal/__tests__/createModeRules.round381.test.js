import { describe, it, expect } from 'vitest';
import { CREATE_DISCUSSION_MODES } from '@generated/utils/mondayApi/boards.config.js';
import {
  availableCreateModes,
  canAutoName,
  firstLinkedProject,
  isFoldingMode,
  isFormRevealed,
  projectLinkValue,
  CREATE_MODE_LABEL,
} from '../createModeRules.js';

/*
 * round381 — the create card's third path, "דיון על פרויקט". The owner's spec is
 * that it behaves as closely as possible to "דיון מתבנית", so these tests are
 * mostly about the two paths giving the SAME answer: one rule, not two copies.
 */

const { TEMPLATE, PROJECT, ADHOC } = CREATE_DISCUSSION_MODES;

/*
 * round383 amended this block: availableCreateModes now takes (preferences,
 * projectReady) because the owner can enable/disable EVERY mode, not just the
 * project one. The behaviour asserted here is unchanged — "the project path shows
 * only when the app can carry it" — it just needs the preferences that say so.
 */
describe('availableCreateModes', () => {
  const allOn = { enabledCreateModes: [TEMPLATE, PROJECT, ADHOC] };

  it('offers the project path only when the app can carry it', () => {
    expect(availableCreateModes(allOn, false)).toEqual([TEMPLATE, ADHOC]);
    expect(availableCreateModes(allOn, true)).toEqual([TEMPLATE, PROJECT, ADHOC]);
  });

  it('keeps מזדמן last, so the existing two-path order is unchanged', () => {
    // round367's toggle was מתבנית then מזדמן; the project path is inserted
    // BETWEEN them, so a user with the feature off sees exactly what they saw.
    expect(availableCreateModes(allOn, true).at(-1)).toBe(ADHOC);
    expect(availableCreateModes(allOn, true)[0]).toBe(TEMPLATE);
  });

  it('names every mode it can offer', () => {
    for (const m of availableCreateModes(allOn, true)) {
      expect(CREATE_MODE_LABEL[m]).toBeTruthy();
    }
    expect(CREATE_MODE_LABEL[PROJECT]).toBe('דיון על פרויקט');
  });
});

describe('isFoldingMode / isFormRevealed', () => {
  it('folds for BOTH template and project — you cannot fill a discussion with no subject', () => {
    expect(isFoldingMode(TEMPLATE)).toBe(true);
    expect(isFoldingMode(PROJECT)).toBe(true);
    expect(isFoldingMode(ADHOC)).toBe(false);
  });

  it('waits for the subject in a folding mode, and reveals at once in adhoc', () => {
    expect(isFormRevealed({ mode: PROJECT, subjectChosen: false })).toBe(false);
    expect(isFormRevealed({ mode: PROJECT, subjectChosen: true })).toBe(true);
    expect(isFormRevealed({ mode: TEMPLATE, subjectChosen: false })).toBe(false);
    expect(isFormRevealed({ mode: ADHOC, subjectChosen: false })).toBe(true);
  });

  it('always reveals in edit and duplicate, whose fields are already filled', () => {
    expect(isFormRevealed({ isEdit: true, mode: PROJECT, subjectChosen: false })).toBe(true);
    expect(isFormRevealed({ isDuplicate: true, mode: TEMPLATE, subjectChosen: false })).toBe(true);
  });
});

describe('canAutoName — round367\'s rule, now shared by both paths', () => {
  const base = { mode: PROJECT, autoNameEnabled: true, name: '', lastAutoDate: '' };

  it('fills an empty name', () => {
    expect(canAutoName(base)).toBe(true);
    expect(canAutoName({ ...base, name: '   ' })).toBe(true);
  });

  /*
   * The one behaviour that must never regress: a name the USER typed is never
   * overwritten when they change the project/template.
   */
  it('never overwrites a name the user typed', () => {
    expect(canAutoName({ ...base, name: 'ישיבת הנהלה חריגה', lastAutoDate: '04.03.2026' })).toBe(false);
  });

  it('DOES replace the previous auto name, recognised by its trailing date', () => {
    expect(canAutoName({ ...base, name: 'פרויקט א - 04.03.2026', lastAutoDate: '04.03.2026' })).toBe(true);
    // ...and not when the trailing date is not the one we wrote
    expect(canAutoName({ ...base, name: 'פרויקט א - 04.03.2026', lastAutoDate: '05.03.2026' })).toBe(false);
  });

  it('is off in edit, in adhoc, and when the preference is off', () => {
    expect(canAutoName({ ...base, isEdit: true })).toBe(false);
    expect(canAutoName({ ...base, mode: ADHOC })).toBe(false);
    expect(canAutoName({ ...base, autoNameEnabled: false })).toBe(false);
    // a missing preference is NOT "on" — resolvePreference returns undefined for
    // an instance saved before the key existed
    expect(canAutoName({ ...base, autoNameEnabled: undefined })).toBe(false);
  });

  it('gives template and project the SAME answer for the same inputs', () => {
    const inputs = { autoNameEnabled: true, name: 'x - 04.03.2026', lastAutoDate: '04.03.2026' };
    expect(canAutoName({ ...inputs, mode: PROJECT })).toBe(canAutoName({ ...inputs, mode: TEMPLATE }));
  });
});

describe('firstLinkedProject — single-select semantics over a MULTI column', () => {
  /*
   * The owner's live column has no `allowMultipleItems`, and monday reads that as
   * MULTI — so the column can hold several projects while a discussion is about
   * one. Taking the first keeps every reader agreeing on which.
   */
  it('takes the first linked item when the column holds several', () => {
    expect(firstLinkedProject({ linkedItems: [{ id: 7, name: 'פרויקט א' }, { id: 8, name: 'ב' }] }))
      .toEqual({ id: '7', name: 'פרויקט א' });
  });

  it('reports no project as null for every empty shape', () => {
    expect(firstLinkedProject(null)).toBeNull();
    expect(firstLinkedProject({})).toBeNull();
    expect(firstLinkedProject({ linkedItems: [] })).toBeNull();
    expect(firstLinkedProject({ linkedItems: [null] })).toBeNull();
  });

  it('skips a junk entry instead of returning a project with no id', () => {
    expect(firstLinkedProject({ linkedItems: [{ name: 'ללא מזהה' }, { id: 9, name: 'תקין' }] }))
      .toEqual({ id: '9', name: 'תקין' });
  });

  it('falls back to the id when the linked item carries no name', () => {
    expect(firstLinkedProject({ linkedItems: [{ id: 5 }] })).toEqual({ id: '5', name: '5' });
  });
});

describe('projectLinkValue — the write shape', () => {
  it('writes exactly ONE id', () => {
    expect(projectLinkValue('7')).toEqual({ linkedItems: [{ id: '7' }] });
    expect(projectLinkValue(7)).toEqual({ linkedItems: [{ id: '7' }] });
  });

  it('writes an EMPTY list to clear, never undefined', () => {
    // An empty list genuinely clears a board_relation; omitting the key would
    // leave a stale link on an edit that removed the project.
    expect(projectLinkValue(null)).toEqual({ linkedItems: [] });
    expect(projectLinkValue('')).toEqual({ linkedItems: [] });
  });
});
