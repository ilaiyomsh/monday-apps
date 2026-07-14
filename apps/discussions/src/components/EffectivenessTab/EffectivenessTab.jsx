import { useState, useMemo, useRef, useEffect } from 'react';
import { Box, Button, Skeleton } from '@vibe/core';
import { CloseSmall } from '@vibe/icons';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell, Tooltip } from 'recharts';
import { TaskTable } from '@generated/components/TaskTable';
import { useStatusOptions } from '@generated/hooks/useStatusOptions';
import { useSettings } from '../../contexts/SettingsContext.jsx';
import { getColumns } from '@api/board-config-store.js';
import {
  NO_STATUS_KEY, DELAYED_COLOR, DELAYED_LABEL,
  startOfToday, resolveDoneStatusIds, isDelayed, countDone,
} from './effectiveness.js';
import styles from './EffectivenessTab.module.css';

// Status values are stable label ids. Charts group by id (rendered as the label
// via the column settings), colored by the column's own colors. Three fixed KPI
// cards: total, "בוצעו" (status in the configured done set), and the computed
// deadline-based "בעיכוב" (past deadline + not in the done set). The chart shows
// pure status counts (no delayed column).
const DEFAULT_COLOR = 'hsl(var(--status-default))';
// KPI card accent colors (border all around + colored percentage on done/delayed).
const TOTAL_COLOR = 'hsl(var(--dept-legal))';
const DONE_COLOR = 'hsl(var(--status-done))';
const assigneeKey = (t) => (t.responsibilityID || []).map((p) => p.name).join(', ') || 'לא הוקצה';

