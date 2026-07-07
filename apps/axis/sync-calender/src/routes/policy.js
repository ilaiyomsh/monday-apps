import express from 'express';
import { sessionTokenMiddleware } from '../middlewares/session-token.js';
import { loadPolicyWithAccountGuard, requirePolicyOwnership, isPolicyOwner } from '../middlewares/authz.js';
import syncConfigStorage from '../storage/sync-config-storage.js';
import { validateColumnMapping } from '../helpers/column-mapping-validator.js';
import { isMicrosoftEnabled } from '../services/provider.js';
import logger from '../services/logger.js';
import { buildAccountCtx } from '../helpers/log-context.js';

const TAG = 'policy';
const router = express.Router();

// GET /api/policy?objectId=<X>
// Any user in the same account may read the active policy (they need it to
// understand what will be written). Returns 404 if the Custom Object has
// not been provisioned (no lifecycle create has fired yet).
router.get('/api/policy', sessionTokenMiddleware, loadPolicyWithAccountGuard, async (req, res) => {
  if (!req.policy) return res.status(404).json({ error: 'policy_not_found' });
  const isOwner = await isPolicyOwner({
    policy: req.policy,
    userId: req.session.userId,
    accountId: req.session.accountId,
  });
  const setupComplete = Boolean(req.policy.boardId && req.policy.linkColumnId && req.policy.lockColumnId);
  return res.json({
    policy: req.policy,
    isOwner,
    setupComplete,
    // Feature flags computed from server env. Frontend uses microsoftEnabled
    // to decide whether to render the Connect Outlook button.
    microsoftEnabled: isMicrosoftEnabled(),
  });
});

// PATCH /api/policy
// body: { objectId, boardId, linkColumnId, lockColumnId, peopleColumnId?, itemNameSource?, columnMapping }
// Owner-only (sessionToken.userId === policy.ownerUserId).
router.patch('/api/policy', sessionTokenMiddleware, requirePolicyOwnership, async (req, res) => {
  try {
    const {
      boardId,
      linkColumnId,
      lockColumnId,
      peopleColumnId,
      itemNameSource,
      columnMapping,
      conditionalEligibleColumns,
    } = req.body || {};

    const patch = {};
    if (boardId !== undefined) patch.boardId = boardId ? String(boardId) : null;
    if (linkColumnId !== undefined) patch.linkColumnId = linkColumnId || null;
    if (lockColumnId !== undefined) patch.lockColumnId = lockColumnId || null;
    if (peopleColumnId !== undefined) patch.peopleColumnId = peopleColumnId || null;
    if (itemNameSource !== undefined) patch.itemNameSource = itemNameSource || 'eventName';
    if (columnMapping !== undefined) {
      const result = validateColumnMapping(columnMapping);
      if (!result.ok) {
        return res.status(400).json({
          error: 'invalid_column_mapping',
          columnId: result.columnId,
          detail: result.error,
        });
      }
      patch.columnMapping = columnMapping;
    }
    if (conditionalEligibleColumns !== undefined) {
      if (!Array.isArray(conditionalEligibleColumns)
        || !conditionalEligibleColumns.every((x) => typeof x === 'string' && x)) {
        return res.status(400).json({
          error: 'invalid_conditional_eligible_columns',
          detail: 'must be an array of non-empty column id strings',
        });
      }
      patch.conditionalEligibleColumns = conditionalEligibleColumns;
    }

    if (!Object.keys(patch).length) return res.status(400).json({ error: 'no_valid_fields' });

    // Board change wipes every board-scoped field (column IDs are per-board,
    // so the existing values point at columns that don't exist on the new
    // board). Wiping every dependent field unconditionally avoids stale
    // mappings causing InvalidColumnIdException at runtime. Fields the caller
    // explicitly set in this same patch win — we never null something they
    // sent — so a "switch board + set link column" form works in one round-trip.
    const boardChanging =
      patch.boardId !== undefined &&
      String(patch.boardId || '') !== String(req.policy.boardId || '');
    if (boardChanging) {
      if (patch.linkColumnId === undefined) patch.linkColumnId = null;
      if (patch.lockColumnId === undefined) patch.lockColumnId = null;
      if (patch.peopleColumnId === undefined) patch.peopleColumnId = null;
      if (patch.columnMapping === undefined) patch.columnMapping = {};
      if (patch.conditionalEligibleColumns === undefined) patch.conditionalEligibleColumns = [];
    }

    const updated = await syncConfigStorage.updateInstancePolicy(req.policy.objectId, patch);

    // Per-user conditionals reference column IDs from the old board too —
    // wipe them on every config attached to this Custom Object instance so a
    // user who already authored rules can't silently sync against stale ids.
    let conditionalsClearedFor = 0;
    if (boardChanging) {
      const configIds = await syncConfigStorage.getInstanceConfigs(req.policy.objectId);
      for (const cid of configIds) {
        const cfg = await syncConfigStorage.getSyncConfig(cid);
        if (cfg && Array.isArray(cfg.conditionals) && cfg.conditionals.length > 0) {
          await syncConfigStorage.updateSyncConfig(cid, { conditionals: [] });
          conditionalsClearedFor++;
        }
      }
    }

    logger.info('policy_updated', TAG, {
      ...buildAccountCtx({
        accountId: req.policy.accountId,
        userId: req.session.userId,
        objectId: req.policy.objectId,
      }),
      ...(patch.boardId !== undefined ? { board: patch.boardId } : {}),
      fields: Object.keys(patch),
      ...(boardChanging ? { boardChanged: true, conditionalsCleared: conditionalsClearedFor } : {}),
    });
    return res.json({ policy: updated });
  } catch (err) {
    logger.error('error', TAG, {
      ...buildAccountCtx({
        accountId: req.policy?.accountId,
        userId: req.session?.userId,
        objectId: req.policy?.objectId,
      }),
      stage: 'policy_patch',
      cause: err.message,
    });
    return res.status(500).json({ error: 'policy_patch_failed' });
  }
});

export default router;
