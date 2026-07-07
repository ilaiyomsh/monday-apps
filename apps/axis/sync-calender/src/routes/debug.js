// Debug-only inspection endpoints. Every request must carry an HMAC-SHA256
// signature over a timestamp using MONDAY_SIGNING_SECRET as the key:
//
//   x-debug-ts:  <unix epoch seconds>
//   x-debug-sig: hex(hmac_sha256(MONDAY_SIGNING_SECRET, "debug:" + ts))
//
// The timestamp must be within 120 seconds of server time, so captured headers
// are useless after that window. Returns metadata + boolean indicators only;
// never returns access/refresh tokens, sync tokens, or delta links verbatim.
//
// Why HMAC and not a static env-var token? monday code does not hot-reload
// env vars on running instances — `mapps code:env set` only takes effect on
// the next deploy. Reusing the already-deployed signing secret with a
// per-request signature avoids the rotation problem entirely.

import express from 'express';
import crypto from 'crypto';
import syncConfigStorage from '../storage/sync-config-storage.js';
import { fetchMondayIdentity, fetchMondayUsers } from '../services/monday-api.js';
import logger, { shortId } from '../services/logger.js';

const TAG = 'debug';
const router = express.Router();
const MAX_CLOCK_SKEW_SECONDS = 120;

function requireSignedRequest(req, res, next) {
  const secret = process.env.MONDAY_SIGNING_SECRET;
  if (!secret) {
    return res.status(503).json({ error: 'signing_secret_missing' });
  }

  const ts = req.get('x-debug-ts');
  const sig = req.get('x-debug-sig');
  if (!ts || !sig) {
    return res.status(401).json({ error: 'missing_signature' });
  }

  const tsNum = Number.parseInt(ts, 10);
  if (!Number.isFinite(tsNum)) {
    return res.status(401).json({ error: 'invalid_timestamp' });
  }

  const skew = Math.abs(Math.floor(Date.now() / 1000) - tsNum);
  if (skew > MAX_CLOCK_SKEW_SECONDS) {
    return res.status(401).json({ error: 'timestamp_skew', skewSeconds: skew });
  }

  const expectedHex = crypto
    .createHmac('sha256', secret)
    .update(`debug:${ts}`)
    .digest('hex');

  let provided;
  let expected;
  try {
    provided = Buffer.from(sig, 'hex');
    expected = Buffer.from(expectedHex, 'hex');
  } catch {
    return res.status(401).json({ error: 'invalid_signature_encoding' });
  }
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return res.status(401).json({ error: 'invalid_signature' });
  }

  return next();
}

function isoOrNull(ms) {
  if (!ms || typeof ms !== 'number') return null;
  return new Date(ms).toISOString();
}

function relativeFromNow(ms) {
  if (!ms || typeof ms !== 'number') return null;
  const diff = ms - Date.now();
  const abs = Math.abs(diff);
  const sign = diff < 0 ? '-' : '+';
  const h = abs / 3_600_000;
  if (h < 1) return `${sign}${Math.round(abs / 60_000)}m`;
  if (h < 48) return `${sign}${h.toFixed(1)}h`;
  return `${sign}${(h / 24).toFixed(1)}d`;
}

