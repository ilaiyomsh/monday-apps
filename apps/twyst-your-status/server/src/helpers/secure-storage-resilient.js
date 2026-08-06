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
 *  3. PER-ATTEMPT GET TIMEOUT (round360) — the SDK's fetch has NO timeout
 *     (verified 2026-08-06), so a hanging Vault attempt is otherwise unbounded.
 *     Each GET attempt races a timer (opts.getTimeoutMs, default 3000ms); the
 *     timeout error is shaped like the SDK's own transient wrapper so
 *     isTransientStorageError classifies it and guard 1's retry loop retries it.
 *     GETS ONLY: set/delete are deliberately un-timed — timing out the
 *     refresh-persist write risks orphaning a rotated refresh token (monday has
 *     already invalidated the old one, so abandoning the write loses the only
 *     copy of the new one).
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
 * @param {{ retries?: number, delayMs?: number, getTimeoutMs?: number, sleep?: (ms:number)=>Promise<void>, logger?: object }} [opts]
 * @returns {{ get: Function, set: Function, delete: Function }}
 */
export function createResilientSecureStorage(inner, opts = {}) {
  const retries = opts.retries ?? 3;
  const delayMs = opts.delayMs ?? 200;
  // Default set FROM the round360 live measurements, not guessed (review doc
  // §6.1: every outbound call from a degraded container measured ~4-5s, and the
  // SDK's cold GCP+login ladder can exceed that). The cap exists to bound a
  // genuine HANG; a value below the honest slow-path latency would time out
  // every slow-but-successful read three times and disable the guard outright
  // (round360 review finding, P0).
  const getTimeoutMs = opts.getTimeoutMs ?? 8000;
  const sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const logger = opts.logger;
  const TAG = 'secure-storage';

  /**
   * One GET attempt raced against a per-attempt timer (guard 3). The timeout
   * message deliberately contains BOTH the SDK's own transient wrapper phrase
   * ('accessing secure storage' — so isTransientStorageError classifies it and
   * withRetry retries it) and 'timed out' (so code:logs distinguishes a hang
   * from a real SDK failure). The timer is cleared as soon as the attempt
   * settles — no open handle outlives the operation.
   */
  function getAttemptWithTimeout(key) {
    return new Promise((resolve, reject) => {
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        reject(new Error(
          `An issue occurred while accessing secure storage: get ${key} timed out after ${getTimeoutMs}ms`,
        ));
      }, getTimeoutMs);
      Promise.resolve(inner.get(key))
        .then((value) => {
          clearTimeout(timer);
          resolve(value); // no-op if the timeout already rejected — safe either way
        })
        .catch((err) => {
          clearTimeout(timer);
          if (timedOut) {
            // The losing attempt failed AFTER the caller already got the timeout
            // rejection. Nobody awaits this promise anymore, so without a handler
            // it would surface as an unhandledRejection — log it instead
            // (error-guard: a catch must log/rethrow/display; recovery is owned
            // by the retry loop that already moved on).
            logger?.warn?.(
              `secure storage late failure after get ${key} timed out: ${String(err?.message ?? err)}`,
              TAG,
              {},
            );
            return;
          }
          reject(err);
        });
    });
  }

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
      // Each retry attempt gets its OWN timeout race (guard 3), so a hanging
      // attempt costs getTimeoutMs — not forever — before the retry loop kicks in.
      const p = withRetry(() => getAttemptWithTimeout(key), `get ${key}`).finally(() => {
        inflightGets.delete(key);
      });
      inflightGets.set(key, p);
      return p;
    },
    // set/delete get NO timeout, deliberately: timing out the refresh-persist
    // write risks orphaning a rotated refresh token — monday has already
    // invalidated the old token by the time we persist the new one, so
    // abandoning a slow-but-alive write could lose the only copy of it.
    // A slow write is better than a lost credential.
    set(key, value) {
      return withRetry(() => inner.set(key, value), `set ${key}`);
    },
    delete(key) {
      return withRetry(() => inner.delete(key), `delete ${key}`);
    },
  };
}
