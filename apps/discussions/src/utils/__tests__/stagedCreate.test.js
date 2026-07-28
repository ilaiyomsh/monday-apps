import { describe, it, expect } from 'vitest';
import { applyStageAdvance, applyStageFailure, bumpReloadStamp } from '../stagedCreate.js';

// round301 — the staged create's optimistic state rules. The failure case is the
// one that matters: `__pendingPeople` outranks fetched details in DiscussionCard,
// so leaving it behind after a failed write makes the card display roles that are
// NOT on the board (and role-derived gates resolve off those ghosts).

const CARD = () => ({
  id: '99',
  name: 'דיון אלפא',
  __pendingPeople: {
    discussionLeadID: [{ id: 'p1', name: 'איש' }],
    participantsID: [{ id: 'p2', name: 'אישה' }],
  },
});

describe('applyStageFailure', () => {
  it('drops the pending people and bumps the reload stamp', () => {
    const next = applyStageFailure(CARD(), '99', 1234);
    expect('__pendingPeople' in next).toBe(false);
    expect(next.__reloadStamp).toBe(1234);
    // everything else survives
    expect(next.id).toBe('99');
    expect(next.name).toBe('דיון אלפא');
  });

  it('leaves a DIFFERENT discussion untouched (same object back, so no refetch)', () => {
    const card = CARD();
    const next = applyStageFailure(card, 'OTHER', 1234);
    expect(next).toBe(card);
    expect(next.__pendingPeople).toBeTruthy();
  });

  it('never mutates the discussion it was handed', () => {
    const card = CARD();
    applyStageFailure(card, '99', 1234);
    expect(card.__pendingPeople).toBeTruthy();
    expect(card.__reloadStamp).toBeUndefined();
  });

  it('tolerates no open card', () => {
    expect(applyStageFailure(null, '99', 1)).toBeNull();
  });
});

describe('applyStageAdvance', () => {
  it('bumps the stamp but KEEPS the pending people (stage 3 has not run yet)', () => {
    const next = applyStageAdvance(CARD(), '99', 777);
    expect(next.__reloadStamp).toBe(777);
    expect(next.__pendingPeople).toBeTruthy();
  });

  it('leaves a DIFFERENT discussion untouched', () => {
    const card = CARD();
    expect(applyStageAdvance(card, 'OTHER', 777)).toBe(card);
  });

  it('matches ids across string/number forms', () => {
    const next = applyStageAdvance({ id: 99 }, '99', 5);
    expect(next.__reloadStamp).toBe(5);
  });
});

describe('bumpReloadStamp', () => {
  it('sets the stamp without touching anything else', () => {
    const next = bumpReloadStamp({ id: '1', name: 'x' }, 42);
    expect(next).toEqual({ id: '1', name: 'x', __reloadStamp: 42 });
  });
});
