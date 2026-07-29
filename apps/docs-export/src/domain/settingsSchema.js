/**
 * settingsSchema — the shape of the stored settings blob, and the three questions
 * the rest of the app asks about it: normalize it, validate it, is it usable.
 *
 * The blob lives in `monday.storage` under `docs_export_settings_${instanceId}`,
 * is written by the owner-facing settings panel, and is READ ON EVERY BOOT to
 * gate render. That makes it hostile input for three concrete reasons:
 *
 * 1. **It can be hand-edited** (storage is writable from the CLI/API), so any key
 *    may be missing or hold the wrong type.
 * 2. **A write can land half-done** — `settingsStore.saveSettings` merges a
 *    PARTIAL update, so a blob with `columns.action` and nothing else is normal.
 * 3. **It is versioned data with no server-side schema.** An older bundle can be
 *    served from the CDN cache long after a newer one wrote the blob, so the
 *    normalizer meets FUTURE blobs as well as legacy ones.
 *
 * Consequently `normalizeSettings` NEVER throws and always returns a complete,
 * self-consistent blob; `validateSettings` collects every problem for the panel to
 * display at once; `isConfigured` is the single yes/no the SettingsGate reads.
 *
 * Pure module: no React, no SDK, no logger — so the whole thing is unit-testable
 * and safe to call during boot.
 */

/** The current schema version. Bumping it means adding a step to MIGRATIONS. */
export const SCHEMA_VERSION = 1;

/** The five roles, in the order the settings panel presents them. */
export const COLUMN_ROLES = ['action', 'committee', 'report', 'date', 'person'];

/**
 * The four roles that become table columns, index 0 = the RIGHTMOST cell in the
 * RTL table. `person` is deliberately absent: it scopes the items, it is never
 * rendered.
 */
export const TABLE_ROLES = ['action', 'committee', 'report', 'date'];

/**
 * Upper bound on the block list. Not a technical limit — a guard against a
 * runaway/duplicated write producing a document with thousands of paragraphs.
 */
export const MAX_BLOCKS = 30;

/** The id given to the table block when one has to be synthesised. */
const TABLE_BLOCK_ID = 'table';

const emptyRoleMap = (roles) => Object.fromEntries(roles.map((role) => [role, '']));

/**
 * The blob a brand-new instance starts from. Deep-frozen: it is module state, and
 * a caller that mutated it would corrupt every later `normalizeSettings()` call.
 * Callers get a fresh copy from `normalizeSettings`, never this object.
 */
export const DEFAULT_SETTINGS = deepFreeze({
  version: SCHEMA_VERSION,
  boardId: '',
  columns: emptyRoleMap(COLUMN_ROLES),
  headers: emptyRoleMap(TABLE_ROLES),
  mergeAction: true,
  mergeCommittee: true,
  weekStartsOn: 0, // Sunday — the Israeli work week
  // A report without a table is meaningless, so the default already contains the
  // single table block; the panel only ever adds text around it.
  blocks: [{ id: TABLE_BLOCK_ID, type: 'table' }],
});

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** A stored id/label as a trimmed string: '' for anything that is not scalar. */
function str(value) {
  if (value == null) return '';
  // Objects (and arrays) are junk in an id/label slot — a stored `{id:'x'}` must
  // not become the string "[object Object]", which would look like a real id.
  if (typeof value === 'object') return '';
  return String(value).trim();
}

/**
 * Truthiness with the ONE special case storage produces: JSON round-trips are
 * lossless, but a hand-written or form-serialized blob can hold the STRING
 * "false", which is truthy and would silently re-enable a merge the owner turned
 * off.
 */
function bool(value, fallback) {
  if (value === undefined) return fallback;
  if (value === 'false') return false;
  if (value === 'true') return true;
  return Boolean(value);
}

/** 0..6, or Sunday for anything else. */
function weekday(value, fallback) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 6) return fallback;
  return n;
}

/**
 * Version migrations, keyed by the version being migrated FROM. Each step takes a
 * raw blob and returns a raw blob one version newer; field normalization happens
 * afterwards, so a step only has to move/rename data.
 *
 * Step 0 → 1 exists because the first shipped blobs carried no `version` key at
 * all; their field names already match v1, so the step is a pass-through that
 * only stamps the version. Real renames go here, not into the normalizer.
 */
