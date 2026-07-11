import { useState, useEffect, useCallback, useRef } from 'react';
import { דיונים1Board } from '@api/BoardSDK.js';
import { api } from '../utils/mondayApi/monday-client.js';
import logger from '../utils/logger.js';

// Undo window for the optimistic discussion delete — matches the delete toast's
// auto-hide so the real delete_item fires exactly when "בטל" disappears.
const DELETE_GRACE_MS = 6000;

// List is ordered by date (discussionDateID) desc; re-apply it after an undo restore so
// the row returns to its original spot rather than the end.
function sortByDateDesc(list) {
  return [...list].sort((a, b) => {
    const ta = a.discussionDateID instanceof Date ? a.discussionDateID.getTime() : 0;
    const tb = b.discussionDateID instanceof Date ? b.discussionDateID.getTime() : 0;
    return tb - ta;
  });
}

// Pull a large page up-front (id + name + date only — see the lean withColumns
// below); the rest of a discussion's data is fetched on click via
// useDiscussionDetails. The cursor + "load more" still cover boards with >500.
const PAGE_SIZE = 500;
// date (display/ordering) + סוג status (drives the list/calendar dot color) +
// the creator/lead people columns (drive the per-row edit-permission gate in the
// list — only the discussion creator/lead, or a board owner, may edit/delete).
const LIST_COLUMNS = ['discussionDateID', 'discussionTypeID', 'discussionCreatorID', 'discussionLeadID'];

// Boot warm cache (in-memory, session-scoped). App.jsx's boot gate calls
// prefetchDiscussions() BEFORE it reveals the app and stores the first default
// page HERE, so the list hook can SEED its first paint from it — the discussions
// list shows the instant the boot loader clears, with no re-fetch + no second
// loader flash. Consumed once by the first default (unfiltered) list mount, and
// only while fresh (a stale entry never seeds a later mount).
let bootPrefetch = null; // { items, cursor, ts } | null
const BOOT_PREFETCH_TTL_MS = 30 * 1000;

