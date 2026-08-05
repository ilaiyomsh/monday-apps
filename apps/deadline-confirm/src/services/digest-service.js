// Digest core (v4 phase 1, owner decisions 2026-07-19) — PURE functions.
// Matching model: a dedicated USERS BOARD (people column + email column) maps
// ONE person id -> recipient email; tasks come from the configured tasks
// board, matched by person-id membership on config.peopleColumnId.
//
// V6 D16 (2026-07-27): one message per users-board row. A recipient carries a
// SINGLE personId (signed into the manifest; drives D11). Rows with ≠1 person
// are skipped as `multi_person`. Email dedup is gone — two rows sharing an
// address produce two independent messages.
//
// Pending semantics (per section, owner decision 2026-07-20):
//   date set AND date <= today (a past date INCLUDES today) AND the task's
//   status (on the section button's status column) is one of the section's
//   includeStatusLabelIds ("show by status" — only listed statuses enter).
// Label id 0 is valid — never truthy-check. An unset status (null) matches
// nothing, so it is excluded unless the board uses a real "not started" label.

import { normalizeDigestBlocks, sectionsFromBlocks } from './digest-blocks.js';

/**
 * The digest's clusters, as sections.
 *
 * SINGLE SOURCE OF TRUTH (0.14.0): when the digest carries `blocks`, the
 * clusters — and their ORDER, which is their priority — come from there. The
 * stored `sections` array is a projection the server writes alongside them
 * (older server versions and this module's callers read it), so trusting it
 * over the blocks would let the two disagree: a config imported or hand-edited
 * with a stale `sections` copy would classify tasks in one order and render
 * them in another. A digest with no `blocks` key is pre-0.14.0 — then
 * `sections` IS the truth.
 *
 * @param {object|null|undefined} digest
 * @returns {Array<object>}
 */
export function digestSections(digest) {
  if (Array.isArray(digest?.blocks)) return sectionsFromBlocks(normalizeDigestBlocks(digest));
  return digest?.sections ?? [];
}

/**
 * Column ids the tasks-board read needs (people + every section date +
 * every referenced button's status column), deduped.
 * @param {object} config
 * @returns {string[]}
 */
export function digestTaskColumnIds(config) {
  const buttonsById = new Map((config.buttons ?? []).map((b) => [b.id, b]));
  const ids = new Set([config.peopleColumnId]);
  for (const section of digestSections(config.digest)) {
    ids.add(section.dateColumnId);
    const btnIds =
      Array.isArray(section.buttonIds) && section.buttonIds.length > 0
        ? section.buttonIds
        : section.buttonId
          ? [section.buttonId]
          : [];
    for (const bid of btnIds) {
      const button = buttonsById.get(bid);
      if (button) ids.add(button.statusColumnId);
    }
  }
  ids.delete(null);
  ids.delete(undefined);
  return [...ids];
}

/**
 * Button ids offered for a section (multi with singular fallback).
 * @param {object} section
 * @returns {string[]}
 */
export function sectionActionButtonIds(section) {
  if (Array.isArray(section.buttonIds) && section.buttonIds.length > 0) {
    return section.buttonIds.filter((id) => typeof id === 'string' && id.length > 0);
  }
  return section.buttonId ? [section.buttonId] : [];
}

/**
 * Attach full ActionButton objects for AMP/plain renderers.
 * @param {object} recipient
 * @param {Map<string, object>} buttonsById
 */
export function decorateRecipientSections(recipient, buttonsById) {
  return {
    ...recipient,
    sections: (recipient.sections ?? []).map((s) => {
      const buttonIds = sectionActionButtonIds(s);
      const buttons = buttonIds.map((id) => buttonsById.get(id)).filter(Boolean);
      return {
        ...s,
        buttonIds,
        button: buttons[0] ?? buttonsById.get(s.buttonId),
        buttons,
      };
    }),
  };
}

function col(item, columnId) {
  return item.columns?.[columnId] ?? { text: '', statusLabelId: null, date: null, personIds: [] };
}

/**
 * Unique date columns from digest settings (first title wins per id).
 * @param {object} digest
 * @returns {Array<{ id: string, title: string }>}
 */
