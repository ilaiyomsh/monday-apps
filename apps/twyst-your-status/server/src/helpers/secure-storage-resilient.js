/**
 * secure-storage-resilient — wraps a monday-code SecureStorage with two guards
 * against the platform's transient Vault hiccups (observed live 2026-08-05 on a
 * cold draft container: `invalid json response body at …/vault-server…/auth/gcp/
 * login` and `An issue occurred while accessing secure storage`, which surfaced
 * as intermittent 502s on enroll/status/bypasses):
 *
 *  1. RETRY — get/set/delete retry a few times with linear backoff on a transient
 *     storage error, so a momentary Vault failure becomes a short internal wait
 *     instead of a 5xx. A non-transient error (or the final attempt) rethrows, so
 *     genuine failures still surface (error-guard: nothing is swallowed).
 *  2. IN-FLIGHT GET COALESCING — concurrent reads of the SAME key share ONE Vault
 *     round-trip (the settings screen fires status+bypasses+enroll at once, each
 *     re-reading the same token keys). This only merges reads already overlapping
 *     in time — it caches nothing across calls, so it introduces no staleness and
 *     is safe for the rotating-refresh-token records. Mirrors stores.js's own
 *     single-flight refresh lane.
 */

/**
 * A transient monday-code SecureStorage/Vault failure worth retrying — matched by
 * the signatures the SDK surfaces (the Vault GCP-login endpoint returning an HTML
 * error page, or the SDK's wrapped "accessing secure storage" message). A "key not
 * found" is NOT an error here (SecureStorage.get resolves null), so only thrown
 * infra failures reach this.
 * @param {unknown} err
 * @returns {boolean}
 */
export function isTransientStorageError(err) {
  const msg = String(err?.message ?? err ?? '').toLowerCase();
  return (
    msg.includes('accessing secure storage') ||
    msg.includes('vault-server') ||
    msg.includes('/auth/gcp/login') ||
    msg.includes('invalid json response body')
  );
}

/**
 * @param {{ get: Function, set: Function, delete?: Function }} inner - the SDK SecureStorage
 * @param {{ retries?: number, delayMs?: number, sleep?: (ms:number)=>Promise<void>, logger?: object }} [opts]
 * @returns {{ get: Function, set: Function, delete: Function }}
 */
export function createResilientSecureStorage(inner, opts = {}) {
  const retries = opts.retries ?? 3;
  const delayMs = opts.delayMs ?? 200;
  const sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const logger = opts.logger;
  const TAG = 'secure-storage';

  /** Run `op`, retrying transient storage failures up to `retries` times. */
  async function withRetry(op, label) {
    let lastErr;
    for (let attempt = 1; attempt <= retries; attempt += 1) {
      try {
        return await op();
      } catch (err) {
        lastErr = err;
        if (!isTransientStorageError(err) || attempt === retries) throw err;
        // Non-silent (error-guard): a transient retry is a WARN, not swallowed —
        // the message carries the reason so it is readable in code:logs.
        logger?.warn?.(
          `secure storage transient failure on ${label} (attempt ${attempt}/${retries}) — retrying: ${String(err?.message ?? err)}`,
          TAG,
          {},
        );
        await sleep(delayMs * attempt);
      }
    }
    throw lastErr; // unreachable (loop rethrows on the final attempt) — defensive.
  }

  /** key -> in-flight get promise, cleared on settle (coalescing window only). */
  const inflightGets = new Map();

  return {
    get(key) {
      const existing = inflightGets.get(key);
      if (existing) return existing;
      const p = withRetry(() => inner.get(key), `get ${key}`).finally(() => {
        inflightGets.delete(key);
      });
      inflightGets.set(key, p);
      return p;
    },
    set(key, value) {
      return withRetry(() => inner.set(key, value), `set ${key}`);
    },
    delete(key) {
      return withRetry(() => inner.delete(key), `delete ${key}`);
    },
  };
}
