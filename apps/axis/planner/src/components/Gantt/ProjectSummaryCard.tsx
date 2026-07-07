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
        className="px-3 py-1.5 rounded-full text-sm font-bold text-white truncate max-w-[150px] cursor-pointer hover:opacity-80 transition-all duration-150 hover:scale-105 hover:shadow-md disabled:cursor-default disabled:opacity-100"
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

const SKELETON = <span className="h-4 w-10 rounded bg-bg-hover animate-pulse" aria-hidden="true" />;

// Shared cell layout: a value (or skeleton) above a muted label, centered.
const MetricCell: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex flex-col items-center text-center min-w-0">
    {children}
    <span className="text-sm text-text-muted mt-0.5 truncate max-w-full">{label}</span>
  </div>
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
      <span className="text-sm font-bold text-text-primary tabular-nums leading-tight">{formatHours(value)}</span>
    ) : SKELETON;

  return (
    <div dir="ltr" className="grid grid-cols-3 gap-2 pt-2 mt-1 border-t border-border-subtle">
      <EditablePlannedCell
        projectId={projectId}
        value={metrics?.planned ?? null}
        ready={projectMetricsReady}
        label={t('projectSummary.plannedHours')}
      />
      <MetricCell label={t('projectSummary.allocatedHours')}>{staticValue(metrics?.allocated ?? 0)}</MetricCell>
      <MetricCell label={t('projectSummary.actualHours')}>{staticValue(metrics?.reported ?? 0)}</MetricCell>
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
      <div className="flex items-center justify-between gap-3">
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
