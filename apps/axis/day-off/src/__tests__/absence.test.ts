import { describe, it, expect } from 'vitest';
import { computeBalance, pendingDaysFor, requestYear, reqWorkdayKeysInYear } from '../domain/absence';
import type { DayOffRequest, Entitlement } from '../domain/types';

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

const entitlements: Entitlement[] = [
  { employeeId: 'e1', type: 'vacation', year: 2026, entitled: 20 },
  { employeeId: 'e1', type: 'sick', year: 2026, entitled: 10 },
  { employeeId: 'e2', type: 'vacation', year: 2026, entitled: 14 },
];

describe('requestYear (start-year attribution)', () => {
  it('attributes a request to its start year', () => {
    expect(requestYear(req({ start: '2026-12-30' }))).toBe(2026);
    expect(requestYear(req({ start: '2027-01-02' }))).toBe(2027);
  });
});

describe('computeBalance', () => {
  it('reads entitled from entitlements board', () => {
    const b = computeBalance([], entitlements, 'e1', 'vacation', 2026);
    expect(b.entitled).toBe(20);
  });

  it('entitled is 0 when no entitlement row exists', () => {
    const b = computeBalance([], entitlements, 'e1', 'reserves', 2026);
    expect(b.entitled).toBe(0);
  });

  it('used = approved workdays, pending = pending workdays', () => {
    const requests = [
      // Sun 2026-05-31 .. Sat 2026-06-06 → 5 workdays, approved.
      req({ id: 'a', start: '2026-05-31', end: '2026-06-06', status: 'approved' }),
      // Sun 2026-06-07 .. Mon 2026-06-08 → 2 workdays, pending.
      req({ id: 'p', start: '2026-06-07', end: '2026-06-08', status: 'pending' }),
      // Rejected — ignored entirely.
      req({ id: 'x', start: '2026-06-10', end: '2026-06-11', status: 'rejected' }),
    ];
    const b = computeBalance(requests, entitlements, 'e1', 'vacation', 2026);
    expect(b).toEqual({ entitled: 20, used: 5, pending: 2 });
  });

  it('ignores other employees and other types', () => {
    const requests = [
      req({ employeeId: 'e2', start: '2026-06-01', end: '2026-06-03', status: 'approved' }),
      req({ type: 'sick', start: '2026-06-01', end: '2026-06-03', status: 'approved' }),
    ];
    const b = computeBalance(requests, entitlements, 'e1', 'vacation', 2026);
    expect(b).toEqual({ entitled: 20, used: 0, pending: 0 });
  });

  it('attributes by start year (a Dec→Jan request counts only in its start year)', () => {
    const requests = [
      // starts 2026-12-30 → attributed to 2026 in full.
      req({ id: 'cross', start: '2026-12-30', end: '2027-01-02', status: 'approved' }),
    ];
    const b2026 = computeBalance(requests, entitlements, 'e1', 'vacation', 2026);
    const b2027 = computeBalance(requests, entitlements, 'e1', 'vacation', 2027);
    // Workdays Wed 12-30, Thu 12-31 (Fri 01-01, Sat 01-02 are weekend) = 2 workdays.
    expect(b2026.used).toBe(2);
    expect(b2027.used).toBe(0);
  });
});

describe('pendingDaysFor', () => {
  it('sums pending workdays for the employee/type/year', () => {
    const requests = [
      req({ start: '2026-06-07', end: '2026-06-08', status: 'pending' }), // 2 workdays
      req({ start: '2026-06-09', end: '2026-06-09', status: 'pending' }), // 1 workday
      req({ start: '2026-06-10', end: '2026-06-10', status: 'approved' }), // not pending
    ];
    expect(pendingDaysFor(requests, 'e1', 'vacation', 2026)).toBe(3);
  });

  it('is 0 with no matching pending requests', () => {
    expect(pendingDaysFor([], 'e1', 'vacation', 2026)).toBe(0);
  });
});

describe('reqWorkdayKeysInYear (clipping across year boundary)', () => {
  it('clips a Dec→Jan range to the requested year', () => {
    const r = req({ start: '2026-12-30', end: '2027-01-05', status: 'approved' });
    // 2026 side: Wed 12-30, Thu 12-31 (Fri/Sat excluded).
    expect(reqWorkdayKeysInYear(r, 2026)).toEqual(['2026-12-30', '2026-12-31']);
    // 2027 side: 01-01 Fri, 01-02 Sat excluded; Sun 01-03..Mon 01-05 workdays.
    expect(reqWorkdayKeysInYear(r, 2027)).toEqual(['2027-01-03', '2027-01-04', '2027-01-05']);
  });

  it('returns empty when the request is entirely outside the year', () => {
    const r = req({ start: '2026-06-01', end: '2026-06-03' });
    expect(reqWorkdayKeysInYear(r, 2025)).toEqual([]);
    expect(reqWorkdayKeysInYear(r, 2027)).toEqual([]);
  });

  it('returns all workdays when fully inside the year', () => {
    const r = req({ start: '2026-05-31', end: '2026-06-06' });
    expect(reqWorkdayKeysInYear(r, 2026)).toEqual([
      '2026-05-31',
      '2026-06-01',
      '2026-06-02',
      '2026-06-03',
      '2026-06-04',
    ]);
  });
});
