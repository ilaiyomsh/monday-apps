/**
 * bypassReason — turns a guard verdict into the human-readable record the
 * monitor shows (round323). PURE. Two jobs:
 *
 *  1. classifyViolation(input, verdict) → { code, allowed?, fields?, ... }:
 *     the guard's verdict is a coarse reason ('not-offered' /
 *     'required-fields-empty'); this re-derives WHICH specific rule the change
 *     broke — hidden label, disallowed transition (with the labels that WERE
 *     allowed), actor not on the allowlist, people-column gate, or empty
 *     required fields (named) — so the owner sees why, not just that.
 *
 *  2. describeViolation(classification, labelsById) → Hebrew technical text,
 *     the same phrasing the approved prototype used, with label ids resolved
 *     to names.
 *
 *  3. estimateSurface(app) → 'api' | 'native': the change_status_column_value
 *     webhook carries an `app` field but NOT the client surface. We can only
 *     honestly split "came through the API / an integration" from "a native
 *     editor" — NOT mobile vs cold-load-window, which the payload cannot tell
 *     apart. The monitor labels these two buckets and says no more.
 *
 * classifyViolation reuses the shipped rule modules (buildAvailableLabels et al.)
 * as the source of truth, then reads the settings to attribute the specific
 * cause — it never re-implements the rules.
 */

import { isActorAllowedForLabel } from './buildAvailableLabels.js';
import { getLabelRule, migrateSettings } from './settingsSchema.js';
import { RESERVED_EMPTY_LABEL_ID } from './statusColors.js';

/**
 * @param {{ settings, labels, actor, previousLabelId, newLabelId, peopleByColumnId, emptyFieldIds? }} input
 * @param {{ reason: string }} verdict
 * @returns {{ code: 'hidden'|'transition'|'allowlist'|'people'|'required'|'unknown', allowed?: string[], fields?: string[], peopleColumnId?: string, labelId?: string }}
 */
export function classifyViolation(input, verdict) {
  const { settings, actor, previousLabelId, newLabelId, peopleByColumnId = {}, emptyFieldIds = [] } = input ?? {};
  const migrated = migrateSettings(settings);
  const targetId = newLabelId ?? String(RESERVED_EMPTY_LABEL_ID);

  if (verdict?.reason === 'required-fields-empty') {
    return { code: 'required', fields: emptyFieldIds.map(String), labelId: targetId };
  }

  // not-offered → find the FIRST rule (in the picker's own order) that rejects.
  const migratedHidden = new Set(migrated?.hiddenLabelIds ?? []);
  if (newLabelId !== null && migratedHidden.has(String(newLabelId))) {
    return { code: 'hidden', labelId: String(newLabelId) };
  }

  // Transition: the SOURCE rule (previous label, or reserved '5' for empty) has
  // a nextLabelIds list that excludes the target.
  const sourceId = previousLabelId ?? String(RESERVED_EMPTY_LABEL_ID);
  const sourceRule = getLabelRule(migrated, sourceId);
  if (Array.isArray(sourceRule.nextLabelIds) && !sourceRule.nextLabelIds.map(String).includes(String(targetId))) {
    return { code: 'transition', allowed: sourceRule.nextLabelIds.map(String), labelId: targetId, sourceId: String(sourceId) };
  }

  // Allowlist vs people-gate: split the target rule's two gates.
  const targetRule = getLabelRule(migrated, targetId);
  const peopleGate = Array.isArray(targetRule.requiredPeopleColumnIds) ? targetRule.requiredPeopleColumnIds : [];
  // Allowlist alone (people gate momentarily satisfied) failing ⇒ allowlist.
  const allowlistOnly = { ...targetRule, requiredPeopleColumnIds: [] };
  if (!isActorAllowedForLabel(allowlistOnly, actor, { peopleByColumnId })) {
    return { code: 'allowlist', labelId: targetId };
  }
  if (peopleGate.length > 0) {
    const failedColumn = peopleGate.find((columnId) => !isActorAllowedForLabel(
      { ...targetRule, allowedUserIds: [], allowedTeamIds: [], requiredPeopleColumnIds: [columnId] },
      actor,
      { peopleByColumnId },
    ));
    if (failedColumn !== undefined) return { code: 'people', peopleColumnId: String(failedColumn), labelId: targetId };
  }

  return { code: 'unknown', labelId: targetId };
}

const nameOf = (labelsById, id) => labelsById?.[String(id)] ?? `#${id}`;

/**
 * @param {object} c - a classifyViolation result
 * @param {Record<string,string>} labelsById - label id → display name
 * @param {Record<string,string>} [columnsById] - column id → title (for gates/fields)
 * @param {string} [actorName]
 * @returns {string} Hebrew technical explanation
 */
export function describeViolation(c, labelsById = {}, columnsById = {}, actorName = 'המשתמש') {
  const target = nameOf(labelsById, c.labelId);
  if (c.code === 'transition') {
    const allowed = (c.allowed ?? []).map((id) => `"${nameOf(labelsById, id)}"`).join(', ') || '— אף לייבל —';
    return `אחרי הלייבל "${nameOf(labelsById, c.sourceId)}" ההגדרות מתירות מעבר רק אל: ${allowed}. הלייבל "${target}" אינו ברשימה, ולכן הבורר לא היה מציע את המעבר הזה.`;
  }
  if (c.code === 'hidden') {
    return `הלייבל "${target}" מסומן כמוסתר בבורר. האפליקציה לא מציעה אותו לבחירה כלל, אך השינוי הנייטיבי עקף את ההסתרה.`;
  }
  if (c.code === 'allowlist') {
    return `הלייבל "${target}" מוגבל לאנשים/צוותים מורשים בלבד. ${actorName} אינו ברשימת המורשים, כך שהבורר לא היה מציע לו את הלייבל.`;
  }
  if (c.code === 'people') {
    const col = columnsById?.[String(c.peopleColumnId)] ?? `#${c.peopleColumnId}`;
    return `המעבר ל-"${target}" מחייב ש${actorName} יופיע בעמודת האנשים "${col}" של האייטם — והוא אינו מופיע שם.`;
  }
  if (c.code === 'required') {
    const fields = (c.fields ?? []).map((id) => `"${columnsById?.[String(id)] ?? `#${id}`}"`).join(', ');
    return `המעבר ל-"${target}" מחייב מילוי שדות חובה: ${fields}. הם היו ריקים בזמן השינוי, כך שהבורר היה חוסם את המעבר עד למילוי.`;
  }
  return `השינוי ל-"${target}" אינו עומד בהגדרות שנקבעו לעמודה, כך שהבורר לא היה מאפשר אותו.`;
}

/**
 * Honest, coarse source classification. The webhook's `app` field is the only
 * client signal, and it can distinguish an API/integration write from a native
 * one — nothing finer (mobile and the cold-load window are both native and
 * indistinguishable here).
 * @param {string|null|undefined} app
 * @returns {'api'|'native'}
 */
export function estimateSurface(app) {
  const a = String(app ?? '').trim().toLowerCase();
  if (a === '' || a === 'monday') return 'native';
  return 'api';
}
