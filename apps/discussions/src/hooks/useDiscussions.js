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
/*
 * round379 (owner spec) — the list no longer defaults to a month filter. Instead
 * the DEFAULT list paints from a tiny first page and then keeps loading the rest
 * in the background, so the side menu is populated immediately and ends up
 * COMPLETE rather than scoped to one month.
 *
 * 15 is the owner's number: ~15 rows at 36px ≈ 540px, which covers the visible
 * pane. It is a named constant precisely because "covers the screen" depends on
 * the monitor — raising it is a one-line change, and the background drain starts
 * immediately either way, so a taller pane fills in without a visible gap.
 */
const FIRST_PAGE_SIZE = 15;
/*
 * Backstop for the background drain: 15 + 20×500 ≈ 10,000 discussions. Reaching
 * it is logged, never silent — a list that stops short while looking complete is
 * exactly the failure the month filter used to hide.
 */
const MAX_BACKGROUND_PAGES = 20;
// date (display/ordering) + סוג status (drives the list/calendar dot color) +
// the creator/lead people columns (drive the per-row edit-permission gate in the
// list — only the discussion creator/lead, or a board owner, may edit/delete).
// round207 — the coordinator joined the row-level fixed EXPORT rule, so the
// lean list read now carries the coordinator column too.
const LIST_COLUMNS = ['discussionDateID', 'discussionTypeID', 'discussionCreatorID', 'discussionLeadID', 'discussionCoordinatorID'];
// Date-only column set for the month-filter option fetch (useDiscussionMonths):
// only each discussion's date is needed to derive the distinct months that have
// discussions — no need to pull type/people.
const MONTH_COLUMNS = ['discussionDateID'];

// Boot warm cache (in-memory, session-scoped). App.jsx's boot gate calls
// prefetchDiscussions() BEFORE it reveals the app and stores the first default
// page HERE, so the list hook can SEED its first paint from it — the discussions
// list shows the instant the boot loader clears, with no re-fetch + no second
// loader flash. Consumed once by the first default (unfiltered) list mount, and
// only while fresh (a stale entry never seeds a later mount).
let bootPrefetch = null; // { items, cursor, ts } | null
const BOOT_PREFETCH_TTL_MS = 30 * 1000;

/*
 * Is this list scoped by anything the SERVER filters on? Extracted (round379) and
 * exported because THREE decisions now read it and they must agree: whether the
 * boot prefetch may seed this mount, whether the first page is the tiny paint-first
 * one, and whether the background drain runs at all.
 *
 * A filtered query keeps the old behaviour — one page of up to PAGE_SIZE and the
 * manual "טען עוד" — because the point of the small first page is the DEFAULT list,
 * the one the side menu opens on.
 */
export function hasActiveFilters(filters = {}) {
  return !!(
    filters.search ||
    filters.month ||
    (filters.type && filters.type.length) ||
    (filters.range?.from && filters.range?.to)
  );
}

/*
 * Append a page, dropping ids already present. The server pages a stable
 * date-desc order, so a plain concat is normally right — but a discussion CREATED
 * while the drain is walking shifts the window, and monday can then hand back a
 * row we already hold. Deduping keeps that from rendering twice (React would also
 * warn on the duplicate key).
 */
export function appendUniqueById(prev, next) {
  const seen = new Set((prev || []).map((i) => String(i.id)));
  const add = (next || []).filter((i) => i && !seen.has(String(i.id)));
  return add.length ? [...prev, ...add] : prev;
}

