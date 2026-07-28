// test-guard gate for src/helpers/log-throttle.js (VENDORED copy — keep behaviorally
// identical to apps/deadline-confirm's; this app pushes its app root only, so a workspace
// dependency would not resolve at runtime) — the budget guard on
// attacker-reachable log lines. Audit finding 8: a pre-auth rejection emitted a
// WARN, and WARN ships to Axiom by default, so 10k unauthenticated requests were
// 10k Axiom writes. `/oauth/start` makes that path reachable without credentials.
//
// The contract has two halves and BOTH matter: emissions are bounded per window,
// and nothing is dropped silently — the next emitted record carries the count of
// what was suppressed while the budget was exhausted.

import { describe, it, expect } from 'vitest';
import { createLogThrottle } from '../src/helpers/log-throttle.js';

/** A controllable clock so windows roll deterministically (no wall-clock flake). */
function fakeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

describe('createLogThrottle', () => {
  it('allows up to `limit` emissions per window, then suppresses', () => {
    const clock = fakeClock();
    const throttle = createLogThrottle({ limit: 3, windowMs: 60_000, now: clock.now });

    const verdicts = [1, 2, 3, 4, 5].map(() => throttle.check('invalid'));

    expect(verdicts.map((v) => v !== null)).toEqual([true, true, true, false, false]);
  });

  it('reports zero suppressed while inside the budget', () => {
    const clock = fakeClock();
    const throttle = createLogThrottle({ limit: 2, windowMs: 60_000, now: clock.now });

    expect(throttle.check('invalid')).toEqual({ suppressed: 0 });
    expect(throttle.check('invalid')).toEqual({ suppressed: 0 });
  });

  it('hands the suppressed count to the first emission of the NEXT window', () => {
    const clock = fakeClock();
    const throttle = createLogThrottle({ limit: 1, windowMs: 60_000, now: clock.now });

    expect(throttle.check('invalid')).toEqual({ suppressed: 0 });
    // four more arrive while the budget is spent — all suppressed, all counted
    for (let i = 0; i < 4; i++) expect(throttle.check('invalid')).toBeNull();

    clock.advance(60_000);
    // The loss becomes VISIBLE here rather than vanishing (no silent caps).
    expect(throttle.check('invalid')).toEqual({ suppressed: 4 });
  });

  it('clears the suppressed count once reported (it is never double-counted)', () => {
    const clock = fakeClock();
    const throttle = createLogThrottle({ limit: 1, windowMs: 60_000, now: clock.now });

    throttle.check('invalid');
    throttle.check('invalid'); // suppressed 1
    clock.advance(60_000);
    expect(throttle.check('invalid')).toEqual({ suppressed: 1 });
    clock.advance(60_000);
    expect(throttle.check('invalid')).toEqual({ suppressed: 0 });
  });

  it('budgets each key independently, so one noisy reason cannot mute another', () => {
    const clock = fakeClock();
    const throttle = createLogThrottle({ limit: 1, windowMs: 60_000, now: clock.now });

    expect(throttle.check('invalid')).toEqual({ suppressed: 0 });
    expect(throttle.check('invalid')).toBeNull();
    // 'missing' has its own untouched budget
    expect(throttle.check('missing')).toEqual({ suppressed: 0 });
  });

  it('does not roll the window early (a partial window keeps suppressing)', () => {
    const clock = fakeClock();
    const throttle = createLogThrottle({ limit: 1, windowMs: 60_000, now: clock.now });

    throttle.check('invalid');       // spends the single-emission budget
    clock.advance(59_999);
    expect(throttle.check('invalid')).toBeNull();  // still the same window — 1 suppressed
    clock.advance(1);                 // now exactly windowMs since the window opened
    expect(throttle.check('invalid')).toEqual({ suppressed: 1 });
  });

  it('bounds memory: idle keys are pruned rather than accumulating forever', () => {
    const clock = fakeClock();
    const throttle = createLogThrottle({ limit: 1, windowMs: 1_000, now: clock.now, maxKeys: 50 });

    // A prober rotating the key (e.g. per-account reasons) must not grow the map without bound.
    for (let i = 0; i < 500; i++) {
      clock.advance(10_000); // every key goes stale immediately
      throttle.check(`reason-${i}`);
    }

    expect(throttle.size()).toBeLessThanOrEqual(50);
  });

  it('treats a non-positive limit as "suppress everything" rather than dividing by zero', () => {
    const clock = fakeClock();
    const throttle = createLogThrottle({ limit: 0, windowMs: 60_000, now: clock.now });
    expect(throttle.check('invalid')).toBeNull();
  });
});
