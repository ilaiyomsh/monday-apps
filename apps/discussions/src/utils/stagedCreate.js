/*
 * round301 — state transitions for the STAGED discussion create.
 *
 * A staged create hands the card off after stage 1 and finishes stages 2 (the
 * deferred topic points) and 3 (the people columns) in the background. The card
 * carries `__pendingPeople` in the meantime — roles the form collected but monday
 * has not stored yet — and `DiscussionCard` deliberately merges them OVER the
 * fetched details so the header does not blank out mid-creation.
 *
 * These helpers own what happens to that optimistic state, because getting it
 * wrong is silent: keep the pending people after a failed write and the card
 * shows roles that do not exist on the board (and role-derived gates resolve off
 * those ghosts) until the discussion is reopened.
 */

/** Force the card's data hooks to re-read the same discussion. */
export function bumpReloadStamp(discussion, stamp) {
  if (!discussion) return discussion;
  return { ...discussion, __reloadStamp: stamp };
}

/**
 * A later stage landed for `id`: re-read the board so the rows it created show up.
 * Returns the SAME object when it is about a different (or no) discussion, so the
 * caller's setState is a no-op and no needless refetch fires.
 */
export function applyStageAdvance(discussion, id, stamp) {
  if (!discussion) return discussion;
  if (id != null && String(discussion.id) !== String(id)) return discussion;
  return bumpReloadStamp(discussion, stamp);
}

/**
 * A background stage FAILED for `id`. The people were never written, so the
 * pending copy must go — and the card refetches to show what monday actually has.
 */
export function applyStageFailure(discussion, id, stamp) {
  if (!discussion) return discussion;
  if (id != null && String(discussion.id) !== String(id)) return discussion;
  const next = { ...discussion, __reloadStamp: stamp };
  delete next.__pendingPeople;
  return next;
}
