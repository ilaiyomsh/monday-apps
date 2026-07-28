/**
 * Did the status write actually land?
 *
 * The picker and the fill form both CLOSE on a successful status write, and the
 * closing is the only confirmation the user gets — there is deliberately no toast
 * (see MANIFEST.md → Product rules). So the surface must not close on "the request
 * came back"; it must close on "the status is now the one that was picked".
 *
 * Both mutations therefore echo the status column back in their response
 * (`change_column_value` and `change_multiple_column_values` both return `Item`,
 * and `Item.column_values(ids:)` narrows it to the one column — schema-checked
 * against schema-cache/schema-2026-04.sdl). `StatusValue.index` carries the label
 * **id**, and `{"index": <labelId>}` is probe-verified to round-trip to the same
 * number (monday-api references/column-formats.md), which is what makes the echo
 * comparable to what we asked for at all.
 *
 * The two failure directions are deliberately NOT symmetric:
 *
 *  - A DEFINITE mismatch — a different label came back, or no item came back —
 *    is a failure. `change_column_value: null` inside a 200 with no `errors` is a
 *    real shape, and a bare `await` cannot tell it from a success.
 *  - An UNREADABLE echo is NOT a failure. If an API version stops returning the
 *    fragment, treating absence as failure would put an error on every successful
 *    transition in the app. The mutation returning without errors is monday's own
 *    answer and we keep it.
 */

import { currentLabelIdFromValue } from './statusPolicy.js';
import logger from '../utils/logger.js';

/**
 * The label id a mutation echoed for `columnId`, or null when the response
 * carries nothing readable for that column.
 *
 * @param {{ column_values?: Array<object> }|null} item  the mutation's returned Item
 * @param {string} columnId
 * @returns {string|null}
 */
export function writtenStatusLabelId(item, columnId) {
  const values = Array.isArray(item?.column_values) ? item.column_values : [];
  const columnValue = values.find((value) => String(value?.id) === String(columnId)) ?? null;
  if (!columnValue) return null;
  return currentLabelIdFromValue(columnValue);
}

/**
 * Throw unless the write is known to have landed on `expectedLabelId`.
 *
 * @param {{ column_values?: Array<object> }|null} item  the mutation's returned Item
 * @param {string} columnId
 * @param {string|number} expectedLabelId
 */
export function assertStatusWritten(item, columnId, expectedLabelId) {
  if (!item) {
    throw new Error('הסטטוס לא עודכן — monday לא החזיר את הפריט');
  }

  const written = writtenStatusLabelId(item, columnId);
  if (written === null) {
    // No evidence either way. Recorded, because a version bump that quietly stops
    // returning the status is how this check would become a no-op unnoticed.
    logger.warn(
      'statusWriteResult',
      'The status write could not be confirmed from the mutation response; accepting it',
      { columnId, expectedLabelId: String(expectedLabelId) },
    );
    return;
  }

  if (written !== String(expectedLabelId)) {
    throw new Error('הסטטוס לא עודכן — monday החזיר סטטוס אחר');
  }
}
