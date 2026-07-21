// Unit tests for the KPI-row guard (src/client/lib/kpi.js). The render crash this guards
// against: the live payload exposes kpi_summary as `{}` when that one APL panel fails, and
// KpiRow.tsx read kpi.error_rate.toFixed(2) straight off it -> TypeError -> whole-app
// ErrorBoundary. normalizeKpi() must return null for un-renderable input (caller shows a
// skeleton) and a fully-numeric summary otherwise.

import { describe, it, expect } from 'vitest';
import { normalizeKpi, KPI_FIELDS } from '../src/client/lib/kpi.js';

const FULL = {
  total: 1234,
  errors: 56,
  usage: 900,
  health: 278,
  distinct_accounts: 12,
  distinct_apps: 7,
  error_rate: 4.54,
};

describe('normalizeKpi — un-renderable input returns null (caller shows a skeleton)', () => {
  it('returns null for the empty object a failed kpi panel yields', () => {
    expect(normalizeKpi({})).toBeNull();
  });

  it('returns null for null, undefined, and non-object inputs', () => {
    expect(normalizeKpi(null)).toBeNull();
    expect(normalizeKpi(undefined)).toBeNull();
    expect(normalizeKpi('nope')).toBeNull();
    expect(normalizeKpi(42)).toBeNull();
  });

  it('returns null when every field is present but non-numeric (all coerce, none real)', () => {
    expect(
      normalizeKpi({
        total: null,
        errors: undefined,
        usage: 'x',
        health: NaN,
        distinct_accounts: Infinity,
        distinct_apps: {},
        error_rate: '4.5',
      })
    ).toBeNull();
  });
});

describe('normalizeKpi — renderable input returns a fully-numeric summary', () => {
  it('passes a complete valid summary through with exact values on every field', () => {
    expect(normalizeKpi(FULL)).toEqual(FULL);
  });

  it('keeps a real all-zero window (0 is a finite number, not "missing") — must NOT return null', () => {
    const zero = {
      total: 0,
      errors: 0,
      usage: 0,
      health: 0,
      distinct_accounts: 0,
      distinct_apps: 0,
      error_rate: 0,
    };
    expect(normalizeKpi(zero)).toEqual(zero);
  });

  it('degrades individual non-finite / missing fields to 0 while keeping the object (>=1 real field)', () => {
    const out = normalizeKpi({ total: 10, errors: NaN, error_rate: Infinity });
    expect(out).not.toBeNull();
    expect(out.total).toBe(10); // the one real field is preserved
    expect(out.errors).toBe(0); // NaN -> 0 (would have thrown as .toFixed on undefined before)
    expect(out.error_rate).toBe(0); // Infinity -> 0
    expect(out.usage).toBe(0); // absent -> 0
    expect(out.distinct_apps).toBe(0);
  });

  it('output always carries exactly the seven KPI fields', () => {
    expect(Object.keys(normalizeKpi(FULL)).sort()).toEqual([...KPI_FIELDS].sort());
  });
});
