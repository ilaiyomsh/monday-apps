import { describe, it, expect } from 'vitest';
import { shapeDashboardData } from '../useDashboardData.js';

// round181b — `shapeDashboardData` is the pure mapping the dashboard hook AND the
// background prefetch share to turn raw board reads into the parse-close arrays
// the aggregator consumes. These lock the mapping (mutation-killing) so a seeded
// (cached) payload is byte-for-byte the same shape as a freshly-fetched one.

describe('shapeDashboardData', () => {
  it('maps discussions — id→String, real Date kept, non-Date date→null, type/lead/participants defaults', () => {
    const date = new Date('2026-06-10T09:00:00Z');
    const out = shapeDashboardData(
      [
        { id: 1, name: 'A', discussionDateID: date, discussionTypeID: 'שבועי',
          discussionLeadID: [{ id: '10', name: 'דנה' }], participantsID: [{ id: 'p1' }] },
        { id: 2, name: 'B', discussionDateID: 'not-a-date', discussionTypeID: '', discussionLeadID: null, participantsID: undefined },
      ],
      [], [],
    );
    expect(out.discussions[0]).toEqual({
      id: '1', name: 'A', date, type: 'שבועי',
      lead: [{ id: '10', name: 'דנה' }], participants: [{ id: 'p1' }],
    });
    // id coerced to string
    expect(out.discussions[1].id).toBe('2');
    // a non-Date date column becomes null (never a string that would crash .getTime())
    expect(out.discussions[1].date).toBeNull();
    // falsy type → null; missing people → []
    expect(out.discussions[1].type).toBeNull();
    expect(out.discussions[1].lead).toEqual([]);
    expect(out.discussions[1].participants).toEqual([]);
  });

  it('maps tasks — discussionId from the relation, statusID ?? null, deadline Date kept else null', () => {
    const deadline = new Date('2026-06-02T00:00:00Z');
    const out = shapeDashboardData(
      [],
      [
        { id: 't1', discussionLinkID: { ids: ['5'] }, statusID: 0, deadlineID: deadline },
        { id: 't2', discussionLinkID: { linkedItems: [{ id: 7 }] }, statusID: undefined, deadlineID: null },
        { id: 't3', discussionLinkID: null, statusID: 2, deadlineID: 'nope' },
      ],
      [],
    );
    // relation id resolves from `ids[0]` (as a string)
    expect(out.tasks[0]).toEqual({ id: 't1', discussionId: '5', statusID: 0, deadlineID: deadline });
    // falls back to linkedItems[0].id, coerced to string
    expect(out.tasks[1].discussionId).toBe('7');
    // statusID 0 is preserved (not nulled); undefined → null
    expect(out.tasks[0].statusID).toBe(0);
    expect(out.tasks[1].statusID).toBeNull();
    // no relation → null; non-Date deadline → null
    expect(out.tasks[2].discussionId).toBeNull();
    expect(out.tasks[2].deadlineID).toBeNull();
  });

  it('maps decisions to { id, discussionId } and tolerates empty/undefined inputs', () => {
    const out = shapeDashboardData(undefined, undefined, [
      { id: 9, discussionLinkID: { ids: ['5'] } },
      { id: 10, discussionLinkID: null },
    ]);
    expect(out.discussions).toEqual([]);
    expect(out.tasks).toEqual([]);
    expect(out.decisions).toEqual([{ id: '9', discussionId: '5' }, { id: '10', discussionId: null }]);
  });
});
