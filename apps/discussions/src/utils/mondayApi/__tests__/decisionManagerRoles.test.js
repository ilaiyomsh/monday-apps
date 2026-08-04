import { describe, it, expect } from 'vitest';
import {
  TIER_EXTRA_ROLE_SOURCES,
  DEFAULT_PERMISSION_SEED,
  COLUMN_SCHEMA,
  CAPABILITIES,
} from '../boards.config.js';
import { mapDecisionDiscussionRoles } from '../../ledDiscussions.js';

/*
 * round341 (owner request) — "אני רוצה להוסיף את יוצר מרכז ומוביל דיון רק בכרטיס
 * ההרשאות של ההחלטות (כשווי כוח למחליט וככאלה שיכולים לבצע כל פעולה על כל החלטה),
 * בעוד המושפעים לא יכולים לעשות שום פעולה על ההחלטה ורק לצפות בה."
 *
 * A decision belongs to a discussion, so the people running that discussion are as
 * entitled to act on it as the decider — but their people columns live on the DISCUSSIONS
 * board, and both the matrix and the resolver were single-board by construction.
 * TIER_EXTRA_ROLE_SOURCES is the declared exception. The resolver-level behaviour is
 * covered in hooks/__tests__/usePermission.test.jsx; this file pins the DECLARATION and
 * the seed, which are what the owner's spec is really about.
 */

const DECISION_CAPS = CAPABILITIES.filter((c) => c.tier === 'decision').map((c) => c.id);
const MANAGERS = ['discussionCreatorID', 'discussionLeadID', 'discussionCoordinatorID'];

describe('TIER_EXTRA_ROLE_SOURCES', () => {
  it('lends the decisions tier exactly the three discussion MANAGER roles', () => {
    expect(TIER_EXTRA_ROLE_SOURCES.decisions).toEqual(MANAGERS);
  });

  /*
   * משתתפים is deliberately NOT here, and that omission is the spec: a participant is not
   * a manager of the discussion, so they get no say over its decisions. Stating it as its
   * own assertion means "just add participantsID too" cannot pass silently.
   */
  it('does NOT lend participants — only the managers', () => {
    expect(TIER_EXTRA_ROLE_SOURCES.decisions).not.toContain('participantsID');
  });

  // A lent alias must be a real people column on the DISCUSSIONS board, or its matrix
  // column would be a checkbox nobody can ever hold.
  it('every lent alias is a real people column on the discussions board', () => {
    for (const alias of TIER_EXTRA_ROLE_SOURCES.decisions) {
      expect(COLUMN_SCHEMA.discussions?.[alias]?.type).toBe('people');
    }
  });

  // The tasks tier is NOT lent anything: it already has its own hardcoded
  // discussion-roles override, and duplicating that here would double-resolve it.
  it('lends nothing to the tasks tier', () => {
    expect(TIER_EXTRA_ROLE_SOURCES.tasks).toBeUndefined();
  });
});

describe('the seed makes the three managers equal to the decider', () => {
  /*
   * "כשווי כוח למחליט" is literal: the comparison is against the decider's own seed row,
   * not against a list typed out here, so if the decider's grants ever change the two
   * stay in step or this fails.
   */
  it('grants each manager every decision capability the decider has', () => {
    const decider = DEFAULT_PERMISSION_SEED['decisions:deciderID'].capabilities;
    for (const alias of MANAGERS) {
      const caps = DEFAULT_PERMISSION_SEED[`discussions:${alias}`].capabilities;
      for (const cap of DECISION_CAPS) {
        expect(caps[cap]).toBe(decider[cap]);
        expect(caps[cap]).toBe(true);
      }
    }
  });

  // Including delete — the half that changed in round341. The old hardcoded override
  // granted every decision cap EXCEPT delete, so this is the assertion that says the
  // owner's "כל פעולה" was actually honoured.
  it('includes deleteDecision', () => {
    for (const alias of MANAGERS) {
      expect(DEFAULT_PERMISSION_SEED[`discussions:${alias}`].capabilities.deleteDecision).toBe(true);
    }
  });

  // …and the other side of the owner's sentence: מושפעים may only look at it.
  it('leaves מושפעים with nothing — view only', () => {
    const caps = DEFAULT_PERMISSION_SEED['decisions:affectedID'].capabilities;
    for (const cap of DECISION_CAPS) expect(caps[cap]).toBe(false);
  });

  // The manager rows carry BOTH tiers' grants on one role entry, which is the point of
  // keeping the `discussions:` key: one role, one stored capabilities map.
  it('keeps the managers\' discussion-tier grants intact alongside the decision ones', () => {
    for (const alias of MANAGERS) {
      const caps = DEFAULT_PERMISSION_SEED[`discussions:${alias}`].capabilities;
      expect(caps.viewDiscussion).toBe(true);
      expect(caps.editDiscussionFields).toBe(true);
    }
  });
});

describe('mapDecisionDiscussionRoles', () => {
  const disc = (over) => ({
    id: 'D1',
    discussionCreatorID: [{ id: '1' }],
    discussionLeadID: [{ id: '2' }],
    discussionCoordinatorID: [{ id: '3' }],
    decisionsBoardLinkID: { ids: ['DC1', 'DC2'] },
    ...over,
  });

  it('maps every linked decision id to its discussion\'s three manager roles', () => {
    const map = mapDecisionDiscussionRoles([disc()]);
    expect([...map.keys()]).toEqual(['DC1', 'DC2']);
    expect(map.get('DC1')).toEqual({
      discussionCreatorID: [{ id: '1' }],
      discussionLeadID: [{ id: '2' }],
      discussionCoordinatorID: [{ id: '3' }],
    });
  });

  // First discussion wins — a decision linked to two discussions must resolve to ONE
  // answer, deterministically, rather than to whichever happened to be iterated last.
  it('keeps the FIRST discussion for a decision linked to more than one', () => {
    const map = mapDecisionDiscussionRoles([
      disc({ id: 'D1', discussionLeadID: [{ id: 'first' }] }),
      disc({ id: 'D2', discussionLeadID: [{ id: 'second' }], decisionsBoardLinkID: { ids: ['DC1'] } }),
    ]);
    expect(map.get('DC1').discussionLeadID).toEqual([{ id: 'first' }]);
  });

  // Missing columns normalize to [] rather than undefined, so the resolver's inPeople
  // never has to distinguish "unmapped" from "nobody in it".
  it('normalizes a missing role column to an empty array', () => {
    const map = mapDecisionDiscussionRoles([{ id: 'D1', decisionsBoardLinkID: { ids: ['DC1'] } }]);
    expect(map.get('DC1')).toEqual({
      discussionCreatorID: [], discussionLeadID: [], discussionCoordinatorID: [],
    });
  });

  it('tolerates junk input', () => {
    expect(mapDecisionDiscussionRoles(null).size).toBe(0);
    expect(mapDecisionDiscussionRoles([null, {}]).size).toBe(0);
    expect(mapDecisionDiscussionRoles([{ id: 'D1' }]).size).toBe(0);
  });
});
