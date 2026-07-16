import React, { memo, useMemo, useState } from 'react';
import { parseISO, differenceInDays } from 'date-fns';
import { Avatar } from './Avatar';
import { useGantt } from '../../hooks/useGantt';
import { softenColor } from '../../utils/colorUtils';
import { CONFIG } from '../../utils/constants';
import type { Group, Task } from '../../types/gantt.types';

// How many avatars to show before the stack collapses the rest into a "+N".
// Uses the lightweight in-house Avatar (./Avatar) rather than Vibe's
// AvatarGroup: the latter dragged the whole @vibe/core subtree onto the
// critical-path bundle (it's otherwise only used by the lazy DatePicker).
const SUMMARY_BAR_MAX_AVATARS = 4;
const AVATAR_SIZE = 24;

/**
 * ProjectSummaryBar — a single roll-up bar rendered in the project header row's
 * timeline area (projects view only). It summarises the project's *active*
 * allocations (those running today: start ≤ today ≤ end):
 *   • Span: earliest active start → latest active end.
 *   • Colour: the same utilisation method as the allocation bars, but over the
 *     SUMMED reported/allocated hours of the active allocations. When reported
 *     hours aren't configured, it falls back to the softened project colour.
 *   • Avatars: the distinct employees across the active allocations (Vibe
 *     AvatarGroup, collapsing to "+N" past SUMMARY_BAR_MAX_AVATARS).
 */
