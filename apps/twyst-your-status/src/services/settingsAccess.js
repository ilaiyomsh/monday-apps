/**
 * settingsAccess — who may open a column's settings (round322, owner decision).
 *
 * The column carries its OWN owner list (domain/columnOwners). The gate:
 *   - Column already ADOPTED (has an owners record) → only its listed owners
 *     may configure. Everyone else is not exposed to the settings at all.
 *   - Column NOT adopted yet (legacy blob, or never configured) → fall back to
 *     the legacy BOARD-owner gate, so the board's owners can perform the first
 *     configuration. That first save adopts them (ColumnSettings.handleSave).
 *
 * Anything that stops the check from running THROWS (same contract as
 * loadIsBoardOwner): a gate that answers "false" on a failed request would tell
 * a genuine owner they are not one. Reading the config with a NULL result is a
 * real answer (unadopted), not a failure — only a thrown read propagates.
 *
 * @returns {Promise<{ canConfigure: boolean, adopted: boolean }>}
 */

import { hasOwners, isColumnOwner } from '../domain/columnOwners.js';
import { migrateSettings } from '../domain/settingsSchema.js';

export async function loadSettingsAccess(
  { boardId, columnId, userId } = {},
  { getColumnConfig, loadIsBoardOwner } = {},
) {
  if (boardId == null || String(boardId).trim() === '') {
    throw new Error('Cannot resolve settings access: boardId is missing from the monday context');
  }
  if (columnId == null || String(columnId).trim() === '') {
    throw new Error('Cannot resolve settings access: columnId is missing from the monday context');
  }
  if (userId == null || String(userId).trim() === '') {
    throw new Error('Cannot resolve settings access: userId is missing from the monday context');
  }

  const rawConfig = await getColumnConfig(boardId, columnId);
  const owners = migrateSettings(rawConfig)?.owners ?? null;

  if (hasOwners(owners)) {
    return { canConfigure: isColumnOwner(owners, userId), adopted: true };
  }

  // Unadopted: the board's owners perform (and, by saving, claim) the first setup.
  const isBoardOwner = await loadIsBoardOwner({ boardId, userId });
  return { canConfigure: isBoardOwner === true, adopted: false };
}
