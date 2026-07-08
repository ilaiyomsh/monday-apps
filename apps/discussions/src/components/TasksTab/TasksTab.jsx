import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Skeleton, Button, Text } from '@vibe/core';
import { DropdownChevronDown, CloseSmall } from '@vibe/icons';
import { TaskTable } from '@generated/components/TaskTable';
import { CollapseAllButton } from '@generated/components/CollapseAllButton';
import { GroupByBuilder, GROUP_STATUS_ORDERS, GROUP_AZ_ORDERS, sortGroupsByOrder } from '@generated/components/GroupByBuilder';
import { useViewport } from '@generated/hooks/useViewport.js';
import { useSavedViews } from '@generated/hooks/useSavedViews.js';
import { useStatusOptions } from '@generated/hooks/useStatusOptions';
import { isValidStatus } from '@generated/constants/statusConfig';
import { getColumns } from '@api/board-config-store.js';
import styles from './TasksTab.module.css';

// Column-name style options (nouns, no "לפי" prefix) + per-column order sets, so
// the builder matches the My Tasks Group module (English chrome, Hebrew column
// name in the segment, e.g. "סטאטוס" / "Z → A").
const GROUP_OPTIONS = [
  { value: 'none', label: 'ללא קיבוץ' },
  { value: 'status', label: 'סטאטוס', icon: 'status', orders: GROUP_STATUS_ORDERS },
  { value: 'person', label: 'אחראי', icon: 'person', orders: GROUP_AZ_ORDERS },
];
const NO_STATUS = '__none__';
const NO_ASSIGNEE = '__unassigned__';

