// Authorization helpers for the Custom Object API. Use after sessionTokenMiddleware.

import syncConfigStorage from '../storage/sync-config-storage.js';
import { getBoardOwnerIds } from '../services/monday-api.js';
import logger from '../services/logger.js';

// Find any monday access token we can use to query the object's owners. Walks
// the verifiedOwnerIds list (pulling each user's sync_config for this instance)
// and returns the first token found. Returns null if nobody has connected
// monday yet.
async function pickVerificationToken({ policy, accountId }) {
  const verifiedIds = Array.isArray(policy.verifiedOwnerIds) && policy.verifiedOwnerIds.length
    ? policy.verifiedOwnerIds
    : [String(policy.ownerUserId)];

  for (const ownerUserId of verifiedIds) {
    const configIds = await syncConfigStorage.getUserConfigs(ownerUserId);
    for (const cid of configIds) {
      const cfg = await syncConfigStorage.getSyncConfig(cid);
      if (
        cfg &&
        String(cfg.accountId) === String(accountId) &&
        String(cfg.objectId) === String(policy.objectId) &&
        cfg.mondayAccessToken
      ) {
        return cfg.mondayAccessToken;
      }
    }
  }
  return null;
}

// Ownership resolver: Custom Objects are boards per the schema
// (BoardObjectType.custom_object), so the real owner list is what monday
// returns for boards(ids:[objectId]) { owners { id } }.
//
// On every check we:
//   1. Pick a monday access token from one of the currently verified owners.
//   2. Query monday live for the current owner IDs.
//   3. Replace verifiedOwnerIds in storage with monday's fresh list.
//   4. Return whether the caller appears in the refreshed list.
//
// Fallback when no token is available (e.g., right after install, before any
// OAuth): allow only if the caller is already in the current verifiedOwnerIds
// list. This is what bootstraps the installer — they're seeded into the list
// at lifecycle create, so they can enter Setup and connect monday, which then
// provides a token for everyone else going forward.
async function isPolicyOwner({ policy, userId, accountId }) {
  const token = await pickVerificationToken({ policy, accountId });

  if (!token) {
    const seeded = Array.isArray(policy.verifiedOwnerIds) ? policy.verifiedOwnerIds : [String(policy.ownerUserId)];
    const allowed = seeded.some((id) => String(id) === String(userId));
    logger.debug('no monday token, fallback to stored list', 'authz', {
      obj: policy.objectId, user: userId, allowed,
    });
    return allowed;
  }

  let freshOwnerIds;
  try {
    freshOwnerIds = (await getBoardOwnerIds(token, policy.objectId)).map(String);
  } catch (err) {
    logger.warn('getBoardOwnerIds failed, fallback to stored', 'authz', {
      obj: policy.objectId, error: err.message,
    });
    const seeded = Array.isArray(policy.verifiedOwnerIds) ? policy.verifiedOwnerIds : [String(policy.ownerUserId)];
    return seeded.some((id) => String(id) === String(userId));
  }

  const prev = Array.isArray(policy.verifiedOwnerIds) ? policy.verifiedOwnerIds.map(String) : [];
  const changed =
    prev.length !== freshOwnerIds.length ||
    prev.some((id, i) => id !== freshOwnerIds[i]) ||
    freshOwnerIds.some((id) => !prev.includes(id));
  if (changed) {
    try {
      await syncConfigStorage.updateInstancePolicy(policy.objectId, { verifiedOwnerIds: freshOwnerIds });
      policy.verifiedOwnerIds = freshOwnerIds;
    } catch (err) {
      logger.warn('persist verifiedOwnerIds failed', 'authz', {
        obj: policy.objectId, error: err.message,
      });
    }
  }

  return freshOwnerIds.some((id) => id === String(userId));
}

export { isPolicyOwner };

// Attach the matched sync_config to req.config. Rejects if:
//   - config doesn't exist (404)
//   - config.accountId doesn't match the session (403) — cross-account guard
// Does NOT enforce row ownership; callers that mutate must call
// requireConfigOwnership separately.
export async function loadConfigWithAccountGuard(req, res, next) {
  try {
    const configId = req.params.configId;
    const config = await syncConfigStorage.getSyncConfig(configId);
    if (!config) return res.status(404).json({ error: 'config_not_found' });
    if (String(config.accountId) !== String(req.session.accountId)) {
      return res.status(403).json({ error: 'account_mismatch' });
    }
    req.config = config;
    next();
  } catch (err) {
    logger.warn('config_account_guard_failed', 'authz', {
      cfg: req.params?.configId, acc: req.session?.accountId, cause: err.message,
    });
    return res.status(500).json({ error: 'authz_failure', message: err.message });
  }
}

// Enforce: the authenticated user owns this config row.
// Must be preceded by loadConfigWithAccountGuard.
export function requireConfigOwnership(req, res, next) {
  if (!req.config) return res.status(500).json({ error: 'missing_config_context' });
  if (String(req.config.userId) !== String(req.session.userId)) {
    return res.status(403).json({ error: 'not_row_owner' });
  }
  next();
}

// Enforce: the authenticated user is the owner of the instance policy
// (the Custom Object "admin" — the user who added the feature).
// Expects objectId in req.query or req.body.
export async function requirePolicyOwnership(req, res, next) {
  try {
    const objectId = req.query.objectId || req.body?.objectId;
    if (!objectId) return res.status(400).json({ error: 'missing_objectId' });
    const policy = await syncConfigStorage.getInstancePolicy(String(objectId));
    if (!policy) return res.status(404).json({ error: 'policy_not_found' });
    if (String(policy.accountId) !== String(req.session.accountId)) {
      return res.status(403).json({ error: 'account_mismatch' });
    }
    const owner = await isPolicyOwner({
      policy,
      userId: req.session.userId,
      accountId: req.session.accountId,
    });
    if (!owner) return res.status(403).json({ error: 'not_policy_owner' });
    req.policy = policy;
    next();
  } catch (err) {
    logger.warn('policy_ownership_guard_failed', 'authz', {
      obj: req.query?.objectId || req.body?.objectId, acc: req.session?.accountId, cause: err.message,
    });
    return res.status(500).json({ error: 'authz_failure', message: err.message });
  }
}

// Read-only policy access: any user in the same account may read.
// Attaches req.policy if found.
export async function loadPolicyWithAccountGuard(req, res, next) {
  try {
    const objectId = req.query.objectId || req.body?.objectId;
    if (!objectId) return res.status(400).json({ error: 'missing_objectId' });
    const policy = await syncConfigStorage.getInstancePolicy(String(objectId));
    if (!policy) {
      req.policy = null;
      return next();
    }
    if (String(policy.accountId) !== String(req.session.accountId)) {
      return res.status(403).json({ error: 'account_mismatch' });
    }
    req.policy = policy;
    next();
  } catch (err) {
    logger.warn('policy_account_guard_failed', 'authz', {
      obj: req.query?.objectId || req.body?.objectId, acc: req.session?.accountId, cause: err.message,
    });
    return res.status(500).json({ error: 'authz_failure', message: err.message });
  }
}
