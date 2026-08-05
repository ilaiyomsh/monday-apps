// In-memory per-IP token bucket (spec §6.4), single container by design
// (locked decision §3 — no distributed limiter).

/**
 * Bucket A on POST /amp/confirm — per bare client IP, spent before any storage
 * read. It must not be the tighter of the two, or bucket B's budget could never
 * be reached.
 */
export const AMP_PER_IP_CAPACITY = 120;

/**
 * Bucket B on POST /amp/confirm — per `${accountId}:${ip}`, the account's
 * monday-budget guard, spent after verification.
 *
 * Raised from 30 on 2026-08-04, when one form per row replaced the bulk form:
 * one message used to be one POST, and is now one POST PER TASK. At 30 a reader
 * working through a large digest would start getting [E9] partway down the
 * email, with the earlier rows already written — a half-updated board and no way
 * to tell which half. The monday side is unchanged by this: same tasks, same
 * writes, same complexity budget; only the request count moved.
 */
export const AMP_PER_ACCOUNT_CAPACITY = 120;

/**
 * Create a token-bucket rate limiter keyed by IP.
 *
 * Each IP gets a bucket of `capacity` tokens, starting full. Every allowed
 * call consumes one token; tokens refill continuously at a rate of
 * `capacity / windowMs` (i.e. a full bucket refills over one window).
 * `allow` never throws; unknown IPs get a fresh full bucket.
 *
 * Buckets idle longer than 2×windowMs are pruned on access (memory hygiene)
 * — safe because an idle bucket would have refilled to full anyway, which is
 * exactly what a fresh bucket is.
 *
 * @param {object} [opts]
 * @param {number} [opts.capacity=30]
 * @param {number} [opts.windowMs=60000]
 * @param {() => number} [opts.now=Date.now] - injectable clock (ms)
 * @returns {{ allow(ip: string): boolean }}
 */
export function createRateLimiter({ capacity = 30, windowMs = 60_000, now = Date.now } = {}) {
  /** @type {Map<string, { tokens: number, lastRefill: number }>} */
  const buckets = new Map();
  const refillPerMs = capacity / windowMs;

  function prune(currentTime) {
    for (const [ip, bucket] of buckets) {
      if (currentTime - bucket.lastRefill > 2 * windowMs) buckets.delete(ip);
    }
  }

  return {
    allow(ip) {
      const currentTime = now();
      if (buckets.size > 10_000) prune(currentTime);

      let bucket = buckets.get(ip);
      if (!bucket) {
        bucket = { tokens: capacity, lastRefill: currentTime };
        buckets.set(ip, bucket);
      } else {
        const elapsed = currentTime - bucket.lastRefill;
        if (elapsed > 0) {
          bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refillPerMs);
          bucket.lastRefill = currentTime;
        }
      }

      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        return true;
      }
      return false;
    },
  };
}
