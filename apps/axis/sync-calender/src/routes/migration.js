// Migration endpoints. Today: status-id (position → stable label id).
// One-shot per affected mapping/conditional, idempotent — re-runs after a
// successful migration return `needed: false`.

import express from 'express';
import { sessionTokenMiddleware } from '../middlewares/session-token.js';
import {
  loadPolicyWithAccountGuard,
  requirePolicyOwnership,
} from '../middlewares/authz.js';
import syncConfigStorage from '../storage/sync-config-storage.js';
import {
  buildMigrationPlan,
  applyMigrationPlan,
} from '../services/status-id-migration.js';
import logger from '../services/logger.js';
import { buildAccountCtx } from '../helpers/log-context.js';

const TAG = 'migration';
const router = express.Router();

async function loadInstanceConfigs(objectId) {
  const ids = await syncConfigStorage.getInstanceConfigs(objectId);
  const out = [];
  for (const cid of ids) {
    const cfg = await syncConfigStorage.getSyncConfig(cid);
    if (cfg) out.push(cfg);
  }
  return out;
}

// Pick any monday access token attached to a verified config in this instance.
// We only need it to read column settings, so any token in the same account
// works; preference is the requester's own config.
function pickMondayToken(configs, sessionUserId) {
  const own = configs.find((c) => String(c.userId) === String(sessionUserId) && c.mondayAccessToken);
  if (own) return own.mondayAccessToken;
  const any = configs.find((c) => c.mondayAccessToken);
  return any?.mondayAccessToken || null;
}

// GET /api/migration/status-ids?objectId=X
// Read-only diagnostic: any user in the account may call. The frontend uses
// this to decide whether to show the migration prompt to the owner.
router.get(
  '/api/migration/status-ids',
  sessionTokenMiddleware,
  loadPolicyWithAccountGuard,
  async (req, res) => {
    if (!req.policy) return res.status(404).json({ error: 'policy_not_found' });
    try {
      const configs = await loadInstanceConfigs(req.policy.objectId);
      const token = pickMondayToken(configs, req.session.userId);
      if (!token) return res.json({ needed: false, items: [], unresolved: [], reason: 'no_monday_token' });
      const plan = await buildMigrationPlan({ token, policy: req.policy, configs });
      return res.json(plan);
    } catch (err) {
      logger.error('error', TAG, {
        ...buildAccountCtx({
          accountId: req.policy?.accountId,
          userId: req.session?.userId,
          objectId: req.policy?.objectId,
        }),
        stage: 'migration_plan',
        cause: err.message,
      });
      return res.status(500).json({ error: 'plan_failed' });
    }
  }
);

// POST /api/migration/status-ids
// Owner-only. Body: { objectId }. Recomputes the plan server-side (don't trust
// the client's items list) and applies it.
router.post(
  '/api/migration/status-ids',
  sessionTokenMiddleware,
  requirePolicyOwnership,
  async (req, res) => {
    try {
      const configs = await loadInstanceConfigs(req.policy.objectId);
      const token = pickMondayToken(configs, req.session.userId);
      if (!token) return res.status(409).json({ error: 'no_monday_token' });
      const plan = await buildMigrationPlan({ token, policy: req.policy, configs });
      if (!plan.needed) return res.json({ migrated: 0, plan });
      const { migrated } = await applyMigrationPlan(plan, { policy: req.policy, configs });
      logger.info('status_ids_migrated', TAG, {
        ...buildAccountCtx({
          accountId: req.policy.accountId,
          userId: req.session.userId,
          objectId: req.policy.objectId,
        }),
        migrated,
        items: plan.items.length,
        unresolved: plan.unresolved.length,
      });
      return res.json({ migrated, plan });
    } catch (err) {
      logger.error('error', TAG, {
        ...buildAccountCtx({
          accountId: req.policy?.accountId,
          userId: req.session?.userId,
          objectId: req.policy?.objectId,
        }),
        stage: 'migration_apply',
        cause: err.message,
      });
      return res.status(500).json({ error: 'apply_failed' });
    }
  }
);

export default router;
