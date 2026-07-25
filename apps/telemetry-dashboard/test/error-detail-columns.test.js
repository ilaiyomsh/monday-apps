// columnsFor decides which fields the drill-down drawer renders as columns and
// in what order. Contract: known app-errors fields come first in a fixed
// sensible order; the stack trace (stack1) and redundant/system fields are
// never columns; any unrecognised field is appended (alphabetically) so data
// is never silently dropped.

import { describe, it, expect } from 'vitest';
import { columnsFor } from '../src/client/components/charts/ErrorDetailDrawer';

describe('columnsFor', () => {
  it('orders known fields in the fixed preferred order, regardless of key order in the record', () => {
    const rows = [{ ver: '1', app: 'planner', _time: 't', acc: 'a', usr: 'u' }];
    // preferred order: _time, level, app, acc, usr, ..., ver
    expect(columnsFor(rows)).toEqual(['_time', 'app', 'acc', 'usr', 'ver']);
  });

  it('never renders the stack trace as a column (it has its own expander)', () => {
    expect(columnsFor([{ _time: 't', stack1: 'Error: boom\n  at x' }])).toEqual(['_time']);
  });

  it('hides redundant fields (kind, err_name) and Axiom system fields (_sysTime), but keeps _time', () => {
    const cols = columnsFor([{ _time: 't', _sysTime: 's', kind: 'error', err_name: 'X', app: 'planner' }]);
    expect(cols).toEqual(['_time', 'app']);
  });

  it('appends unrecognised fields after the known ones, sorted alphabetically', () => {
    const cols = columnsFor([{ app: 'planner', zebra: 1, alpha: 2 }]);
    expect(cols).toEqual(['app', 'alpha', 'zebra']);
  });

  it('unions keys across rows (a field present on only some rows still gets a column)', () => {
    const cols = columnsFor([{ app: 'planner' }, { usr: 'u' }]);
    expect(cols).toEqual(['app', 'usr']);
  });
});
