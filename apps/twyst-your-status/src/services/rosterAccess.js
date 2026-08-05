// Account-roster access: one users query per page load, shared by every picker
// instance. Extracted verbatim from PersonPicker.jsx (A-structure-07) so the
// monday read lives under src/services/ like every other one — teamsAccess.js is
// the app's precedent for exactly this shape (module-level cache + single-flight
// promise). The `logger.error('PersonPicker', …)` tag is deliberately unchanged:
// moving the code is not a reason to move the log tag an operator greps for.
import { GET_ACCOUNT_USERS } from './graphqlQueries';
import mondayService from './mondayService';
import logger from '../utils/logger';

// Module-level roster cache: one users query per page load, shared by every
// picker instance.
let rosterCache = null;
let rosterPromise = null;

/**
 * Synchronous peek at the cache. PersonPicker seeds its initial state from this
 * so a second open does not flash a loading row. Returns null before the first
 * successful load — callers rely on the null/array distinction, so it is passed
 * through rather than normalized to [].
 *
 * The finding that moved loadRoster() out of PersonPicker (A-structure-07) did not
 * mention these two reads; without the accessor they became free identifiers that
 * lint accepted (this workspace has no no-undef) and that crashed the component at
 * render — 54 tests caught it.
 */
export function getCachedRoster() {
  return rosterCache;
}
export async function loadRoster() {
  if (rosterCache) return rosterCache;
  if (!rosterPromise) {
    rosterPromise = mondayService
      .query(GET_ACCOUNT_USERS, { limit: 500 })
      .then((data) => {
        rosterCache = data?.users || [];
        return rosterCache;
      })
      .catch((err) => {
        logger.error('PersonPicker', 'Failed to load account roster', err);
        rosterPromise = null; // allow retry on next open
        return [];
      });
  }
  return rosterPromise;
}
