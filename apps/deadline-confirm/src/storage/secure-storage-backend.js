// Production backend: @mondaycom/apps-sdk SecureStorage, normalized to the
// { get, set, delete } backend contract.
//
// PLATFORM QUIRK (apps-sdk 0.1.4, source-verified + production-observed
// 2026-07-15): SecureStorage.set wraps PRIMITIVES as { value } —
// `formalizedValue = isObject(value) ? value : { value }` — and get returns
// the wrapper verbatim. Without unwrapping, stored strings (oauth_token,
// link_secret) come back as objects: Authorization becomes
// '[object Object]' → 401 → the admin shows "broken" although the token is
// fine. Objects (config, nonces) pass through untouched.

// PRODUCTION INCIDENT (2026-07-29): `/api/state` failed with
// `secure_storage_get_failed: An issue occurred while accessing secure storage`
// on `<account>:config` — a key that existed. That string is the SDK's
// CATCH-ALL for every transport failure on the hop to Vault (5xx, an expired
// Vault token surfacing as 403, a socket reset, a non-JSON body), so it carries
// no information about the key. One blip took out the whole admin screen.
// Hence: bounded retries with backoff, applied to the transport-shaped errors
// only — a 400/404 from the SDK is deterministic and retrying it just adds
// latency to a failure that will not change.

import { SecureStorage } from '@mondaycom/apps-sdk';
import { logWarn } from '../helpers/logger.js';

const DEFAULT_RETRIES = 2;
const BASE_BACKOFF_MS = 150;

/** apps-sdk BaseError carries `status`. Absent status = below the SDK (socket). */
function isTransient(err) {
  const status = err?.status;
  return typeof status !== 'number' || status >= 500;
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function unwrapPrimitive(value) {
  if (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    'value' in value
  ) {
    return value.value;
  }
  return value;
}

/**
 * @param {object} [opts]
 * @param {number} [opts.retries=2] extra attempts after the first, transient errors only
 * @param {(ms: number) => Promise<void>} [opts.sleep] backoff hook (injected in tests)
 */
export function createSecureStorageBackend({ retries = DEFAULT_RETRIES, sleep = defaultSleep } = {}) {
  const secureStorage = new SecureStorage();

  /**
   * Run one SecureStorage operation, retrying transport failures with linear
   * backoff. The final failure is wrapped as `${failCode}: <message>` — the
   * shape the storage layer and the admin error surface already expect.
   */
  async function attempt(failCode, key, operation) {
    for (let tries = 0; tries <= retries; tries += 1) {
      try {
        return await operation();
      } catch (err) {
        const message = String(err?.message ?? err);
        if (!isTransient(err) || tries === retries) {
          const wrapped = new Error(`${failCode}: ${message}`);
          wrapped.cause = err;
          throw wrapped;
        }
        // A recovered blip is otherwise invisible. WARN ships to Axiom, so a
        // hop that is degrading shows up before it starts failing requests.
        logWarn('secure_storage', 'transient failure, retrying', {
          op: failCode,
          key,
          attempt: tries + 1,
          error: message,
        });
        await sleep(BASE_BACKOFF_MS * (tries + 1));
      }
    }
    // Unreachable: the final iteration always returns or throws.
    throw new Error(`${failCode}: retry loop exhausted`);
  }

  // COLD START. The SDK authenticates lazily per instance —
  // `this.connectionData = await authenticate(this.connectionData)` — so on a
  // cold container the four concurrent reads of GET /api/state each see
  // `connectionData === undefined` and each runs the full auth path (GCP
  // identity token → Vault GCP login → lookup-self), racing to assign the same
  // field. Observed 2026-07-29: first open failed every time, a refresh always
  // worked (the token TTL is hours, so only the first request ever pays).
  //
  // So the first operation runs ALONE and everything else waits behind it;
  // once one has completed, the connection is warm and the gate is gone for
  // good. Serializing warm reads would turn /api/state into four sequential
  // round trips on every request, which is why this is not a general mutex.
  let primed = false;
  /** @type {Promise<any> | null} in-flight priming attempt, if any */
  let priming = null;

  async function runPrimed(operation) {
    for (;;) {
      if (primed) return operation();
      const inFlight = priming;
      if (inFlight) {
        // Its failure is the primer's to report, not ours — we just re-check.
        await inFlight.catch(() => {});
        continue;
      }
      priming = (async () => {
        try {
          const value = await operation();
          primed = true;
          return value;
        } finally {
          priming = null;
        }
      })();
      return priming;
    }
  }

  return {
    async get(key) {
      const value = await runPrimed(() =>
        attempt('secure_storage_get_failed', key, () => secureStorage.get(key))
      );
      return unwrapPrimitive(value) ?? null;
    },
    async set(key, value) {
      await runPrimed(() =>
        attempt('secure_storage_set_failed', key, () => secureStorage.set(key, value))
      );
    },
    async delete(key) {
      await runPrimed(() =>
        attempt('secure_storage_delete_failed', key, () => secureStorage.delete(key))
      );
    },
  };
}
