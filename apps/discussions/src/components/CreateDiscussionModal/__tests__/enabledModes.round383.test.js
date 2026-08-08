import { describe, it, expect } from 'vitest';
import { CREATE_DISCUSSION_MODES, DEFAULT_PREFERENCES } from '@generated/utils/mondayApi/boards.config.js';
import {
  CREATE_MODE_ORDER,
  DEFAULT_ENABLED_MODES,
  availableCreateModes,
  canDisableMode,
  nextEnabledModes,
  resolveDefaultMode,
  resolveEnabledModes,
} from '../createModeRules.js';

/*
 * round383 (owner spec, mockup v3 approved) — the settings tab gains a "סוגי דיון"
 * section: each of the three paths carries an ENABLED checkbox and a DEFAULT radio,
 * the radio only choosing among the enabled ones, and at least one path always
 * staying on.
 */

const { TEMPLATE, PROJECT, ADHOC } = CREATE_DISCUSSION_MODES;

describe('resolveEnabledModes', () => {
  it('ships with template + adhoc on and project off', () => {
    expect(DEFAULT_ENABLED_MODES).toEqual([TEMPLATE, ADHOC]);
    expect(resolveEnabledModes({})).toEqual([TEMPLATE, ADHOC]);
    expect(resolveEnabledModes(undefined)).toEqual([TEMPLATE, ADHOC]);
  });

  it('returns the stored set in DISPLAY order, not storage order', () => {
    // The toggle, the settings rows and "the first enabled mode" must agree on
    // what "first" is; sorting here is what makes that one answer.
    expect(resolveEnabledModes({ enabledCreateModes: [ADHOC, PROJECT, TEMPLATE] }))
      .toEqual(CREATE_MODE_ORDER);
  });

  it('ignores junk entries in a stored set', () => {
    expect(resolveEnabledModes({ enabledCreateModes: ['nonsense', PROJECT] })).toEqual([PROJECT]);
  });

  /*
   * round382 shipped a single `projectDiscussions` boolean. An owner who already
   * switched the project path on must keep it without a migration pass over stored
   * settings — so the legacy key is READ when the new set is absent.
   */
  it('reads the legacy projectDiscussions flag when no set is stored', () => {
    expect(resolveEnabledModes({ projectDiscussions: true })).toEqual(CREATE_MODE_ORDER);
    expect(resolveEnabledModes({ projectDiscussions: false })).toEqual([TEMPLATE, ADHOC]);
  });

  it('lets a stored set WIN over the legacy flag', () => {
    expect(resolveEnabledModes({ projectDiscussions: true, enabledCreateModes: [ADHOC] }))
      .toEqual([ADHOC]);
  });

  it('never returns an empty list — a card with no path is unreachable', () => {
    // The settings UI blocks this, but a hand-edited store is not the settings UI.
    expect(resolveEnabledModes({ enabledCreateModes: [] })).toEqual([TEMPLATE, ADHOC]);
  });
});

describe('availableCreateModes — enabled AND ready are separate conditions', () => {
  it('drops the project path when the column is not mapped', () => {
    const prefs = { enabledCreateModes: CREATE_MODE_ORDER };
    expect(availableCreateModes(prefs, false)).toEqual([TEMPLATE, ADHOC]);
    expect(availableCreateModes(prefs, true)).toEqual(CREATE_MODE_ORDER);
  });

  it('never adds a mode the owner disabled, however ready it is', () => {
    expect(availableCreateModes({ enabledCreateModes: [ADHOC] }, true)).toEqual([ADHOC]);
  });
});

describe('canDisableMode / nextEnabledModes — one must always stay on', () => {
  it('refuses to switch off the last enabled mode', () => {
    expect(canDisableMode([ADHOC], ADHOC)).toBe(false);
    expect(nextEnabledModes([ADHOC], ADHOC, false)).toEqual([ADHOC]);
  });

  it('allows switching one off while another remains', () => {
    expect(canDisableMode([TEMPLATE, ADHOC], TEMPLATE)).toBe(true);
    expect(nextEnabledModes([TEMPLATE, ADHOC], TEMPLATE, false)).toEqual([ADHOC]);
  });

  it('adds a mode back IN DISPLAY ORDER, not appended at the end', () => {
    expect(nextEnabledModes([ADHOC], TEMPLATE, true)).toEqual([TEMPLATE, ADHOC]);
    expect(nextEnabledModes([TEMPLATE, ADHOC], PROJECT, true)).toEqual(CREATE_MODE_ORDER);
  });

  it('is idempotent — enabling an enabled mode changes nothing', () => {
    expect(nextEnabledModes([TEMPLATE, ADHOC], ADHOC, true)).toEqual([TEMPLATE, ADHOC]);
  });

  it('reports a mode that is not enabled as not disable-able', () => {
    expect(canDisableMode([TEMPLATE, ADHOC], PROJECT)).toBe(false);
  });
});

describe('resolveDefaultMode — the radio only picks among the enabled', () => {
  it('honours the stored default when it is enabled', () => {
    expect(resolveDefaultMode({ createDiscussionMode: ADHOC }, [TEMPLATE, ADHOC])).toBe(ADHOC);
  });

  /*
   * Disabling the mode that WAS the default must not leave the card opening on a
   * path that is not on the toggle. It falls back to the first enabled one.
   */
  it('falls back to the first enabled mode when the stored default was disabled', () => {
    expect(resolveDefaultMode({ createDiscussionMode: TEMPLATE }, [PROJECT, ADHOC])).toBe(PROJECT);
  });

  /*
   * ...and the stored value is NOT rewritten, which is what makes disabling a path
   * reversible: re-enable it and the owner's choice comes back by itself.
   */
  it('leaves the stored preference untouched, so re-enabling restores it', () => {
    const prefs = { createDiscussionMode: TEMPLATE };
    resolveDefaultMode(prefs, [ADHOC]);
    expect(prefs.createDiscussionMode).toBe(TEMPLATE);
    expect(resolveDefaultMode(prefs, [TEMPLATE, ADHOC])).toBe(TEMPLATE);
  });

  it('derives the enabled set itself when none is handed in', () => {
    expect(resolveDefaultMode({ createDiscussionMode: PROJECT })).toBe(TEMPLATE); // project not enabled by default
    expect(resolveDefaultMode({})).toBe(TEMPLATE);
  });
});

describe('the shipped preference defaults', () => {
  it('names the enabled set and a default that is inside it', () => {
    const enabled = resolveEnabledModes(DEFAULT_PREFERENCES);
    expect(enabled).toEqual([TEMPLATE, ADHOC]);
    expect(enabled).toContain(resolveDefaultMode(DEFAULT_PREFERENCES, enabled));
  });
});
