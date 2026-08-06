import { useEffect, useState } from 'react';
import { api, parseValue, cvSelection } from '../../utils/mondayApi/monday-client.js';
import { getColumns } from '../../utils/mondayApi/board-config-store.js';
import { משימות1Board, דיונים1Board } from '@api/BoardSDK.js';
import { useDropdownOptions } from '@generated/hooks/useDropdownOptions';
import { pickLatestPreviousId } from './previousScope.js';
import { customEntriesFor } from '@generated/utils/customColumns.js';
import logger from '@generated/utils/logger.js';

// Map a linked task item (from the discussion-side relation query) into the
// app-facing task shape TaskTable/TaskTableRow render: { id, name, responsibilityID,
// deadlineID, statusID, ... } via parseValue using the configured tasks columns.
function mapTaskItems(linkedItems = [], taskColumns = {}) {
  return linkedItems.map((item) => {
    const byId = {};
    (item.column_values || []).forEach((cv) => { byId[cv.id] = cv; });

    const mapped = { id: String(item.id), name: item.name, created_at: item.created_at };
    Object.entries(taskColumns).forEach(([alias, col]) => {
      if (!col?.id) return;
      mapped[alias] = parseValue(col.type, byId[col.id]);
    });
    return mapped;
  });
}

/*
 * Data layer of the Previous-Tasks tab (round146 split — moved verbatim out of
 * PreviousTasksTab.jsx). Resolves what the tab shows in the mode the caller
 * derived (`byType`): the linked previous discussion's tasks (link mode) or all
 * tasks of the current discussion's TYPE (by-type mode), plus the
 * "set previous discussion" picker plumbing. `onResetSelection` is called at
 * the exact points the tab used to clear its multi-selection (discussion
 * switch / type re-resolution).
 */
