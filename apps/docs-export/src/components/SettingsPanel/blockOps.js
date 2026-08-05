/**
 * Pure edits on the ordered block list the owner builds in the settings panel.
 *
 * @module components/SettingsPanel/blockOps
 *
 * The list holds text blocks plus EXACTLY ONE table block. That invariant is the
 * whole reason this module exists as separate, tested logic: the table block can
 * be MOVED but never deleted or duplicated, and `domain/settingsSchema.js` only
 * repairs a broken list after the fact — the panel must never produce one.
 *
 * Every function is pure and returns a NEW array (React state), or the SAME array
 * reference when the operation is a no-op, so a caller can cheaply tell whether
 * anything changed (and skip marking the draft dirty).
 */
import { MAX_BLOCKS } from '../../domain/settingsSchema.js';

const list = (blocks) => (Array.isArray(blocks) ? blocks : []);

const indexOfId = (blocks, id) => list(blocks).findIndex((block) => block?.id === id);

/** Ids the panel generates look like `block-<n>`; anything else is user/legacy data. */
const GENERATED_ID = /^block-(\d+)$/;

/**
 * The smallest unused `block-<n>` id (n starts at 1).
 *
 * Smallest-free rather than "highest + 1" so a long editing session (add, delete,
 * add again) does not drift into `block-47` on a five-block list — the ids show up
 * in the stored blob and in log context, and a human reads them.
 *
 * @param {Array<{id: string}>} [blocks]
 * @returns {string}
 */
export function nextBlockId(blocks) {
  const taken = new Set();
  for (const block of list(blocks)) {
    const match = GENERATED_ID.exec(String(block?.id ?? ''));
    if (match) taken.add(Number(match[1]));
  }
  let n = 1;
  while (taken.has(n)) n += 1;
  return `block-${n}`;
}

/**
 * Append a text block at the end of the list.
 *
 * Capped at MAX_BLOCKS, and the cap is enforced HERE rather than left to
 * `normalizeSettings`: the normalizer drops trailing text blocks silently, so an
 * uncapped panel would let the owner type a block that vanishes on the next boot.
 *
 * @param {Array<Object>} blocks
 * @param {string} [text] - initial text
 * @returns {Array<Object>} a new list, or `blocks` itself when at the cap
 */
export function addTextBlock(blocks, text = '') {
  const current = list(blocks);
  if (current.length >= MAX_BLOCKS) return blocks;
  return [...current, { id: nextBlockId(current), type: 'text', text }];
}

/**
 * Replace one text block's text.
 *
 * A no-op for the table block (it has no text) and for an unknown id, so a stale
 * render cannot inject a `text` key into the table block — which would make
 * `normalizeSettings` see... still a table block, but the blob would carry a lie.
 *
 * @param {Array<Object>} blocks
 * @param {string} id
 * @param {string} text
 * @returns {Array<Object>} a new list, or `blocks` itself when nothing changed
 */
export function updateBlockText(blocks, id, text) {
  const current = list(blocks);
  const index = indexOfId(current, id);
  if (index < 0 || current[index].type !== 'text') return blocks;

  const next = [...current];
  next[index] = { ...current[index], text };
  return next;
}

/**
 * May this block be deleted? True only for an existing TEXT block — a report
 * without a table is meaningless, so the table block has no delete affordance.
 *
 * @param {Array<Object>} blocks
 * @param {string} id
 * @returns {boolean}
 */
export function canDeleteBlock(blocks, id) {
  const index = indexOfId(blocks, id);
  return index >= 0 && list(blocks)[index].type === 'text';
}

/**
 * Remove a text block. Refuses the table block and unknown ids.
 *
 * @param {Array<Object>} blocks
 * @param {string} id
 * @returns {Array<Object>} a new list, or `blocks` itself when nothing changed
 */
export function deleteBlock(blocks, id) {
  if (!canDeleteBlock(blocks, id)) return blocks;
  return list(blocks).filter((block) => block.id !== id);
}

/**
 * Move a block by `delta` positions (-1 = one step toward the start).
 *
 * Splice-move with the target index CLAMPED to the list, not a swap: clamping is
 * what makes an oversized delta land at an end instead of dropping the block off
 * the list. Applies to the table block too — its position is exactly what the
 * owner is choosing when they order the report.
 *
 * @param {Array<Object>} blocks
 * @param {string} id
 * @param {number} delta
 * @returns {Array<Object>} a new list, or `blocks` itself when nothing moved
 */
export function moveBlock(blocks, id, delta) {
  const current = list(blocks);
  const from = indexOfId(current, id);
  if (from < 0) return blocks;

  const to = Math.max(0, Math.min(current.length - 1, from + delta));
  if (to === from) return blocks;

  const next = [...current];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
