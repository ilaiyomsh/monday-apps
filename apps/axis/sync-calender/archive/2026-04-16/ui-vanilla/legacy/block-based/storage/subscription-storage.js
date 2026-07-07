import { SecureStorage } from '@mondaycom/apps-sdk';
import LocalStorage from './local-storage.js';
import logger from '../services/logger.js';

const TAG = 'subscription_storage';
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 200;
// TTL must comfortably exceed monday's action retry cadence (up to ~10 minutes
// with exponential backoff on 500s) so a webhook write at T=0 is still
// readable by a retry invocation at T=8min. 2 minutes was too tight.
const TRIGGER_CACHE_TTL_MS = 30 * 60 * 1000;

function isTransient(error) {
  const status = error?.status;
  if (status === 500 || status === 502 || status === 503 || status === 429) {
    return true;
  }
  const msg = error?.message || '';
  if (msg.includes('invalid json response body')) return true;
  if (msg.includes('vault-server')) return true;
  if (msg.includes('accessing secure storage')) return true;
  if (msg.includes('Unexpected token')) return true;
  if (msg.includes('ECONNRESET') || msg.includes('ETIMEDOUT') || msg.includes('ENOTFOUND')) return true;
  if (status === undefined && error?.errorCode === undefined && msg) {
    return true;
  }
  return false;
}

async function withRetry(operation, opName, key) {
  let lastErr;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastErr = error;
      if (!isTransient(error)) {
        throw error;
      }
      if (attempt === MAX_RETRIES - 1) {
        logger.error('SecureStorage giving up after retries', TAG, {
          op: opName,
          key,
          attempts: MAX_RETRIES,
          errorMessage: error.message,
        });
        throw error;
      }
      const delay = BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 200;
      logger.warn('SecureStorage transient error, retrying', TAG, {
        op: opName,
        key,
        attempt: attempt + 1,
        delay: Math.round(delay),
        status: error.status,
        errorCode: error.errorCode,
        errorMessage: error.message?.substring(0, 200),
      });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// In-memory cache of active subscription metadata — survives within a single
// container lifetime. Reduces dependency on SecureStorage for hot webhook lookups.
const subscriptionCache = new Map();

// Singleflight: when N concurrent callers ask for the same key, only one
// SecureStorage call goes out; the others share the in-flight Promise. This
// is what absorbs Google's webhook bursts (12+ concurrent /webhook hits for
// the same subscription) before they overwhelm the vault server.
//
// We intentionally do NOT cache negative results. A previous version kept
// `unknownSubscriptions` with a TTL to avoid repeated vault hits for orphan
// channels, but in production vault-server occasionally returns null for
// keys that DO exist (transient issues surface as null rather than throw).
// That locked active subscriptions out for the TTL duration — symptom:
// `unknown subscriptionId in webhook` on subscriptions whose data is
// actually present in storage. With singleflight covering burst dedup, the
// negative cache offers little upside for a lot of downside.
const inflightGets = new Map(); // key -> Promise

class SubscriptionStorage {
  constructor() {
    // USE_LOCAL_STORAGE=true swaps SecureStorage for a file-backed shim so
    // tests can run without a monday code runtime. Production leaves it unset.
    this.storage = process.env.USE_LOCAL_STORAGE === 'true'
      ? new LocalStorage(process.env.LOCAL_STORAGE_FILE || '.dev/storage.json')
      : new SecureStorage();
  }

  async _get(key) {
    if (inflightGets.has(key)) {
      return inflightGets.get(key);
    }

    const promise = withRetry(
      async () => {
        try {
          const result = await this.storage.get(key);
          if (result == null) return null;
          return JSON.parse(result.value);
        } catch (error) {
          if (error.message?.includes('not found') || error.status === 404) {
            return null;
          }
          throw error;
        }
      },
      'get',
      key
    ).finally(() => {
      inflightGets.delete(key);
    });

    inflightGets.set(key, promise);
    return promise;
  }

  async _set(key, data) {
    return withRetry(
      async () => {
        await this.storage.set(key, JSON.stringify(data));
      },
      'set',
      key
    );
  }

  async _delete(key) {
    return withRetry(
      async () => {
        await this.storage.delete(key);
      },
      'delete',
      key
    );
  }

  // --- Subscription methods (prefix: subscription_) ---

  async getSubscription(subscriptionId) {
    if (subscriptionCache.has(subscriptionId)) {
      return subscriptionCache.get(subscriptionId);
    }
    const data = await this._get(`subscription_${subscriptionId}`);
    if (data) subscriptionCache.set(subscriptionId, data);
    return data;
  }

  async setSubscription(subscriptionId, data) {
    subscriptionCache.set(subscriptionId, data);
    return this._set(`subscription_${subscriptionId}`, data);
  }

  async updateSubscription(subscriptionId, partial) {
    const existing = (await this.getSubscription(subscriptionId)) || {};
    const merged = Object.assign(existing, partial);
    subscriptionCache.set(subscriptionId, merged);
    return this._set(`subscription_${subscriptionId}`, merged);
  }

  async deleteSubscription(subscriptionId) {
    subscriptionCache.delete(subscriptionId);
    return this._delete(`subscription_${subscriptionId}`);
  }

  // --- User subscription index (prefix: user_subscriptions_) ---

  async getUserSubscriptions(userId) {
    return (await this._get(`user_subscriptions_${userId}`)) || [];
  }

  async addUserSubscription(userId, subscriptionId) {
    const subs = await this.getUserSubscriptions(userId);
    if (!subs.includes(subscriptionId)) {
      subs.push(subscriptionId);
    }
    return this._set(`user_subscriptions_${userId}`, subs);
  }

  async removeUserSubscription(userId, subscriptionId) {
    const subs = await this.getUserSubscriptions(userId);
    return this._set(
      `user_subscriptions_${userId}`,
      subs.filter((id) => id !== subscriptionId)
    );
  }

  // --- Global subscription index (key: all_active_subscriptions) ---

  async getSubscriptionIndex() {
    return (await this._get('all_active_subscriptions')) || [];
  }

  async addToSubscriptionIndex({ subscriptionId, webhookUrl, userId, expiration }) {
    const index = await this.getSubscriptionIndex();
    index.push({ subscriptionId, webhookUrl, userId, expiration });
    return this._set('all_active_subscriptions', index);
  }

  async removeFromSubscriptionIndex(subscriptionId) {
    const index = await this.getSubscriptionIndex();
    return this._set(
      'all_active_subscriptions',
      index.filter((entry) => entry.subscriptionId !== subscriptionId)
    );
  }

  // --- Trigger cache (prefix: trigger_cache_) — short-lived routing data
  // written by the webhook when firing a trigger and consumed by the action
  // via runtimeMetadata.triggerUuid. TTL 2 minutes; entries auto-expire on read.

  async setTriggerCache(triggerUuid, payload, ttlMs = TRIGGER_CACHE_TTL_MS) {
    const entry = { ...payload, expiresAt: Date.now() + ttlMs };
    return this._set(`trigger_cache_${triggerUuid}`, entry);
  }

  async getTriggerCache(triggerUuid) {
    const entry = await this._get(`trigger_cache_${triggerUuid}`);
    if (!entry) return null;
    if (typeof entry.expiresAt === 'number' && entry.expiresAt < Date.now()) {
      // Lazy expiry — remove stale entry and return null
      try { await this._delete(`trigger_cache_${triggerUuid}`); } catch {}
      return null;
    }
    return entry;
  }

  async deleteTriggerCache(triggerUuid) {
    return this._delete(`trigger_cache_${triggerUuid}`);
  }
}

export default new SubscriptionStorage();
