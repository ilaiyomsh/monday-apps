import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_PREFERENCES, isProjectModeReady } from '@generated/utils/mondayApi/boards.config.js';

/*
 * round382 — the switch for "דיון על פרויקט".
 *
 * round380 shipped the preference and the readiness gate but NO control, so the only
 * way to turn the path on was to edit monday.storage by hand — the owner reported it
 * as "לא רואה את הבחירה בהעדפות". This pins the three things that make the row
 * useful, so the same omission cannot recur.
 */

const SRC = readFileSync(
  join(process.cwd(), 'src/components/SettingsModal/SettingsModal.jsx'),
  'utf-8'
);

describe('the preference exists in the model and starts OFF', () => {
  it('defaults to false, so no existing instance changes behaviour', () => {
    expect(DEFAULT_PREFERENCES.projectDiscussions).toBe(false);
  });
});

describe('the preferences tab actually offers it', () => {
  it('renders a checkbox bound to projectDiscussions', () => {
    expect(SRC).toContain("resolvePreference(preferences, 'projectDiscussions') === true");
    expect(SRC).toContain('projectDiscussions: e.target.checked');
  });

  it('labels the row so an owner can find it', () => {
    expect(SRC).toContain('דיון על פרויקט');
  });

  /*
   * The preference ALONE does nothing — isProjectModeReady also needs projectLinkID
   * mapped. Without this hint an owner ticks the box, sees no third button in the
   * create card, and has no way to learn why.
   */
  it('warns when the preference is on but the column is not mapped', () => {
    expect(SRC).toContain("!columns?.discussions?.projectLinkID?.id");
    expect(SRC).toContain('מפו גם את עמודת "פרויקט" בלשונית המיפוי');
  });

  it('keeps the mapping row for the column, or there would be nothing to map', () => {
    const fields = SRC.slice(SRC.indexOf('const DISCUSSIONS_SETTINGS_FIELDS = ['));
    expect(fields.slice(0, fields.indexOf('];'))).toContain("'projectLinkID'");
  });
});

describe('the gate the control feeds is still both-conditions', () => {
  it('needs the preference AND the mapping — the hint tells the truth', () => {
    const mapped = { projectLinkID: { id: 'board_relation_mm60hh74' } };
    expect(isProjectModeReady({ projectDiscussions: true }, mapped)).toBe(true);
    expect(isProjectModeReady({ projectDiscussions: true }, {})).toBe(false);
    expect(isProjectModeReady({ projectDiscussions: false }, mapped)).toBe(false);
  });
});
