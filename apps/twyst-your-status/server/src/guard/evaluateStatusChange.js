/**
 * evaluateStatusChange — the guard's single verdict function, PURE.
 *
 * Answers: was this status change legal under the column's stored rules?
 * It validates with the CLIENT's own domain modules (one source of truth):
 * buildAvailableLabels covers hidden labels, per-label allowlists (users+teams),
 * the people-column gate, transition rules (incl. the empty≡grey identity where
 * an empty status is governed by the reserved rule '5'), and deactivated labels.
 * Required fields are judged by the same per-type emptiness registry the fill
 * form uses (columnFields.isFieldValueEmpty).
 *
 * Verdicts and their consumers (handleStatusChangeEvent):
 *   { allowed: true,  reason: null }
 *   { allowed: false, reason: 'not-offered' }            → revert
 *   { allowed: false, reason: 'required-fields-empty' }  → revert
 *   { allowed: false, reason: 'required-fields-unknown' }→ do NOT revert (fail-soft):
 *     the rule demands fields but the caller could not READ the item — reverting a
 *     possibly-legal change on our own read failure would punish the user for our
 *     outage. Logged upstream instead.
 *
 * Clearing the status (newLabelId null) is a transition INTO the empty state,
 * which the empty≡grey identity maps to the reserved label id 5: the source
 * rule's nextLabelIds must include '5' (or restrict nothing) and the actor must
 * pass rule '5''s own allowlist + people gate. It is NOT judged via the picker
 * options — an id-5 label need not exist on the column for cells to be cleared.
 *
 * @param {{
 *   settings: object|null,
 *   labels: Array<{ id: string, label?: string, isDeactivated?: boolean }>,
 *   actor: { userId: string, teamIds?: string[] },
 *   previousLabelId: string|null,
 *   newLabelId: string|null,
 *   peopleByColumnId?: Record<string, { personIds: string[], teamIds: string[] }>,
 *   requiredFieldValues?: Array<{ columnId: string, type: string, columnValue: object|null }>|null,
 * }} input
 * @returns {{ allowed: boolean, reason: 'not-offered'|'required-fields-empty'|'required-fields-unknown'|null }}
 */

import { buildAvailableLabels, isActorAllowedForLabel } from '../../../src/domain/buildAvailableLabels.js';
import { isFieldValueEmpty, prefillFieldValue } from '../../../src/domain/columnFields.js';
import { getLabelRule, migrateSettings } from '../../../src/domain/settingsSchema.js';
import { RESERVED_EMPTY_LABEL_ID } from '../../../src/domain/statusColors.js';

export function evaluateStatusChange(input) {
  const {
    settings = null,
    labels = [],
    actor,
    previousLabelId = null,
    newLabelId = null,
    peopleByColumnId = {},
    requiredFieldValues = null,
  } = input ?? {};

  const migrated = migrateSettings(settings);

  // No-op echo: monday should not deliver these, but a same-label event is
  // definitionally not a transition and must never be reverted.
  if (newLabelId !== null && newLabelId === previousLabelId) {
    return { allowed: true, reason: null };
  }

  const targetRuleId = newLabelId ?? String(RESERVED_EMPTY_LABEL_ID);

  if (newLabelId !== null) {
    // The picker's own offer function IS the law — hidden labels, deactivation,
    // allowlists, the people gate, transitions and the empty≡grey identity all
    // come from the one shipped implementation the client uses.
    const { options } = buildAvailableLabels({
      labels,
      settings: migrated,
      actor,
      currentValue: previousLabelId === null ? null : { index: Number(previousLabelId) },
      peopleByColumnId,
    });
    const offered = options.some((label) => String(label.id) === String(newLabelId));
    if (!offered) return { allowed: false, reason: 'not-offered' };
  } else {
    // Clearing the cell = transition INTO the empty state ≡ reserved id 5,
    // judged directly (an id-5 label need not exist on the column): the source
    // rule must allow '5' as a next step, and rule '5''s own allowlist +
    // people gate must pass for the actor.
    const sourceRule = getLabelRule(
      migrated,
      previousLabelId ?? String(RESERVED_EMPTY_LABEL_ID),
    );
    if (Array.isArray(sourceRule.nextLabelIds)
      && !sourceRule.nextLabelIds.map(String).includes(String(RESERVED_EMPTY_LABEL_ID))) {
      return { allowed: false, reason: 'not-offered' };
    }
    const emptyRule = getLabelRule(migrated, String(RESERVED_EMPTY_LABEL_ID));
    if (!isActorAllowedForLabel(emptyRule, actor, { peopleByColumnId })) {
      return { allowed: false, reason: 'not-offered' };
    }
  }

  const targetRule = getLabelRule(migrated, targetRuleId);
  const requiredColumnIds = Array.isArray(targetRule.requiredColumnIds)
    ? targetRule.requiredColumnIds
    : [];
  if (requiredColumnIds.length > 0) {
    if (requiredFieldValues === null) {
      return { allowed: false, reason: 'required-fields-unknown' };
    }
    const byColumnId = new Map(
      (Array.isArray(requiredFieldValues) ? requiredFieldValues : [])
        .map((field) => [String(field.columnId), field]),
    );
    const someEmpty = requiredColumnIds.some((columnId) => {
      const field = byColumnId.get(String(columnId));
      // A required column the caller could not resolve (deleted from the board,
      // unreadable type) counts as EMPTY — same fail-closed rule as the picker.
      if (!field) return true;
      return isFieldValueEmpty(field.type, prefillFieldValue(field.type, field.columnValue));
    });
    if (someEmpty) return { allowed: false, reason: 'required-fields-empty' };
  }

  return { allowed: true, reason: null };
}
