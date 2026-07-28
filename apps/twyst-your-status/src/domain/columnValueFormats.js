/**
 * Assemble the `column_values` payload for change_multiple_column_values —
 * the status label plus every required field of the transition.
 *
 * Per-type read/write/emptiness rules live in ./columnFields.js; this file only
 * assembles and guards. Nothing here enumerates column types.
 */

import { sanitizeColumnValues, serializeFieldValue } from './columnFields.js';
import { serializeStatusMutationValue } from './statusPolicy.js';

/**
 * @param {object} args
 * @param {string} args.statusColumnId  the gated status column
 * @param {string|number} args.statusLabelId  label id being written
 * @param {{columnId: string}[]} args.formFields  the label's required fields
 * @param {Record<string, unknown>} args.formValues  form value per column id
 * @param {Map<string, {type: string}>|Record<string, {type: string}>} args.columnsById
 * @returns {Record<string, unknown>} sanitized column_values, ready to stringify
 */
export function buildMultiColumnWritePayload({
  statusColumnId,
  statusLabelId,
  formFields,
  formValues,
  columnsById,
}) {
  const payload = {
    [statusColumnId]: JSON.parse(serializeStatusMutationValue(statusLabelId)),
  };

  (formFields || []).forEach((field) => {
    const column = columnsById?.get?.(field.columnId) ?? columnsById?.[field.columnId];
    // No type ⇒ nothing safe to write. serializeFieldValue returns undefined for
    // an unsupported type and the sanitizer then omits the column, so a formula
    // or mirror column can never be written as raw text.
    const serialized = serializeFieldValue(column?.type, formValues?.[field.columnId]);
    if (serialized !== undefined) payload[field.columnId] = serialized;
  });

  // One unusable field value must not fail the whole mutation — monday rejects
  // the entire change_multiple_column_values call on a single bad column, which
  // would block the status transition itself.
  return sanitizeColumnValues(payload);
}
