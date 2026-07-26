// The seed-mode drill-down extractor (client, pure JS). In seed mode the raw
// records already live in the browser, so clicking an error shows its full
// occurrences with NO server call — this is that filter: error records of one
// err_name, within the active window/app/account scope, newest first, capped.

import { describe, it, expect } from 'vitest';
import { errorOccurrences, errorLabel } from '../src/client/lib/aggregate.js';

const NOW = Date.parse('2026-07-24T12:00:00.000Z');
const base = {
  kind: 'error',
  app: 'planner',
  acc: 'acc1',
  err_name: 'TimeoutError',
  err_msg: 'timed out',
};
const rec = (over) => ({ ...base, _time: new Date(NOW - 1000).toISOString(), ...over });
const noFilter = { window: '7d', apps: [], accounts: [], kinds: [], focusError: null };

describe('errorOccurrences (seed drill-down)', () => {
  it('returns only error records matching the err_name, within the window', () => {
    const records = [
      rec({}),
      rec({ err_name: 'AuthError' }), // different name
      rec({ kind: 'usage', message: 'view_open' }), // not an error
      rec({ _time: new Date(NOW - 40 * 24 * 3600 * 1000).toISOString() }), // outside 7d
    ];
    const rows = errorOccurrences(records, 'TimeoutError', noFilter, NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0].err_name).toBe('TimeoutError');
  });

  it('orders newest first', () => {
    const older = rec({ _time: new Date(NOW - 5000).toISOString() });
    const newer = rec({ _time: new Date(NOW - 1000).toISOString() });
    const rows = errorOccurrences([older, newer], 'TimeoutError', noFilter, NOW);
    expect(rows.map((r) => r._time)).toEqual([newer._time, older._time]);
  });

  it('respects an active app filter (scope carries into the drill-down)', () => {
    const rows = errorOccurrences(
      [rec({ app: 'planner' }), rec({ app: 'tracker' })],
      'TimeoutError',
      { ...noFilter, apps: ['tracker'] },
      NOW
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].app).toBe('tracker');
  });

  it('respects an active account filter', () => {
    const rows = errorOccurrences(
      [rec({ acc: 'acc1' }), rec({ acc: 'acc2' })],
      'TimeoutError',
      { ...noFilter, accounts: ['acc2'] },
      NOW
    );
    expect(rows.map((r) => r.acc)).toEqual(['acc2']);
  });

  it('caps the result at the limit', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      rec({ _time: new Date(NOW - i * 1000).toISOString() })
    );
    const rows = errorOccurrences(many, 'TimeoutError', noFilter, NOW, 3);
    expect(rows).toHaveLength(3);
  });

  // err_name-less records (warn-level logs) are named by their message, so
  // clicking their row must drill into them by that same derived name.
  it('drills into un-named errors by their message-derived name', () => {
    const records = [
      rec({ err_name: '', err_msg: '', message: 'Retryable error, attempt 1/2' }),
      rec({ err_name: '', err_msg: '', message: 'a different message' }),
    ];
    const rows = errorOccurrences(records, 'Retryable error, attempt 1/2', noFilter, NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0].message).toBe('Retryable error, attempt 1/2');
  });
});

describe('errorLabel', () => {
  it('prefers err_name when present', () => {
    expect(errorLabel({ err_name: 'TimeoutError', err_msg: 'x', message: 'y' })).toBe('TimeoutError');
  });
  it('falls back err_msg → message → (unnamed)', () => {
    expect(errorLabel({ err_msg: 'boom', message: 'ctx' })).toBe('boom');
    expect(errorLabel({ message: 'ctx' })).toBe('ctx');
    expect(errorLabel({})).toBe('(unnamed)');
  });
});
