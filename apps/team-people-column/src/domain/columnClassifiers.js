// Pure column-type classifiers + board_relation link extraction.
// No React/SDK/service imports — safe to unit-test against captured fixtures.

import logger from '../utils/logger.js';

const PEOPLE_TYPES = new Set(['people', 'person', 'multiple_person']);

/** True only for connect-boards (board_relation) columns — dependency is excluded. */
export function isBoardRelationColumn(col) {
  return col?.type === 'board_relation';
}

/** True for any people-flavoured column type. */
export function isPeopleColumn(col) {
  return PEOPLE_TYPES.has(col?.type);
}

/**
 * Linked board ids for a board_relation column, always as strings.
 * Reads the typed `settings` object — the only source, now that the deprecated
 * stringified-settings field is no longer selected by GET_BOARD_COLUMNS (dead
 * since 2025-10). A missing/unconfigured column (no `settings.boardIds`) → [].
 * A `settings.boardIds` present but not an array = corrupt/unexpected shape →
 * logger.warn + [].
 */
export function getLinkedBoardIds(col) {
  const boardIds = col?.settings?.boardIds;
  if (Array.isArray(boardIds)) {
    return boardIds.map((id) => String(id));
  }

  // Present-but-not-an-array is genuine corruption/drift (an unconfigured column
  // simply has no boardIds → benign []); a configured relation column always
  // carries an array here.
  if (boardIds != null) {
    logger.warn('columnClassifiers', 'board_relation settings.boardIds is not an array', {
      columnId: col?.id,
      boardIds,
    });
  }
  return [];
}
