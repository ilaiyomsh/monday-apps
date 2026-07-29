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
 * A later stage landed for `id`: re-read the board so the rows it created show up,
 * and drop `__building` — the agenda is complete, so the loading animation must
 * give way to it. Returns the SAME object when it is about a different (or no)
 * discussion, so the caller's setState is a no-op and no needless refetch fires.
 */
export function applyStageAdvance(discussion, id, stamp) {
  if (!discussion) return discussion;
  if (id != null && String(discussion.id) !== String(id)) return discussion;
  const next = { ...discussion, __reloadStamp: stamp };
  delete next.__building;
  return next;
}

/**
 * The LAST stage landed for `id`: everything the form collected is now really on
 * the board, so the card re-reads and BOTH pieces of optimistic state go — the
 * pending people (monday now serves the real ones) and `__building`.
 *
 * round306 (PR review) — this exists so completion no longer runs through the
 * generic save handler. That handler closes whatever create/edit modal is open,
 * hides the list and selects this discussion; since the tail can finish seconds
 * after the handoff (the agenda readiness wait alone can run ~5s), a user who
 * moved on in the meantime was yanked back here and lost the newer form's unsaved
 * input. Like the other stage helpers, this is id-GUARDED: a different (or no)
 * open discussion returns the SAME object, so the caller's setState is a no-op.
 */
export function applyStageComplete(discussion, id, stamp) {
  if (!discussion) return discussion;
  if (id != null && String(discussion.id) !== String(id)) return discussion;
  const next = { ...discussion, __reloadStamp: stamp };
  delete next.__pendingPeople;
  delete next.__building;
  return next;
}

/**
 * A background stage FAILED for `id`. The pending copy must go and the card
 * refetches, so it shows what monday actually has. Note that "a stage failed" does
 * NOT mean nothing was written — the agenda and the people are independent writes,
 * so the people may well have landed while the agenda is what failed. That is
 * exactly why the pending copy is dropped in favour of a re-read rather than being
 * kept or trusted.
 * `__building` goes too: whatever is on the board is all there will be, and
 * leaving the loader spinning forever would strand the user.
 */
export function applyStageFailure(discussion, id, stamp) {
  if (!discussion) return discussion;
  if (id != null && String(discussion.id) !== String(id)) return discussion;
  const next = { ...discussion, __reloadStamp: stamp };
  delete next.__pendingPeople;
  delete next.__building;
  return next;
}
