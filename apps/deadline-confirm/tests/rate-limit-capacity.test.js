// TDD — the /amp/confirm bucket capacities, as VALUES the wiring imports.
//
// They stopped being an implementation detail on 2026-08-04: until then one
// message meant one POST, and 30/min per (account × IP) was generous. With one
// form per row a reader who works through a 30-task digest fires 30 requests in
// a couple of minutes, and bucket B would start answering [E9] mid-email while
// the rows already written stayed written — the worst possible failure shape.
//
// The monday side does NOT get busier: same tasks, same writes, same complexity
// budget — only the request count changed, which is what these buckets count.
//
// They live here, next to the limiter, because src/index.js is not testable
// (it binds a port on import).

import { describe, it, expect } from 'vitest';
import {
  createRateLimiter,
  AMP_PER_IP_CAPACITY,
  AMP_PER_ACCOUNT_CAPACITY,
} from '../src/helpers/rate-limit.js';

describe('AMP bucket capacities', () => {
  it('allows a full 30-row digest from one reader without tripping bucket B', () => {
    expect(AMP_PER_ACCOUNT_CAPACITY).toBeGreaterThanOrEqual(120);
  });

  it('keeps bucket A (per IP) no tighter than bucket B (per account × IP)', () => {
    // Bucket A runs FIRST, before any storage read. If it were the tighter of
    // the two, bucket B's budget could never be reached and raising it would be
    // theatre.
    expect(AMP_PER_IP_CAPACITY).toBeGreaterThanOrEqual(AMP_PER_ACCOUNT_CAPACITY);
  });

  it('spends exactly the account capacity before refusing', () => {
    let clock = 1_000_000;
    const limiter = createRateLimiter({ capacity: AMP_PER_ACCOUNT_CAPACITY, now: () => clock });
    for (let i = 0; i < AMP_PER_ACCOUNT_CAPACITY; i += 1) {
      expect(limiter.allow('777:203.0.113.9')).toBe(true);
    }
    expect(limiter.allow('777:203.0.113.9')).toBe(false);
  });

  it('still refills over one window, so a rate-limited reader recovers', () => {
    let clock = 1_000_000;
    const limiter = createRateLimiter({ capacity: AMP_PER_ACCOUNT_CAPACITY, now: () => clock });
    for (let i = 0; i < AMP_PER_ACCOUNT_CAPACITY; i += 1) limiter.allow('k');
    expect(limiter.allow('k')).toBe(false);
    clock += 60_000;
    expect(limiter.allow('k')).toBe(true);
  });

  it('counts each key separately — one busy reader cannot lock out another', () => {
    let clock = 1_000_000;
    const limiter = createRateLimiter({ capacity: AMP_PER_ACCOUNT_CAPACITY, now: () => clock });
    for (let i = 0; i < AMP_PER_ACCOUNT_CAPACITY; i += 1) limiter.allow('777:1.1.1.1');
    expect(limiter.allow('777:1.1.1.1')).toBe(false);
    expect(limiter.allow('777:2.2.2.2')).toBe(true);
  });
});
