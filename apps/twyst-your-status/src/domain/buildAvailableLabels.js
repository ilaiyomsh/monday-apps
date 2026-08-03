/**
 * buildAvailableLabels — pure filter for which status labels a user may pick.
 *
 * Rules (product contract):
 * - Skip deactivated labels.
 * - Skip hiddenLabelIds (picker-only; current metadata still returned for UI notes).
 * - Skip the currently selected label — no reason to re-pick the same status.
 * - Missing rule OR empty allowlists → everyone may pick (subject to people gate).
 * - Else allow if actor.userId ∈ allowedUserIds OR any actor.teamIds ∈ allowedTeamIds.
 * - If requiredPeopleColumnIds is set: actor must appear in EACH listed people
 *   column (as a person / agent id, or as a member of a team listed there).
 * - Unauthorized labels are omitted (not disabled).
 *
 * Label keys in settings are monday status label **ids** (stable). The status
 * column value's `index` field also carries that id (monday naming quirk).
 */

import { actorMatchesPeopleAssignments } from './peopleColumnGate.js';
import { getLabelRule, isOpenAllowlist, migrateSettings } from './settingsSchema.js';
import { RESERVED_EMPTY_LABEL_ID } from './statusColors.js';

function normalizeNonNegativeInteger(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

export function currentLabelIdFromValue(currentValue) {
  const directIndex = normalizeNonNegativeInteger(currentValue?.index);
  if (directIndex !== null) return String(directIndex);

  if (typeof currentValue?.value !== 'string') return null;
  const serializedIndex = currentValue.value.match(/"index"\s*:\s*(\d+)/);
  if (!serializedIndex) return null;

  const fallbackIndex = normalizeNonNegativeInteger(serializedIndex[1]);
  return fallbackIndex === null ? null : String(fallbackIndex);
}

function passesAllowlist(rule, actor) {
  if (isOpenAllowlist(rule)) return true;

  const userId = actor?.userId == null ? null : String(actor.userId).trim();
  const teamIds = (Array.isArray(actor?.teamIds) ? actor.teamIds : [])
    .map((id) => String(id).trim())
    .filter(Boolean);

  const allowedUsers = new Set(rule.allowedUserIds.map(String));
  const allowedTeams = new Set(rule.allowedTeamIds.map(String));

  if (userId && allowedUsers.has(userId)) return true;
  return teamIds.some((teamId) => allowedTeams.has(teamId));
}

function passesPeopleColumnGate(rule, actor, itemContext) {
  const gateIds = Array.isArray(rule?.requiredPeopleColumnIds)
    ? rule.requiredPeopleColumnIds
    : [];
  if (gateIds.length === 0) return true;

  const peopleByColumnId = itemContext?.peopleByColumnId ?? {};
  return gateIds.every((columnId) => {
    const assignments = peopleByColumnId[columnId]
      ?? peopleByColumnId[String(columnId)]
      ?? null;
    return actorMatchesPeopleAssignments(actor, assignments);
  });
}

/**
 * @param {object} rule
 * @param {{ userId: string, teamIds?: string[] }} actor
 * @param {{ peopleByColumnId?: Record<string, { personIds: string[], teamIds: string[] }> }} [itemContext]
 */
export function isActorAllowedForLabel(rule, actor, itemContext = {}) {
  if (!passesAllowlist(rule, actor)) return false;
  return passesPeopleColumnGate(rule, actor, itemContext);
}

/**
 * @param {{
 *   labels: Array<{ id: string, isDeactivated?: boolean, label?: string, color?: string }>,
 *   settings: object|null,
 *   actor: { userId: string, teamIds?: string[] },
 *   currentValue?: object|null,
 *   peopleByColumnId?: Record<string, { personIds: string[], teamIds: string[] }>,
 * }} input
 */
export function buildAvailableLabels({
  labels,
  settings,
  actor,
  currentValue,
  peopleByColumnId,
}) {
  const normalizedLabels = Array.isArray(labels) ? labels : [];
  const migrated = migrateSettings(settings);
  const hiddenIds = new Set(migrated?.hiddenLabelIds ?? []);
  const currentLabelId = currentLabelIdFromValue(currentValue);
  const currentLabel = currentLabelId === null
    ? null
    : normalizedLabels.find((label) => String(label.id) === currentLabelId) ?? null;
  const itemContext = { peopleByColumnId: peopleByColumnId ?? {} };

  /*
   * round321 — transition restriction. The SOURCE of the transition is the current
   * label; an EMPTY status resolves to the reserved default id (5), because the grey
   * default label is that state's face on the board — an item explicitly holding the
   * id-5 label lands on the same rule directly, which is the point. A source rule
   * with no `nextLabelIds` array (every pre-round321 blob) restricts nothing.
   */
  const sourceRule = getLabelRule(migrated, currentLabelId ?? String(RESERVED_EMPTY_LABEL_ID));
  const allowedNext = Array.isArray(sourceRule.nextLabelIds)
    ? new Set(sourceRule.nextLabelIds.map(String))
    : null;

  const options = normalizedLabels.filter((label) => {
    if (label?.isDeactivated) return false;
    const labelId = String(label.id);
    if (currentLabelId !== null && labelId === currentLabelId) return false;
    /*
     * The empty≡grey identity, completed on the OPTIONS side (round321 review):
     * an empty status already LOOKS like the id-5 label, so that label is its
     * "current" one and is excluded exactly as every non-empty status excludes its
     * own. Without this, the named grey label was offered from empty cells right up
     * until the default card carried any restriction — at which point it vanished,
     * with no checkbox anywhere that could bring it back ('5' cannot be a target on
     * its own card).
     */
    if (currentLabelId === null && labelId === String(RESERVED_EMPTY_LABEL_ID)) return false;
    if (hiddenIds.has(labelId)) return false;
    // Composes with (never replaces) the filters below: a listed-but-hidden label
    // stays hidden, a listed label outside the actor's allowlist stays blocked.
    if (allowedNext !== null && !allowedNext.has(labelId)) return false;
    const rule = getLabelRule(migrated, labelId);
    return isActorAllowedForLabel(rule, actor, itemContext);
  });

  return {
    currentLabelId,
    currentLabel,
    currentIsHidden: currentLabel !== null && hiddenIds.has(String(currentLabel.id)),
    options,
  };
}