export function useDiscussions(filters = {}) {
  // Seed the FIRST paint from the boot prefetch when this is the DEFAULT,
  // unfiltered list — so rows show the instant the boot loader reveals the view,
  // with no re-fetch flash. Any active filter (search / month / type / calendar
  // range) skips the seed. Consumed once and only while fresh; the initial fetch
  // is then skipped (the boot gate JUST fetched this exact page — no wasteful
  // double-fetch), while every later filter change still fetches normally.
  const hasFilters = hasActiveFilters(filters);
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
  /*
   * round379 — background-drain plumbing.
   *
   * `cursorRef` mirrors the cursor so the drain loop can advance WITHOUT being in
   * its own dependency array (a cursor-keyed effect that also sets the cursor is
   * the shape that loops forever — round370's freeze was exactly that mistake one
   * layer up). `drainGenRef` is the abort token: every new first page bumps it, so
   * a filter change or an unmount makes the in-flight loop drop its result instead
   * of appending it onto a list it no longer belongs to.
   */
  const cursorRef = useRef(seed ? seed.cursor || null : null);
  const drainGenRef = useRef(0);
  const [autoLoading, setAutoLoading] = useState(false);

  const applyCursor = useCallback((next) => {
    cursorRef.current = next || null;
    setCursor(next || null);
  }, []);
  // A boot-seeded first mount SKIPS the initial fetch (the boot gate just fetched
  // this exact page); consumed on the first effect run.
  const skipInitialFetchRef = useRef(!!seed);

  /*
   * round379 — keep pulling pages until the board is exhausted, WITHOUT blocking
   * the paint. Started right after the first page lands (and right after a boot
   * seed), it walks the cursor at full PAGE_SIZE, so the cost is the same total
   * work as the old single 500-row read — just reordered so 15 rows are on screen
   * first.
   *
   * `gen` is captured at start and re-checked after every await: a filter change
   * or an unmount bumps `drainGenRef`, and the loop then discards its page instead
   * of appending it to a list that has since been replaced.
   */
  const drainRemainingPages = useCallback(async (gen) => {
    if (!cursorRef.current) return;
    setAutoLoading(true);
    try {
      let pages = 0;
      while (cursorRef.current && drainGenRef.current === gen) {
        if (pages >= MAX_BACKGROUND_PAGES) {
          logger.warn(
            'useDiscussions',
            `טעינת הרקע נעצרה אחרי ${MAX_BACKGROUND_PAGES} עמודים — ייתכן שלא כל הדיונים נטענו`
          );
          return;
        }
        // A failed page ABORTS the drain rather than retrying forever: safeApi has
        // already retried the transient cases, and the list keeps what it has.
        const result = await new דיונים1Board().items()
          .withColumns(LIST_COLUMNS)
          .withPagination({ cursor: cursorRef.current })
          .execute();
        if (drainGenRef.current !== gen) return;
        pages += 1;
        setItems((prev) => appendUniqueById(prev, result.items));
        applyCursor(result.cursor);
      }
    } catch (err) {
      if (!err?.__loggedId) logger.warn('useDiscussions', 'טעינת הרקע של הדיונים נעצרה', err);
    } finally {
      if (drainGenRef.current === gen) setAutoLoading(false);
    }
  }, [applyCursor]);

  const fetchDiscussions = useCallback(async (isRefetch = false) => {
    try {
      if (isRefetch) {
        setRefetching(true);
      } else {
        setLoading(true);
      }

      const board = new דיונים1Board();
      // round379 — the DEFAULT list asks for 15 rows so it can paint at once and
      // then drain the rest; a FILTERED list still takes one full page.
      const drains = !hasActiveFilters(filters);
      const limit = drains ? FIRST_PAGE_SIZE : PAGE_SIZE;
      // Lean list: only the date is fetched for display/ordering (name + id come
      // for free). Participants, description, type, relations etc. are pulled on
      // click (useDiscussionDetails / per-tab hooks). A where-filter on another
      // column (e.g. type) auto-adds that column to the fetch in BoardSDK.
      let query = board.items()
        .withColumns(LIST_COLUMNS)
        .orderBy({ column: "discussionDateID", direction: "desc" })
        .withPagination({ limit });

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
      // Bump BEFORE applying: any drain still walking the previous filter's cursor
      // is now stale and must not append into this fresh list.
      const gen = drainGenRef.current + 1;
      drainGenRef.current = gen;
      setItems(result.items || []);
      applyCursor(result.cursor);
      setError(null);
      // Paint first, drain after — deliberately NOT awaited.
      if (drains) drainRemainingPages(gen);
    } catch (err) {
      if (!err?.__loggedId) logger.error('useDiscussions', 'טעינת הדיונים נכשלה', err);
      setError(err.message);
    } finally {
      setLoading(false);
      setRefetching(false);
    }
    // `filters` is read through hasActiveFilters as well; the five primitive
    // fields below are the whole of it, so they remain the honest dep list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.search, filters.month, filters.type, filters.range?.from, filters.range?.to, applyCursor, drainRemainingPages]);

  // Manual "טען עוד" — still the path for a FILTERED list, which takes one full
  // page and no drain. It stays inert while the background drain owns the cursor.
  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore || autoLoading) return;
    try {
      setLoadingMore(true);
      const board = new דיונים1Board();
      const result = await board.items()
        .withColumns(LIST_COLUMNS)
        .withPagination({ cursor })
        .execute();
      setItems(prev => appendUniqueById(prev, result.items));
      applyCursor(result.cursor);
    } catch (err) {
      if (!err?.__loggedId) logger.error('useDiscussions', 'טעינת דיונים נוספים נכשלה', err);
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore, autoLoading, applyCursor]);

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
      // round379 — a boot seed is only the FIRST 15 rows now, so the seeded mount
      // must drain too. Skipping this would leave a boot-seeded session showing
      // 15 discussions forever, which is the one regression this round can cause.
      const gen = drainGenRef.current + 1;
      drainGenRef.current = gen;
      drainRemainingPages(gen);
      return;
    }
    const isRefetch = prevFiltersRef.current !== null && prevFiltersRef.current !== filtersKey;
    prevFiltersRef.current = filtersKey;
    fetchDiscussions(isRefetch);
  }, [fetchDiscussions, drainRemainingPages]);

  // Unmount aborts the drain: bumping the generation makes the in-flight loop
  // discard its page instead of calling setItems on an unmounted hook.
  useEffect(() => () => { drainGenRef.current += 1; }, []);

  return {
    items, loading, refetching, loadingMore, autoLoading, cursor, error,
    loadMore, softDeleteDiscussion, refetch: () => fetchDiscussions(true),
  };
}

