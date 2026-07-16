import { describe, it, expect, beforeEach, vi } from 'vitest';

// round135 — unit tests for the single riskiest untested logic in the API
// layer: ItemsQueryBuilder._buildQueryParams, which builds monday's
// server-side query_params. Regressions here fail SILENTLY (monday returns
// zero matches instead of erroring) — see the person-<id> pitfall in CLAUDE.md.

vi.mock('../peopleColumns.js', () => ({
  getPeopleColumnIds: () => [],
}));

import { setActiveConfig } from '../board-config-store.js';
import { משימות1Board } from '../BoardSDK.js';

beforeEach(() => {
  setActiveConfig({
    boards: { tasks: { id: 'tasks-board' } },
    columns: {
      tasks: {
        responsibilityID: { id: 'people_col', type: 'people' },
        statusID: { id: 'status_col', type: 'status' },
        taskTypeID: { id: 'dd_col', type: 'dropdown' },
        deadlineID: { id: 'date_col', type: 'date' },
      },
    },
  });
});

const buildQP = (where, orderBy = null) => {
  const b = new משימות1Board().items().where(where);
  if (orderBy) b.orderBy(orderBy);
  return b._buildQueryParams();
};

describe('ItemsQueryBuilder._buildQueryParams', () => {
  it('people columns filter with the person-<id> form; assigned_to_me passes through untouched', () => {
    const { qp } = buildQP({ responsibilityID: ['123', 'assigned_to_me'] });
    expect(qp.rules).toEqual([
      { column_id: 'people_col', compare_value: ['person-123', 'assigned_to_me'], operator: 'any_of' },
    ]);
  });

  it('status any_of compares NUMERIC label ids — string ids are coerced, non-numeric dropped, all-invalid emits NO rule', () => {
    const { qp } = buildQP({ statusID: ['2', 5] });
    expect(qp.rules).toEqual([
      { column_id: 'status_col', compare_value: [2, 5], operator: 'any_of' },
    ]);
    const { qp: bad } = buildQP({ statusID: ['not-a-number'] });
    expect(bad.rules).toBeUndefined();
  });

  it('dropdown any_of mirrors the status numeric-id shape', () => {
    const { qp } = buildQP({ taskTypeID: '7' });
    expect(qp.rules).toEqual([
      { column_id: 'dd_col', compare_value: [7], operator: 'any_of' },
    ]);
  });

  it('a {between:[from,to]} condition emits a between rule with the raw range', () => {
    const { qp } = buildQP({ deadlineID: { between: ['2026-01-01', '2026-01-31'] } });
    expect(qp.rules).toEqual([
      { column_id: 'date_col', compare_value: ['2026-01-01', '2026-01-31'], operator: 'between' },
    ]);
  });

  it('name search never becomes a server rule (client-side), and unmapped aliases are skipped', () => {
    const { qp, nameSearch } = buildQP({ name: 'תקציב', notMappedID: 'x' });
    expect(nameSearch).toBe('תקציב');
    expect(qp.rules).toBeUndefined();
  });

  it('orderBy resolves the alias to the real column id with desc default', () => {
    const { qp } = buildQP({}, { column: 'deadlineID' });
    expect(qp.order_by).toEqual([{ column_id: 'date_col', direction: 'desc' }]);
  });
});
