// Settings routes — the in-app configuration surface for the lifecycle events
// board (replaces env vars + the create-events-board.mjs CLI). Mounted at
// /api/settings BEHIND requireSession (same monday session-token + allowlist
// gate as /api/telemetry), so only authenticated (and, if an allowlist is
// set, allowlisted) monday users reach it.
//
//   GET  /api/settings        → { oauthConnected, board: config|null }
//   POST /api/settings/board  → provision board+columns+group; { board: config }
//
// Board writes use the owner's OAuth token (resolved per call in monday-api).
// Without it, provisioning throws MondayApiError('no_write_token'), reported
// here as 409 { error: 'not_authorized' } so the UI can prompt /oauth/start.
// Every catch logs (error-guard); the token/config values are never logged.
//
// All collaborators are injected — the only app import is asyncHandler.

import express from 'express';
import { asyncHandler } from '../helpers/asyncHandler.js';

const TAG = 'settings';

/**
 * @param {object} deps
 * @param {{ getOwnerToken: () => Promise<string|null>, getBoardConfig: () => Promise<object|null> }} deps.storage
 * @param {{ provision: (opts?: object) => Promise<object> }} deps.provisioner
 * @param {object} deps.logger - app logger (`(message, tag, context)` shape)
 * @returns {import('express').Router}
 */
export function createSettingsRouter({ storage, provisioner, logger }) {
  const router = express.Router();

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      const [token, board] = await Promise.all([
        storage.getOwnerToken(),
        storage.getBoardConfig(),
      ]);
      res.json({ oauthConnected: Boolean(token), board: board ?? null });
    })
  );

  router.post(
    '/board',
    asyncHandler(async (req, res) => {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const name = typeof body.name === 'string' ? body.name : undefined;
      const workspaceId =
        typeof body.workspaceId === 'string' || typeof body.workspaceId === 'number'
          ? body.workspaceId
          : null;
      try {
        const board = await provisioner.provision({ name, workspaceId });
        logger.info('settings_board_provisioned', TAG, { boardId: board.boardId });
        res.json({ board });
      } catch (err) {
        // The provisioner already logged with context; map to a client status.
        if (err?.code === 'no_write_token') {
          res.status(409).json({ error: 'not_authorized' });
          return;
        }
        res.status(502).json({ error: 'provision_failed' });
      }
    })
  );

  return router;
}
