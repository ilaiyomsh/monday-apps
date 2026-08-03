/**
 * Canonical form for transition restrictions after pruning — round321, Codex PR
 * review (P2, confirmed):
 *
 * The EDITOR has one canonical form for "unrestricted": no field at all. Its
 * all-checked state stores null precisely so a label added later is allowed
 * (transitionsEditor.test.jsx pins it). But PRUNE could leave the other spelling
 * behind: delete the one label an admin had unchecked, and the trimmed list now
 * covers every surviving target — the editor renders every checkbox checked,
 * says that means unrestricted, yet the stored rule is still a whitelist, so the
 * NEXT label added is silently blocked with nothing on screen to show why. The
 * two spellings must stay one: a list that covers every possible target for its
 * source canonicalizes away, exactly as toggleTarget does.
 *
 * The vacuous edge is the guard's other half: with NO possible targets (a
 * one-label column) an explicit [] "covers everything" only vacuously — and it
 * must stay, because it is a deliberate terminal status, not an all-checked
 * checklist.
 */

import { describe, expect, it } from 'vitest';

import { pruneSettingsForActiveLabels } from './statusLabelDraft.js';

const settingsWith = (labels) => ({ version: 1, hiddenLabelIds: [], labels });

describe('an exhaustive restriction is the same thing as no restriction', () => {
  it('drops the field when pruning leaves the list covering every surviving target', () => {
    // The review's exact scenario: 0 was restricted to {1,2} out of {1,2,3};
    // labels 2 and 3 are deleted; ['1'] now covers everything that exists.
    const pruned = pruneSettingsForActiveLabels(
      settingsWith({ 0: { allowedUserIds: ['9'], nextLabelIds: ['1', '2'] } }),
      ['0', '1'],
    );
    expect('nextLabelIds' in pruned.labels['0']).toBe(false);
    expect(pruned.labels['0'].allowedUserIds).toEqual(['9']);
  });

  it('drops a stored list that was exhaustive all along (a hand-written blob)', () => {
    const pruned = pruneSettingsForActiveLabels(
      settingsWith({ 0: { nextLabelIds: ['1'] } }),
      ['0', '1'],
    );
    expect('nextLabelIds' in pruned.labels['0']).toBe(false);
  });

  it('keeps a list that a survivor makes NON-exhaustive', () => {
    // Label 3 survives and is not listed — the restriction still restricts.
    const pruned = pruneSettingsForActiveLabels(
      settingsWith({ 0: { nextLabelIds: ['1', '2'] } }),
      ['0', '1', '3'],
    );
    expect(pruned.labels['0'].nextLabelIds).toEqual(['1']);
  });

  it("measures exhaustiveness per SOURCE — the source's own id is not a missing target", () => {
    // Possible targets of '1' are {0}: its own id never counts against coverage.
    const pruned = pruneSettingsForActiveLabels(
      settingsWith({ 1: { nextLabelIds: ['0'] } }),
      ['0', '1'],
    );
    expect('nextLabelIds' in pruned.labels['1']).toBe(false);
  });

  it('does NOT vacuously drop an explicit terminal [] on a one-label column', () => {
    // Zero possible targets: [] "covers everything" only vacuously, and it is a
    // deliberate terminal status — the next label added must stay blocked.
    const pruned = pruneSettingsForActiveLabels(
      settingsWith({ 0: { nextLabelIds: [] } }),
      ['0'],
    );
    expect(pruned.labels['0'].nextLabelIds).toEqual([]);
  });
});
