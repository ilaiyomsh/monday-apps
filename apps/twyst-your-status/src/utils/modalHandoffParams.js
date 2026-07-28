/**
 * Read the ids the picker hands to the /required-fields modal.
 *
 * `openAppFeatureModal` opens a NEW iframe, so nothing carries over in memory —
 * the picker passes board/column/item/label through the SDK's `urlParams` and this
 * reads them back. Kept pure (no React, no SDK) so the handoff contract is
 * testable on its own; a silent mis-read here would open a form on the wrong cell.
 *
 * @param {string} search  a location.search value
 * @returns {{boardId: string|null, columnId: string|null, itemId: string|null, labelId: string|null}}
 */
export function readModalHandoffParams(search) {
  const params = new URLSearchParams(typeof search === 'string' ? search : '');
  // Blank/whitespace becomes null, never '' — an empty id must read as MISSING so
  // the modal refuses to guess. Label id 0 is a real label, so this is a
  // string-emptiness test, never a truthiness test.
  const read = (key) => {
    const value = params.get(key);
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  };

  return {
    boardId: read('boardId'),
    columnId: read('columnId'),
    itemId: read('itemId'),
    labelId: read('labelId'),
  };
}
