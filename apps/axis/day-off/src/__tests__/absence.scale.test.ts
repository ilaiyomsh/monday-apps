/**
 * High-scale + boundary tests for domain/absence, checked against an
 * INDEPENDENT reference implementation built here in the test file.
 *
 * The reference uses only the separately-tested date primitives
 * (workdaysBetween / eachDay / isWeekend / fromKey) plus the contract rules:
 *   - a request is attributed to its START year (Number(start.slice(0,4)));
 *   - 'approved' feeds `used`, 'pending' feeds `pending`, 'rejected' is ignored;
 *   - a Dec→Jan spill counts its FULL workday span toward the start year and
 *     contributes NOTHING to year+1 (computeBalance does NOT clip);
 *   - reqWorkdayKeysInYear DOES clip to the calendar year and drops Fri/Sat.
 *
 * Scale data comes from @axis/scale-fixtures — its generators may still be
 * NOT_IMPLEMENTED stubs; the handcrafted suites below must pass regardless.
 */
import { describe, it, expect } from 'vitest';
import {
  computeBalance,
  pendingDaysFor,
  reqWorkdayKeysInYear,
} from '../domain/absence';
import { workdaysBetween, eachDay, isWeekend, fromKey } from '../domain/dates';
import { genDayOffRequests, genEntitlements } from '@axis/scale-fixtures';
import type { Balance, DayOffRequest, Entitlement } from '../domain/types';

/* ------------------------------------------------------------------ */
/* Independent reference implementation                                */
/* ------------------------------------------------------------------ */

/** Start-year attribution, restated independently of the product code. */
function refStartYear(r: DayOffRequest): number {
  return Number(r.start.slice(0, 4));
}

interface RefTally {
  used: number;
  pending: number;
}

/**
 * ONE pass over all requests → Map `${employeeId}|${type}` → {used, pending}
 * for requests attributed (by start year) to `year`. Full workday span via
 * workdaysBetween — no year clipping, matching the computeBalance contract.
 */
function refTallies(requests: DayOffRequest[], year: number): Map<string, RefTally> {
  const tallies = new Map<string, RefTally>();
  for (const r of requests) {
    if (refStartYear(r) !== year) continue;
    if (r.status !== 'approved' && r.status !== 'pending') continue;
    const key = `${r.employeeId}|${r.type}`;
    let t = tallies.get(key);
    if (!t) {
      t = { used: 0, pending: 0 };
      tallies.set(key, t);
    }
    const days = workdaysBetween(r.start, r.end);
    if (r.status === 'approved') t.used += days;
    else t.pending += days;
  }
  return tallies;
}

/** Map `${employeeId}|${type}` → entitled for rows matching `year`. */
function refEntitledMap(entitlements: Entitlement[], year: number): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of entitlements) {
    if (e.year === year) m.set(`${e.employeeId}|${e.type}`, e.entitled);
  }
  return m;
}

/** Reference for reqWorkdayKeysInYear: clip to the year, drop Fri/Sat. */
function refWorkdayKeysInYear(r: DayOffRequest, year: number): string[] {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const start = r.start > from ? r.start : from;
  const end = r.end < to ? r.end : to;
  if (start > end) return [];
  return eachDay(start, end).filter((k) => !isWeekend(fromKey(k)));
}

/* ------------------------------------------------------------------ */
/* Shared scale dataset (generators may throw NOT_IMPLEMENTED — the    */
/* call happens INSIDE the scale tests so handcrafted suites still run)*/
/* ------------------------------------------------------------------ */

const YEAR = 2026;
const TYPES = ['vacation', 'sick', 'reserves', 'unpaid'];
const EMPLOYEE_IDS = Array.from({ length: 30 }, (_, i) => `emp-${String(i + 1).padStart(2, '0')}`);
const SEED = 20260717;

function scaleDataset(): { requests: DayOffRequest[]; entitlements: Entitlement[] } {
  const requests = genDayOffRequests({
    employeeIds: EMPLOYEE_IDS,
    types: TYPES,
    year: YEAR,
    count: 1000,
    seed: SEED,
  }) as DayOffRequest[];
  const entitlements = genEntitlements({
    employeeIds: EMPLOYEE_IDS,
    types: TYPES,
    year: YEAR,
    seed: SEED,
  }) as Entitlement[];
  return { requests, entitlements };
}