function maskId(id) {
  if (!id || typeof id !== 'string') return null;
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

function accountUrlFromSlug(slug) {
  if (!slug || typeof slug !== 'string') return null;
  return `https://${slug}.monday.com`;
}

function projectConfig(config, { policy, activeIndex }) {
  const inActiveIndex = activeIndex.some((e) => e.configId === config.configId);

  return {
    configId: config.configId,
    objectId: config.objectId ?? null,
    workspaceId: config.workspaceId ?? null,

    account: {
      id: config.accountId ?? null,
      name: config.mondayAccountName ?? null,
      slug: config.mondayAccountSlug ?? null,
      url: accountUrlFromSlug(config.mondayAccountSlug),
    },
    user: {
      id: config.userId ?? null,
      mondayUserId: config.mondayUserId ?? null,
      name: config.mondayUserName ?? null,
      email: config.mondayUserEmail ?? null,
      timeZone: config.mondayTimeZone ?? null,
    },

    provider: config.provider ?? null,
    isInstanceOwner: policy
      ? String(policy.ownerUserId) === String(config.userId)
      : null,

    google: {
      connected: Boolean(config.googleRefreshToken),
      email: config.googleUserEmail ?? null,
      hasResourceId: Boolean(config.googleResourceId),
      hasSyncToken: Boolean(config.googleSyncToken),
      watchExpiresAt: isoOrNull(config.googleWatchExpiration),
      watchExpiresIn: relativeFromNow(config.googleWatchExpiration),
      accessTokenExpiresAt: isoOrNull(config.googleAccessTokenExpiresAt),
      accessTokenExpiresIn: relativeFromNow(config.googleAccessTokenExpiresAt),
    },

    microsoft: {
      connected: Boolean(config.microsoftRefreshToken),
      email: config.microsoftUserEmail ?? null,
      userId: config.microsoftUserId ?? null,
      subscriptionId: maskId(config.microsoftSubscriptionId),
      subscriptionExpiresAt: isoOrNull(config.microsoftSubscriptionExpiration),
      subscriptionExpiresIn: relativeFromNow(config.microsoftSubscriptionExpiration),
      hasDeltaLink: Boolean(config.microsoftDeltaLink),
      accessTokenExpiresAt: isoOrNull(config.microsoftTokenExpiresAt),
      accessTokenExpiresIn: relativeFromNow(config.microsoftTokenExpiresAt),
    },

    monday: {
      connected: Boolean(config.mondayAccessToken),
    },

    status: config.status ?? null,
    lastError: config.lastError ?? null,

    activity: {
      lastSyncAt: isoOrNull(config.lastSyncAt),
      lastSyncAgo: relativeFromNow(config.lastSyncAt),
      createdAt: isoOrNull(config.createdAt),
      updatedAt: isoOrNull(config.updatedAt),
    },

    conditionals: {
      count: Array.isArray(config.conditionals) ? config.conditionals.length : 0,
      ids: Array.isArray(config.conditionals) ? config.conditionals.map((c) => c.id) : [],
    },

    backfill: config.backfill ?? null,
    inActiveIndex,
  };
}

function projectPolicy(policy) {
  if (!policy) return null;
  return {
    objectId: policy.objectId ?? null,
    boardId: policy.boardId ?? null,
    linkColumnId: policy.linkColumnId ?? null,
    peopleColumnId: policy.peopleColumnId ?? null,
    owner: {
      id: policy.ownerUserId ?? null,
      name: policy.mondayOwnerName ?? null,
      email: policy.mondayOwnerEmail ?? null,
    },
    columnMappingCount: policy.columnMapping
      ? Object.keys(policy.columnMapping).length
      : 0,
    conditionalEligibleCount: Array.isArray(policy.conditionalEligibleColumns)
      ? policy.conditionalEligibleColumns.length
      : 0,
    createdAt: isoOrNull(policy.createdAt),
    updatedAt: isoOrNull(policy.updatedAt),
  };
}

// Lazy backfill: when a config has a working monday access token but no
// cached identity (mondayUserName / mondayAccountSlug), fetch it once and
// persist back to the config. Best-effort — silent on failure (the token may
// be expired or revoked, or the API may be transiently down).
async function enrichConfigIdentity(config) {
  if (!config.mondayAccessToken) return config;
  const hasIdentity = config.mondayUserName && config.mondayUserEmail
    && config.mondayAccountSlug && config.mondayAccountName;
  if (hasIdentity) return config;
  try {
    const identity = await fetchMondayIdentity(config.mondayAccessToken);
    const patch = {};
    if (identity.timeZone     && !config.mondayTimeZone)     patch.mondayTimeZone     = identity.timeZone;
    if (identity.userName     && !config.mondayUserName)     patch.mondayUserName     = identity.userName;
    if (identity.userEmail    && !config.mondayUserEmail)    patch.mondayUserEmail    = identity.userEmail;
    if (identity.accountName  && !config.mondayAccountName)  patch.mondayAccountName  = identity.accountName;
    if (identity.accountSlug  && !config.mondayAccountSlug)  patch.mondayAccountSlug  = identity.accountSlug;
    if (Object.keys(patch).length > 0) {
      const updated = await syncConfigStorage.updateSyncConfig(config.configId, patch);
      logger.info('identity enriched', TAG, {
        cfg: shortId(config.configId), fields: Object.keys(patch),
      });
      return updated;
    }
  } catch (err) {
    logger.debug('identity enrich failed', TAG, {
      cfg: shortId(config.configId), error: err.message?.slice(0, 200),
    });
  }
  return config;
}

// Lazy backfill the instance policy with owner name/email. We need a working
// monday access token to query the users endpoint, so we pick any config in
// the instance that has one. Cheaper than asking each config individually.
async function enrichPolicyOwner(policy, configs) {
  if (!policy?.ownerUserId) return policy;
  if (policy.mondayOwnerName && policy.mondayOwnerEmail) return policy;

  // First: if the owner has their own connected config, copy from there.
  const ownerConfig = configs.find(
    (c) => c && String(c.userId) === String(policy.ownerUserId)
      && c.mondayUserName && c.mondayUserEmail
  );
  if (ownerConfig) {
    return await syncConfigStorage.updateInstancePolicy(policy.objectId, {
      mondayOwnerName: ownerConfig.mondayUserName,
      mondayOwnerEmail: ownerConfig.mondayUserEmail,
    });
  }

  // Otherwise: borrow any working monday token in the instance and query.
  const tokenConfig = configs.find((c) => c && c.mondayAccessToken);
  if (!tokenConfig) return policy;
  try {
    const map = await fetchMondayUsers(tokenConfig.mondayAccessToken, [policy.ownerUserId]);
    const owner = map[String(policy.ownerUserId)];
    if (owner?.name || owner?.email) {
      return await syncConfigStorage.updateInstancePolicy(policy.objectId, {
        mondayOwnerName: owner.name ?? null,
        mondayOwnerEmail: owner.email ?? null,
      });
    }
  } catch (err) {
    logger.debug('owner enrich failed', TAG, {
      objectId: policy.objectId, error: err.message?.slice(0, 200),
    });
  }
  return policy;
}

// GET /api/_debug/configs — full inventory grouped by instance.
//
// Discovery walks `all_active_configs` to collect every objectId currently
// running a subscription. For each instance we then load the full
// `instance_configs_<objectId>` list — this catches paused/error/pending
// configs in the same instance even if they're not in the active index.
//
// Caveat: an instance with ZERO active configs is invisible to discovery.
// Pass ?objectId=<id> to inspect such an instance directly.
router.get('/api/_debug/configs', requireSignedRequest, async (req, res) => {
  try {
    const activeIndex = await syncConfigStorage.getActiveConfigIndex();
    const explicitObjectId = req.query.objectId ? String(req.query.objectId) : null;

    const objectIds = new Set();
    if (explicitObjectId) objectIds.add(explicitObjectId);
    for (const entry of activeIndex) if (entry.objectId) objectIds.add(String(entry.objectId));

    const instances = [];
    let totalConfigs = 0;
    const accountIds = new Set();
    const byProvider = { google: 0, microsoft: 0, none: 0 };
    const byStatus = {};

    for (const objectId of objectIds) {
      let policy = await syncConfigStorage.getInstancePolicy(objectId);
      const configIds = await syncConfigStorage.getInstanceConfigs(objectId);

      // First pass — load each config and lazy-enrich identity if missing.
      const rawConfigs = [];
      for (const cid of configIds) {
        let cfg = await syncConfigStorage.getSyncConfig(cid);
        if (!cfg) {
          rawConfigs.push({ configId: cid, missing: true });
          continue;
        }
        cfg = await enrichConfigIdentity(cfg);
        rawConfigs.push(cfg);
      }

      // Second pass — enrich policy owner using configs we just loaded.
      policy = await enrichPolicyOwner(
        policy,
        rawConfigs.filter((c) => c && !c.missing),
      );

      // Third pass — project and tally summary buckets.
      const configs = [];
      for (const cfg of rawConfigs) {
        if (!cfg || cfg.missing) {
          configs.push({ configId: cfg?.configId, missing: true });
          continue;
        }
        const projected = projectConfig(cfg, { policy, activeIndex });
        configs.push(projected);
        totalConfigs += 1;
        if (cfg.accountId != null) accountIds.add(String(cfg.accountId));
        const provider = projected.provider || 'none';
        byProvider[provider] = (byProvider[provider] || 0) + 1;
        const status = projected.status || 'unknown';
        byStatus[status] = (byStatus[status] || 0) + 1;
      }

      instances.push({
        objectId,
        policy: projectPolicy(policy),
        configs,
      });
    }

    res.json({
      generatedAt: new Date().toISOString(),
      summary: {
        totalConfigs,
        totalInstances: instances.length,
        totalAccounts: accountIds.size,
        activeIndexSize: activeIndex.length,
        byProvider,
        byStatus,
      },
      activeIndex: activeIndex.map((e) => ({
        configId: e.configId,
        objectId: e.objectId ?? null,
        provider: e.provider ?? null,
        subscriptionExpiresAt: isoOrNull(e.subscriptionExpiration),
        subscriptionExpiresIn: relativeFromNow(e.subscriptionExpiration),
      })),
      instances,
    });
  } catch (error) {
    logger.error('debug listing failed', TAG, { error: error.message });
    res.status(500).json({ error: 'debug_failed', message: error.message });
  }
});

// GET /api/_debug/configs/:configId — drill-down on a single config.
router.get('/api/_debug/configs/:configId', requireSignedRequest, async (req, res) => {
  try {
    let config = await syncConfigStorage.getSyncConfig(req.params.configId);
    if (!config) return res.status(404).json({ error: 'config_not_found' });
    config = await enrichConfigIdentity(config);

    let policy = config.objectId
      ? await syncConfigStorage.getInstancePolicy(config.objectId)
      : null;
    if (policy) policy = await enrichPolicyOwner(policy, [config]);

    const activeIndex = await syncConfigStorage.getActiveConfigIndex();

    res.json({
      generatedAt: new Date().toISOString(),
      config: projectConfig(config, { policy, activeIndex }),
      policy: projectPolicy(policy),
      conditionals: Array.isArray(config.conditionals) ? config.conditionals : [],
    });
  } catch (error) {
    logger.error('debug detail failed', TAG, {
      configId: req.params.configId, error: error.message,
    });
    res.status(500).json({ error: 'debug_failed', message: error.message });
  }
});

export default router;