export const ProjectSummaryBar: React.FC<{ group: Group }> = memo(({ group }) => {
  const { getXByDate, getWidthByDates, pixelsPerDay, settings, selectedProjectId, setSelectedProjectId } = useGantt();

  // Click the label to toggle between the percentage and the raw "reported /
  // allocated" hours.
  const [showHours, setShowHours] = useState(false);

  const summary = useMemo(() => {
    const today = new Date();
    const active: Task[] = group.tasks.filter((t) => {
      const start = parseISO(t.startDate);
      const end = parseISO(t.endDate);
      return start <= today && end >= today;
    });
    if (active.length === 0) return null;

    let minStart = parseISO(active[0].startDate);
    let maxEnd = parseISO(active[0].endDate);
    let reported = 0;
    let allocated = 0;
    // Dedupe employees by id (id-join, never by display name).
    const employees = new Map<string, { name: string; url?: string }>();

    active.forEach((t) => {
      const start = parseISO(t.startDate);
      const end = parseISO(t.endDate);
      if (start < minStart) minStart = start;
      if (end > maxEnd) maxEnd = end;
      reported += t.reportedHours || 0;
      allocated += t.totalHours || 0;
      if (t.employeeId && !employees.has(t.employeeId)) {
        employees.set(t.employeeId, { name: t.userName || '', url: t.userPhotoUrl });
      }
    });

    return { minStart, maxEnd, reported, allocated, employees: Array.from(employees.values()) };
  }, [group.tasks]);

  // Completion over the ACTIVE allocations only — the same reported ÷ allocated
  // ratio that drives the bar colour (not the all-time project totals). Shown on
  // the bar's right edge as either a percentage or "reported / allocated" hours.
  // "-" when nothing is allocated among the active set.
  const completionLabel = useMemo<string | null>(() => {
    if (!summary) return null;
    const { reported, allocated } = summary;
    if (allocated <= 0) return '-';
    if (showHours) return `${Math.round(reported)} / ${Math.round(allocated)}`;
    return `${Math.round((reported / allocated) * 100)}%`;
  }, [summary, showHours]);

  // Same utilisation→colour mapping as TaskBar, over the summed hours.
  const fillColor = useMemo(() => {
    const soft = group.color ? softenColor(group.color) : 'var(--color-monday-blue)';
    if (!summary || !settings?.reportedHoursColumnId) return soft;

    const { minStart, maxEnd, reported, allocated } = summary;
    const utilization = allocated > 0 ? (reported / allocated) * 100 : 0;

    // timeProgress over the bar's own span (mirror of TaskBar).
    const today = new Date();
    const totalDays = differenceInDays(maxEnd, minStart) + 1;
    let timeProgress: number;
    if (totalDays <= 0) timeProgress = 100;
    else if (today < minStart) timeProgress = 0;
    else if (today > maxEnd) timeProgress = 100;
    else timeProgress = ((differenceInDays(today, minStart) + 1) / totalDays) * 100;

    if (utilization > 100) return 'var(--color-danger)';
    if (utilization > timeProgress * 1.2) return 'var(--color-warning)';
    if (timeProgress > 0 && utilization < timeProgress * 0.5) return 'var(--color-info)';
    return 'var(--color-success)';
  }, [summary, group.color, settings?.reportedHoursColumnId]);

  if (!summary) return null;

  const isSelected = selectedProjectId !== null && String(selectedProjectId) === String(group.id);

  const left = getXByDate(summary.minStart);
  const width = Math.max(getWidthByDates(summary.minStart, summary.maxEnd), pixelsPerDay);
  // Default height matches an individual allocation bar (TaskBar = rowHeight-12
  // = 36px, top 6px), so every project's summary bar reads as a PEER of the
  // allocations when nothing is focused. Selecting a project promotes ONLY its
  // summary bar to rowHeight-4 = 44px (top 2px) — then it becomes the dominant
  // "parent" bar over its own allocations. Focus is what earns the emphasis.
  const barHeight = isSelected ? CONFIG.rowHeight - 4 : CONFIG.rowHeight - 12;
  const barTop = (CONFIG.rowHeight - barHeight) / 2;

  // Clicking the summary bar focuses the project — identical to clicking the
  // project name in the sidebar (toggle off when it's already focused).
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedProjectId(isSelected ? null : group.id);
  };

  return (
    <div
      className="absolute flex items-center px-2 shadow-[var(--shadow-dnd)] cursor-pointer transition-[filter] hover:brightness-105"
      style={{
        left: `${left}px`,
        width: `${width}px`,
        height: `${barHeight}px`,
        top: `${barTop}px`,
        borderRadius: `${barHeight / 2}px`,
        backgroundColor: fillColor,
      }}
      onClick={handleClick}
    >
      {/* Overlapping avatar stack of the distinct employees, collapsing to a
          "+N" once past SUMMARY_BAR_MAX_AVATARS. */}
      <div className="flex items-center">
        {summary.employees.slice(0, SUMMARY_BAR_MAX_AVATARS).map((emp, i) => (
          <div
            key={i}
            className="rounded-full"
            style={{ marginLeft: i === 0 ? 0 : -6, zIndex: SUMMARY_BAR_MAX_AVATARS - i }}
          >
            <Avatar name={emp.name} url={emp.url} size={AVATAR_SIZE} />
          </div>
        ))}
        {summary.employees.length > SUMMARY_BAR_MAX_AVATARS && (
          <div
            className="flex items-center justify-center rounded-full border border-white bg-bg-inverted text-white font-medium select-none"
            style={{ marginLeft: -6, width: AVATAR_SIZE, height: AVATAR_SIZE, fontSize: AVATAR_SIZE * 0.36 }}
            title={summary.employees.slice(SUMMARY_BAR_MAX_AVATARS).map((e) => e.name).join(', ')}
          >
            +{summary.employees.length - SUMMARY_BAR_MAX_AVATARS}
          </div>
        )}
      </div>

      {/* Completion pinned to the bar's right edge. Clicking it toggles between
          the percentage and "reported / allocated" hours — stopPropagation so it
          doesn't also focus the project like the rest of the bar. */}
      {completionLabel !== null && (
        <span
          className="ms-auto ps-2 text-xs font-bold text-white tabular-nums whitespace-nowrap drop-shadow-sm cursor-pointer"
          onClick={(e) => { e.stopPropagation(); setShowHours((v) => !v); }}
        >
          {completionLabel}
        </span>
      )}
    </div>
  );
});

ProjectSummaryBar.displayName = 'ProjectSummaryBar';