// recharts tooltip panel
function ChartTooltipContent({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  const rows = payload.filter((e) => e.value > 0);
  if (!rows.length) return null;
  return (
    <div className={styles.tooltip}>
      {label != null && <div className={styles.tooltipLabel}>{label}</div>}
      {rows.map((entry, i) => (
        <div key={i} className={styles.tooltipRow}>
          <span className={styles.tooltipSwatch} style={{ background: entry.color || entry.fill }} />
          <span className={styles.tooltipName}>{entry.name}</span>
          <span className={styles.tooltipValue}>{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

// `data` is the shared useTasks() result, prefetched in DiscussionCard.
export function EffectivenessTab({ data, canManageSettings = false, onNotify }) {
  const {
    items, loading, updateTaskStatus, updateTaskPriority, updateTaskAssignee, updateTaskDeadline,
    updateTasksStatusBatch, updateTasksAssigneeBatch, updateTasksDeadlineBatch, softDeleteTasks,
  } = data;
  const { options, labelById, doneId } = useStatusOptions();
  const { settings } = useSettings();
  const [groupMode, setGroupMode] = useState('status'); // 'status' | 'person'
  // selection: { type: 'status'|'person', value: string } | null
  // For status, value is the label id as a string (or NO_STATUS_KEY).
  const [selected, setSelected] = useState(null);
  // Selection in the drill-down TaskTable (checkbox column only — no bulk-action
  // bar; this is a read-only analytics drill-down). Reset whenever the selected
  // bar changes so the checkboxes don't carry over between drill-downs.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const listRef = useRef(null);

  // Which statuses mean "done" for the delayed KPI — owner-picked in Settings
  // (preferences.delayedDoneStatusIds), falling back to the is_done label.
  const doneStatusIds = useMemo(
    () => resolveDoneStatusIds(settings?.preferences?.delayedDoneStatusIds, doneId),
    [settings, doneId]
  );

  // The three headline KPIs. The done-status mapping (doneStatusIds) drives BOTH
  // the "בוצעו" count and the deadline-based "בעיכוב" count (past deadline + not
  // in the done set).
  const stats = useMemo(() => {
    const today = startOfToday();
    return {
      total: items.length,
      done: countDone(items, doneStatusIds),
      delayed: items.filter((t) => isDelayed(t, doneStatusIds, today)).length,
    };
  }, [items, doneStatusIds]);

  // Done/delayed cards show a share-of-total percentage (0 when there are no tasks).
  const pct = (n) => (stats.total > 0 ? Math.round((n / stats.total) * 100) : 0);

  // A task's status group key: its label id (as a string) or the no-status bucket.
  const statusKeyOf = (t) => (labelById[t.statusID] != null ? String(t.statusID) : NO_STATUS_KEY);

  // Ordered chart categories: every live label (display order) + a trailing
  // "no status" bucket. Keyed by String(id) so it survives object-key coercion.
  const statusMeta = useMemo(() => {
    const metas = options.map((o) => ({ key: String(o.id), label: o.label, color: o.color || DEFAULT_COLOR }));
    metas.push({ key: NO_STATUS_KEY, label: 'ללא סטאטוס', color: DEFAULT_COLOR });
    return metas;
  }, [options]);

  // Status mode: one column per status (X = label, Y = count). Pure status
  // counts — no computed "בעיכוב" column.
  const statusData = useMemo(() => {
    if (!items.length) return [];
    const counts = {};
    items.forEach((t) => { const k = statusKeyOf(t); counts[k] = (counts[k] || 0) + 1; });
    return statusMeta
      .filter((m) => counts[m.key] > 0)
      .map((m) => ({ key: m.key, name: m.label, value: counts[m.key], fill: m.color }));
  }, [items, statusMeta, labelById]);

  // Assignee mode: one column per assignee, stacked by status id.
  const personData = useMemo(() => {
    if (!items.length) return [];
    const groups = {};
    items.forEach((t) => {
      const pk = assigneeKey(t);
      if (!groups[pk]) {
        groups[pk] = { name: pk };
        statusMeta.forEach((m) => { groups[pk][m.key] = 0; });
      }
      groups[pk][statusKeyOf(t)] += 1;
    });
    return Object.values(groups);
  }, [items, statusMeta, labelById]);

  const filteredTasks = useMemo(() => {
    if (!selected) return [];
    let tasks;
    if (selected.type === 'status') {
      tasks = selected.value === NO_STATUS_KEY
        ? items.filter((t) => labelById[t.statusID] == null)
        : items.filter((t) => String(t.statusID) === selected.value);
    } else {
      tasks = items.filter((t) => assigneeKey(t) === selected.value);
    }
    // Sort by the same status order as the chart (statusMeta index).
    const statusOrder = Object.fromEntries(statusMeta.map((m, i) => [m.key, i]));
    return [...tasks].sort((a, b) => {
      const ka = labelById[a.statusID] != null ? String(a.statusID) : NO_STATUS_KEY;
      const kb = labelById[b.statusID] != null ? String(b.statusID) : NO_STATUS_KEY;
      return (statusOrder[ka] ?? 999) - (statusOrder[kb] ?? 999);
    });
  }, [items, selected, labelById, statusMeta]);

  const selectedLabel = useMemo(() => {
    if (!selected) return '';
    if (selected.type === 'status') {
      return selected.value === NO_STATUS_KEY ? 'ללא סטאטוס' : (labelById[Number(selected.value)] ?? '');
    }
    return selected.value;
  }, [selected, labelById]);

  // Color the filtered-list title with the selected status' own color (status
  // selections only; person selections keep the default text color).
  const selectedColor = useMemo(() => {
    if (selected?.type !== 'status') return undefined;
    return statusMeta.find((m) => m.key === selected.value)?.color || undefined;
  }, [selected, statusMeta]);

  // Scroll to the task list whenever a bar is selected.
  useEffect(() => {
    if (selected && filteredTasks.length > 0 && listRef.current) {
      listRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selected, filteredTasks.length]);

  // Clear the drill-down row selection whenever the selected bar changes.
  useEffect(() => {
    setSelectedIds(new Set());
  }, [selected]);

  // Bulk edit (mirrors הנחיות קודמות): editing one selected row applies the change
  // to the WHOLE selection; a single-row edit otherwise. Status/assignee/deadline
  // use the batch endpoints when >1; priority has no batch so it loops.
  const resolveTargetIds = (originId) =>
    (selectedIds.size > 1 && selectedIds.has(originId)) ? [...selectedIds] : [originId];
  const applyStatusChange = async (taskId, status) => {
    const ids = resolveTargetIds(taskId);
    if (ids.length > 1 && updateTasksStatusBatch) return updateTasksStatusBatch(ids, status);
    for (const id of ids) await updateTaskStatus(id, status);
  };
  const applyPriorityChange = async (taskId, value) => {
    for (const id of resolveTargetIds(taskId)) await updateTaskPriority(id, value);
  };
  const applyAssigneeChange = async (taskId, people) => {
    const ids = resolveTargetIds(taskId);
    if (ids.length > 1 && updateTasksAssigneeBatch) return updateTasksAssigneeBatch(ids, people);
    for (const id of ids) await updateTaskAssignee(id, people);
  };
  const applyDeadlineChange = async (taskId, date) => {
    const ids = resolveTargetIds(taskId);
    if (ids.length > 1 && updateTasksDeadlineBatch) return updateTasksDeadlineBatch(ids, date);
    for (const id of ids) await updateTaskDeadline(id, date);
  };
  const clearSelection = () => setSelectedIds(new Set());
  const deleteSelected = () => {
    const ids = [...selectedIds];
    if (ids.length === 0 || !softDeleteTasks) return;
    clearSelection();
    const { undo } = softDeleteTasks(ids);
    const msg = ids.length === 1 ? 'המשימה נמחקה' : `${ids.length} משימות נמחקו`;
    onNotify?.(msg, 'success', 6000, { label: 'בטל', onClick: undo });
  };

  const switchMode = (mode) => {
    if (mode === groupMode) return;
    setGroupMode(mode);
    setSelected(null);
  };

  const pick = (type, value) => {
    setSelected((prev) => (prev && prev.type === type && prev.value === value ? null : { type, value }));
  };

  if (loading) {
    return (
      <div className={styles.loadingStack}>
        <Skeleton type={"rectangle"} fullWidth height={112} />
        <Skeleton type={"rectangle"} fullWidth height={256} />
      </div>
    );
  }

  const hasChart = groupMode === 'status' ? statusData.length > 0 : personData.length > 0;

  return (
    <div className={styles.root}>
      {/* KPI cards — total · בוצעו (done set) · בעיכוב (computed, deadline-based). */}
      <div className={styles.kpiGrid}>
        <Box className={styles.kpiCard} rounded="medium" dir="ltr">
          <div className={styles.kpiAccent} style={{ backgroundColor: TOTAL_COLOR }} />
          <div className={styles.kpiBody}>
            <p className={styles.kpiLabel}>סה"כ משימות</p>
            <p className={styles.kpiValue}>{stats.total}</p>
          </div>
        </Box>
        <Box className={styles.kpiCard} rounded="medium" dir="ltr">
          <div className={styles.kpiAccent} style={{ backgroundColor: DONE_COLOR }} />
          <div className={styles.kpiBody}>
            <p className={styles.kpiLabel}>בוצעו</p>
            <p className={styles.kpiValue} style={{ color: DONE_COLOR }}>{pct(stats.done)}%</p>
          </div>
        </Box>
        <Box className={styles.kpiCard} rounded="medium" dir="ltr">
          <div className={styles.kpiAccent} style={{ backgroundColor: DELAYED_COLOR }} />
          <div className={styles.kpiBody}>
            <p className={styles.kpiLabel}>{DELAYED_LABEL}</p>
            <p className={styles.kpiValue} style={{ color: DELAYED_COLOR }}>{pct(stats.delayed)}%</p>
          </div>
        </Box>
      </div>

      {/* Column chart */}
      {hasChart && (
        <Box className={styles.chartCard} rounded="medium" shadow="xs" border>
          <div className={styles.chartBody}>
            <div className={styles.chartToolbar}>
              <div className={styles.segmented} role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={groupMode === 'status'}
                  className={`${styles.segment} ${groupMode === 'status' ? styles.segmentActive : ''}`}
                  onClick={() => switchMode('status')}
                >
                  לפי סטאטוס
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={groupMode === 'person'}
                  className={`${styles.segment} ${groupMode === 'person' ? styles.segmentActive : ''}`}
                  onClick={() => switchMode('person')}
                >
                  לפי אחראי
                </button>
              </div>
            </div>

            <div className={styles.chartContainer}>
              <ResponsiveContainer width="100%" height="100%">
                {groupMode === 'status' ? (
                  <BarChart data={statusData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" type="category" tick={{ fontSize: 12 }} />
                    <YAxis allowDecimals={false} width={32} />
                    <Tooltip content={<ChartTooltipContent />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
                    <Bar
                      dataKey="value"
                      name="משימות"
                      radius={[6, 6, 0, 0]}
                      cursor="pointer"
                      onClick={(d) => pick('status', d.payload?.key ?? d.key)}
                    >
                      {statusData.map((entry) => (
                        <Cell key={entry.key} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                ) : (
                  <BarChart data={personData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" type="category" tick={{ fontSize: 12 }} interval={0} />
                    <YAxis allowDecimals={false} width={32} />
                    <Tooltip content={<ChartTooltipContent />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
                    {statusMeta.map((m, i) => (
                      <Bar
                        key={m.key}
                        dataKey={m.key}
                        name={m.label}
                        stackId="status"
                        fill={m.color}
                        radius={i === statusMeta.length - 1 ? [6, 6, 0, 0] : [0, 0, 0, 0]}
                        cursor="pointer"
                        onClick={(d) => pick('person', d.payload?.name ?? d.name)}
                      />
                    ))}
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          </div>
        </Box>
      )}

      {/* Tasks for the selected bar */}
      {selected && filteredTasks.length > 0 && (
        <div className={styles.filteredStack} ref={listRef}>
          <div className={styles.filteredHeader}>
            <h3 className={styles.filteredTitle} style={selectedColor ? { color: selectedColor } : undefined}>
              {selectedLabel}
            </h3>
            <Button kind={"tertiary"} size={"xs"} onClick={() => setSelected(null)} leftIcon={CloseSmall}>
              סגור
            </Button>
          </div>
          {selectedIds.size > 0 && (
            <div className={styles.actionBar} role="region" aria-label="פעולות על משימות נבחרות">
              <div className={styles.actionBarLeft}>
                <span>{selectedIds.size} נבחרו</span>
              </div>
              <div className={styles.actionBarCenter}>
                <Button kind={"secondary"} size={"small"} onClick={deleteSelected}>מחיקה</Button>
              </div>
              <div className={styles.actionBarRight}>
                <button type="button" className={styles.closeSelectionBtn} onClick={clearSelection} aria-label="בטל בחירה">
                  <CloseSmall size={18} />
                </button>
              </div>
            </div>
          )}
          <div className={styles.taskStack}>
            {/* Same row component as the Tasks board; multi-select drives bulk
                status/assignee/deadline edits (edit one selected row → all) + delete. */}
            <TaskTable
              tasks={filteredTasks}
              showPriority={!!getColumns('tasks').priorityID?.id}
              canManageSettings={canManageSettings}
              onStatusChange={applyStatusChange}
              onPriorityChange={applyPriorityChange}
              onAssigneeChange={applyAssigneeChange}
              onDeadlineChange={applyDeadlineChange}
              selectable={true}
              selectedIds={selectedIds}
              onToggleSelect={(id, checked) => setSelectedIds((prev) => {
                const n = new Set(prev);
                checked ? n.add(id) : n.delete(id);
                return n;
              })}
              selectAllChecked={filteredTasks.length > 0 && filteredTasks.every((t) => selectedIds.has(t.id))}
              selectAllIndeterminate={filteredTasks.some((t) => selectedIds.has(t.id)) && !filteredTasks.every((t) => selectedIds.has(t.id))}
              onToggleSelectAll={(checked) => setSelectedIds(() => checked ? new Set(filteredTasks.map((t) => t.id)) : new Set())}
            />
          </div>
        </div>
      )}

      {items.length === 0 && (
        <div className={styles.empty}>
          אין מספיק נתונים להצגת אפקטיביות
        </div>
      )}
    </div>
  );
}

export default EffectivenessTab;