function buildPersonGroup(task) {
  const people = Array.isArray(task?.responsibilityID) ? task.responsibilityID : [];
  if (people.length === 0) return { key: NO_ASSIGNEE, label: 'לא הוקצה', assignee: [] };
  const normalized = people
    .map((p) => ({ id: String(p.id), name: p.name || '' }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return {
    key: `people:${normalized.map((p) => p.id).join('|')}`,
    label: normalized.map((p) => p.name).join(', '),
    assignee: normalized.map((p) => ({ id: p.id, kind: 'person', name: p.name })),
  };
}

// `data` is the shared useTasks() result, prefetched in DiscussionCard.
// Phase 4: editing is gated by the TASK-TIER caps, resolved PER-TASK via
// `canTask(cap, task)` (passed from DiscussionCard, bound to the discussion).
// `canCreateTask` gates the "משימה חדשה"/add-row affordances. While the feature
// is off both resolve via the legacy creator/lead/owner gate, so behavior is
// byte-for-byte identical to the old single `canEdit` boolean.
export function TasksTab({ data, onNewTask, onNotify, canTask = () => true, canCreateTask = true, canReorderColumns, canManageSettings = false }) {
  const {
    items,
    loading,
    updateTaskName,
    updateTaskStatus,
    updateTaskPriority,
    updateTaskAssignee,
    updateTaskDeadline,
    updateTasksStatusBatch,
    updateTasksAssigneeBatch,
    updateTasksDeadlineBatch,
    softDeleteTasks,
  } = data;
  // Load-time grouping = the shared saved view (empty default otherwise);
  // in-session changes are local until someone with permission hits Save.
  const { view: savedView, canSave: canSaveView, saveView } = useSavedViews('tasksTab', { canManageSettings });
  const savedGroup = GROUP_OPTIONS.some((o) => o.value === savedView?.group?.col) ? savedView.group : null;
  const [groupBy, setGroupBy] = useState(savedGroup ? savedGroup.col : 'none');
  const [groupOrder, setGroupOrder] = useState(savedGroup?.order || 'labelAsc');
  const [collapsed, setCollapsed] = useState({});
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [deleting, setDeleting] = useState(false);
  const { colorById, labelById, orderById } = useStatusOptions();
  const { isMobile } = useViewport();
  // Show the read-only priority column only when the owner mapped priorityID.
  const showPriority = !!getColumns('tasks').priorityID?.id;

  // Each group is { key, label, color, status, items }:
  //   key    — stable react/collapse key (status id as string, person name, or sentinel)
  //   label  — display text (status label via labelById, or person name)
  //   color  — group accent (status color via colorById; null otherwise)
  //   status — the status id to seed when quick-adding inside the group
  //            (number, including 0; null = "no status" group; undefined = N/A)
  const grouped = useMemo(() => {
    if (groupBy === 'status') {
      const groups = new Map();
      items.forEach(t => {
        const id = isValidStatus(t.statusID) && labelById[t.statusID] != null ? t.statusID : null;
        const key = id == null ? NO_STATUS : String(id);
        if (!groups.has(key)) groups.set(key, { key, statusId: id, items: [] });
        groups.get(key).items.push(t);
      });
      const list = [...groups.values()].map(g => ({
        key: g.key,
        label: g.statusId == null ? 'ללא סטאטוס' : (labelById[g.statusId] ?? 'ללא סטאטוס'),
        color: g.statusId == null ? null : (colorById[g.statusId] || null),
        status: g.statusId,
        items: g.items,
      }));
      return sortGroupsByOrder(list, { order: groupOrder, orderById, noKey: NO_STATUS });
    }
    if (groupBy === 'person') {
      const groups = new Map();
      items.forEach(t => {
        const personGroup = buildPersonGroup(t);
        if (!groups.has(personGroup.key)) {
          groups.set(personGroup.key, {
            key: personGroup.key,
            label: personGroup.label,
            color: null,
            status: undefined,
            assignee: personGroup.assignee,
            items: [],
          });
        }
        groups.get(personGroup.key).items.push(t);
      });
      return sortGroupsByOrder([...groups.values()], { order: groupOrder, noKey: NO_ASSIGNEE });
    }
    return [{ key: '__all__', label: '', color: null, status: undefined, items }];
  }, [items, groupBy, groupOrder, labelById, colorById, orderById]);

  const allCollapsed = grouped.length > 0 && grouped.every((g) => collapsed[g.key]);
  const allIds = useMemo(() => items.map((t) => t.id), [items]);
  const toggleAll = () => {
    if (allCollapsed) { setCollapsed({}); }
    else { const c = {}; grouped.forEach((g) => { c[g.key] = true; }); setCollapsed(c); }
  };
  const toggleSelect = (id, checked) =>
    setSelectedIds(prev => { const n = new Set(prev); if (checked) n.add(id); else n.delete(id); return n; });
  const clearSelection = () => setSelectedIds(new Set());
  const itemById = useMemo(() => {
    const m = new Map();
    items.forEach((t) => m.set(String(t.id), t));
    return m;
  }, [items]);
  // Per-task capability check (cheap, at render). Used to gate row editors and to
  // filter batch/bulk targets down to the tasks the user may actually edit.
  const allow = useCallback(
    (cap, taskId) => canTask(cap, itemById.get(String(taskId))),
    [canTask, itemById]
  );
  // Resolve the set of tasks an action applies to, then keep only those the user
  // is permitted to act on for `cap`. A mixed selection (allowed + disallowed)
  // applies ONLY to the allowed subset (silently skips the rest).
  const resolveTargetIds = (originTaskId, cap) => {
    const base = selectedIds.size > 1 && selectedIds.has(originTaskId) ? [...selectedIds] : [originTaskId];
    return cap ? base.filter((id) => allow(cap, id)) : base;
  };
  const applyStatusChange = async (taskId, status) => {
    const targetIds = resolveTargetIds(taskId, 'editTaskStatus');
    if (targetIds.length === 0) return;
    if (targetIds.length > 1 && updateTasksStatusBatch) {
      await updateTasksStatusBatch(targetIds, status);
      return;
    }
    for (const id of targetIds) await updateTaskStatus(id, status);
  };
  // Priority has no batch endpoint; apply to each selected target sequentially.
  const applyPriorityChange = async (taskId, priority) => {
    for (const id of resolveTargetIds(taskId, 'editTaskPriority')) await updateTaskPriority(id, priority);
  };
  const applyAssigneeChange = async (taskId, people) => {
    const targetIds = resolveTargetIds(taskId, 'editTaskAssignee');
    if (targetIds.length === 0) return;
    if (targetIds.length > 1 && updateTasksAssigneeBatch) {
      await updateTasksAssigneeBatch(targetIds, people);
      return;
    }
    for (const id of targetIds) await updateTaskAssignee(id, people);
  };
  const applyDeadlineChange = async (taskId, date) => {
    const targetIds = resolveTargetIds(taskId, 'editTaskDeadline');
    if (targetIds.length === 0) return;
    if (targetIds.length > 1 && updateTasksDeadlineBatch) {
      await updateTasksDeadlineBatch(targetIds, date);
      return;
    }
    for (const id of targetIds) await updateTaskDeadline(id, date);
  };
  const applyRename = async (taskId, name) => {
    if (!allow('editTaskName', taskId)) return;
    await updateTaskName(taskId, name);
  };

  useEffect(() => {
    setSelectedIds((current) => {
      if (current.size === 0) return current;
      const valid = new Set(allIds);
      const next = new Set();
      current.forEach((id) => { if (valid.has(id)) next.add(id); });
      return next.size === current.size ? current : next;
    });
  }, [allIds]);

  // Only the selected tasks the user may delete (mixed selection → delete the
  // allowed subset; if none are allowed the action is a no-op / disabled).
  const deletableSelectedIds = useMemo(
    () => [...selectedIds].filter((id) => allow('deleteTask', id)),
    [selectedIds, allow]
  );
  const deleteSelectedTasks = () => {
    if (deletableSelectedIds.length === 0 || deleting) return;
    const ids = deletableSelectedIds;
    setSelectedIds(new Set());
    // Deferred delete: rows vanish now, the real delete fires after the undo
    // window, and "בטל" cancels it and restores the rows.
    const { undo } = softDeleteTasks(ids);
    const msg = ids.length === 1 ? 'המשימה נמחקה' : `${ids.length} משימות נמחקו`;
    onNotify?.(msg, 'info', 6000, { label: 'בטל', onClick: undo });
  };

  if (loading) return (
    <div className={styles.skeletonStack}>{[1, 2, 3, 4].map(i => <Skeleton key={i} type="rectangle" height={36} fullWidth />)}</div>
  );

  // Handlers are always wired; per-field/per-task gating happens INSIDE
  // TaskTableRow via the `canTask` prop (each editor degrades to a display cell
  // when the user lacks that task's cap) and inside the apply* handlers (which
  // filter batch/bulk targets to the allowed subset). Selection is offered when
  // the user can act on at least one loaded task (edit any field OR delete);
  // while the feature is off this equals the legacy creator/lead/owner gate.
  const editHandlers = {
    onStatusChange: applyStatusChange,
    onPriorityChange: applyPriorityChange,
    onAssigneeChange: applyAssigneeChange,
    onDeadlineChange: applyDeadlineChange,
    onRenameTask: applyRename,
  };
  const TASK_EDIT_CAPS = ['editTaskStatus', 'editTaskPriority', 'editTaskDeadline', 'editTaskAssignee', 'editTaskName', 'deleteTask'];
  const canSelect = items.some((t) => TASK_EDIT_CAPS.some((cap) => canTask(cap, t)));

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        {/* One left-aligned cluster (like My Tasks): primary action, then group-by + collapse-all. */}
        <div className={styles.toolbarLeft}>
          {canCreateTask && (
            <Button kind={"primary"} size={"small"} onClick={onNewTask}>משימה חדשה</Button>
          )}
        </div>
        <div className={styles.toolbarRight}>
          <GroupByBuilder
            options={GROUP_OPTIONS}
            value={{ col: groupBy, order: groupOrder }}
            noneValue="none"
            mobile={isMobile}
            onChange={(g) => { setGroupBy(g.col ?? 'none'); if (g.order) setGroupOrder(g.order); setCollapsed({}); }}
            onSave={canSaveView ? () => {
              saveView({ group: { col: groupBy, order: groupOrder } });
              onNotify?.('הבחירה נשמרה עבור כל המשתמשים', 'success');
            } : null}
          />
          {groupBy !== 'none' && (
            <CollapseAllButton collapsed={allCollapsed} onClick={toggleAll} />
          )}
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className={styles.actionBar} role="region" aria-label="פעולות על משימות נבחרות">
          <div className={styles.actionBarLeft}>
            <Text type={"text2"} element="span">{selectedIds.size} נבחרו</Text>
          </div>
          <div className={styles.actionBarCenter}>
            <Button kind={"secondary"} size={"small"} loading={deleting} disabled={deleting || deletableSelectedIds.length === 0} onClick={deleteSelectedTasks}>
              מחיקה
            </Button>
          </div>
          <div className={styles.actionBarRight}>
            <button type="button" className={styles.closeSelectionBtn} onClick={clearSelection} aria-label="בטל בחירה">
              <CloseSmall size={18} />
            </button>
          </div>
        </div>
      )}

      <div className={styles.board}>
      <div className={styles.groupScrollInner}>
      <div className={styles.groupStack}>
        {grouped.length === 0 ? (
          <TaskTable tasks={[]} onOpenNewTask={canCreateTask ? () => onNewTask?.({}) : undefined}
            {...editHandlers} canTask={canTask} showPriority={showPriority} canReorderColumns={canReorderColumns} canManageSettings={canManageSettings}
            selectable={canSelect} selectedIds={selectedIds} onToggleSelect={toggleSelect}
            selectAllChecked={false}
            selectAllIndeterminate={false}
            onToggleSelectAll={() => {}} />
        ) : grouped.map((grp) => {
          const groupColor = grp.color;
          const groupSelectedCount = grp.items.reduce((count, task) => count + (selectedIds.has(task.id) ? 1 : 0), 0);
          const groupAllSelected = grp.items.length > 0 && groupSelectedCount === grp.items.length;
          const groupSomeSelected = groupSelectedCount > 0 && !groupAllSelected;
          return (
          <div key={grp.key}>
            {groupBy !== 'none' && grp.label && (
              <button type="button" onClick={() => setCollapsed(p => ({ ...p, [grp.key]: !p[grp.key] }))}
                className={styles.groupHeader}>
                <DropdownChevronDown
                  className={`${styles.chevron} ${collapsed[grp.key] ? styles.chevronCollapsed : ''}`}
                  style={groupColor ? { color: groupColor } : undefined}
                />
                <span
                  className={styles.groupTitle}
                  style={{ color: groupColor || 'var(--secondary-text-color)' }}
                >
                  {grp.label}
                </span>
              </button>
            )}
            {!collapsed[grp.key] && (
              <TaskTable tasks={grp.items} color={groupColor}
                {...editHandlers} canTask={canTask} showPriority={showPriority} canReorderColumns={canReorderColumns} canManageSettings={canManageSettings}
                selectable={canSelect} selectedIds={selectedIds} onToggleSelect={toggleSelect}
                selectAllChecked={groupAllSelected}
                selectAllIndeterminate={groupSomeSelected}
                onToggleSelectAll={(checked) => {
                  setSelectedIds((prev) => {
                    const next = new Set(prev);
                    grp.items.forEach((task) => {
                      if (checked) next.add(task.id);
                      else next.delete(task.id);
                    });
                    return next;
                  });
                }}
                onOpenNewTask={canCreateTask ? () => {
                  const opts = {};
                  if (groupBy === 'status') opts.status = grp.status ?? null;
                  if (groupBy === 'person') opts.assignee = grp.assignee || [];
                  onNewTask?.(opts);
                } : undefined} />
            )}
          </div>
          );
        })}
      </div>
      </div>
      </div>
    </div>
  );
}
