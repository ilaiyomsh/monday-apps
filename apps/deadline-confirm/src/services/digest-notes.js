// Per-task required note (owner ask 2026-08-03) — PURE rules, no I/O.
//
// A digest cluster MAY map a text column on the tasks board. When it does, the
// reader cannot mark a task in that cluster without typing a note, and the note
// is written to the mapped column alongside the status.
//
// The amp4email document disables its submit button while a marked row has an
// empty note, but that is UX only: AMP runs in the reader's mail client and a
// hand-crafted POST reaches the endpoint just the same. THIS module is the
// authority — the route refuses the item, not the browser.

/** Longest note we accept. Well under any text-column limit; keeps one message small. */
export const MAX_NOTE_LENGTH = 500;

/** Wire field carrying a task's note. Same itemId shape as the selection fields. */
const NOTE_FIELD_RE = /^note_(\d{1,20})$/;

/**
 * Notes out of a parsed form body, keyed by item id. Non-matching fields are
 * ignored (the body also carries the signature fields and the selections), and
 * values are trimmed so a space-only note is indistinguishable from an empty
 * one — otherwise a single space would satisfy a "required" field.
 * @param {Record<string, unknown>} body
 * @returns {Map<string, string>}
 */
export function extractNotes(body) {
  /** @type {Map<string, string>} */
  const notes = new Map();
  for (const [field, rawValue] of Object.entries(body ?? {})) {
    const match = NOTE_FIELD_RE.exec(field);
    if (!match) continue;
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    // A repeated field arrives as an array; the first NON-EMPTY value wins, so
    // an empty duplicate cannot mask a real note.
    let picked = null;
    for (const value of values) {
      if (typeof value !== 'string') continue;
      const trimmed = value.trim();
      if (picked === null) picked = trimmed;
      if (trimmed.length > 0) {
        picked = trimmed;
        break;
      }
    }
    if (picked !== null) notes.set(match[1], picked);
  }
  return notes;
}

/** Button ids a section offers (multi, with the legacy singular fallback). */
function sectionButtonIds(section) {
  if (Array.isArray(section?.buttonIds) && section.buttonIds.length > 0) return section.buttonIds;
  return section?.buttonId ? [section.buttonId] : [];
}

/**
 * The text column a selection's note must be written to, or null when the
 * selection's cluster maps none.
 *
 * The lookup goes through the BUTTON, not the cluster index: the wire carries
 * one selection per item (`item_<id>=<btnId>`) and no cluster identity, and a
 * task legitimately appears in two clusters. Resolving from the chosen button
 * makes the target follow the action the reader actually took. A button shared
 * by two mapped clusters is ambiguous by construction — first match wins.
 *
 * @param {object|null} config
 * @param {string} btnId
 * @returns {{ id: string, title: string } | null}
 */
export function resolveNoteColumn(config, btnId) {
  for (const section of config?.digest?.sections ?? []) {
    const columnId = section?.noteColumnId;
    if (typeof columnId !== 'string' || columnId.length === 0) continue;
    if (!sectionButtonIds(section).includes(btnId)) continue;
    return { id: columnId, title: typeof section.noteColumnTitle === 'string' ? section.noteColumnTitle : '' };
  }
  return null;
}

/**
 * Verdict for one selection's note.
 * @param {{ column: { id: string } | null, value: string }} p
 * @returns {'ok' | 'note_required' | 'note_too_long'}
 */
export function classifyNote({ column, value }) {
  if (!column) return 'ok';
  const text = typeof value === 'string' ? value : '';
  if (text.length === 0) return 'note_required';
  if (text.length > MAX_NOTE_LENGTH) return 'note_too_long';
  return 'ok';
}
