import { describe, it, expect } from 'vitest';
import { sanitizeTypeTemplate } from '../templates.js';
import { canSaveType } from '../../components/TemplateManagerModal/typeSaveGuard.js';
import { DEFAULT_PREFERENCES, CREATE_DISCUSSION_MODES, resolvePreference } from '../mondayApi/boards.config.js';

/*
 * round367 §2+§3 — external participants ride on the TYPE template (sanitized,
 * save-guard counts them as content), and the create-card toggle preferences
 * exist with the owner-specified defaults.
 */
describe('round367 — external participants on the type template', () => {
  it('sanitizeTypeTemplate keeps trimmed non-empty names and defaults to []', () => {
    const t = sanitizeTypeTemplate({
      discussionType: 'ישיבת צוות',
      externalParticipants: ['  רו"ח אבי שגב ', '', null, 'יועץ חיצוני'],
    });
    expect(t.externalParticipants).toEqual(['רו"ח אבי שגב', 'יועץ חיצוני']);
    const empty = sanitizeTypeTemplate({ discussionType: 'ישיבת צוות' });
    expect(empty.externalParticipants).toEqual([]);
  });

  it('a junk (non-array) value never reaches storage', () => {
    const t = sanitizeTypeTemplate({ discussionType: 'x', externalParticipants: 'לא מערך' });
    expect(t.externalParticipants).toEqual([]);
  });

  it('canSaveType counts external participants as content — a type with ONLY externals saves', () => {
    const base = {
      draft: { topics: [{ name: '', points: [] }] },
      lead: [], coordinator: [], participants: [],
      exportDirty: false, colorDraft: null, storedColor: null,
      deciderIsLead: false, storedDeciderIsLead: false,
    };
    expect(canSaveType({ ...base, externalParticipants: [] })).toBe(false);
    expect(canSaveType({ ...base, externalParticipants: ['רו"ח אבי שגב'] })).toBe(true);
  });
});

describe('round367 — create-card toggle preferences', () => {
  it('defaults: TEMPLATE half pre-selected, auto name ON', () => {
    expect(CREATE_DISCUSSION_MODES.TEMPLATE).toBe('template');
    expect(CREATE_DISCUSSION_MODES.ADHOC).toBe('adhoc');
    expect(DEFAULT_PREFERENCES.createDiscussionMode).toBe(CREATE_DISCUSSION_MODES.TEMPLATE);
    expect(DEFAULT_PREFERENCES.templateAutoName).toBe(true);
    // resolvePreference falls back to the defaults for unset/empty
    expect(resolvePreference({}, 'createDiscussionMode')).toBe('template');
    expect(resolvePreference({ createDiscussionMode: '' }, 'createDiscussionMode')).toBe('template');
    // false is a REAL stored value (the resolvePreference invariant)
    expect(resolvePreference({ templateAutoName: false }, 'templateAutoName')).toBe(false);
  });
});