function collectDigestDateColumns(digest) {
  /** @type {Array<{ id: string, title: string }>} */
  const cols = [];
  const seen = new Set();
  for (const section of digestSections(digest)) {
    const id = section.dateColumnId;
    if (typeof id !== 'string' || id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    cols.push({ id, title: section.dateColumnTitle ?? '' });
  }
  return cols;
}

/**
 * Snapshot every digest date-column value on a task (null when unset).
 * @param {object} task
 * @param {Array<{ id: string }>} dateColumns
 * @returns {Record<string, string|null>}
 */
function snapshotTaskDates(task, dateColumns) {
  /** @type {Record<string, string|null>} */
  const dates = {};
  for (const dc of dateColumns) {
    dates[dc.id] = col(task, dc.id).date;
  }
  return dates;
}

/**
 * @param {object} p
 * @param {object} p.config - full app config (digest + buttons + peopleColumnId)
 * @param {Array<object>} p.tasks - normalized items of the tasks board
 * @param {Array<object>} p.users - normalized items of the users board
 * @param {string} p.today - YYYY-MM-DD
 * @param {Record<string, Record<string, string>>} [p.statusColumnColors] - real
 *   board label colors ({ columnId → { labelId → hex } }) from
 *   getBoardItems on the TASKS board; optional — absent keeps the renderers
 *   on their config-color fallback exactly as before.
 * @returns {{ recipients: Array<object>, skippedUsers: Array<object> }}
 */
export function buildDigest({ config, tasks, users, today, statusColumnColors }) {
  const { digest } = config;
  const buttonsById = new Map((config.buttons ?? []).map((b) => [b.id, b]));
  const dateColumns = collectDigestDateColumns(digest);
  // Blocks first, `sections` only for a pre-0.14.0 digest — see digestSections.
  // NAMED configSections deliberately: the per-recipient loop below builds its
  // own local `sections` (the output), and shadowing this one there silently
  // classifies against an empty list.
  const configSections = digestSections(digest);

  // --- users board -> recipients (D16: one row = one message) --------------
  /** @type {Array<{ email: string, name: string, personId: string }>} */
  const userRecipients = [];
  const skippedUsers = [];
  for (const row of users) {
    const personIds = col(row, digest.usersPeopleColumnId).personIds ?? [];
    const email = (col(row, digest.usersEmailColumnId).text ?? '').trim();
    if (!email) {
      skippedUsers.push({ itemId: row.id, name: row.name, reason: 'no_email' });
      continue;
    }
    if (personIds.length === 0) {
      skippedUsers.push({ itemId: row.id, name: row.name, reason: 'no_person' });
      continue;
    }
    if (personIds.length > 1) {
      skippedUsers.push({ itemId: row.id, name: row.name, reason: 'multi_person' });
      continue;
    }
    userRecipients.push({ email, name: row.name, personId: personIds[0] });
  }

  // --- classify every task once per section ---------------------------------
  // pendingBySection: sectionId -> [{ task, personIds }]
  const pendingBySection = new Map();
  for (const section of configSections) {
    const button = buttonsById.get(section.buttonId);
    if (!button) continue; // config validation prevents this; defensive skip
    const includeSet = new Set(section.includeStatusLabelIds ?? []);
    const pending = [];
    for (const task of tasks) {
      const date = col(task, section.dateColumnId).date;
      if (!date || date > today) continue; // future only — today counts as passed
      const statusLabelId = col(task, button.statusColumnId).statusLabelId;
      // "show by status": only statuses the section lists enter the digest
      // (label id 0 is valid — Set membership, never truthy-check).
      if (statusLabelId === null || !includeSet.has(statusLabelId)) continue;
      pending.push({
        itemId: task.id,
        name: task.name,
        date,
        dates: snapshotTaskDates(task, dateColumns),
        statusText: col(task, button.statusColumnId).text ?? '',
        // Real board color for the CURRENT label (section primary button's
        // status column). Unknown label / missing settings → undefined, and
        // the renderer falls back exactly as before.
        statusColor: statusColumnColors?.[button.statusColumnId]?.[statusLabelId],
        personIds: col(task, config.peopleColumnId).personIds ?? [],
      });
    }
    pendingBySection.set(section.id, pending);
  }

  // --- assemble per-recipient digests ---------------------------------------
  // R2 invariant (v6 §6): a recipient's digest contains ONLY tasks assigned
  // to that recipient — R1/R2 and the attribution wording depend on it.
  const recipients = [];
  for (const r of userRecipients) {
    const sections = [];
    let taskCount = 0;
    // Section order = priority (owner decision 2026-08-04): the first section in
    // config order claims a matching task; later sections skip it. One row per
    // task per email — the same item can never carry two dropdowns, so a rendered
    // message cannot produce a conflict_item. Per-recipient (not in the Phase-A
    // classification) so the rule survives any future recipient-dependent filter.
    const claimed = new Set();
    for (const section of configSections) {
      const mine = (pendingBySection.get(section.id) ?? []).filter(
        (t) => t.personIds.includes(r.personId) && !claimed.has(t.itemId)
      );
      if (mine.length === 0) continue;
      for (const t of mine) claimed.add(t.itemId);
      taskCount += mine.length;
      sections.push({
        sectionId: section.id,
        title: section.title,
        dateColumnTitle: section.dateColumnTitle ?? '',
        // Per-cluster required note: the renderer needs the mapping to emit the
        // text field, and its title to head the column.
        noteColumnId: section.noteColumnId ?? null,
        noteColumnTitle: section.noteColumnTitle ?? '',
        buttonId: section.buttonId,
        buttonIds: sectionActionButtonIds(section),
        tasks: mine.map(({ itemId, name, date, dates, statusText, statusColor }) => ({
          itemId,
          name,
          date,
          dates,
          statusText,
          statusColor,
        })),
      });
    }
    if (taskCount === 0) continue;
    recipients.push({
      email: r.email,
      name: r.name,
      personId: r.personId,
      taskCount,
      dateColumns,
      // Renderers resolve option-pill colors (button targetIndex on the
      // button's own status column) from this map; undefined when the caller
      // supplied none — the config-color fallback stays intact.
      statusColumnColors,
      sections,
    });
  }

  return { recipients, skippedUsers };
}
