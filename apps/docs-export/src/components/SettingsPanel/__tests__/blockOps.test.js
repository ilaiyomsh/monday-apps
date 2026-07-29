/**
 * blockOps — the ordered block list the owner edits in the settings panel.
 *
 * The invariant these tests exist to defend: EXACTLY ONE table block, which can be
 * MOVED but never deleted and never duplicated. `normalizeSettings` repairs a
 * broken list after the fact (keep the first table, synthesise one when missing),
 * so a panel bug here would be silently "fixed" into a report with the table in
 * the wrong place — or with the owner's text blocks dropped by the cap.
 *
 * Second invariant: purity. Every op either returns a NEW array or the SAME
 * reference when nothing changed, and never mutates the input — the caller uses
 * the identity to decide whether to mark the draft dirty.
 *
 * Block shapes match `domain/settingsSchema.js` exactly:
 *   {id, type:'text', text} | {id, type:'table'}
 */
import { describe, it, expect } from 'vitest';
import { MAX_BLOCKS } from '../../../domain/settingsSchema';
import {
  nextBlockId,
  addTextBlock,
  updateBlockText,
  deleteBlock,
  moveBlock,
  canDeleteBlock,
} from '../blockOps';

const text = (id, t = '') => ({ id, type: 'text', text: t });
const table = (id = 'table') => ({ id, type: 'table' });

/** intro · table · closing — the shape a configured instance actually holds. */
const LIST = [text('block-1', 'פתיח'), table(), text('block-2', 'סיום')];

/** A deep snapshot, to prove the input was not mutated. */
const snapshot = (blocks) => JSON.parse(JSON.stringify(blocks));

describe('nextBlockId', () => {
  it('starts at block-1 for an empty list', () => {
    expect(nextBlockId([])).toBe('block-1');
  });

  it('skips ids already taken, returning the SMALLEST free one', () => {
    expect(nextBlockId([table(), text('block-1')])).toBe('block-2');
    expect(nextBlockId([text('block-1'), text('block-2'), table()])).toBe('block-3');
  });

  it('reuses a freed slot rather than always counting upward', () => {
    // block-1 was deleted; the next id fills the hole instead of becoming block-3.
    expect(nextBlockId([text('block-2'), table()])).toBe('block-1');
  });

  it('ignores ids that are not of the block-N form', () => {
    expect(nextBlockId([text('intro'), text('שלום'), table()])).toBe('block-1');
  });

  it('survives a missing list', () => {
    expect(nextBlockId(undefined)).toBe('block-1');
  });
});

describe('addTextBlock', () => {
  it('appends an empty text block at the END with a fresh id', () => {
    const before = snapshot(LIST);
    const next = addTextBlock(LIST);

    expect(next).toHaveLength(4);
    expect(next[3]).toEqual({ id: 'block-3', type: 'text', text: '' });
    expect(next.slice(0, 3)).toEqual(LIST.slice(0, 3));
    expect(LIST).toEqual(before);
    expect(next).not.toBe(LIST);
  });

  it('carries an initial text when one is given', () => {
    expect(addTextBlock([table()], 'שורת פתיחה')[1]).toEqual({
      id: 'block-1',
      type: 'text',
      text: 'שורת פתיחה',
    });
  });

  it('adds the block that brings the list exactly UP TO the cap', () => {
    const atCapMinusOne = [table(), ...Array.from({ length: MAX_BLOCKS - 2 }, (_, i) => text(`t${i}`))];
    expect(atCapMinusOne).toHaveLength(MAX_BLOCKS - 1);

    const next = addTextBlock(atCapMinusOne);
    expect(next).toHaveLength(MAX_BLOCKS);
    expect(next).not.toBe(atCapMinusOne);
  });

  it('refuses to add once the list is exactly AT the cap, returning the same reference', () => {
    const atCap = [table(), ...Array.from({ length: MAX_BLOCKS - 1 }, (_, i) => text(`t${i}`))];
    expect(atCap).toHaveLength(MAX_BLOCKS);

    expect(addTextBlock(atCap)).toBe(atCap);
  });

  it('adds to an empty list without inventing a table block', () => {
    expect(addTextBlock([])).toEqual([{ id: 'block-1', type: 'text', text: '' }]);
  });
});

