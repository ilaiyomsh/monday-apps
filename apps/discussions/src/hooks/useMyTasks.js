import { useState, useEffect, useCallback, useRef } from 'react';
import { משימות1Board, דיונים1Board } from '@api/BoardSDK.js';
import { api, parseValue, cvSelection } from '../utils/mondayApi/monday-client.js';
import { getBoardId, getColumns } from '../utils/mondayApi/board-config-store.js';
import { makeViewCacheKey, readViewCache, writeViewCache, reconcileSeeded } from '../utils/viewCache.js';
import { computeLedDiscussionIds, collectLedTaskIds, mapLedTaskDiscussionRoles } from '../utils/ledDiscussions.js';
import logger from '../utils/logger.js';

/*
 * "My Tasks" data hook (client-only).
 *
 * Reads tasks straight off the TASKS board (not from a single discussion's
 * relation) and filters them SERVER-SIDE to the current user via the
 * responsibility people column (alias `responsibilityID` / "אחריות"):
 *   query_params.rules = [{ column_id: <responsibilityID id>, compare_value: [userId],
 *                           operator: any_of }]
 * monday's any_of on a people column matches items where that user is among the
 * column's persons — exactly "tasks assigned to me". An optional taskCreatorID
 * filter (alias `taskCreatorID`) adds a second any_of rule on the creator column.
 *
 * Cursor pagination: the first page comes from boards.items_page; "load more"
 * follows the returned cursor via next_items_page (handled inside BoardSDK's
 * ItemsQueryBuilder — withPagination({ cursor })).
 *
 * Each task is mapped through parseValue (via BoardSDK.mapItem) so the rendered
 * shape matches the rest of the app: { id, name, created_at, responsibilityID, deadlineID,
 * statusID, discussionLinkID (discussion relation), taskNotesID, priorityID }. The discussion
 * name shown in the table comes from the discussionLinkID board_relation's linked_items.
 *
 * Inline edits (status / priority / notes / deadline / name) are optimistic and
 * revert on error, writing through BoardSDK .item(id).update()
 * (change_multiple_column_values). Which of them a given row actually offers is
 * gated per task by the board-permissions matrix (MyTasksView's canTask →
 * resolveCan with { item }, no discussion).
 */

const PAGE_SIZE = 100;
// Undo window for deferred bulk delete — matches the delete toast auto-hide.
const DELETE_GRACE_MS = 6000;
// Staged loading window: phase 1 renders the user's ACTIONABLE tasks (not
// "done" + created within the last month) ASAP; phase 2 loads the full page.
const LAST_MONTH_MS = 30 * 24 * 60 * 60 * 1000;

// Columns the "My Tasks" view renders / filters on. Kept lean so the page query
// stays light. discussionLinkID is the discussion board_relation (for the discussion
// column + the discussion grouping); taskNotesID is the inline-editable notes col;
// priorityID is a SECOND status column (its label order = priorityID order).
// taskCreatorID is fetched for the PERMISSION resolution only (the task-tier
// "creator" role in resolveCan) — it isn't rendered as a column here.
// round305 — partnersID (שותפים) rides along so the personal table can render +
// edit it; taskViewersID/taskEditorsID come too because the permission resolver
// scans the task's own role columns in this (discussion-less) surface.
const RENDERED_COLUMNS = ['responsibilityID', 'partnersID', 'taskCreatorID', 'deadlineID', 'statusID', 'discussionLinkID', 'taskNotesID', 'priorityID', 'taskViewersID', 'taskEditorsID'];

// round272 — is the current user among a task's responsibility people? Drives
// the "משימות של אחרים" scope, which is the led-discussion tasks MINUS the ones
// the user is responsible for. Pure, so it's unit-testable.
export function isUserResponsible(task, userId) {
  const people = task?.responsibilityID;
  if (!Array.isArray(people) || userId == null) return false;
  return people.some((p) => String(p?.id) === String(userId));
}

// Resolve the current user's person id as a string, tolerant of the few shapes
// monday's context exposes it in (currentUser.id, context.user.id).
export function resolveUserId(currentUser, context) {
  const raw =
    currentUser?.id ??
    context?.user?.id ??
    context?.userId ??
    null;
  if (raw == null || raw === '') return null;
  return String(raw);
}

