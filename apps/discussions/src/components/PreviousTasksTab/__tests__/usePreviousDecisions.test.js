import { describe, it, expect } from 'vitest';
import { decisionLinksToAny } from '../usePreviousDecisions.js';

describe('decisionLinksToAny (round275 — keep decisions linked to a source set)', () => {
  it('is true when the decision links to any id in the source set (id type-tolerant)', () => {
    expect(decisionLinksToAny({ discussionLinkID: { ids: ['5', '7'] } }, new Set(['7']))).toBe(true);
    // number id on the decision, string id in the set — both coerced to string.
    expect(decisionLinksToAny({ discussionLinkID: { ids: [7] } }, new Set(['7']))).toBe(true);
  });

  it('is false when nothing links, the ids are empty, or the column is missing', () => {
    expect(decisionLinksToAny({ discussionLinkID: { ids: ['5'] } }, new Set(['7']))).toBe(false);
    expect(decisionLinksToAny({ discussionLinkID: { ids: [] } }, new Set(['7']))).toBe(false);
    expect(decisionLinksToAny({}, new Set(['7']))).toBe(false);
    expect(decisionLinksToAny(null, new Set(['7']))).toBe(false);
  });
});