export function usePreviousTasksData(discussion, byType, { onResetSelection, scope = 'all' } = {}) {
  const [tasks, setTasks] = useState([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [previousDiscussionID, setPreviousDiscussion] = useState({ id: null, name: null });
  // Resolve the previous-discussion link first; show a loader until we know
  // whether one exists (avoids flashing "no previous discussion" on every open).
  const [resolving, setResolving] = useState(true);
  // Picker for setting a previous discussion when none is defined.
  const [picking, setPicking] = useState(false);
  const [discussionOptions, setDiscussionOptions] = useState([]);
  const [savingPrev, setSavingPrev] = useState(false);
  // The discussion's "סוג" is a DROPDOWN value = the label TEXT directly. taskTypeID
  // is ALSO a dropdown on the tasks board; bridge the text -> its label id and
  // filter server-side (any_of by id — exact match, same as task creation writes).
  const { options: taskTypeOptions, loading: taskTypeLoading } = useDropdownOptions('tasks', 'taskTypeID');
  // True while the taskType map is still loading and the discussion HAS a type —
  // avoids briefly flashing "no tasks of this type" before resolution completes.
  const typeMapsLoading = byType && !!discussion?.discussionTypeID && taskTypeLoading;
  // { taskTypeId, label } for the current discussion's type; taskTypeId is the
  // TASKS-board label id to filter on (null when no type / no text match / unmapped).
  const [typeFilter, setTypeFilter] = useState({ taskTypeId: null, label: null });

  // Resolve the previous discussion via the TYPED board_relation field on the
  // current discussion (linked_items[0] — ONE back only, no recursion).
  useEffect(() => {
    let cancelled = false;

    async function resolvePreviousDiscussion() {
      setResolving(true);
      setPicking(false);
      onResetSelection?.(); // a discussion switch clears any pending selection
      // By-type mode resolves via a separate effect (below) — don't touch the
      // previous-discussion link here.
      if (byType) { setResolving(false); return; }
      if (!discussion?.id) {
        setPreviousDiscussion({ id: null, name: null });
        setResolving(false);
        return;
      }

      const discussionsColumns = getColumns('discussions');
      const previousDiscussionColId = discussionsColumns?.previousDiscussionID?.id;
      if (!previousDiscussionColId) {
        setPreviousDiscussion({ id: null, name: null });
        setResolving(false);
        return;
      }

      try {
        const data = await api(
          `query ($discussionId: ID!, $relationCol: [String!]) {
            items(ids: [$discussionId]) {
              column_values(ids: $relationCol) { ${cvSelection(['board_relation'])} }
            }
          }`,
          { discussionId: String(discussion.id), relationCol: [previousDiscussionColId] },
          'PreviousTasksTab.resolvePreviousDiscussion'
        );

        const cv = data?.items?.[0]?.column_values?.[0];
        const relation = parseValue('board_relation', cv);
        const prev = relation?.linkedItems?.[0] || null;
        if (!cancelled) {
          setPreviousDiscussion({
            id: prev?.id ? String(prev.id) : null,
            name: prev?.name || relation?.text || null,
          });
        }
      } catch (err) {
        logger.error('PreviousTasksTab', 'Failed to resolve previous discussion link', err);
        if (!cancelled) setPreviousDiscussion({ id: null, name: null });
      } finally {
        if (!cancelled) setResolving(false);
      }
    }

    resolvePreviousDiscussion();
    return () => { cancelled = true; };
    // round127 — __savedAt: re-resolve after an edit-save of the SAME
    // discussion (the link may have changed; without this the chip and task
    // list kept the pre-edit previous discussion until a full reload).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discussion?.id, discussion?.__savedAt, byType]);

  // By-type resolution: map the current discussion's "סוג" label -> the TASKS
  // board taskTypeID label id to filter on. Runs only in by-type mode; waits for
  // the status-option maps (loaded async) before resolving.
  useEffect(() => {
    if (!byType) { setTypeFilter({ taskTypeId: null, label: null }); return; }
    onResetSelection?.();
    const text = discussion?.discussionTypeID || null;
    if (!text) { setTypeFilter({ taskTypeId: null, label: null }); return; }
    const match = (taskTypeOptions || []).find((o) => o.label === text);
    setTypeFilter({ taskTypeId: match ? match.id : null, label: text });
  }, [byType, discussion?.id, discussion?.discussionTypeID, taskTypeOptions]);

  // Load the discussions list (id + name) for the "set previous discussion"
  // picker, lazily on first use. Excludes the current discussion.
  useEffect(() => {
    if (!picking || discussionOptions.length > 0) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await new דיונים1Board().items()
          .withColumns(['discussionDateID'])
          .orderBy({ column: 'discussionDateID', direction: 'desc' })
          .withPagination({ limit: 100 })
          .execute();
        const opts = (result.items || [])
          .filter((d) => String(d.id) !== String(discussion?.id))
          .map((d) => ({ value: String(d.id), label: d.name }));
        if (!cancelled) setDiscussionOptions(opts);
      } catch (err) {
        logger.error('PreviousTasksTab', 'Failed to load discussions for picker', err);
      }
    })();
    return () => { cancelled = true; };
  }, [picking, discussionOptions.length, discussion?.id]);

  // Write the chosen previous-discussion link onto the current discussion, then
  // reflect it locally so the tasks load.
  const setPrevious = async (id, name) => {
    if (!id || !discussion?.id) return;
    try {
      setSavingPrev(true);
      await new דיונים1Board().item(discussion.id)
        .update({ previousDiscussionID: { linkedItems: [{ id }] } })
        .execute();
      setPreviousDiscussion({ id: String(id), name });
      setPicking(false);
    } catch (err) {
      logger.error('PreviousTasksTab', 'Failed to set previous discussion', err);
    } finally {
      setSavingPrev(false);
    }
  };

  const previousDiscussionId = previousDiscussionID?.id || null;
  const previousDiscussionLabel = previousDiscussionID?.name || null;

  // Fetch the previous discussion's tasks the SAME discussion-side way as
  // useTasks: read them off the discussion's tasksBoardLinkID relation column.
  useEffect(() => {
    if (byType) return; // by-type mode loads via its own effect below
    if (!previousDiscussionId) { setTasks([]); return; }
    let cancelled = false;

    async function load() {
      const discussionsColumns = getColumns('discussions');
      const tasksBoardLinkId = discussionsColumns?.tasksBoardLinkID?.id;
      const taskColumns = getColumns('tasks') || {};
      // round306 — partnersID rides along: the tab now RENDERS + edits שותפים, and a
      // picker seeded from an unfetched column would look empty and overwrite the
      // real people list on the next pick.
      // round364 — custom mappings ride along (read-only cells in the shared TaskTable).
      const RENDERED = ['responsibilityID', 'partnersID', 'deadlineID', 'statusID', 'priorityID', 'discussionLinkID', ...customEntriesFor(taskColumns).map(([alias]) => alias)]; // assignee, partners, deadline, status, priority (read-only), discussion links, customs
      const taskCols = RENDERED.map((alias) => taskColumns?.[alias]?.id).filter(Boolean);
      const taskCv = cvSelection(RENDERED.map((alias) => taskColumns?.[alias]?.type));

      if (!tasksBoardLinkId) { setTasks([]); return; }

      try {
        setTasksLoading(true);
        const data = await api(
          `query ($discussionId: ID!, $relationCol: [String!], $taskCols: [String!]) {
            items(ids: [$discussionId]) {
              column_values(ids: $relationCol) {
                ... on BoardRelationValue {
                  linked_items {
                    id
                    name
                    created_at
                    column_values(ids: $taskCols) { ${taskCv} }
                  }
                }
              }
            }
          }`,
          {
            discussionId: String(previousDiscussionId),
            relationCol: [tasksBoardLinkId],
            taskCols,
          },
          'PreviousTasksTab.loadPreviousTasks'
        );

        const linkedTasks = data?.items?.[0]?.column_values?.[0]?.linked_items || [];
        if (!cancelled) setTasks(mapTaskItems(linkedTasks, taskColumns));
      } catch (err) {
        logger.error('PreviousTasksTab', 'Failed to load previous-discussion tasks', err);
        if (!cancelled) setTasks([]);
      } finally {
        if (!cancelled) setTasksLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [previousDiscussionId, byType]);

  // By-type tasks loader — scope='all' ("כל הדיונים הקודמים"): server-side filter
  // the TASKS board by taskTypeID = the current discussion's mapped type label id
  // (BoardSDK formats the status any_of rule). Returns ALL tasks of that type
  // across discussions. (round274 — the scope='last' path loads only the most
  // recent previous occurrence instead; see the effect below.)
  useEffect(() => {
    if (!byType || scope === 'last') return;
    const taskTypeId = typeFilter.taskTypeId;
    if (taskTypeId == null) { setTasks([]); return; }
    let cancelled = false;

    async function load() {
      try {
        setTasksLoading(true);
        const result = await new משימות1Board().items()
          .where({ taskTypeID: taskTypeId })
          // round364 — custom mappings ride along here too.
          .withColumns(['responsibilityID', 'partnersID', 'deadlineID', 'statusID', 'priorityID', 'discussionLinkID', 'taskTypeID', ...customEntriesFor(getColumns('tasks')).map(([alias]) => alias)])
          .withPagination({ limit: 200 })
          .execute();
        if (!cancelled) setTasks(result.items || []);
      } catch (err) {
        logger.error('PreviousTasksTab', 'Failed to load tasks by discussion type', err);
        if (!cancelled) setTasks([]);
      } finally {
        if (!cancelled) setTasksLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [byType, typeFilter.taskTypeId, scope]);

  // round274 — by-type tasks loader, scope='last' ("הפעם האחרונה"): find the MOST
  // RECENT previous discussion sharing this type, then read ITS tasks off the
  // tasksBoardLinkID relation (the same discussion-side read the linked mode uses).
  // The default scope, so the tab opens on the latest occurrence, not everything.
  useEffect(() => {
    if (!byType || scope !== 'last') return;
    const typeText = discussion?.discussionTypeID || null;
    if (!typeText || !discussion?.id) { setTasks([]); return; }
    let cancelled = false;

    async function load() {
      const discussionsColumns = getColumns('discussions');
      const tasksBoardLinkId = discussionsColumns?.tasksBoardLinkID?.id;
      const taskColumns = getColumns('tasks') || {};
      // round364 — custom mappings ride along (read-only cells in the shared TaskTable).
      const RENDERED = ['responsibilityID', 'partnersID', 'deadlineID', 'statusID', 'priorityID', 'discussionLinkID', ...customEntriesFor(taskColumns).map(([alias]) => alias)];
      const taskCols = RENDERED.map((alias) => taskColumns?.[alias]?.id).filter(Boolean);
      const taskCv = cvSelection(RENDERED.map((alias) => taskColumns?.[alias]?.type));
      if (!tasksBoardLinkId) { setTasks([]); return; }
      try {
        setTasksLoading(true);
        // discussions sharing this type (id + date), pick the latest OTHER one.
        const dres = await new דיונים1Board().items()
          .withColumns(['discussionTypeID', 'discussionDateID'])
          .withPagination({ limit: 200 })
          .execute();
        const sameType = (dres.items || []).filter((d) => d.discussionTypeID === typeText);
        const lastId = pickLatestPreviousId(sameType, discussion.id);
        if (!lastId) { if (!cancelled) setTasks([]); return; }
        const data = await api(
          `query ($discussionId: ID!, $relationCol: [String!], $taskCols: [String!]) {
            items(ids: [$discussionId]) {
              column_values(ids: $relationCol) {
                ... on BoardRelationValue {
                  linked_items { id name created_at column_values(ids: $taskCols) { ${taskCv} } }
                }
              }
            }
          }`,
          { discussionId: String(lastId), relationCol: [tasksBoardLinkId], taskCols },
          'PreviousTasksTab.loadLatestTypeTasks'
        );
        const linkedTasks = data?.items?.[0]?.column_values?.[0]?.linked_items || [];
        if (!cancelled) setTasks(mapTaskItems(linkedTasks, taskColumns));
      } catch (err) {
        logger.error('PreviousTasksTab', 'Failed to load latest-occurrence tasks', err);
        if (!cancelled) setTasks([]);
      } finally {
        if (!cancelled) setTasksLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [byType, scope, discussion?.id, discussion?.discussionTypeID]);

  return {
    tasks, setTasks, tasksLoading,
    resolving, picking, setPicking, discussionOptions, savingPrev, setPrevious,
    previousDiscussionId, previousDiscussionLabel,
    typeFilter, typeMapsLoading,
  };
}
