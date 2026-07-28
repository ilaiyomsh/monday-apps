import { describe, it, expect } from 'vitest';
import { computeLedDiscussionIds, collectLedTaskIds, mapLedTaskDiscussionRoles } from '../ledDiscussions.js';

const ME = '7';
const me = { id: 7, name: 'אני' };
const other = { id: 9, name: 'מישהו אחר' };

describe('computeLedDiscussionIds (round224 — "דיונים שהובלתי")', () => {
  it('counts discussions where I am the LEAD or the COORDINATOR', () => {
    const discussions = [
      { id: 1, discussionLeadID: [me], discussionCoordinatorID: [], discussionCreatorID: [other] },
      { id: 2, discussionLeadID: [other], discussionCoordinatorID: [me], discussionCreatorID: [other] },
      { id: 3, discussionLeadID: [other], discussionCoordinatorID: [other], discussionCreatorID: [me] },
    ];
    // 3 has a lead+coordinator (not me) → my creatorship does NOT count.
    expect(computeLedDiscussionIds(discussions, ME)).toEqual(['1', '2']);
  });

  it('creator counts ONLY when the discussion has no lead AND no coordinator', () => {
    const discussions = [
      { id: 4, discussionLeadID: [], discussionCoordinatorID: [], discussionCreatorID: [me] },
      { id: 5, discussionLeadID: [other], discussionCoordinatorID: [], discussionCreatorID: [me] },
      { id: 6, discussionLeadID: [], discussionCoordinatorID: [], discussionCreatorID: [other] },
    ];
    expect(computeLedDiscussionIds(discussions, ME)).toEqual(['4']);
  });

  it('tolerates empty/missing input', () => {
    expect(computeLedDiscussionIds(null, ME)).toEqual([]);
    expect(computeLedDiscussionIds([], ME)).toEqual([]);
    expect(computeLedDiscussionIds([{ id: 1 }], null)).toEqual([]);
  });
});

describe('collectLedTaskIds', () => {
  it('collects task ids off the LED discussions only, deduped, order preserved', () => {
    const discussions = [
      { id: 1, tasksBoardLinkID: { ids: [11, 12] } },
      { id: 2, tasksBoardLinkID: { ids: [12, 13] } },
      { id: 3, tasksBoardLinkID: { ids: [99] } }, // not led — excluded
    ];
    expect(collectLedTaskIds(discussions, ['1', '2'])).toEqual(['11', '12', '13']);
  });

  it('handles discussions with no relation value', () => {
    expect(collectLedTaskIds([{ id: 1 }, { id: 2, tasksBoardLinkID: null }], ['1', '2'])).toEqual([]);
    expect(collectLedTaskIds([], [])).toEqual([]);
  });
});

/*
 * round305 — the personal "בדיונים שהובלתי" rows carry their parent discussion's
 * ROLE people, because some capabilities (שותפים) are granted to the discussion's
 * lead/coordinator/creator and that surface has no discussion object in context.
 */
describe('mapLedTaskDiscussionRoles', () => {
  const lead = [{ id: '1', name: 'מנהל' }];
  const coord = [{ id: '2', name: 'מרכז' }];
  const creator = [{ id: '3', name: 'יוצר' }];
  const discussions = [
    {
      id: 'D1',
      discussionLeadID: lead,
      discussionCoordinatorID: coord,
      discussionCreatorID: creator,
      tasksBoardLinkID: { ids: ['T1', 'T2'] },
    },
    { id: 'D2', discussionLeadID: [], tasksBoardLinkID: { ids: ['T3'] } },
  ];

  it('maps every task of a led discussion to that discussion\'s three role columns', () => {
    const map = mapLedTaskDiscussionRoles(discussions, ['D1']);
    expect([...map.keys()]).toEqual(['T1', 'T2']);
    expect(map.get('T1')).toEqual({
      discussionLeadID: lead, discussionCoordinatorID: coord, discussionCreatorID: creator,
    });
    // the same roles object serves every task of that discussion
    expect(map.get('T2')).toEqual(map.get('T1'));
  });

  it('skips discussions that are NOT in the led set', () => {
    const map = mapLedTaskDiscussionRoles(discussions, ['D2']);
    expect([...map.keys()]).toEqual(['T3']);
  });

  it('normalizes missing role columns to empty arrays (never undefined)', () => {
    const map = mapLedTaskDiscussionRoles([{ id: 'D3', tasksBoardLinkID: { ids: ['T9'] } }], ['D3']);
    expect(map.get('T9')).toEqual({
      discussionLeadID: [], discussionCoordinatorID: [], discussionCreatorID: [],
    });
  });

  it('keeps the FIRST discussion for a task linked to two, and tolerates junk input', () => {
    const dup = [
      { id: 'D1', discussionLeadID: lead, tasksBoardLinkID: { ids: ['T1'] } },
      { id: 'D2', discussionLeadID: coord, tasksBoardLinkID: { ids: ['T1'] } },
    ];
    expect(mapLedTaskDiscussionRoles(dup, ['D1', 'D2']).get('T1').discussionLeadID).toBe(lead);
    expect(mapLedTaskDiscussionRoles(null, ['D1']).size).toBe(0);
    expect(mapLedTaskDiscussionRoles(discussions, null).size).toBe(0);
  });
});