export function useDiscussions(filters = {}) {
  // Seed the FIRST paint from the boot prefetch when this is the DEFAULT,
  // unfiltered list — so rows show the instant the boot loader reveals the view,
  // with no re-fetch flash. Any active filter (search / month / type / calendar
  // range) skips the seed. Consumed once and only while fresh; the initial fetch
  // is then skipped (the boot gate JUST fetched this exact page — no wasteful
  // double-fetch), while every later filter change still fetches normally.
  const hasFilters = !!(
    filters.search ||
    filters.month ||
    (filters.type && filters.type.length) ||
    (filters.range?.from && filters.range?.to)
  );
  const seedRef = useRef(undefined);
  if (seedRef.current === undefined) {
    const fresh = bootPrefetch && Date.now() - bootPrefetch.ts < BOOT_PREFETCH_TTL_MS;
    if (!hasFilters && fresh) {
      seedRef.current = bootPrefetch;
      bootPrefetch = null; // consume: only the first default list mount seeds
    } else {
      seedRef.current = null;
    }
  }
  const seed = seedRef.current;

  const [items, setItems] = useState(() => (seed ? seed.items : []));
  const [loading, setLoading] = useState(() => (seed ? false : true));
  const [refetching, setRefetching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [cursor, setCursor] = useState(() => (seed ? seed.cursor || null : null));
  const [error, setError] = useState(null);
  const prevFiltersRef = useRef(null);
  // A boot-seeded first mount SKIPS the initial fetch (the boot gate just fetched
  // this exact page); consumed on the first effect run.
  const skipInitialFetchRef = useRef(!!seed);

  const fetchDiscussions = useCallback(async (isRefetch = false) => {
    try {
      if (isRefetch) {
        setRefetching(true);
      } else {
        setLoading(true);
      }

      const board = new דיונים1Board();
      // Lean list: only the date is fetched for display/ordering (name + id come
      // for free). Participants, description, type, relations etc. are pulled on
      // click (useDiscussionDetails / per-tab hooks). A where-filter on another
      // column (e.g. type) auto-adds that column to the fetch in BoardSDK.
      let query = board.items()
        .withColumns(LIST_COLUMNS)
        .orderBy({ column: "discussionDateID", direction: "desc" })
        .withPagination({ limit: PAGE_SIZE });

      const where = {};
      if (filters.search) {
        where.name = filters.search;
      }
      // Calendar view passes an explicit visible range (already padded for the
      // UTC date-part drift of timed values); it wins over the month dropdown.
      // NOTE: capped at PAGE_SIZE items per range (no auto load-more) — fine
      // for a month of discussions.
      if (filters.range?.from && filters.range?.to) {
        where.discussionDateID = { between: [filters.range.from, filters.range.to] };
      } else if (filters.month) {
        const [year, month] = filters.month.split('-');
        const startDate = `${year}-${month}-01`;
        const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
        const endDate = `${year}-${month}-${lastDay}`;
        where.discussionDateID = { between: [startDate, endDate] };
      }
      if (filters.type && filters.type.length > 0) {
        where.discussionTypeID = filters.type;
      }

      if (Object.keys(where).length > 0) {
        query = query.where(where);
      }

      const result = await query.execute();
      setItems(result.items || []);
      setCursor(result.cursor || null);
      setError(null);
    } catch (err) {
      console.error('Error fetching discussions:', err);
      setError(err.message);
    } finally {
      setLoading(false);
      setRefetching(false);
    }
  }, [filters.search, filters.month, filters.type, filters.range?.from, filters.range?.to]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    try {
      setLoadingMore(true);
      const board = new דיונים1Board();
      const result = await board.items()
        .withColumns(LIST_COLUMNS)
        .withPagination({ cursor })
        .execute();
      setItems(prev => [...prev, ...(result.items || [])]);
      setCursor(result.cursor || null);
    } catch (err) {
      console.error('Error loading more:', err);
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore]);

  // Optimistic delete with an undo window: the row vanishes from the list
  // immediately, but the real delete_item fires only after DELETE_GRACE_MS — so
  // the returned undo() (wired to the toast's "בטל") can cancel it and restore
  // the row (monday has no simple un-delete, so deferring is the only true undo).
  const softDeleteDiscussion = useCallback((id) => {
    if (!id) return { undo: () => {} };
    const removed = items.filter((i) => String(i.id) === String(id)); // snapshot
    setItems((cur) => cur.filter((i) => String(i.id) !== String(id)));

    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      api(
        `mutation ($itemId: ID!) { delete_item(item_id: $itemId) { id } }`,
        { itemId: String(id) },
        'useDiscussions.softDeleteDiscussion'
      ).catch((err) => logger.error('useDiscussions', 'מחיקת הדיון נכשלה', err));
    }, DELETE_GRACE_MS);

    const undo = () => {
      if (cancelled) return;
      cancelled = true;
      clearTimeout(timer);
      setItems((cur) => {
        const have = new Set(cur.map((i) => String(i.id)));
        return sortByDateDesc([...cur, ...removed.filter((i) => !have.has(String(i.id)))]);
      });
    };
    return { undo };
  }, [items]);

  useEffect(() => {
    const filtersKey = JSON.stringify({ search: filters.search, month: filters.month, type: filters.type, range: filters.range });
    // Boot-seeded first mount: the boot gate already fetched this exact default
    // page, so skip the initial fetch (no clobber, no double-fetch). Prime
    // prevFiltersRef so a later real filter change still refetches normally.
    if (skipInitialFetchRef.current) {
      skipInitialFetchRef.current = false;
      prevFiltersRef.current = filtersKey;
      return;
    }
    const isRefetch = prevFiltersRef.current !== null && prevFiltersRef.current !== filtersKey;
    prevFiltersRef.current = filtersKey;
    fetchDiscussions(isRefetch);
  }, [fetchDiscussions]);

  return { items, loading, refetching, loadingMore, cursor, error, loadMore, softDeleteDiscussion, refetch: () => fetchDiscussions(true) };
}

/**
 * Fetch a single discussion's FULL column set by id ("click pulls the rest").
 * Returns null while loading / if not found. The api() funnel logs failures, so
 * here we only re-log un-logged ones and otherwise leave details null.
 */
export function useDiscussionDetails(discussionId) {
  const [details, setDetails] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setDetails(null);
    if (!discussionId) return undefined;
    (async () => {
      try {
        const full = await new דיונים1Board().itemById(discussionId);
        if (!cancelled) setDetails(full);
      } catch (err) {
        if (!cancelled && !err?.__loggedId) logger.error('useDiscussionDetails', 'טעינת פרטי הדיון נכשלה', err);
      }
    })();
    return () => { cancelled = true; };
  }, [discussionId]);

  return details;
}

// Warm + GATE the discussions list on boot (used by App.jsx's boot gate). Runs
// the SAME lean default first-page query the list hook runs, stores the result
// in the in-memory boot cache (so the first list mount SEEDS from it instead of
// re-fetching), and resolves when it settles. Never touches React state; on any
// failure it logs + resolves false so boot can never hang or crash. Returns
// true when the page was fetched, false on error / unconfigured board.
export async function prefetchDiscussions() {
  try {
    const board = new דיונים1Board();
    const result = await board
      .items()
      .withColumns(LIST_COLUMNS)
      .orderBy({ column: 'discussionDateID', direction: 'desc' })
      .withPagination({ limit: PAGE_SIZE })
      .execute();
    bootPrefetch = { items: result.items || [], cursor: result.cursor || null, ts: Date.now() };
    return true;
  } catch (err) {
    logger.warn('useDiscussions', 'boot prefetch failed', err);
    return false;
  }
}
