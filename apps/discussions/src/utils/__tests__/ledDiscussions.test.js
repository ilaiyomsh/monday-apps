import { describe, it, expect } from 'vitest';
import { computeLedDiscussionIds, collectLedTaskIds } from '../ledDiscussions.js';

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
