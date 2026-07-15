// Contract tests for src/helpers/rate-limit.js — spec §6.4: in-memory
// per-IP token bucket, 30 req/min per IP, continuous refill at
// capacity/windowMs. All timing goes through the injectable clock.

import { describe, it, expect, beforeEach } from 'vitest';
import { createRateLimiter } from '../src/helpers/rate-limit.js';

const CAPACITY = 30;
const WINDOW_MS = 60_000;

describe('createRateLimiter', () => {
  /** @type {number} fake clock, milliseconds */
  let t;
  /** @type {{ allow(ip: string): boolean }} */
  let limiter;

  beforeEach(() => {
    t = 0;
    limiter = createRateLimiter({ capacity: CAPACITY, windowMs: WINDOW_MS, now: () => t });
  });

  it('allows exactly 30 consecutive calls for one IP and denies the 31st', () => {
    const results = [];
    for (let i = 0; i < 31; i++) results.push(limiter.allow('10.0.0.1'));
    expect(results.slice(0, 30)).toEqual(new Array(30).fill(true));
    expect(results[30]).toBe(false);
  });

  it('allows a never-seen IP on its first call without prior setup', () => {
    expect(limiter.allow('203.0.113.7')).toBe(true);
  });

  it('keeps IP B’s full 30-token budget after IP A is exhausted', () => {
    for (let i = 0; i < 30; i++) limiter.allow('10.0.0.1');
    expect(limiter.allow('10.0.0.1')).toBe(false); // A exhausted

    const bResults = [];
    for (let i = 0; i < 31; i++) bResults.push(limiter.allow('10.0.0.2'));
    expect(bResults.slice(0, 30)).toEqual(new Array(30).fill(true));
    expect(bResults[30]).toBe(false);
  });

  it('allows a full 30-call budget again exactly one windowMs after exhaustion', () => {
    for (let i = 0; i < 30; i++) limiter.allow('10.0.0.1');
    expect(limiter.allow('10.0.0.1')).toBe(false);

    t = WINDOW_MS; // exactly one full window elapsed since the bucket emptied
    const results = [];
    for (let i = 0; i < 31; i++) results.push(limiter.allow('10.0.0.1'));
    expect(results.slice(0, 30)).toEqual(new Array(30).fill(true));
    expect(results[30]).toBe(false);
  });

  it('refills exactly one token after exactly windowMs/30 ms — one call allowed, the next denied', () => {
    for (let i = 0; i < 30; i++) limiter.allow('10.0.0.1');
    expect(limiter.allow('10.0.0.1')).toBe(false);

    t = WINDOW_MS / CAPACITY; // 2000ms — exactly one token's worth of refill
    expect(limiter.allow('10.0.0.1')).toBe(true);
    expect(limiter.allow('10.0.0.1')).toBe(false);
  });

  it('caps refill at capacity: after 3 idle windows the 31st call is still denied', () => {
    limiter.allow('10.0.0.1'); // create the bucket at t=0
    t = 3 * WINDOW_MS;
    const results = [];
    for (let i = 0; i < 31; i++) results.push(limiter.allow('10.0.0.1'));
    expect(results.slice(0, 30)).toEqual(new Array(30).fill(true));
    expect(results[30]).toBe(false);
  });
});
