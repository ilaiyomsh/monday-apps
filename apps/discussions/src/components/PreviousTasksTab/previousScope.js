/*
 * round274 — "דיונים קודמים" scope helpers.
 *
 * By-type mode aggregates the tasks/decisions of EVERY discussion that shares
 * the current discussion's type. The tab defaults to the MOST RECENT previous
 * occurrence of that type ("הפעם האחרונה"); the user can switch to "כל הדיונים
 * הקודמים" to see them all.
 *
 * pickLatestPreviousId picks that most-recent previous discussion: the newest
 * type-sibling that is NOT the current discussion, by date desc (falling back to
 * created_at, then item id as a stable tiebreak). Pure, so it's unit-tested.
 */

/** Milliseconds for a discussion's ordering date (discussionDateID → created_at). */
function whenMs(d) {
  const raw = d?.discussionDateID ?? d?.created_at ?? null;
  if (!raw) return NaN;
  const t = raw instanceof Date ? raw.getTime() : Date.parse(raw);
  return Number.isNaN(t) ? NaN : t;
}

/**
 * @param {Array<{id:string|number, discussionDateID?:any, created_at?:any}>} discussions
 *        all discussions sharing the type (may include the current one).
 * @param {string|number} currentId the open discussion's id (excluded).
 * @returns {string|null} the most-recent OTHER discussion's id, or null if none.
 */
export function pickLatestPreviousId(discussions, currentId) {
  const cur = currentId == null ? null : String(currentId);
  const others = (Array.isArray(discussions) ? discussions : [])
    .filter((d) => d && d.id != null && String(d.id) !== cur);
  if (!others.length) return null;
  let best = null;
  let bestMs = -Infinity;
  for (const d of others) {
    const ms = whenMs(d);
    const cmp = Number.isNaN(ms) ? -Infinity : ms;
    // date desc; on a tie prefer the larger numeric id (later-created item).
    if (cmp > bestMs || (cmp === bestMs && Number(d.id) > Number(best?.id ?? -Infinity))) {
      best = d;
      bestMs = cmp;
    }
  }
  return best ? String(best.id) : null;
}
