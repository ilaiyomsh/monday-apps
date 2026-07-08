// Storage module for the Custom Object path. Kept deliberately separate from
// subscription-storage.js so the v3 automation path is untouched during the
// coexistence window.
//
// Key families:
//   instance_policy_<objectId>         shared board+mapping per Custom Object instance
//   sync_config_<configId>             per-user connection row
//   instance_configs_<objectId>        [configId, ...] — rows visible in one table
//   user_configs_<userId>              [configId, ...] — a user's rows across instances
//   account_configs_<accountId>        [configId, ...] — admin overview
//   all_active_configs                 [{ configId, objectId, provider, subscriptionExpiration }, ...]
//   oauth_state_<state>                CSRF guard entries (5-min TTL, consume-once)
//
// Reuses the same withRetry + backend-swap pattern as subscription-storage.js
// (copy-pasted on purpose so neither file can break the other).

import { SecureStorage } from '@mondaycom/apps-sdk';
import LocalStorage from './local-storage.js';
import logger from '../services/logger.js';

const TAG = 'sync_config_storage';
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 200;
const OAUTH_STATE_TTL_MS = 5 * 60 * 1000;

function isTransient(error) {
  const status = error?.status;
  if (status === 500 || status === 502 || status === 503 || status === 429) return true;
  const msg = error?.message || '';
  if (msg.includes('invalid json response body')) return true;
  if (msg.includes('vault-server')) return true;
  if (msg.includes('accessing secure storage')) return true;
  if (msg.includes('Unexpected token')) return true;
  if (msg.includes('ECONNRESET') || msg.includes('ETIMEDOUT') || msg.includes('ENOTFOUND')) return true;
  if (status === undefined && error?.errorCode === undefined && msg) return true;
  return false;
}