/**
 * Distinct 'YYYY-MM' months that have at least one discussion — powers the list's
 * month filter so ANY month that holds a discussion is offered (past, present OR
 * future), instead of a fixed trailing window that hid future-dated discussions.
 *
 * useDiscussions() fetches only the SELECTED month's discussions (for perf), so
 * the full month set can't be derived from its items; this runs ONE lean,
 * date-only query independently — a single page up to PAGE_SIZE, ordered by date
 * desc so future-dated discussions are always captured — and reduces the dates
 * to the sorted (newest-first) distinct month set. Never throws: on error it
 * logs + returns []; buildMonthOptions always re-adds the current month, so the
 * dropdown is never empty.
 */
// round136 — `refreshToken` re-runs the month scan when the caller signals a
// data change (a save that may introduce a new month), replacing the old
// whole-list remount that refreshed it as a side effect.
export function useDiscussionMonths(refreshToken = 0) {
  const [months, setMonths] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const board = new דיונים1Board();
        const result = await board
          .items()
          .withColumns(MONTH_COLUMNS)
          .orderBy({ column: 'discussionDateID', direction: 'desc' })
          .withPagination({ limit: PAGE_SIZE })
          .execute();
        const set = new Set();
        for (const it of result.items || []) {
          const d = it.discussionDateID;
          if (d instanceof Date && !Number.isNaN(d.getTime())) {
            set.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
          }
        }
        // Newest-first (descending) — 'YYYY-MM' sorts chronologically (zero-padded).
        if (!cancelled) setMonths([...set].sort().reverse());
      } catch (err) {
        if (!cancelled && !err?.__loggedId) logger.warn('useDiscussionMonths', 'טעינת חודשי הדיונים נכשלה', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshToken]);

  return { months, loading };
}

/**
 * Fetch a single discussion's FULL column set by id ("click pulls the rest").
 * Returns null while loading / if not found. The api() funnel logs failures, so
 * here we only re-log un-logged ones and otherwise leave details null.
 */
/**
 * `reloadStamp` (round301) re-runs the fetch for the SAME discussion id. The
 * staged create writes a discussion in three passes, so the card must be able to
 * re-read it once a later pass lands — without it, everything created after the
 * card opened stayed invisible until the discussion was reopened.
 */
export function useDiscussionDetails(discussionId, reloadStamp = null) {
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
  }, [discussionId, reloadStamp]);

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
      // round379 — the SAME 15-row first page the default list now asks for, so
      // the boot gate resolves on 15 rows instead of 500 and the seed matches
      // what the list would have fetched. The list drains the rest afterwards.
      //
      // Until this round the seed was DEAD: the list mounted with a month filter,
      // so `hasActiveFilters` was true, the seed was skipped, and boot paid for a
      // 500-row query whose result was thrown away before a second, filtered
      // fetch. Dropping the month default is what makes this path live.
      .withPagination({ limit: FIRST_PAGE_SIZE })
      .execute();
    bootPrefetch = { items: result.items || [], cursor: result.cursor || null, ts: Date.now() };
    return true;
  } catch (err) {
    logger.warn('useDiscussions', 'boot prefetch failed', err);
    return false;
  }
}