describe('updateBlockText', () => {
  it('replaces the text of the addressed block and leaves every sibling identical', () => {
    const before = snapshot(LIST);
    const next = updateBlockText(LIST, 'block-2', 'טקסט חדש');

    expect(next[2]).toEqual({ id: 'block-2', type: 'text', text: 'טקסט חדש' });
    expect(next[0]).toBe(LIST[0]);
    expect(next[1]).toBe(LIST[1]);
    expect(LIST).toEqual(before);
  });

  it('accepts clearing the text to empty — a blank paragraph is legitimate', () => {
    const next = updateBlockText(LIST, 'block-1', '');
    expect(next[0]).toEqual({ id: 'block-1', type: 'text', text: '' });
  });

  it('preserves newlines, which are what makes the block multiline', () => {
    const next = updateBlockText(LIST, 'block-1', 'שורה\nשורה שנייה');
    expect(next[0].text).toBe('שורה\nשורה שנייה');
  });

  it('is a no-op for the table block, which has no text', () => {
    expect(updateBlockText(LIST, 'table', 'לא אמור לקרות')).toBe(LIST);
  });

  it('is a no-op for an id that is not in the list', () => {
    expect(updateBlockText(LIST, 'block-9', 'x')).toBe(LIST);
  });
});

describe('canDeleteBlock', () => {
  it('is true for a text block', () => {
    expect(canDeleteBlock(LIST, 'block-1')).toBe(true);
    expect(canDeleteBlock(LIST, 'block-2')).toBe(true);
  });

  it('is false for the table block — exactly one must always exist', () => {
    expect(canDeleteBlock(LIST, 'table')).toBe(false);
  });

  it('is false for an unknown id', () => {
    expect(canDeleteBlock(LIST, 'block-9')).toBe(false);
  });
});

describe('deleteBlock', () => {
  it('removes the addressed text block and keeps the rest in order', () => {
    const before = snapshot(LIST);
    const next = deleteBlock(LIST, 'block-1');

    expect(next.map((b) => b.id)).toEqual(['table', 'block-2']);
    expect(LIST).toEqual(before);
  });

  it('refuses to delete the table block, returning the same reference', () => {
    expect(deleteBlock(LIST, 'table')).toBe(LIST);
  });

  it('is a no-op for an unknown id', () => {
    expect(deleteBlock(LIST, 'block-9')).toBe(LIST);
  });
});

describe('moveBlock', () => {
  it('moves a block one step toward the start for delta -1', () => {
    const before = snapshot(LIST);
    const next = moveBlock(LIST, 'table', -1);

    expect(next.map((b) => b.id)).toEqual(['table', 'block-1', 'block-2']);
    expect(LIST).toEqual(before);
  });

  it('moves a block one step toward the end for delta +1', () => {
    expect(moveBlock(LIST, 'table', 1).map((b) => b.id)).toEqual(['block-1', 'block-2', 'table']);
  });

  it('moves the TABLE block, which is reorderable even though it is undeletable', () => {
    const next = moveBlock(LIST, 'table', -1);
    expect(next[0]).toEqual(table());
    expect(next.filter((b) => b.type === 'table')).toHaveLength(1);
  });

  it('is a no-op at the first index for delta -1', () => {
    expect(moveBlock(LIST, 'block-1', -1)).toBe(LIST);
  });

  it('is a no-op at the last index for delta +1', () => {
    expect(moveBlock(LIST, 'block-2', 1)).toBe(LIST);
  });

  it('is a no-op for delta 0', () => {
    expect(moveBlock(LIST, 'table', 0)).toBe(LIST);
  });

  it('is a no-op for an unknown id', () => {
    expect(moveBlock(LIST, 'block-9', -1)).toBe(LIST);
  });

  it('clamps an oversized delta to the ends instead of dropping the block', () => {
    expect(moveBlock(LIST, 'block-2', -5).map((b) => b.id)).toEqual(['block-2', 'block-1', 'table']);
    expect(moveBlock(LIST, 'block-1', 9).map((b) => b.id)).toEqual(['table', 'block-2', 'block-1']);
  });

  it('never changes the list length', () => {
    expect(moveBlock(LIST, 'table', 1)).toHaveLength(LIST.length);
    expect(moveBlock(LIST, 'block-2', -5)).toHaveLength(LIST.length);
  });
});
