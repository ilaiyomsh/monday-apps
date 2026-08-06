/**
 * pruneSettings — the settings-blob transform that drops what a save leaves
 * behind. Re-exported from statusLabelDraft.js, which is where the app imports
 * it from. Imports settingsSchema/statusColors directly, so there is no cycle
 * back into statusLabelDraft.js.
 */

import { migrateSettings } from './settingsSchema.js';
import { RESERVED_EMPTY_LABEL_ID } from './statusColors.js';

/**
 * Drop permission rules / hidden ids for labels that no longer exist as active.
 * @param {object|null} settings
 * @param {string[]} activeLabelIds
 */
export function pruneSettingsForActiveLabels(settings, activeLabelIds) {
  const migrated = migrateSettings(settings) ?? {
    version: 1,
    hiddenLabelIds: [],
    labels: {},
  };
  /*
   * round321 — two keep-sets with different jobs (review-confirmed distinction):
   *
   * `keepTargets` is the caller's list verbatim — a transition may only point at a
   * label that really exists (or will exist after this save). '5' earns its place
   * here like anyone else; force-keeping it left a phantom target behind the
   * name-then-clear flow, one the editor could never show and the counts kept
   * counting.
   *
   * `keepKeys` additionally always holds the reserved id: the rule keyed '5'
   * governs what may be picked from an EMPTY status, its card is always on the
   * settings screen (round313), and the refreshed active ids after a labels
   * mutation list only labels monday really has — so a save that never created the
   * grey label would otherwise silently discard the empty state's configuration.
   */
  const keepTargets = new Set((activeLabelIds ?? []).map(String));
  const keepKeys = new Set([...keepTargets, String(RESERVED_EMPTY_LABEL_ID)]);
  const labels = {};
  Object.entries(migrated.labels).forEach(([key, rule]) => {
    if (!keepKeys.has(key)) return;
    if (!Array.isArray(rule.nextLabelIds)) {
      labels[key] = rule;
      return;
    }
    const nextLabelIds = rule.nextLabelIds.filter((id) => keepTargets.has(id));
    if (nextLabelIds.length === 0 && rule.nextLabelIds.length > 0) {
      /*
       * The restriction was emptied BY this prune — every label it pointed at is
       * gone. Keeping the empty list would silently convert "only via X" into a
       * TERMINAL status the moment X is deleted; unrestricting is the smaller
       * surprise. A stored [] (deliberately terminal) takes the branch above this
       * one untouched, because 0 === 0.
       */
      const { nextLabelIds: dropped, ...rest } = rule;
      labels[key] = rest;
      return;
    }
    /*
     * Canonical form (Codex PR review, confirmed): the editor's ONE spelling of
     * "unrestricted" is no field at all — its all-checked state stores null so a
     * label added later is allowed. A list that covers every possible target for
     * this source (everything active except the source itself) is that same state
     * in different bytes, and pruning could mint it: delete the one label the
     * admin had unchecked and the survivors are all listed — the editor shows
     * all-checked, SAYS unrestricted, yet the next label added would be silently
     * blocked. Non-empty is required: an explicit terminal [] on a column with no
     * other labels covers everything only vacuously, and it must stay terminal.
     */
    const nextSet = new Set(nextLabelIds);
    const coversEveryTarget = nextLabelIds.length > 0
      && [...keepTargets].every((id) => id === key || nextSet.has(id));
    if (coversEveryTarget) {
      const { nextLabelIds: dropped, ...rest } = rule;
      labels[key] = rest;
      return;
    }
    labels[key] = { ...rule, nextLabelIds };
  });
  return {
    version: migrated.version,
    hiddenLabelIds: migrated.hiddenLabelIds.filter((id) => keepKeys.has(id)),
    labels,
  };
}
