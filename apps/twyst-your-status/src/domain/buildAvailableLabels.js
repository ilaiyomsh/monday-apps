/**
 * buildAvailableLabels — pure filter for which status labels a user may pick.
 *
 * Rules (product contract):
 * - Skip deactivated labels.
 * - Skip hiddenLabelIds (picker-only; current hidden value stays visible read-only).
 * - Missing rule OR empty allowlists → everyone may pick.
 * - Else allow if actor.userId ∈ allowedUserIds OR any actor.teamIds ∈ allowedTeamIds.
 * - Unauthorized labels are omitted (not disabled).
 *
 * Label keys in settings are monday status label **ids** (stable). The status
 * column value's `index` field also carries that id (monday naming quirk).
 */

import { getLabelRule, isOpenAllowlist, migrateSettings } from './settingsSchema.js';

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

export function isActorAllowedForLabel(rule, actor) {
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

/**
 * @param {{
 *   labels: Array<{ id: string, isDeactivated?: boolean, label?: string, color?: string }>,
 *   settings: object|null,
 *   actor: { userId: string, teamIds?: string[] },
 *   currentValue?: object|null,
 * }} input
 */
export function buildAvailableLabels({ labels, settings, actor, currentValue }) {
  const normalizedLabels = Array.isArray(labels) ? labels : [];
  const migrated = migrateSettings(settings);
  const hiddenIds = new Set(migrated?.hiddenLabelIds ?? []);
  const currentLabelId = currentLabelIdFromValue(currentValue);
  const currentLabel = currentLabelId === null
    ? null
    : normalizedLabels.find((label) => String(label.id) === currentLabelId) ?? null;

  const options = normalizedLabels.filter((label) => {
    if (label?.isDeactivated) return false;
    const labelId = String(label.id);
    if (hiddenIds.has(labelId)) return false;
    const rule = getLabelRule(migrated, labelId);
    return isActorAllowedForLabel(rule, actor);
  });

  return {
    currentLabelId,
    currentLabel,
    currentIsHidden: currentLabel !== null && hiddenIds.has(String(currentLabel.id)),
    options,
  };
}