/** Handcrafted request factory (mirrors the shape used by the small suite). */
function req(p: Partial<DayOffRequest>): DayOffRequest {
  return {
    id: 'r',
    employeeId: 'e1',
    type: 'vacation',
    start: '2026-06-01',
    end: '2026-06-01',
    status: 'approved',
    submittedAt: '2026-06-01',
    ...p,
  };
}

/* ------------------------------------------------------------------ */
/* 1. SCALE vs REFERENCE                                               */
/* ------------------------------------------------------------------ */

describe('scale: computeBalance/pendingDaysFor match an independent one-pass reference over 1,000 requests', () => {
  it('every one of the 120 (employee × type) pairs equals the reference tallies exactly', () => {
    const { requests, entitlements } = scaleDataset();

    // Dataset sanity — a vacuous dataset would make the sweep meaningless.
    expect(requests).toHaveLength(1000);
    expect(requests.filter((r) => r.status === 'pending').length).toBeGreaterThan(0);
    expect(requests.filter((r) => r.status === 'approved').length).toBeGreaterThan(0);
    expect(requests.filter((r) => r.status === 'rejected').length).toBeGreaterThan(0);

    const tallies = refTallies(requests, YEAR);
    const entitledOf = refEntitledMap(entitlements, YEAR);

    let pairsChecked = 0;
    let nonZeroPairs = 0;
    for (const employeeId of EMPLOYEE_IDS) {
      for (const type of TYPES) {
        const key = `${employeeId}|${type}`;
        const t = tallies.get(key) ?? { used: 0, pending: 0 };
        const expected: Balance = {
          entitled: entitledOf.get(key) ?? 0,
          used: t.used,
          pending: t.pending,
        };
        expect(
          computeBalance(requests, entitlements, employeeId, type, YEAR),
          `computeBalance mismatch for ${key}`
        ).toEqual(expected);
        expect(
          pendingDaysFor(requests, employeeId, type, YEAR),
          `pendingDaysFor mismatch for ${key}`
        ).toBe(expected.pending);
        pairsChecked += 1;
        if (expected.used > 0 || expected.pending > 0) nonZeroPairs += 1;
      }
    }
    expect(pairsChecked).toBe(120);
    // 1,000 requests over 120 pairs — nearly every pair must carry real numbers.
    expect(nonZeroPairs).toBeGreaterThan(100);
  });
});

/* ------------------------------------------------------------------ */
/* 2. CROSS-YEAR BOUNDARY (handcrafted, exactly ON the edge)           */
/* ------------------------------------------------------------------ */

describe('cross-year boundary: Dec 2026 → Jan 2027 requests exactly on the edge', () => {
  // 2026-12-28 is a Monday (guarded below): Mon 28, Tue 29, Wed 30, Thu 31
  // are 2026 workdays (4); Fri 2027-01-01 + Sat 01-02 are weekend; Sun 01-03
  // + Mon 01-04 are 2027 workdays (2) → full span = 6 workdays.
  const crossReq = req({
    id: 'cross',
    start: '2026-12-28',
    end: '2027-01-04',
    status: 'approved',
  });
  const entitlements: Entitlement[] = [
    { employeeId: 'e1', type: 'vacation', year: 2026, entitled: 20 },
    { employeeId: 'e1', type: 'vacation', year: 2027, entitled: 21 },
  ];

  it('weekday premises hold (Dec 28 2026 = Monday, Jan 1 2027 = Friday)', () => {
    expect(fromKey('2026-12-28').getDay()).toBe(1);
    expect(fromKey('2027-01-01').getDay()).toBe(5);
  });

  it('a 2026-12-28..2027-01-04 approved request puts its FULL 6 workdays in 2026 used', () => {
    // Literal hand-derived expectation AND the primitive agree.
    expect(workdaysBetween('2026-12-28', '2027-01-04')).toBe(6);
    const b2026 = computeBalance([crossReq], entitlements, 'e1', 'vacation', 2026);
    expect(b2026).toEqual({ entitled: 20, used: 6, pending: 0 });
  });

  it('the same Dec→Jan request contributes NOTHING to 2027', () => {
    const b2027 = computeBalance([crossReq], entitlements, 'e1', 'vacation', 2027);
    expect(b2027).toEqual({ entitled: 21, used: 0, pending: 0 });
  });

  it('a request starting exactly 2027-01-01 counts only in 2027 (3 workdays: Sun 03, Mon 04, Tue 05)', () => {
    // Fri 01-01 + Sat 01-02 are weekend → workdays are 01-03, 01-04, 01-05.
    const janReq = req({ id: 'jan', start: '2027-01-01', end: '2027-01-05', status: 'pending' });
    expect(workdaysBetween('2027-01-01', '2027-01-05')).toBe(3);
    const b2027 = computeBalance([janReq], entitlements, 'e1', 'vacation', 2027);
    expect(b2027).toEqual({ entitled: 21, used: 0, pending: 3 });
    expect(pendingDaysFor([janReq], 'e1', 'vacation', 2027)).toBe(3);
    const b2026 = computeBalance([janReq], entitlements, 'e1', 'vacation', 2026);
    expect(b2026).toEqual({ entitled: 20, used: 0, pending: 0 });
    expect(pendingDaysFor([janReq], 'e1', 'vacation', 2026)).toBe(0);
  });

  it('reqWorkdayKeysInYear clips the Dec→Jan request per calendar year, excluding Fri/Sat', () => {
    expect(reqWorkdayKeysInYear(crossReq, 2026)).toEqual([
      '2026-12-28',
      '2026-12-29',
      '2026-12-30',
      '2026-12-31',
    ]);
    expect(reqWorkdayKeysInYear(crossReq, 2027)).toEqual(['2027-01-03', '2027-01-04']);
    // The independent clip+weekend reference agrees on both sides.
    expect(reqWorkdayKeysInYear(crossReq, 2026)).toEqual(refWorkdayKeysInYear(crossReq, 2026));
    expect(reqWorkdayKeysInYear(crossReq, 2027)).toEqual(refWorkdayKeysInYear(crossReq, 2027));
  });
});