const MIGRATIONS = {
  0: (raw) => ({ ...raw }),
};

/** The version of a raw blob: a positive integer, or 0 for missing/junk. */
function rawVersion(raw) {
  const n = Number(raw?.version);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/** One valid block, or null when the entry is not a block at all. */
function normalizeBlock(raw, id) {
  if (!isPlainObject(raw)) return null;
  if (raw.type === 'table') return { id, type: 'table' };
  if (raw.type !== 'text') return null;
  // A text block with no text is a legitimate blank paragraph, so it survives —
  // but as '' rather than undefined, which the docx builder would render as
  // "undefined".
  return { id, type: 'text', text: raw.text == null ? '' : String(raw.text) };
}

/**
 * `preferred` when it is free, otherwise the first free `block-<n>`.
 *
 * The loop is the point. Every id the entry loop hands out is checked against
 * `usedIds`, and the synthesised table block must be held to the same standard: a
 * duplicate id is not cosmetic here, because the settings panel addresses blocks BY
 * ID and `blockOps.deleteBlock` filters on it — so a text block sharing the table
 * block's id makes deleting that text block silently delete the TABLE too, leaving
 * a blob that `isConfigured` rejects. A single unchecked guess is what caused
 * exactly that.
 */
function freeId(usedIds, preferred) {
  if (!usedIds.has(preferred)) return preferred;
  let n = usedIds.size;
  while (usedIds.has(`block-${n}`)) n += 1;
  return `block-${n}`;
}

/**
 * The block list: valid entries only, unique ids, EXACTLY one table block, at most
 * MAX_BLOCKS entries.
 *
 * Two deliberate repairs:
 * - **Two table blocks** (a duplicated write, or a hand-edit) → keep the FIRST and
 *   drop the rest. The first is where the owner put it; a second table would
 *   render the same rows twice.
 * - **Capping** drops TRAILING TEXT blocks only. The table block is not optional,
 *   so it survives the cap even when it sits last (a text-heavy blob).
 */
function normalizeBlocks(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const blocks = [];
  const usedIds = new Set();
  let sawTable = false;

  list.forEach((entry, index) => {
    if (isPlainObject(entry) && entry.type === 'table') {
      if (sawTable) return;
      sawTable = true;
    }
    // Reuse the stored id when it is a usable, not-yet-taken string; otherwise
    // synthesise a positional one. Duplicate ids break React keys AND make the
    // panel's "edit block N" address the wrong block.
    const storedId = str(entry?.id);
    const id = storedId && !usedIds.has(storedId) ? storedId : `block-${index}`;
    const block = normalizeBlock(entry, usedIds.has(id) ? `block-${index}-${blocks.length}` : id);
    if (!block) return;
    usedIds.add(block.id);
    blocks.push(block);
  });

  if (!sawTable) {
    blocks.push({ id: freeId(usedIds, TABLE_BLOCK_ID), type: 'table' });
  }

  // Cap from the END, skipping the table block.
  for (let i = blocks.length - 1; i >= 0 && blocks.length > MAX_BLOCKS; i -= 1) {
    if (blocks[i].type !== 'table') blocks.splice(i, 1);
  }

  return blocks;
}

/**
 * A complete, self-consistent settings blob built from whatever was stored.
 *
 * Never throws: a boot-path read must degrade to "unconfigured", never to a crash.
 *
 * @param {*} raw The parsed storage value — any shape, including null.
 * @returns {{version: number, boardId: string, columns: Object, headers: Object,
 *   mergeAction: boolean, mergeCommittee: boolean, weekStartsOn: number,
 *   blocks: Array<{id: string, type: 'text'|'table', text?: string}>}}
 */
export function normalizeSettings(raw) {
  let blob = isPlainObject(raw) ? raw : {};

  // Walk the migration chain from the blob's own version up to ours.
  let version = rawVersion(blob);
  while (version < SCHEMA_VERSION && MIGRATIONS[version]) {
    const migrated = MIGRATIONS[version](blob);
    if (isPlainObject(migrated)) blob = migrated;
    version += 1;
  }

  // A blob written by a NEWER bundle keeps its own version and its unknown keys:
  // re-stamping it as SCHEMA_VERSION would make the newer bundle run its
  // migration a second time on the next boot, and dropping the keys would delete
  // data this build simply does not understand yet.
  const isFuture = version > SCHEMA_VERSION;
  const passthrough = isFuture ? { ...blob } : {};
  delete passthrough.version;
  for (const key of Object.keys(DEFAULT_SETTINGS)) delete passthrough[key];

  const columns = emptyRoleMap(COLUMN_ROLES);
  for (const role of COLUMN_ROLES) columns[role] = str(blob.columns?.[role]);

  const headers = emptyRoleMap(TABLE_ROLES);
  for (const role of TABLE_ROLES) headers[role] = str(blob.headers?.[role]);

  return {
    ...passthrough,
    version: isFuture ? version : SCHEMA_VERSION,
    boardId: str(blob.boardId),
    columns,
    headers,
    mergeAction: bool(blob.mergeAction, DEFAULT_SETTINGS.mergeAction),
    mergeCommittee: bool(blob.mergeCommittee, DEFAULT_SETTINGS.mergeCommittee),
    weekStartsOn: weekday(blob.weekStartsOn, DEFAULT_SETTINGS.weekStartsOn),
    blocks: normalizeBlocks(blob.blocks),
  };
}

/** How many table blocks a RAW block list holds (validate sees raw input). */
function countTableBlocks(raw) {
  if (!Array.isArray(raw)) return 0;
  return raw.filter((b) => isPlainObject(b) && b.type === 'table').length;
}

/**
 * Can the app run at all with this blob? The SettingsGate's single question.
 *
 * Reads defensively (raw or normalized), because the gate runs before anything
 * else and must not care which it was handed.
 *
 * @param {*} s
 * @returns {boolean}
 */
export function isConfigured(s) {
  if (!isPlainObject(s)) return false;
  if (!str(s.boardId)) return false;
  for (const role of COLUMN_ROLES) {
    if (!str(s.columns?.[role])) return false;
  }
  return countTableBlocks(s.blocks) === 1;
}

/**
 * Every problem with the blob, for the settings panel to display at once.
 *
 * Messages are Hebrew: they are shown verbatim in the owner-facing panel (this app
 * is Hebrew-first; `t()` serves only the error/toast layer).
 *
 * What it CANNOT check: column TYPES. The blob holds ids only, so "committee must
 * be a mirror" is the panel's job — it has the board's column list.
 *
 * @param {*} s
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateSettings(s) {
  const errors = [];
  if (!isPlainObject(s)) {
    return { ok: false, errors: ['ההגדרות לא נטענו (blob לא תקין) — יש להגדיר את האפליקציה מחדש'] };
  }

  if (!str(s.boardId)) errors.push('לא נבחר לוח יעד (boardId)');

  const ROLE_LABELS = {
    action: 'פעולה (action)',
    committee: 'שם הועדה האזורית (committee)',
    report: 'דיווח (report)',
    date: 'תאריך דיווח (date)',
    person: 'אחראי דיווח (person)',
  };
  for (const role of COLUMN_ROLES) {
    if (!str(s.columns?.[role])) errors.push(`לא מופתה עמודה לתפקיד ${ROLE_LABELS[role]}`);
  }

  // The same column in two roles is a mapping mistake, not a feature: the four
  // table roles would render duplicate cells, and `person`/`date` double as
  // FILTERS, so sharing one column silently changes what the report scopes to.
  const seen = new Map();
  for (const role of COLUMN_ROLES) {
    const id = str(s.columns?.[role]);
    if (!id) continue;
    if (seen.has(id)) {
      errors.push(`העמודה "${id}" מופתה גם ל-${ROLE_LABELS[seen.get(id)]} וגם ל-${ROLE_LABELS[role]}`);
    } else {
      seen.set(id, role);
    }
  }

  const tables = countTableBlocks(s.blocks);
  if (tables !== 1) {
    errors.push(`על רשימת הבלוקים להכיל בלוק טבלה אחד בדיוק (נמצאו ${tables})`);
  }

  if (Array.isArray(s.blocks) && s.blocks.length > MAX_BLOCKS) {
    errors.push(`יותר מ-${MAX_BLOCKS} בלוקים (${s.blocks.length}) — יש למחוק בלוקים`);
  }

  if (s.weekStartsOn !== undefined && weekday(s.weekStartsOn, null) === null) {
    errors.push('יום תחילת השבוע חייב להיות מספר שלם בין 0 (ראשון) ל-6 (שבת)');
  }

  return { ok: errors.length === 0, errors };
}
