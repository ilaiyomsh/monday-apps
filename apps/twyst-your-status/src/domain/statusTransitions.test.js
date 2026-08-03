/**
 * Transition rules — round321 (owner request): for each label, which labels may be
 * picked AFTER it, and which are not offered at all once it is the current status.
 *
 * The model is one optional field on the existing per-label rule:
 *
 *   labels[sourceId].nextLabelIds : string[] | absent
 *
 *   - absent (or anything that is not an array) → unrestricted, exactly today's
 *     behaviour. Every stored settings blob from before this round reads this way.
 *   - an array → after `sourceId`, ONLY these labels are offered. An empty array is
 *     a terminal status: nothing may follow it.
 *
 * The EMPTY status is a source too: an item whose status was never set has no label
 * id, but the grey default label (reserved id 5) is that state's face — the settings
 * screen always shows its card now (round313) — so the rule keyed '5' governs what
 * may be picked first. An item explicitly holding the id-5 label hits the same key
 * directly, which is exactly right: both LOOK like the grey label on the board.
 *
 * Transitions compose with (never replace) the existing filters: a hidden label stays
 * hidden and an actor outside a label's allowlist stays blocked, whatever the
 * transition rule says.
 */

import { describe, expect, it } from 'vitest';

import { buildAvailableLabels } from './buildAvailableLabels.js';
import { migrateSettings, normalizeLabelRule } from './settingsSchema.js';
import { pruneSettingsForActiveLabels } from './statusLabelDraft.js';

/** Active labels as the picker sees them (probe-shaped: id + label + color). */
const LABELS = [
  { id: '0', label: 'ממתין', color: '#fdab3d' },
  { id: '1', label: 'בעבודה', color: '#579bfc' },
  { id: '2', label: 'בוצע', color: '#00c875' },
  { id: '3', label: 'נדחה', color: '#e2445c' },
];

const ACTOR = { userId: '7', teamIds: [] };

const settingsWith = (labels, extra = {}) => ({
  version: 1,
  hiddenLabelIds: [],
  labels,
  ...extra,
});

/** Options the picker would offer, as bare ids, for a given current status. */
const optionIdsFor = (settings, currentLabelId) => buildAvailableLabels({
  labels: LABELS,
  settings,
  actor: ACTOR,
  currentValue: currentLabelId === null ? null : { index: Number(currentLabelId) },
}).options.map((label) => label.id);

describe('normalizeLabelRule / migrateSettings — the stored shape', () => {
  it('carries a valid nextLabelIds array through, normalized to unique string ids', () => {
    const rule = normalizeLabelRule({ nextLabelIds: [2, '2', ' 3 ', 'x', null] });
    expect(rule.nextLabelIds).toEqual(['2', '3']);
  });

  it('omits the field entirely when it is absent or not an array — old blobs stay byte-compatible', () => {
    // Pinned as key-absence, not undefined-value: several suites toEqual the
    // 4-key rule shape, and a phantom 5th key would fail them all.
    expect('nextLabelIds' in normalizeLabelRule({ allowedUserIds: ['1'] })).toBe(false);
    expect('nextLabelIds' in normalizeLabelRule({ nextLabelIds: 'all' })).toBe(false);
    expect('nextLabelIds' in normalizeLabelRule({ nextLabelIds: null })).toBe(false);
  });

  it('keeps an EMPTY array — a terminal status is a real configuration, not a default', () => {
    expect(normalizeLabelRule({ nextLabelIds: [] }).nextLabelIds).toEqual([]);
  });

  it('survives migrateSettings on a rule that has ONLY a transition restriction', () => {
    const migrated = migrateSettings(settingsWith({ 2: { nextLabelIds: ['0'] } }));
    expect(migrated.labels['2'].nextLabelIds).toEqual(['0']);
    // The permission lists are still normalized in beside it.
    expect(migrated.labels['2'].allowedUserIds).toEqual([]);
  });
});