/* ------------------------------------------------------------------ */
/* 3. IDENTITY ISOLATION at scale                                      */
/* ------------------------------------------------------------------ */

describe('scale: identity isolation — foreign/rejected requests never leak into a pair\'s balance', () => {
  it('adding other-employee, other-type, and rejected requests leaves the pair\'s computeBalance unchanged', () => {
    const { requests, entitlements } = scaleDataset();
    const employeeId = EMPLOYEE_IDS[0];
    const type = TYPES[0];
    const otherEmployee = EMPLOYEE_IDS[1];
    const otherType = TYPES[1];

    const before = computeBalance(requests, entitlements, employeeId, type, YEAR);

    const intruders: DayOffRequest[] = [
      // Same type, DIFFERENT employee.
      req({ id: 'x-emp', employeeId: otherEmployee, type, start: '2026-04-05', end: '2026-04-09', status: 'approved' }),
      // Same employee, DIFFERENT type.
      req({ id: 'x-type', employeeId, type: otherType, start: '2026-04-12', end: '2026-04-16', status: 'pending' }),
      // Same employee AND type — but rejected.
      req({ id: 'x-rej', employeeId, type, start: '2026-04-19', end: '2026-04-23', status: 'rejected' }),
    ];
    const after = computeBalance(requests.concat(intruders), entitlements, employeeId, type, YEAR);

    expect(after).toEqual(before);
    expect(pendingDaysFor(requests.concat(intruders), employeeId, type, YEAR)).toBe(before.pending);
  });
});

/* ------------------------------------------------------------------ */
/* 4. ENTITLEMENT MISS (handcrafted)                                   */
/* ------------------------------------------------------------------ */

describe('entitlement misses: balances are still well-defined without a row or without requests', () => {
  const entitlements: Entitlement[] = [
    { employeeId: 'e9', type: 'sick', year: 2026, entitled: 12 },
  ];

  it('a pair with requests but NO entitlement row gets entitled 0 with used/pending still computed', () => {
    const requests = [
      // Sun 2026-03-01 .. Thu 2026-03-05 → 5 workdays, approved.
      req({ id: 'a', employeeId: 'e1', type: 'vacation', start: '2026-03-01', end: '2026-03-05', status: 'approved' }),
      // Sun 2026-03-08 → 1 workday, pending.
      req({ id: 'p', employeeId: 'e1', type: 'vacation', start: '2026-03-08', end: '2026-03-08', status: 'pending' }),
    ];
    expect(workdaysBetween('2026-03-01', '2026-03-05')).toBe(5);
    const b = computeBalance(requests, entitlements, 'e1', 'vacation', 2026);
    expect(b).toEqual({ entitled: 0, used: 5, pending: 1 });
  });

  it('a pair with an entitlement row but ZERO requests gets {entitled: N, used: 0, pending: 0}', () => {
    const b = computeBalance([], entitlements, 'e9', 'sick', 2026);
    expect(b).toEqual({ entitled: 12, used: 0, pending: 0 });
  });
});
