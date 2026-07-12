// People column value <-> selection mapping (pure).
//
// parseCellValue: monday native people-column `value` JSON string -> selection.
// formatCellValue: selection -> native people-column write payload.
// The ONLY place ids become integers is formatCellValue (native write format);
// everywhere else ids are strings.

import logger from '../utils/logger.js';

/**
 * Parse a monday people-column `value` JSON string into a selection list.
 * Shape returned by/accepted by monday: `{"personsAndTeams":[{"id":<int>,"kind":"person"}]}`.
 *
 * @param {string|null|undefined} rawValue - the column value JSON string.
 * @returns {Array<{id:string, kind:string}>} entries with string ids; [] when
 *   empty/null; [] + logger.warn on corrupt JSON.
 */
export function parseCellValue(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === '') {
    return [];
  }

  let parsed;
  try {
    parsed = JSON.parse(rawValue);
  } catch (err) {
    logger.warn('cellValue', 'Failed to parse people column value JSON', {
      error: err.message,
    });
    return [];
  }

  const list = parsed && Array.isArray(parsed.personsAndTeams)
    ? parsed.personsAndTeams
    : [];

  return list
    .filter((entry) => entry != null && entry.id != null)
    .map((entry) => ({ id: String(entry.id), kind: entry.kind || 'person' }));
}

/**
 * Format a selection into the native people-column write payload.
 * Integer ids are produced here and ONLY here.
 *
 * The entry's original `kind` is preserved (defaulting to 'person' only when
 * absent) so a pre-existing team assignment — assignable from other monday
 * surfaces — round-trips back as a team instead of being silently rewritten as
 * a person id, which would corrupt the cell.
 *
 * @param {Array<{id:string|number, kind?:string}>} selection
 * @returns {{personsAndTeams: Array<{id:number, kind:string}>}}
 */
export function formatCellValue(selection) {
  const list = Array.isArray(selection) ? selection : [];
  return {
    personsAndTeams: list
      .filter((entry) => entry != null && entry.id != null)
      .map((entry) => ({ id: Number(entry.id), kind: entry.kind || 'person' })),
  };
}
