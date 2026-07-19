// Board provisioner — creates the lifecycle events board from the Settings UI
// (POST /api/settings/board), replacing the old scripts/create-events-board.mjs
// CLI. It creates a PRIVATE board, adds the 9 columns (board-schema.js), uses
// the board's single default group as the events group, and persists the
// resulting config { boardId, groupId, columns } to SecureStorage via the
// storage service. events-board.js then reads that config per event.
//
// Unlike the webhook path (fail-soft), provisioning is an explicit operator
// action: failures PROPAGATE to the route so the UI can report them. Every
// catch here still logs (error-guard) before rethrowing. Board writes need the
// owner's OAuth token; without it monday-api throws MondayApiError
// ('no_write_token'), surfaced to the caller as an authorize-first error.
//
// All collaborators are injected — the only import is the board schema.

import { BOARD_COLUMNS, DEFAULT_BOARD_NAME } from './board-schema.js';

const TAG = 'board_provisioner';

/**
 * @param {object} deps
 * @param {{ createBoard: Function, createColumn: Function }} deps.mondayApi
 * @param {{ setBoardConfig: (config: object) => Promise<void> }} deps.storage
 * @param {object} deps.logger - app logger (`(message, tag, context)` shape)
 * @returns {{ provision: (opts?: { name?: string, workspaceId?: string|number|null }) => Promise<object> }}
 */
export function createBoardProvisioner({ mondayApi, storage, logger }) {
  /**
   * Create the board + columns + resolve the single group, then store the
   * config. Returns the stored config on success; throws on any failure
   * (already logged).
   * @param {{ name?: string, workspaceId?: string|number|null }} [opts]
   * @returns {Promise<{ boardId: string, groupId: string|null, columns: Record<string,string> }>}
   */
  async function provision({ name, workspaceId = null } = {}) {
    const boardName = typeof name === 'string' && name.trim().length > 0 ? name.trim() : DEFAULT_BOARD_NAME;
    try {
      // 1. Create the private board. A fresh board carries exactly one default
      //    group — that is the single events group (decision: one group, not
      //    one-per-app; the `app` column already discriminates).
      const board = await mondayApi.createBoard({ name: boardName, kind: 'private', workspaceId });
      const groupId = board.groups?.[0]?.id ?? null;

      // 2. Create the 9 columns in schema order, collecting logical key → id.
      const columns = {};
      for (const col of BOARD_COLUMNS) {
        const columnId = await mondayApi.createColumn({
          boardId: board.id,
          title: col.title,
          columnType: col.type,
          defaults: col.defaults ?? null,
        });
        columns[col.key] = columnId;
      }

      // 3. Persist. events-board.js reads this per event (its own 60s cache).
      const config = { boardId: board.id, groupId, columns };
      await storage.setBoardConfig(config);

      logger.info('board_provisioned', TAG, {
        boardId: board.id,
        hasGroup: Boolean(groupId),
        columnCount: Object.keys(columns).length,
      });
      return config;
    } catch (err) {
      // Explicit operator action — log, then rethrow so the route reports it.
      logger.error('board_provision_failed', TAG, {
        code: err?.code ?? null,
        error: String(err?.message ?? err),
      });
      throw err;
    }
  }

  return { provision };
}