// Build the BoardSDK `where` clause for the My Tasks query. Exported so the
// query-shape can be unit-tested without a live board.
//   - responsibilityID (responsibility people): any_of current user
//   - taskCreatorID (people): any_of, only when a creator filter is supplied
//   - name: client-side contains search (BoardSDK handles it post-fetch)
export function buildMyTasksWhere({ userId, taskCreatorId, search }) {
  const where = {};
  if (userId) where.responsibilityID = String(userId);
  if (taskCreatorId) where.taskCreatorID = String(taskCreatorId);
  if (search && String(search).trim()) where.name = String(search).trim();
  return where;
}

// The My-Tasks first-page query, factored out so the hook AND the background
// prefetch build byte-identical queries (same columns / group / page size).
function tasksItemsQuery({ where, sort }) {
  let q = new משימות1Board().items()
    .withColumns(RENDERED_COLUMNS)
    .withGroup() // need item.group for the board-group grouping
    .withPagination({ limit: PAGE_SIZE })
    .where(where);
  if (sort?.column) q = q.orderBy({ column: sort.column, direction: sort.direction || 'asc' });
  return q;
}

// round224 — the "משימות בדיונים שהובלתי" scope (owner mockup): fetch ALL the
// tasks linked to discussions the user LED. Pipeline (proven query shapes only):
//   1. Three server-side people-filtered pages of the DISCUSSIONS board (lead /
//      coordinator / creator = me — BoardSDK formats person-<id>), unioned by id.
//   2. computeLedDiscussionIds applies the owner's rule (lead/coordinator; the
//      creator counts only when the discussion has neither) and
//      collectLedTaskIds gathers the linked task ids off tasksBoardLinkID.
//   3. The tasks are read by id (items(ids:) — the same read shape useTasks
//      uses via linked_items), chunked ≤100, with the SAME lean columns as the
//      default scope so the table renders identically.
const LED_DISCUSSION_COLUMNS = ['discussionLeadID', 'discussionCoordinatorID', 'discussionCreatorID', 'tasksBoardLinkID'];
const LED_CHUNK = 100;

async function fetchLedTasksPage(userId) {
  const dCols = getColumns('discussions') || {};
  const roleWheres = [
    dCols.discussionLeadID?.id && { discussionLeadID: String(userId) },
    dCols.discussionCoordinatorID?.id && { discussionCoordinatorID: String(userId) },
    dCols.discussionCreatorID?.id && { discussionCreatorID: String(userId) },
  ].filter(Boolean);
  if (!getBoardId('discussions') || !roleWheres.length) return [];
  const results = await Promise.all(roleWheres.map((where) =>
    new דיונים1Board().items()
      .withColumns(LED_DISCUSSION_COLUMNS)
      .withPagination({ limit: PAGE_SIZE })
      .where(where)
      .execute()
  ));
  const byId = new Map();
  results.forEach((r) => (r.items || []).forEach((d) => {
    if (!byId.has(String(d.id))) byId.set(String(d.id), d);
  }));
  const discussions = [...byId.values()];
  const ledIds = computeLedDiscussionIds(discussions, userId);
  const taskIds = collectLedTaskIds(discussions, ledIds);
  if (!taskIds.length) return [];
  // round305 — the parent discussion's role people per task: this surface has no
  // discussion object, and שותפים is editable by the discussion's lead/
  // coordinator/creator, so the rows carry those roles for the resolver.
  const rolesByTask = mapLedTaskDiscussionRoles(discussions, ledIds);

  const tCols = getColumns('tasks') || {};
  const colIds = RENDERED_COLUMNS.map((a) => tCols?.[a]?.id).filter(Boolean);
  const cv = cvSelection(RENDERED_COLUMNS.map((a) => tCols?.[a]?.type));
  const chunks = [];
  for (let i = 0; i < taskIds.length; i += LED_CHUNK) chunks.push(taskIds.slice(i, i + LED_CHUNK));
  const pages = await Promise.all(chunks.map((ids) => api(
    `query ($ids: [ID!], $cols: [String!]) {
       items(ids: $ids) { id name created_at group { id title } column_values(ids: $cols) { ${cv} } }
     }`,
    { ids, cols: colIds },
    'useMyTasks.fetchLedTasksPage'
  )));
  const tasks = [];
  pages.forEach((data) => (data?.items || []).forEach((item) => {
    const byCol = {};
    (item.column_values || []).forEach((c) => { byCol[c.id] = c; });
    const mapped = { id: String(item.id), name: item.name, created_at: item.created_at, group: item.group || null };
    RENDERED_COLUMNS.forEach((alias) => {
      const col = tCols?.[alias];
      if (col?.id) mapped[alias] = parseValue(col.type, byCol[col.id]);
    });
    const roles = rolesByTask.get(String(item.id));
    if (roles) mapped.__discussionRoles = roles;
    tasks.push(mapped);
  }));
  return tasks;
}

