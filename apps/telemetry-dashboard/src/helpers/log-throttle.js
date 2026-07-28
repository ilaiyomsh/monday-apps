// log-throttle.js — a fixed-window emission budget for log lines an UNAUTHENTICATED
// caller can trigger.
//
// Why this exists (audit finding 8): the pre-auth rejection in
// middlewares/session-token.js emits a WARN, and WARN ships to Axiom under the default
// policy. Any caller can reach it with no credentials at all, so 10k unauthenticated
// requests meant 10k Axiom writes — an external party choosing our ingest bill. The 401
// already protects the DATA; this protects the BUDGET.
//
// VENDORED copy: this app pushes its app root only, so a workspace dependency does not
// resolve at runtime. Keep behaviorally identical to
// apps/deadline-confirm/src/helpers/log-throttle.js.
//
// Two halves to the contract, both load-bearing:
//   1. bounded — at most `limit` emissions per `windowMs` per key;
//   2. never silent — while the budget is spent, occurrences are COUNTED, and the first
//      emission of the next window carries `suppressed: N`. A cap that hides its own
//      truncation reports green on something it is not measuring; the repo treats that
//      as the bug, not the mitigation.
//
// Keyed by REASON, deliberately not by IP: a per-IP budget is trivially bypassed by a
// distributed prober and grows the map with attacker-chosen keys. A per-reason budget is
// a hard ceiling of (#reasons x limit) writes per window regardless of source spread.

const DEFAULT_LIMIT = 10;
const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_KEYS = 500;

/**
 * Create a fixed-window log-emission budget.
 *
 * @param {object} [opts]
 * @param {number} [opts.limit=10] - emissions allowed per window per key; <=0 suppresses all.
 * @param {number} [opts.windowMs=60000] - window length in ms.
 * @param {() => number} [opts.now=Date.now] - injectable clock (ms).
 * @param {number} [opts.maxKeys=500] - soft cap on tracked keys before stale ones are pruned.
 * @returns {{ check(key: string): { suppressed: number } | null, size(): number }}
 */
export function createLogThrottle({
  limit = DEFAULT_LIMIT,
  windowMs = DEFAULT_WINDOW_MS,
  now = Date.now,
  maxKeys = DEFAULT_MAX_KEYS,
} = {}) {
  /** @type {Map<string, { windowStart: number, emitted: number, suppressed: number }>} */
  const states = new Map();

  /** Drop entries whose window has fully elapsed — a fresh entry is equivalent to a stale one. */
  function prune(currentTime) {
    for (const [key, state] of states) {
      if (currentTime - state.windowStart >= windowMs && state.suppressed === 0) states.delete(key);
    }
  }

  return {
    check(key) {
      const currentTime = now();
      const k = String(key);

      if (states.size > maxKeys) prune(currentTime);

      let state = states.get(k);
      if (!state) {
        state = { windowStart: currentTime, emitted: 0, suppressed: 0 };
        states.set(k, state);
      } else if (currentTime - state.windowStart >= windowMs) {
        // Window rolled: reset the budget but CARRY the suppressed tally so the next
        // emission can report it. Resetting it here is what would make the cap silent.
        state.windowStart = currentTime;
        state.emitted = 0;
      }

      if (state.emitted < limit) {
        state.emitted += 1;
        const suppressed = state.suppressed;
        state.suppressed = 0; // reported exactly once — never double-counted
        return { suppressed };
      }

      state.suppressed += 1;
      return null;
    },

    /** Tracked-key count — memory-hygiene assertions read this. */
    size() {
      return states.size;
    },
  };
}
