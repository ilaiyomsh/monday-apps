// Retrofit characterization tests (test-guard) — v2 draft model.

import { describe, it, expect } from 'vitest';
import {
  defaultDigestDraft,
  draftFromConfig,
  draftIsComplete,
  draftToConfig,
  buttonIsComplete,
  templateIsComplete,
  newButton,
  newTemplate,
  type ConfigDraft,
} from './draft';
import type { ActionButton, AppConfig, EmailTemplate } from './types';

const button: ActionButton = {
  id: 'b_done0001',
  name: 'בוצע',
  statusColumnId: 'color_mm58mbec',
  targetIndex: 0, // label id 0 is valid!
  targetLabel: 'בעבודה',
  style: { color: '#00854d', icon: '✓', size: 'md' },
};

const template: EmailTemplate = {
  id: 't_start0001',
  name: 'מייל התחלה',
  blocks: [
    { type: 'text', text: 'שלום', direction: 'rtl', font: 'Arial', fontSize: 16, align: 'right' },
    { type: 'buttons', buttonIds: ['b_done0001'] },
  ],
};

const storedConfig: AppConfig = {
  boardId: '18422009734',
  peopleColumnId: 'multiple_person_mm582h4p',
  buttons: [button],
  templates: [template],
};

function completeDraft(overrides: Partial<ConfigDraft> = {}): ConfigDraft {
  return {
    boardId: '18422009734',
    peopleColumnId: 'multiple_person_mm582h4p',
    buttons: [button],
    templates: [template],
    // v4: digest rides the draft; disabled by default (contract pinned in
    // draft-digest.test.ts).
    digest: defaultDigestDraft(),
    ...overrides,
  };
}

// defaultDigestDraft() generates fresh section ids — match shape, not ids.
const DISABLED_DIGEST = expect.objectContaining({ enabled: false });

describe('draftFromConfig', () => {
  it('maps a null stored config to an empty draft', () => {
    expect(draftFromConfig(null)).toStrictEqual({
      boardId: null,
      peopleColumnId: null,
      buttons: [],
      templates: [],
      digest: DISABLED_DIGEST,
    });
  });

  it('copies buttons and templates verbatim from the stored config', () => {
    expect(draftFromConfig(storedConfig)).toStrictEqual({
      boardId: '18422009734',
      peopleColumnId: 'multiple_person_mm582h4p',
      buttons: [button],
      templates: [template],
      digest: DISABLED_DIGEST,
    });
  });
});

describe('buttonIsComplete', () => {
  it('accepts a full button with targetIndex 0 (falsy label id)', () => {
    expect(buttonIsComplete(button)).toBe(true);
  });

  it.each([
    ['name', { name: ' ' }],
    ['statusColumnId', { statusColumnId: '' }],
    ['targetIndex unpicked', { targetIndex: -1 }],
    ['targetLabel', { targetLabel: '' }],
  ] as const)('rejects a button with missing %s', (_what, patch) => {
    expect(buttonIsComplete({ ...button, ...patch })).toBe(false);
  });

  it('newButton() starts incomplete with a b_-prefixed id', () => {
    const fresh = newButton();
    expect(fresh.id).toMatch(/^b_[A-Za-z0-9_-]{4,16}$/);
    expect(buttonIsComplete(fresh)).toBe(false);
  });
});

describe('templateIsComplete', () => {
  it('accepts a named template whose blocks all have content', () => {
    expect(templateIsComplete(template)).toBe(true);
  });

  it('rejects an unnamed template, an empty-blocks template, an empty text block, and an empty buttons block', () => {
    expect(templateIsComplete({ ...template, name: ' ' })).toBe(false);
    expect(templateIsComplete({ ...template, blocks: [] })).toBe(false);
    expect(
      templateIsComplete({
        ...template,
        blocks: [{ type: 'text', text: ' ', direction: 'rtl', font: 'Arial', fontSize: 16, align: 'right' }],
      })
    ).toBe(false);
    expect(templateIsComplete({ ...template, blocks: [{ type: 'buttons', buttonIds: [] }] })).toBe(
      false
    );
  });

  it('newTemplate() starts incomplete with a t_-prefixed id and one empty text block', () => {
    const fresh = newTemplate();
    expect(fresh.id).toMatch(/^t_[A-Za-z0-9_-]{4,16}$/);
    expect(fresh.blocks).toHaveLength(1);
    expect(templateIsComplete(fresh)).toBe(false);
  });
});

describe('draftIsComplete / draftToConfig', () => {
  it('requires a board and at least one complete button', () => {
    expect(draftIsComplete(completeDraft())).toBe(true);
    expect(draftIsComplete(completeDraft({ boardId: null }))).toBe(false);
    expect(draftIsComplete(completeDraft({ buttons: [] }))).toBe(false);
    expect(draftIsComplete(completeDraft({ buttons: [{ ...button, name: '' }] }))).toBe(false);
  });

  it('templates are optional but must be complete when present', () => {
    expect(draftIsComplete(completeDraft({ templates: [] }))).toBe(true);
    expect(draftIsComplete(completeDraft({ templates: [{ ...template, name: '' }] }))).toBe(false);
  });

  it('draftToConfig returns the exact payload for a complete draft and null otherwise', () => {
    expect(draftToConfig(completeDraft())).toStrictEqual({ ...storedConfig, digest: null });
    expect(draftToConfig(completeDraft({ buttons: [] }))).toBeNull();
  });
});