export function useMyTasks({ currentUser, context, taskCreatorId = null, search = '', sort = null, notDoneStatusIds = [], scope = 'mine' } = {}) {
  const userId = resolveUserId(currentUser, context);
  // Instant-cache seed (stale-while-revalidate): on the FIRST mount only, seed
  // state SYNCHRONOUSLY from the versioned view cache for an instant first
  // paint. Only the DEFAULT query (no creator filter / no search / no server
  // sort) is cached, so a filtered result never seeds the default view. The
  // seed is ALWAYS revalidated by the fetch below (which overwrites the cache);
  // a cache miss ⇒ behavior is exactly as before (empty list + loading:true).
  const isDefaultQuery = scope === 'mine' && !taskCreatorId && !(search && String(search).trim()) && !sort?.column;
  const cacheKey = isDefaultQuery ? makeViewCacheKey('myTasks', { userId, boardId: getBoardId('tasks') }) : null;
  const seedRef = useRef(undefined);
  if (seedRef.current === undefined) {
    const hit = cacheKey ? readViewCache(cacheKey) : null;
    seedRef.current = hit && Array.isArray(hit.items) && hit.items.length ? hit : null;
  }
  const seed = seedRef.current;

  const [items, setItems] = useState(() => (seed ? seed.items : []));
  const [loading, setLoading] = useState(() => (seed ? false : true));
  const [loadingMore, setLoadingMore] = useState(false);
  const [cursor, setCursor] = useState(() => (seed ? seed.cursor || null : null));
  const [error, setError] = useState(null);
  // The first fetch after a seed is a SILENT background revalidate (keep the
  // seeded rows visible, no spinner); every later fetch behaves exactly as
  // before. One-shot — consumed on the first fetchPage run.
  const silentSeedRef = useRef(!!seed);
  // Ids the user has locally mutated this session (optimistic edit/create/
  // delete). The silent seeded revalidate PROTECTS these so a fresh page never
  // clobbers an in-flight change or re-adds a just-deleted (deferred) row.
  const dirtyIdsRef = useRef(new Set());

  // Stable filter key so the fetch effect only re-runs on a real change.
  const filterKey = JSON.stringify({ userId, taskCreatorId, search: (search || '').trim(), sort, scope });
  const reqIdRef = useRef(0);
  // Mirror of `items` for SYNCHRONOUS snapshots: an optimistic edit needs the
  // pre-edit list captured at call time so it can revert on error. Reading it
  // inside a setItems updater is unreliable (React may defer the updater past
  // the time the write rejects), so we keep this ref in lockstep with state.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  // Latest not-"done" status label ids (for the staged phase-1 filter), held in
  // a ref so a late status-options load doesn't churn the fetch dependencies.
  const notDoneStatusIdsRef = useRef(notDoneStatusIds);
  notDoneStatusIdsRef.current = notDoneStatusIds;

  const fetchPage = useCallback(async () => {
    const reqId = ++reqIdRef.current;
    // Not configured yet (Settings not mapped) or no resolvable user → empty.
    if (!getBoardId('tasks') || !getColumns('tasks')?.responsibilityID?.id || !userId) {
      setItems([]);
      setCursor(null);
      setLoading(false);
      return;
    }
    // round224 — the LED scope replaces the whole page pipeline (discussions I
    // led → their linked tasks); one full load, no cursor, client-side search.
    // All the inline edit/delete handlers below operate on the same `items`
    // state, so they work unchanged in this scope too.
    if (scope === 'led' || scope === 'others') {
      try {
        setLoading(true);
        let full = await fetchLedTasksPage(userId);
        if (reqId !== reqIdRef.current) return;
        // round272 — "משימות של אחרים": same led-discussion source, minus the
        // tasks the current user is responsible for (those are "המשימות שלי").
        if (scope === 'others') full = full.filter((tk) => !isUserResponsible(tk, userId));
        const q = (search || '').trim();
        setItems(q ? full.filter((tk) => (tk.name || '').includes(q)) : full);
        setCursor(null);
        setError(null);
      } catch (err) {
        if (reqId !== reqIdRef.current) return;
        logger.error('useMyTasks', 'Error fetching led-discussion tasks', { userId, err });
        setError(err?.message || 'fetch failed');
        setItems([]);
        setCursor(null);
      } finally {
        if (reqId === reqIdRef.current) setLoading(false);
      }
      return;
    }
    const baseWhere = buildMyTasksWhere({ userId, taskCreatorId, search });
    // Consume the one-shot "silent seeded revalidate" flag: the first fetch
    // after a cache seed keeps the seeded rows visible (no spinner) and
    // reconciles the fresh page onto them; every later fetch is unchanged.
    const silentSeeded = silentSeedRef.current;
    silentSeedRef.current = false;
    // Build a page query for a given `where` (shared with the prefetch helper).
    // Sort is { column, direction } over an aliased column (deadline = deadlineID,
    // status = statusID; BoardSDK maps the alias). Priority sort is client-side
    // in the view, so never passed here.
    const buildQuery = (where) => tasksItemsQuery({ where, sort });
    // STAGED LOAD (perceived speed): only on a FRESH load (nothing shown yet).
    // Phase 1 = the user's actionable tasks — NOT in a "done" status AND created
    // within the last month — rendered ASAP. Phase 2 = the full page (+ the real
    // pagination cursor), merged in (dedupe). On a refetch that already has rows
    // (search/sort change) skip straight to the single full query, so the list
    // never shrinks-then-grows.
    const staged = itemsRef.current.length === 0;
    let phase1Items = [];
    if (staged) {
      try {
        setLoading(true);
        const p1Where = { ...baseWhere };
        const notDone = notDoneStatusIdsRef.current;
        // "not done" via any_of over the NON-done label ids (reuses the proven
        // status any_of path). Skipped when the done set is unknown (options not
        // loaded yet) — phase 1 then applies only the last-month trim below.
        if (Array.isArray(notDone) && notDone.length) p1Where.statusID = notDone;
        const r1 = await buildQuery(p1Where).execute();
        if (reqId !== reqIdRef.current) return; // a newer request superseded this one
        const monthAgo = Date.now() - LAST_MONTH_MS;
        phase1Items = (r1.items || []).filter((t) => {
          const ts = t?.created_at ? Date.parse(t.created_at) : NaN;
          return Number.isNaN(ts) ? true : ts >= monthAgo; // unknown created_at → keep
        });
        setItems(phase1Items);
        setCursor(r1.cursor || null);
        setError(null);
        setLoading(false); // first paint done — phase 2 fills in the rest
      } catch (err) {
        if (reqId !== reqIdRef.current) return;
        // Phase 1 is best-effort — fall through to the full load below.
        logger.warn('useMyTasks', 'staged phase-1 fetch failed; loading full set', err);
        phase1Items = [];
      }
    }
    try {
      // A SILENT cache-seeded revalidate keeps the seeded rows on screen (no
      // spinner); a real refetch (search/sort change) shows loading as before.
      if (!staged && !silentSeeded) setLoading(true);
      const r2 = await buildQuery(baseWhere).execute();
      if (reqId !== reqIdRef.current) return; // a newer request superseded this one
      const full = r2.items || [];
      if (staged) {
        // Augment what phase 1 rendered: ADD the server rows not yet shown,
        // preserving current order + any optimistic rows that raced in (a create
        // /edit). A functional update reads the LIVE list, so nothing that was
        // already shown flickers out (final data stays complete).
        setItems((current) => {
          const have = new Set(current.map((t) => String(t.id)));
          return [...current, ...full.filter((t) => !have.has(String(t.id)))];
        });
      } else if (silentSeeded) {
        // Cache seed → fresh page: reconcile on id. The fresh page is
        // authoritative (picks up remote edits/deletes), but locally-touched
        // ids keep their optimistic value / stay deleted, so an in-flight change
        // is never clobbered.
        setItems((current) => reconcileSeeded(current, full, dirtyIdsRef.current));
      } else {
        // Refetch (search/sort change) — the full page is authoritative.
        setItems(full);
      }
      setCursor(r2.cursor || null);
      setError(null);
      // Refresh the DEFAULT-query cache so the next entry seeds fresh data.
      if (cacheKey) writeViewCache(cacheKey, full, r2.cursor || null);
    } catch (err) {
      if (reqId !== reqIdRef.current) return;
      logger.error('useMyTasks', 'Error fetching my tasks', { userId, err });
      // Keep already-visible rows: a staged phase-1 paint OR a cache seed must
      // NOT be cleared by a failed (re)validate — only surface an error and
      // clear when nothing is on screen yet.
      if (!((staged && phase1Items.length) || silentSeeded)) {
        setError(err?.message || 'fetch failed');
        setItems([]);
        setCursor(null);
      }
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, [userId, taskCreatorId, search, sort?.column, sort?.direction, scope]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchPage();
    // filterKey collapses the dependency set into one stable string.
  }, [filterKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    try {
      setLoadingMore(true);
      const res = await new משימות1Board().items()
        .withColumns(RENDERED_COLUMNS)
        .withGroup()
        .withPagination({ cursor })
        .execute();
      setItems((prev) => {
        const have = new Set(prev.map((t) => String(t.id)));
        const fresh = (res.items || []).filter((t) => !have.has(String(t.id)));
        return [...prev, ...fresh];
      });
      setCursor(res.cursor || null);
    } catch (err) {
      logger.error('useMyTasks', 'Error loading more my tasks', err);
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore]);

  // Optimistic inline edit of a status-shaped column — revert on error. Used for
  // both `statusID` (status) and `priorityID`; both store the stable label id (id 0
  // is valid, so callers guard on null/'' upstream).
  const updateStatusColumn = useCallback((alias) => async (taskId, value) => {
    const prev = itemsRef.current; // synchronous pre-edit snapshot for revert
    dirtyIdsRef.current.add(String(taskId)); // protect this row from a seeded revalidate
    setItems((current) =>
      current.map((t) => (String(t.id) === String(taskId) ? { ...t, [alias]: value } : t))
    );
    try {
      await new משימות1Board().item(taskId).update({ [alias]: value }).execute();
    } catch (err) {
      logger.error('useMyTasks', `Error updating task ${alias}`, err);
      setItems(prev);
    }
  }, []);

  const updateTaskStatus = useCallback((taskId, status) => updateStatusColumn('statusID')(taskId, status), [updateStatusColumn]);
  const updateTaskPriority = useCallback((taskId, value) => updateStatusColumn('priorityID')(taskId, value), [updateStatusColumn]);

  // Optimistic inline deadline edit — `date` is a Date or null (clear). The
  // write shape mirrors useTasks.updateTaskDeadline (local Y-M-D string).
  const updateTaskDeadline = useCallback(async (taskId, date) => {
    const prev = itemsRef.current; // synchronous pre-edit snapshot for revert
    dirtyIdsRef.current.add(String(taskId)); // protect this row from a seeded revalidate
    setItems((current) =>
      current.map((t) => (String(t.id) === String(taskId) ? { ...t, deadlineID: date || null } : t))
    );
    try {
      const f = date
        ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
        : null;
      await new משימות1Board().item(taskId).update({ deadlineID: f }).execute();
    } catch (err) {
      logger.error('useMyTasks', 'Error updating task deadline', err);
      setItems(prev);
    }
  }, []);

  // Optimistic inline rename — mirrors useTasks.updateTaskName ({ name } rides
  // change_multiple_column_values' name key). Empty names are ignored upstream.
  const updateTaskName = useCallback(async (taskId, name) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    const prev = itemsRef.current; // synchronous pre-edit snapshot for revert
    dirtyIdsRef.current.add(String(taskId)); // protect this row from a seeded revalidate
    setItems((current) =>
      current.map((t) => (String(t.id) === String(taskId) ? { ...t, name: trimmed } : t))
    );
    try {
      await new משימות1Board().item(taskId).update({ name: trimmed }).execute();
    } catch (err) {
      logger.error('useMyTasks', 'Error renaming task', err);
      setItems(prev);
    }
  }, []);

  // Optimistic inline notes edit (taskNotesID, a text/long_text column) — revert
  // on error.
  const updateTaskNotes = useCallback(async (taskId, notes) => {
    const next = notes == null ? '' : String(notes);
    const prev = itemsRef.current; // synchronous pre-edit snapshot for revert
    dirtyIdsRef.current.add(String(taskId)); // protect this row from a seeded revalidate
    setItems((current) =>
      current.map((t) => (String(t.id) === String(taskId) ? { ...t, taskNotesID: next } : t))
    );
    try {
      await new משימות1Board().item(taskId).update({ taskNotesID: next }).execute();
    } catch (err) {
      logger.error('useMyTasks', 'Error updating task notes', err);
      setItems(prev);
    }
  }, []);

  // round305/306 — optimistic inline edit of a PEOPLE column (partnersID שותפים /
  // responsibilityID אחראי). formatValue('people') accepts ids or [{id}], so the
  // PersonPicker selection goes straight through; revert on failure.
  //
  // RETURNS whether the write actually landed. The failure is handled here (logged
  // + reverted, never rethrown, so a picker edit can't crash the view), but the
  // caller still has to know: updateTaskAssignee decides row MEMBERSHIP from the
  // new assignment, and deciding that from a write the server rejected would drop
  // a row that still belongs in the scope (round306 PR review).
  const updatePeopleColumn = useCallback((alias, label) => async (taskId, people) => {
    const next = Array.isArray(people) ? people : [];
    const prev = itemsRef.current; // synchronous pre-edit snapshot for revert
    dirtyIdsRef.current.add(String(taskId)); // protect this row from a seeded revalidate
    setItems((current) =>
      current.map((t) => (String(t.id) === String(taskId) ? { ...t, [alias]: next } : t))
    );
    try {
      await new משימות1Board().item(taskId).update({ [alias]: next }).execute();
      return true;
    } catch (err) {
      logger.error('useMyTasks', `Error updating task ${label}`, err);
      setItems(prev);
      return false;
    }
  }, []);
  const updateTaskPartners = useCallback(
    (taskId, people) => updatePeopleColumn('partnersID', 'partners')(taskId, people),
    [updatePeopleColumn]
  );
  // round306 (PR review) — reassigning אחריות can move the task OUT of the active
  // scope: the 'mine' page is server-filtered to "responsible = me", and the
  // 'others' scope is explicitly "led tasks I am NOT responsible for". Updating the
  // column in place would leave the row visible (and editable) in a scope it no
  // longer belongs to until the next refetch, so the row is dropped here.
  const updateTaskAssignee = useCallback(
    async (taskId, people) => {
      const written = await updatePeopleColumn('responsibilityID', 'assignee')(taskId, people);
      // A REJECTED write leaves the old assignment on the board (and the helper has
      // already reverted the row), so the task still belongs to this scope — judging
      // membership by what was merely REQUESTED would make it vanish anyway.
      if (!written) return;
      const next = Array.isArray(people) ? people : [];
      const holdsMe = !!userId && next.some((p) => String(p?.id) === String(userId));
      const leftScope = (scope === 'mine' && !holdsMe) || (scope === 'others' && holdsMe);
      if (leftScope) {
        setItems((current) => current.filter((t) => String(t.id) !== String(taskId)));
      }
    },
    [updatePeopleColumn, scope, userId]
  );

  // Deferred bulk delete with an undo window (mirrors useTasks.softDeleteTasks):
  // rows vanish optimistically now, the real delete_item fires only after
  // DELETE_GRACE_MS, and the returned undo() (wired to the toast's "בטל") cancels
  // the pending delete and restores the rows. monday has no simple un-delete.
  const softDeleteTasks = useCallback((ids) => {
    const idList = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
    if (!idList.length) return { undo: () => {}, count: 0 };
    const idSet = new Set(idList.map(String));
    idList.forEach((id) => dirtyIdsRef.current.add(String(id))); // keep them removed through a seeded revalidate
    const removed = itemsRef.current.filter((i) => idSet.has(String(i.id))); // snapshot for restore
    setItems((current) => current.filter((i) => !idSet.has(String(i.id))));

    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      idList.forEach((id) => {
        api(`mutation ($itemId: ID!) { delete_item(item_id: $itemId) { id } }`, { itemId: id }, 'useMyTasks.softDeleteTasks')
          .catch((err) => logger.error('useMyTasks', 'Error deleting task', err));
      });
    }, DELETE_GRACE_MS);

    const undo = () => {
      if (cancelled) return;
      cancelled = true;
      clearTimeout(timer);
      setItems((current) => {
        const have = new Set(current.map((i) => String(i.id)));
        return [...current, ...removed.filter((i) => !have.has(String(i.id)))];
      });
    };
    return { undo, count: idList.length };
  }, []);

  const refresh = useCallback(() => fetchPage(), [fetchPage]);

  // Create a standalone task from the My Tasks view (no discussion link). The
  // responsibility (responsibilityID) is stamped with the CURRENT user so the new
  // task passes the server-side "assigned to me" filter this view runs on — a
  // task created here without me as assignee would never appear in the list.
  // taskCreatorID is stamped too (mirrors useTasks.createTask). status/priority
  // are label ids (0 is valid); deadline is a Date; notes is text. The new row is
  // APPENDED optimistically by default (bottom of its group); pass `prepend:true`
  // (the top "משימה חדשה" button) to insert it at the FRONT instead, so it can be
  // surfaced at the very top of the view. Its temp id is swapped for the real one
  // on success (no full refetch → no skeleton flash). Optional callbacks let the
  // caller track the row across that swap: `onOptimistic(tempId)` fires the moment
  // the optimistic row is inserted, `onReconcile(tempId, realId)` the moment the
  // temp id becomes the real id — used by the view to keep the new row pinned to
  // the top through the create round-trip.
  const createTask = useCallback(async ({
    name, status = null, priority = null, deadline = null, notes = '',
    prepend = false, onOptimistic = null, onReconcile = null,
  } = {}) => {
    const trimmed = (name || '').trim();
    if (!trimmed || !userId) return null;
    const tempId = `temp-${Date.now()}`;
    dirtyIdsRef.current.add(String(tempId)); // protect the optimistic row from a seeded revalidate
    const meAsPerson = [{ id: String(userId), name: currentUser?.name || '' }];
    const optimisticRow = {
      id: tempId,
      name: trimmed,
      responsibilityID: meAsPerson,
      // Stamp the creator locally too — the permission gate (canTask) reads
      // it, so the fresh optimistic row is immediately editable by its maker.
      taskCreatorID: meAsPerson,
      deadlineID: deadline instanceof Date ? deadline : null,
      statusID: status,
      priorityID: priority,
      taskNotesID: notes || '',
    };
    setItems((prev) => (prepend ? [optimisticRow, ...prev] : [...prev, optimisticRow]));
    onOptimistic?.(tempId);
    try {
      const data = { name: trimmed, responsibilityID: [Number(userId)] };
      if (getColumns('tasks')?.taskCreatorID?.id) data.taskCreatorID = [Number(userId)];
      // round115 — stamp the creation date (today); no-op when unmapped.
      if (getColumns('tasks')?.taskCreationDateID?.id) data.taskCreationDateID = new Date();
      if (status != null) data.statusID = status; // label id; 0 is valid
      if (priority != null) data.priorityID = priority;
      if (deadline instanceof Date) {
        data.deadlineID = `${deadline.getFullYear()}-${String(deadline.getMonth() + 1).padStart(2, '0')}-${String(deadline.getDate()).padStart(2, '0')}`;
      }
      if (notes && String(notes).trim()) data.taskNotesID = String(notes);
      const created = await new משימות1Board().item().create(data, { createLabelsIfMissing: true }).execute();
      const realId = created.id;
      dirtyIdsRef.current.add(String(realId)); // the reconciled row stays protected under its real id
      setItems((prev) => prev.map((t) => (t.id === tempId ? { ...t, id: realId } : t)));
      // Let the caller migrate any temp-id tracking (e.g. the top-of-view pin)
      // to the real id in the SAME tick as the swap, so the row never flickers
      // out of its pinned position during reconciliation.
      onReconcile?.(tempId, realId);
      return { id: realId };
    } catch (err) {
      logger.error('useMyTasks', 'Error creating task', err);
      setItems((prev) => prev.filter((t) => t.id !== tempId));
      return null;
    }
  }, [userId, currentUser?.name]);

  return {
    items,
    loading,
    loadingMore,
    cursor,
    hasMore: !!cursor,
    error,
    userId,
    loadMore,
    updateTaskStatus,
    updateTaskPriority,
    updateTaskNotes,
    updateTaskDeadline,
    updateTaskName,
    updateTaskPartners,
    updateTaskAssignee,
    softDeleteTasks,
    createTask,
    refresh,
  };
}