async function withRetry(operation, opName, key) {
  let lastErr;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastErr = error;
      if (!isTransient(error)) throw error;
      if (attempt === MAX_RETRIES - 1) {
        logger.error('giving up', TAG, {
          op: opName, key, attempts: MAX_RETRIES, error: error.message?.slice(0, 200),
        });
        throw error;
      }
      const delay = BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 200;
      // Transient retries are debug-only — only the final give-up matters for
      // operators. The retry loop is internal noise otherwise.
      logger.debug('transient retry', TAG, {
        op: opName, attempt: attempt + 1, delay: Math.round(delay), status: error.status,
      });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// Singleflight + in-memory cache, same rationale as subscription-storage.js.
const policyCache = new Map();
const configCache = new Map();
const inflightGets = new Map();

class SyncConfigStorage {
  constructor() {
    this.storage = process.env.USE_LOCAL_STORAGE === 'true'
      ? new LocalStorage(process.env.LOCAL_STORAGE_FILE || '.dev/storage.json')
      : new SecureStorage();
  }

  async _get(key) {
    if (inflightGets.has(key)) return inflightGets.get(key);
    const promise = withRetry(
      async () => {
        try {
          const result = await this.storage.get(key);
          if (result == null) return null;
          return JSON.parse(result.value);
        } catch (error) {
          if (error.message?.includes('not found') || error.status === 404) return null;
          throw error;
        }
      },
      'get', key
    ).finally(() => inflightGets.delete(key));
    inflightGets.set(key, promise);
    return promise;
  }

  async _set(key, data) {
    return withRetry(async () => { await this.storage.set(key, JSON.stringify(data)); }, 'set', key);
  }

  async _delete(key) {
    return withRetry(async () => { await this.storage.delete(key); }, 'delete', key);
  }

  // --- instance_policy_<objectId> — ADMIN-managed shared policy ---

  async getInstancePolicy(objectId) {
    if (policyCache.has(objectId)) return policyCache.get(objectId);
    const data = await this._get(`instance_policy_${objectId}`);
    if (data) policyCache.set(objectId, data);
    return data;
  }

  async setInstancePolicy(objectId, data) {
    policyCache.set(objectId, data);
    return this._set(`instance_policy_${objectId}`, data);
  }

  async updateInstancePolicy(objectId, partial) {
    const existing = (await this.getInstancePolicy(objectId)) || {};
    const merged = Object.assign(existing, partial, { updatedAt: Date.now() });
    policyCache.set(objectId, merged);
    await this._set(`instance_policy_${objectId}`, merged);
    return merged;
  }

  async deleteInstancePolicy(objectId) {
    policyCache.delete(objectId);
    return this._delete(`instance_policy_${objectId}`);
  }

  // --- sync_config_<configId> — per-user connection row ---

  async getSyncConfig(configId) {
    if (configCache.has(configId)) return configCache.get(configId);
    const data = await this._get(`sync_config_${configId}`);
    if (data) {
      // Default `provider` for configs created before the multi-provider
      // refactor — they're all Google. Stamped only on read; storage is
      // upgraded on the next write.
      if (!data.provider) data.provider = 'google';
      configCache.set(configId, data);
    }
    return data;
  }

  async setSyncConfig(configId, data) {
    configCache.set(configId, data);
    return this._set(`sync_config_${configId}`, data);
  }

  async updateSyncConfig(configId, partial) {
    const existing = (await this.getSyncConfig(configId)) || {};
    const merged = Object.assign(existing, partial, { updatedAt: Date.now() });
    configCache.set(configId, merged);
    await this._set(`sync_config_${configId}`, merged);
    return merged;
  }

  async deleteSyncConfig(configId) {
    configCache.delete(configId);
    return this._delete(`sync_config_${configId}`);
  }

  // --- instance_configs_<objectId> — rows shown in a Custom Object instance ---

  async getInstanceConfigs(objectId) {
    return (await this._get(`instance_configs_${objectId}`)) || [];
  }

  async addInstanceConfig(objectId, configId) {
    const list = await this.getInstanceConfigs(objectId);
    if (!list.includes(configId)) list.push(configId);
    return this._set(`instance_configs_${objectId}`, list);
  }

  async removeInstanceConfig(objectId, configId) {
    const list = await this.getInstanceConfigs(objectId);
    return this._set(`instance_configs_${objectId}`, list.filter((id) => id !== configId));
  }

  // --- user_configs_<userId> — a user's rows across instances ---

  async getUserConfigs(userId) {
    return (await this._get(`user_configs_${userId}`)) || [];
  }

  async addUserConfig(userId, configId) {
    const list = await this.getUserConfigs(userId);
    if (!list.includes(configId)) list.push(configId);
    return this._set(`user_configs_${userId}`, list);
  }

  async removeUserConfig(userId, configId) {
    const list = await this.getUserConfigs(userId);
    return this._set(`user_configs_${userId}`, list.filter((id) => id !== configId));
  }

  // --- account_configs_<accountId> — account overview ---

  async getAccountConfigs(accountId) {
    return (await this._get(`account_configs_${accountId}`)) || [];
  }

  async addAccountConfig(accountId, configId) {
    const list = await this.getAccountConfigs(accountId);
    if (!list.includes(configId)) list.push(configId);
    return this._set(`account_configs_${accountId}`, list);
  }

  async removeAccountConfig(accountId, configId) {
    const list = await this.getAccountConfigs(accountId);
    return this._set(`account_configs_${accountId}`, list.filter((id) => id !== configId));
  }

  // --- all_active_configs — global index for watch-renewal cron ---

  async getActiveConfigIndex() {
    return (await this._get('all_active_configs')) || [];
  }

  // Provider-aware index entry. Legacy callers passed `googleWatchExpiration`;
  // we accept either shape and normalize to `subscriptionExpiration`.
  async addActiveConfig({ configId, objectId, provider, subscriptionExpiration, googleWatchExpiration }) {
    const list = await this.getActiveConfigIndex();
    const filtered = list.filter((e) => e.configId !== configId);
    const exp = subscriptionExpiration ?? googleWatchExpiration;
    filtered.push({
      configId,
      objectId,
      provider: provider || 'google',
      subscriptionExpiration: exp,
    });
    return this._set('all_active_configs', filtered);
  }

  async removeActiveConfig(configId) {
    const list = await this.getActiveConfigIndex();
    return this._set('all_active_configs', list.filter((e) => e.configId !== configId));
  }

  // --- oauth_state_<state> — CSRF guard, 5-min TTL, consume-once ---

  async setOauthState(state, payload) {
    const entry = { ...payload, expiresAt: Date.now() + OAUTH_STATE_TTL_MS };
    return this._set(`oauth_state_${state}`, entry);
  }

  async consumeOauthState(state) {
    const entry = await this._get(`oauth_state_${state}`);
    if (!entry) return null;
    try { await this._delete(`oauth_state_${state}`); } catch { /* ignore */ }
    if (typeof entry.expiresAt === 'number' && entry.expiresAt < Date.now()) return null;
    return entry;
  }
}

const syncConfigStorage = new SyncConfigStorage();
export default syncConfigStorage;
