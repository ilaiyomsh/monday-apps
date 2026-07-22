// Settings routes — the in-app configuration surface for the lifecycle events
// board (replaces env vars + the create-events-board.mjs CLI). Mounted at
// /api/settings BEHIND requireSession (same monday session-token + allowlist
// gate as /api/telemetry), so only authenticated (and, if an allowlist is
// set, allowlisted) monday users reach it.
//
//   GET  /api/settings             → { oauthStatus, oauthConnected, board }
//   POST /api/settings/board       → provision board+columns+group; { board }
//   POST /api/settings/disconnect  → revoke (best-effort) + clear the stored
//                                    OAuth record; { status, revoked }
//
// oauthStatus (Change #144, OAuth 2.1): 'connected' | 'disconnected' |
// 'reauth_required' — the third state surfaces the 6-month refresh-token
// death (or an invalid_grant) so the UI shows a re-authorize CTA.
// oauthConnected is kept as a boolean for back-compat.
//
// Board writes use the owner's OAuth token (resolved per call in monday-api
// via the oauth-token-provider). Without it, provisioning throws
// MondayApiError('no_write_token'), reported here as 409
// { error: 'not_authorized' } so the UI can prompt /oauth/start.
// Every catch logs (error-guard); token/config values are never logged.
//
// All collaborators are injected — the only app import is asyncHandler.

import express from 'express';
import { asyncHandler } from '../helpers/asyncHandler.js';

const TAG = 'settings';

/**
 * @param {object} deps
 * @param {{ getBoardConfig: () => Promise<object|null> }} deps.storage
 * @param {{ provision: (opts?: object) => Promise<object> }} deps.provisioner
 * @param {ReturnType<import('../services/oauth-token-provider.js').createOauthTokenProvider>} deps.tokenProvider
 * @param {object} deps.logger - app logger (`(message, tag, context)` shape)
 * @returns {import('express').Router}
 */
export function createSettingsRouter({ storage, provisioner, tokenProvider, logger }) {
  const router = express.Router();

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      const [oauthStatus, board] = await Promise.all([
        tokenProvider.getStatus(),
        storage.getBoardConfig(),
      ]);
      res.json({ oauthStatus, oauthConnected: oauthStatus === 'connected', board: board ?? null });
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

  router.post(
    '/disconnect',
    asyncHandler(async (_req, res) => {
      // Always 200: the local clear always succeeds; revoked:false only
      // signals that the best-effort remote revocation did not (see
      // oauth-token-provider.disconnect — it logs the cause).
      const { revoked } = await tokenProvider.disconnect();
      res.json({ status: 'disconnected', revoked });
    })
  );

  return router;
}