// Pull the list of task CREATORS (distinct people on the taskCreatorID column)
// for the optional "filter by creator" dropdown. Returns [{ id, name }].
// Scans up to a few pages of the user's tasks — the creator set is small, so a
// bounded scan is fine. Kept here (vs the hook) so the view can lazy-load it.
export async function fetchTaskCreators({ userId, limit = 300 } = {}) {
  const boardId = getBoardId('tasks');
  const cols = getColumns('tasks') || {};
  const creatorColId = cols?.taskCreatorID?.id;
  const respColId = cols?.responsibilityID?.id;
  if (!boardId || !creatorColId) return [];
  const rules = [];
  if (userId && respColId) {
    // People-column filters need the "person-<id>" compare_value form — a bare
    // user id is silently ignored by monday and matches nothing (same rule
    // BoardSDK._buildQueryParams applies), which left the creators list empty.
    rules.push({ column_id: respColId, compare_value: [`person-${userId}`], operator: 'any_of' });
  }
  const qp = rules.length ? { rules } : undefined;
  const cv = cvSelection(['people']);
  try {
    const data = await api(
      `query ($boardId: ID!, $limit: Int!, $qp: ItemsQuery, $ids: [String!]) {
         boards(ids: [$boardId]) {
           items_page(limit: $limit, query_params: $qp) {
             items { id column_values(ids: $ids) { ${cv} } }
           }
         }
       }`,
      { boardId, limit, qp, ids: [creatorColId] },
      'useMyTasks.fetchTaskCreators'
    );
    const pageItems = data?.boards?.[0]?.items_page?.items || [];
    const byId = new Map();
    pageItems.forEach((it) => {
      const cvv = (it.column_values || [])[0];
      const people = parseValue('people', cvv) || [];
      people.forEach((p) => { if (p?.id && !byId.has(String(p.id))) byId.set(String(p.id), { id: String(p.id), name: p.name || '' }); });
    });
    return [...byId.values()].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'he'));
  } catch (err) {
    logger.error('useMyTasks', 'Error fetching task creators', err);
    return [];
  }
}

// Warm the My-Tasks view cache in the background (used by App.jsx's post-boot
// prefetch). Runs the SAME default first-page query the hook seeds from and
// writes the result into the view cache. Never touches React state; swallows +
// logs its own errors so it can never crash the UI. No-ops (returns false) when
// the board / user / columns aren't ready yet.
export async function prefetchMyTasks({ currentUser, context } = {}) {
  try {
    const userId = resolveUserId(currentUser, context);
    const boardId = getBoardId('tasks');
    if (!userId || !boardId || !getColumns('tasks')?.responsibilityID?.id) return false;
    const key = makeViewCacheKey('myTasks', { userId, boardId });
    if (!key) return false;
    const res = await tasksItemsQuery({ where: buildMyTasksWhere({ userId }) }).execute();
    writeViewCache(key, res.items || [], res.cursor || null);
    return true;
  } catch (err) {
    logger.warn('useMyTasks', 'prefetch failed', err);
    return false;
  }
}