describe('buildAvailableLabels — what the picker offers after each label', () => {
  it('offers only the listed labels after a restricted one', () => {
    const settings = settingsWith({ 0: { nextLabelIds: ['1', '3'] } });
    expect(optionIdsFor(settings, '0')).toEqual(['1', '3']);
  });

  it('offers everything (minus the current label) when the source carries no rule', () => {
    expect(optionIdsFor(settingsWith({}), '0')).toEqual(['1', '2', '3']);
  });

  it('offers NOTHING after a terminal label (empty list)', () => {
    const settings = settingsWith({ 2: { nextLabelIds: [] } });
    expect(optionIdsFor(settings, '2')).toEqual([]);
  });

  it("an EMPTY status is governed by the default label's rule (reserved id 5)", () => {
    const settings = settingsWith({ 5: { nextLabelIds: ['0'] } });
    expect(optionIdsFor(settings, null)).toEqual(['0']);
  });

  it('an empty status with no id-5 rule stays unrestricted', () => {
    expect(optionIdsFor(settingsWith({}), null)).toEqual(['0', '1', '2', '3']);
  });

  it('composes with hiding: a listed-but-hidden label is still not offered', () => {
    const settings = settingsWith(
      { 0: { nextLabelIds: ['1', '2'] } },
      { hiddenLabelIds: ['1'] },
    );
    expect(optionIdsFor(settings, '0')).toEqual(['2']);
  });

  it('composes with the allowlist: a listed label the actor may not pick is still blocked', () => {
    const settings = settingsWith({
      0: { nextLabelIds: ['1', '2'] },
      1: { allowedUserIds: ['999'] },
    });
    expect(optionIdsFor(settings, '0')).toEqual(['2']);
  });

  it('ignores listed ids that are not on the column (a removed label restricts nothing)', () => {
    const settings = settingsWith({ 0: { nextLabelIds: ['1', '77'] } });
    expect(optionIdsFor(settings, '0')).toEqual(['1']);
  });

  it('restricts only FROM the rule’s own label — other sources are untouched', () => {
    const settings = settingsWith({ 0: { nextLabelIds: ['1'] } });
    expect(optionIdsFor(settings, '3')).toEqual(['0', '1', '2']);
  });
});

describe('pruneSettingsForActiveLabels — transitions when labels come and go', () => {
  it('drops removed labels from every nextLabelIds list', () => {
    const pruned = pruneSettingsForActiveLabels(
      settingsWith({ 0: { nextLabelIds: ['1', '2'] } }),
      ['0', '1'],
    );
    expect(pruned.labels['0'].nextLabelIds).toEqual(['1']);
  });

  it("keeps the reserved default rule ('5') even when no id-5 label exists on the column", () => {
    // The empty state is always configurable — its card is always on screen — so a
    // save that never created the grey label must not silently discard its rule.
    const pruned = pruneSettingsForActiveLabels(
      settingsWith({ 5: { nextLabelIds: ['0'] } }),
      ['0', '1'],
    );
    expect(pruned.labels['5']).toBeDefined();
    expect(pruned.labels['5'].nextLabelIds).toEqual(['0']);
  });

  it("keeps '5' as a transition TARGET when the grey label is really on the column", () => {
    // Refined after round321's review (statusTransitionsRefinement.test.js): '5'
    // earns its place as a target by being ACTIVE, like any other id — force-keeping
    // it left phantom targets behind the name-then-clear flow. The rule KEY '5' is
    // still always kept (the case above this one).
    const pruned = pruneSettingsForActiveLabels(
      settingsWith({ 0: { nextLabelIds: ['1', '5'] } }),
      ['0', '1', '5'],
    );
    expect(pruned.labels['0'].nextLabelIds).toEqual(['1', '5']);
  });

  it('leaves unrestricted rules without the field, exactly as before this round', () => {
    const pruned = pruneSettingsForActiveLabels(
      settingsWith({ 0: { allowedUserIds: ['1'] } }),
      ['0'],
    );
    expect(pruned.labels['0']).toEqual({
      allowedUserIds: ['1'],
      allowedTeamIds: [],
      requiredColumnIds: [],
      requiredPeopleColumnIds: [],
    });
  });
});
