import React, { memo, useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { ProjectSummary, Employee } from '../../types/gantt.types';
import { PMSelector } from './PMSelector';
import { useGantt } from '../../hooks/useGantt';
import { useSettings } from '../../contexts/SettingsContext';
import { useLocale } from '../../hooks/useLocale';
import { mondayService } from '../../services/mondayService';
import { logger } from '../../utils/Logger';
import { CONFIG } from '../../utils/constants';
export { Avatar } from './Avatar';

interface ProjectSummaryCardProps {
  summary: ProjectSummary;
  projectId: string;
  employees: Employee[];
  onPMUpdate: (newManagerId?: string) => void;
}

// Editable Project Type Badge
const ProjectTypeBadge: React.FC<{ projectType?: string; projectTypeColor?: string; projectId: string }> = ({ projectType, projectTypeColor, projectId }) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const { availableProjectTypes, patchProjectData } = useGantt();
  const { settings } = useSettings();
  const [isOpen, setIsOpen] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  // Local overrides so only this component re-renders, not the whole app
  const [localLabel, setLocalLabel] = useState<string | null>(null);
  const [localColor, setLocalColor] = useState<string | null>(null);
  const badgeRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });

  const displayLabel = localLabel ?? projectType;
  const displayColor = localColor ?? projectTypeColor;

  useEffect(() => {
    if (!isOpen) return;
    if (badgeRef.current) {
      const rect = badgeRef.current.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 4, left: rect.left });
    }
    const handleClick = (e: MouseEvent) => {
      if (badgeRef.current?.contains(e.target as Node) || dropdownRef.current?.contains(e.target as Node)) return;
      setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  const handleSelectType = async (label: string, color: string) => {
    if (!settings?.projectsBoardId || !settings?.projectTypeColumnId) return;
    setLocalLabel(label);
    setLocalColor(color);
    setIsUpdating(true);
    setIsOpen(false);

    try {
      await mondayService.updateItem(
        settings.projectsBoardId,
        projectId,
        { [settings.projectTypeColumnId]: { label } }
      );
      patchProjectData(projectId, {
        [settings.projectTypeColumnId]: label,
        [settings.projectTypeColumnId + '_color']: color,
      });
    } catch (error) {
      logger.error('[ProjectTypeBadge] Failed to update project type:', error);
      setLocalLabel(null);
      setLocalColor(null);
    } finally {
      setIsUpdating(false);
    }
  };

  if (!displayLabel && availableProjectTypes.length === 0) return <span />;

  return (
    <div className="relative">
      <button
        ref={badgeRef}
        onClick={() => setIsOpen(!isOpen)}
        disabled={isUpdating || availableProjectTypes.length === 0}
        className="px-2.5 py-0.5 rounded-full text-xs font-semibold text-white truncate max-w-[130px] cursor-pointer hover:opacity-80 transition-all duration-150 hover:scale-105 hover:shadow-md disabled:cursor-default disabled:opacity-100"
        style={{ backgroundColor: displayColor || 'var(--project-color-fallback)' }}
        title={displayLabel || t('projectSummary.selectType')}
      >
        {isUpdating ? <span className="inline-block w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : (displayLabel || t('projectSummary.addType'))}
      </button>
      {isOpen && createPortal(
        <div ref={dropdownRef} className="fixed bg-bg-surface rounded-lg shadow-xl border z-[9999] min-w-[160px] max-h-[200px] overflow-y-auto py-1" style={{ top: dropdownPos.top, left: dropdownPos.left }} dir={locale.dir}>
          {availableProjectTypes.map(type => (
            <button
              key={type.label}
              onClick={() => handleSelectType(type.label, type.color)}
              className={`w-full px-3 py-2 flex items-center gap-2 hover:bg-bg-hover text-start transition-all duration-150 text-sm ${type.label === displayLabel ? 'bg-accent-bg-soft font-bold' : ''}`}
            >
              <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: type.color }} />
              <span>{type.label}</span>
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
};

/** Round to a whole number; null ⇒ em-dash. */
const formatHours = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return '–';
  return String(Math.round(value));
};

const SKELETON = <span className="h-3.5 w-8 rounded bg-bg-hover animate-pulse" aria-hidden="true" />;

// Shared cell layout: a muted label and its value on ONE line, small text to
// match the timeline ruler's month labels. The caller supplies the auto-margin
// (ml-auto / mr-auto — physical, dir-independent) that flushes the pair to the
// outer edge of its half-cell so the two metrics sit symmetrically.
const MetricCell: React.FC<{ label: string; className?: string; children: React.ReactNode }> = ({ label, className = '', children }) => (
  <span className={`flex items-center gap-1.5 min-w-0 max-w-full ${className}`}>
    <span className="text-xs text-text-muted truncate">{label}</span>
    {children}
  </span>
);

// Editable planned-hours cell. Click the number to edit; the value is written
// back to the projects-board number column (mondayService.updateItem) and
// applied locally first via patchProjectData (optimistic), reverting on failure.
// Mirrors the ProjectTypeBadge edit flow. Editing is enabled only when both the
// projects board and the planned-hours column are mapped.
const EditablePlannedCell: React.FC<{ projectId: string; value: number | null; ready: boolean; label: string }>
  = ({ projectId, value, ready, label }) => {
  const { settings, patchProjectData } = useGantt();
  const colId = settings?.projectPlannedHoursColumnId;
  const boardId = settings?.projectsBoardId;
  const editable = !!colId && !!boardId;

  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const startEdit = () => {
    if (!editable) return;
    setDraft(value !== null && value !== undefined ? String(value) : '');
    setIsEditing(true);
  };

  const commit = async () => {
    setIsEditing(false);
    if (!editable) return;
    const trimmed = draft.trim();
    if (trimmed !== '' && !Number.isFinite(Number(trimmed))) return; // invalid — ignore
    const newRaw = trimmed === '' ? '' : String(Number(trimmed));
    const prevRaw = value === null || value === undefined ? '' : String(value);
    if (newRaw === prevRaw) return; // no change

    patchProjectData(projectId, { [colId!]: newRaw }); // optimistic
    try {
      await mondayService.updateItem(boardId!, projectId, { [colId!]: newRaw });
    } catch (err) {
      logger.error('[EditablePlannedCell] Failed to update planned hours:', err);
      patchProjectData(projectId, { [colId!]: prevRaw }); // revert
    }
  };

  let content: React.ReactNode;
  if (!ready) {
    content = SKELETON;
  } else if (isEditing) {
    content = (
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') setIsEditing(false);
        }}
        onClick={(e) => e.stopPropagation()}
        // Looks identical to the displayed number — borderless, transparent, no
        // spinner arrows — so only the text itself becomes editable in place.
        className="w-12 text-center text-sm font-bold text-text-primary tabular-nums leading-tight bg-transparent border-0 p-0 m-0 focus:outline-none focus:ring-0"
      />
    );
  } else {
    content = (
      <span
        onClick={(e) => { e.stopPropagation(); startEdit(); }}
        className={`text-sm font-bold text-text-primary tabular-nums leading-tight ${editable ? 'cursor-pointer hover:bg-bg-hover rounded px-1 -mx-1 transition-colors' : ''}`}
        title={editable ? undefined : undefined}
      >
        {formatHours(value)}
      </span>
    );
  }

  return <MetricCell label={label}>{content}</MetricCell>;
};

// Row of three hour metrics under the PM/type bar, left → right:
// planned · allocated · reported. Forced dir=ltr so the visual order matches the
// spec regardless of UI direction; each cell is centered. The NUMBERS render
// only once `projectMetricsReady` is true — all three together, never partial —
// with skeleton placeholders until then (the aggregates land after first paint).
const ProjectMetricsRow: React.FC<{ projectId: string }> = ({ projectId }) => {
  const { t } = useTranslation();
  const { projectMetrics, projectMetricsReady } = useGantt();
  const metrics = projectMetrics.get(projectId.toString());

  const staticValue = (value: number) =>
    projectMetricsReady ? (
      <span className="text-xs font-bold text-text-primary tabular-nums leading-tight">{formatHours(value)}</span>
    ) : SKELETON;

  return (
    // Planned-hours cell is intentionally HIDDEN for now (owner, 2026-07-14): the
    // card shows only ACTUAL + ALLOCATED, each as an inline "label number" pair
    // split by a vertical divider. The Settings mapping (projectPlannedHoursColumnId)
    // is deliberately left in place, and the EditablePlannedCell component below is
    // kept ready for future use — to bring planned back, add a third <MetricCell/>
    // (value={metrics?.planned ?? null}, label={t('projectSummary.plannedHours')})
    // with another divider.
    // Two equal-width cells (flex-1 halves), no dividers. The metrics flush to
    // the OUTER edges — actual to the right (ml-auto), allocated to the left
    // (mr-auto) — so they sit symmetrically under the type/PM pair above. Height
    // pinned to CONFIG.rowHeight (px) — NOT Tailwind h-12: :root font-size is 20px
    // (index.css), so h-12 (3rem) renders 60px and drifts the card off the 48px
    // px-based track grid (the drift compounds per row). See BUGS.md.
    <div data-testid="summary-card-row2" className="flex items-stretch" style={{ height: CONFIG.rowHeight }}>
      <div className="flex-1 min-w-0 px-3 flex items-center">
        <MetricCell className="ml-auto" label={t('projectSummary.actualHours')}>{staticValue(metrics?.reported ?? 0)}</MetricCell>
      </div>
      <div className="flex-1 min-w-0 px-3 flex items-center">
        <MetricCell className="mr-auto" label={t('projectSummary.allocatedHours')}>{staticValue(metrics?.allocated ?? 0)}</MetricCell>
      </div>
    </div>
  );
};

// Project info bar: PM selector + Project Type badge, plus a 3-metric row
// (planned / allocated / reported hours) below.
export const ProjectSummaryCard = memo<ProjectSummaryCardProps>(({
  summary,
  projectId,
  employees,
  onPMUpdate
}) => {
  const locale = useLocale();
  return (
    <div className="flex flex-col" dir={locale.dir}>
      {/* Row 1 — project-type badge flush to one edge, PM to the other
          (justify-between), symmetric with the two hour metrics below. Type is
          first (right in RTL); PM is last so it sits on the LEFT. Height pinned
          to CONFIG.rowHeight (px), NOT h-12 — see the metrics row below for why
          rem-based heights drift off the 48px track grid. */}
      <div data-testid="summary-card-row1" className="flex items-center justify-between gap-2" style={{ height: CONFIG.rowHeight }}>
        <ProjectTypeBadge
          projectType={summary.projectType}
          projectTypeColor={summary.projectTypeColor}
          projectId={projectId}
        />
        <PMSelector
          projectId={projectId}
          currentManagerName={summary.managerName}
          currentManagerPhotoUrl={summary.managerPhotoUrl}
          employees={employees}
          onUpdate={onPMUpdate}
        />
      </div>
      <ProjectMetricsRow projectId={projectId} />
    </div>
  );
});
