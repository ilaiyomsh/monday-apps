/**
 * The five column roles as the SETTINGS PANEL sees them: Hebrew labels, the
 * column types that make sense per role, and the "is this pick sensible?" answer.
 *
 * @module components/SettingsPanel/roleTypes
 *
 * Deliberately a soft filter, not a hard one. `domain/settingsSchema.js` cannot
 * check types (the blob stores ids only), and monday boards carry types this app
 * has never seen — a `formula` that renders a date, a `lookup` behaving like a
 * mirror, a mirror of a mirror. Blocking those would strand the owner with a
 * board the app refuses to configure. So the panel SORTS the sensible columns
 * first and WARNS on an odd pick, and the owner always gets the last word.
 *
 * Pure module: no React, no SDK, no logger.
 */
import { COLUMN_ROLES, TABLE_ROLES } from '../../domain/settingsSchema.js';

/**
 * One entry per role, in `COLUMN_ROLES` order (the order the panel renders).
 *
 * `types: null` means "no opinion" — used for `action`, which is documented as
 * "any column type": the action is whatever the board calls it, and boards in the
 * wild use text, status, a dropdown, or the item name itself.
 *
 * `lookup` sits next to `mirror` for `committee` because monday's API answers
 * with either depending on how the column was created; both deliver a
 * `MirrorValue`-shaped payload that `domain/committees.js` can read.
 *
 * `tableRole` is derived from `TABLE_ROLES` rather than restated, so a schema
 * change cannot leave a stale flag behind.
 */
const LABELS = {
  action: 'פעולה',
  committee: 'שם הועדה האזורית',
  report: 'דיווח',
  date: 'תאריך דיווח',
  person: 'עמודת האחראי',
};

const PREFERRED_TYPES = {
  action: null,
  committee: ['mirror', 'lookup'],
  report: ['text', 'long_text'],
  date: ['date'],
  person: ['people', 'person', 'multiple_person'],
};

/** What each role is FOR, shown under its dropdown so the owner can self-serve. */
const HINTS = {
  action: 'עמודה 1 בטבלה (הימנית ביותר). שורות עוקבות עם אותו ערך ימוזגו לתא אחד.',
  committee: 'עמודה 2 בטבלה, וגם רשימת הועדות שממנה המשתמש בוחר. חייבת להיות עמודת מירור.',
  report: 'עמודה 3 בטבלה — תוכן הדיווח.',
  date: 'עמודה 4 בטבלה, וגם הסינון לטווח היומי/שבועי.',
  person: 'לא מופיעה בטבלה. כל משתמש רואה רק פריטים שהוא מופיע בעמודה הזו — כולל בעלי הלוח.',
};

export const ROLE_META = COLUMN_ROLES.map((role) => ({
  role,
  label: LABELS[role],
  hint: HINTS[role],
  types: PREFERRED_TYPES[role],
  tableRole: TABLE_ROLES.includes(role),
}));

const META_BY_ROLE = new Map(ROLE_META.map((entry) => [entry.role, entry]));

/**
 * The metadata for one role, or undefined when it is not one of the five.
 * @param {string} role
 * @returns {{role: string, label: string, hint: string, types: string[]|null, tableRole: boolean}|undefined}
 */
export function roleMeta(role) {
  return META_BY_ROLE.get(role);
}

/**
 * Split the board's columns into the ones that fit this role and the rest, each
 * keeping the board's own column order (which is the order the owner sees on the
 * board, so it is the only order they can navigate by).
 *
 * A role with no type opinion — and an unrecognised role — puts EVERYTHING in
 * `preferred`: the alternative is a dropdown that silently hides the board.
 *
 * @param {Array<{id: string, title: string, type: string}>} [columns]
 * @param {string} role
 * @returns {{preferred: Array<Object>, other: Array<Object>}}
 */
export function partitionColumnsForRole(columns, role) {
  const list = Array.isArray(columns) ? columns : [];
  const types = roleMeta(role)?.types;
  if (!types) return { preferred: [...list], other: [] };

  const preferred = [];
  const other = [];
  for (const column of list) {
    (types.includes(column?.type) ? preferred : other).push(column);
  }
  return { preferred, other };
}

/**
 * The Hebrew warning for an odd pick, or '' when there is nothing to warn about.
 *
 * Returning '' (never null) so the caller can render it unconditionally — the
 * same contract `domain/columnText.js` uses for cell text.
 *
 * @param {string} role
 * @param {{id: string, title: string, type: string}} [column] - the CHOSEN column
 * @returns {string}
 */
export function typeWarning(role, column) {
  if (!column) return '';
  const meta = roleMeta(role);
  if (!meta?.types) return '';
  if (meta.types.includes(column.type)) return '';

  const name = column.title || column.id;
  return (
    `העמודה "${name}" היא מסוג ${column.type} — ` +
    `לתפקיד "${meta.label}" מתאימות עמודות מסוג ${meta.types.join(' / ')}. ` +
    'ניתן להמשיך, אך ייתכן שהדוח יציג ערכים ריקים.'
  );
}

/**
 * What a table header will actually read: the owner's override when they set one,
 * otherwise the mapped board column's title.
 *
 * Trims, so a header of spaces is treated as "not set" — the panel's draft has not
 * been through `normalizeSettings` yet, so the padding is still here.
 *
 * @param {Object} [settings] - a settings blob or the panel's draft
 * @param {string} role - one of the four TABLE_ROLES
 * @param {Array<{id: string, title: string}>} [columns] - the board's columns
 * @returns {string}
 */
export function resolveHeader(settings, role, columns) {
  const override = String(settings?.headers?.[role] ?? '').trim();
  if (override) return override;

  const columnId = settings?.columns?.[role];
  if (!columnId) return '';
  const list = Array.isArray(columns) ? columns : [];
  const column = list.find((c) => c?.id === columnId);
  return column?.title ? String(column.title) : '';
}

/**
 * One dropdown option's text: the column title plus its monday type, because two
 * columns on the same board routinely share a title ("תאריך" as both a date and a
 * mirror) and the type is the only thing that tells them apart.
 *
 * @param {{id: string, title: string, type: string}} [column]
 * @returns {string}
 */
export function columnLabel(column) {
  if (!column) return '';
  return `${column.title || column.id} (${column.type})`;
}
