/**
 * Transition-rule refinements — the confirmed findings of round321's adversarial
 * review, each one a hole in the empty≡grey-label identity:
 *
 * 1. The identity was applied on the SOURCE side only. An empty status resolved to
 *    rule '5', but a NAMED id-5 label was still OFFERED from empty cells — and the
 *    moment the default card carried any restriction it vanished, because the
 *    editor's target list can never contain the card itself ('5' was inexpressible).
 *    The fix completes the identity: an empty status treats the id-5 label as its
 *    CURRENT label and excludes it, exactly as every non-empty status excludes its
 *    own label. Picking the grey label from an empty cell was a visual no-op anyway.
 *
 * 2. Prune force-kept '5' in every nextLabelIds list, so a default label that was
 *    named, checked as a target elsewhere, and un-named in the same visit left a
 *    phantom target the editor could never show. '5' now survives as a TARGET only
 *    when the caller lists it as active — the rule KEY is still always kept, because
 *    the empty state stays configurable regardless.
 *
 * 3. A restriction whose targets were ALL removed by pruning used to become an empty
 *    list — the terminal-status marker — silently converting "only via X" into
 *    "nothing may follow" when X was deleted. A restriction emptied BY the prune now
 *    drops the field (unrestricted); an explicit stored [] is untouched, because a
 *    deliberately terminal status must stay terminal.
 */

import { describe, expect, it } from 'vitest';

import { buildAvailableLabels } from './buildAvailableLabels.js';
import { pruneSettingsForActiveLabels } from './statusLabelDraft.js';

const LABELS_WITH_NAMED_DEFAULT = [
  { id: '0', label: 'ממתין', color: '#fdab3d' },
  { id: '1', label: 'בעבודה', color: '#579bfc' },
  { id: '5', label: 'טרם עודכן', color: '#c4c4c4' },
];

const ACTOR = { userId: '7', teamIds: [] };

const optionIdsFor = (settings, currentLabelId) => buildAvailableLabels({
  labels: LABELS_WITH_NAMED_DEFAULT,
  settings,
  actor: ACTOR,
  currentValue: currentLabelId === null ? null : { index: Number(currentLabelId) },
}).options.map((label) => label.id);

const settingsWith = (labels) => ({ version: 1, hiddenLabelIds: [], labels });

describe('the empty≡grey identity holds on BOTH sides of the picker', () => {
  it('an empty status never offers the id-5 label — it already IS that state', () => {
    expect(optionIdsFor(settingsWith({}), null)).toEqual(['0', '1']);
  });

  it('so restricting the default card no longer makes the grey label silently vanish: it was never offered', () => {
    // Pre-fix: unrestricted empty offered ['0','1','5'], restricted offered ['0'] —
    // label 5 disappeared without the admin ever seeing a checkbox for it.
    expect(optionIdsFor(settingsWith({ 5: { nextLabelIds: ['0'] } }), null)).toEqual(['0']);
  });

  it('a REAL label still offers the named grey label as a next step when listed', () => {
    expect(optionIdsFor(settingsWith({ 0: { nextLabelIds: ['5'] } }), '0')).toEqual(['5']);
  });

  it('an item explicitly ON the id-5 label excludes it as before (self-exclusion)', () => {
    expect(optionIdsFor(settingsWith({}), '5')).toEqual(['0', '1']);
  });
});

describe("prune — '5' as a transition target follows reality, the rule key never does", () => {
  it("drops '5' from target lists when the caller does not list it as active", () => {
    // The named-then-cleared flow: the grey label will NOT exist after this save,
    // so a rule allowing a transition to it allows nothing and only skews counts.
    // Label 2 survives unlisted in both cases, keeping the lists non-exhaustive —
    // an exhaustive one canonicalizes away (statusTransitionsCanonical.test.js).
    const pruned = pruneSettingsForActiveLabels(
      settingsWith({ 0: { nextLabelIds: ['1', '5'] } }),
      ['0', '1', '2'],
    );
    expect(pruned.labels['0'].nextLabelIds).toEqual(['1']);
  });

  it("keeps '5' as a target when the id-5 label is active on the column", () => {
    const pruned = pruneSettingsForActiveLabels(
      settingsWith({ 0: { nextLabelIds: ['1', '5'] } }),
      ['0', '1', '2', '5'],
    );
    expect(pruned.labels['0'].nextLabelIds).toEqual(['1', '5']);
  });

  it("still keeps the rule KEYED '5' either way — the empty state stays configurable", () => {
    const pruned = pruneSettingsForActiveLabels(
      settingsWith({ 5: { nextLabelIds: ['0'] } }),
      ['0', '1'],
    );
    expect(pruned.labels['5'].nextLabelIds).toEqual(['0']);
  });
});

describe('prune — a restriction emptied by label removal unrestricts instead of turning terminal', () => {
  it('drops the field entirely when every listed target was removed', () => {
    const pruned = pruneSettingsForActiveLabels(
      settingsWith({ 0: { allowedUserIds: ['9'], nextLabelIds: ['2'] } }),
      ['0', '1'],
    );
    expect('nextLabelIds' in pruned.labels['0']).toBe(false);
    // The rest of the rule survives the surgery.
    expect(pruned.labels['0'].allowedUserIds).toEqual(['9']);
  });

  it('leaves an EXPLICIT empty list alone — a deliberately terminal status stays terminal', () => {
    const pruned = pruneSettingsForActiveLabels(
      settingsWith({ 0: { nextLabelIds: [] } }),
      ['0', '1'],
    );
    expect(pruned.labels['0'].nextLabelIds).toEqual([]);
  });

  it('a partially survivable restriction is only trimmed, never dropped', () => {
    // Label 3 survives unlisted — still a real restriction. When the survivors
    // COVER every target the field canonicalizes away instead (Codex PR review;
    // pinned in statusTransitionsCanonical.test.js).
    const pruned = pruneSettingsForActiveLabels(
      settingsWith({ 0: { nextLabelIds: ['1', '2'] } }),
      ['0', '1', '3'],
    );
    expect(pruned.labels['0'].nextLabelIds).toEqual(['1']);
  });
});
