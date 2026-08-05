import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../contexts/SettingsContext';
import { useSettingsValidation } from '../../hooks/useSettingsValidation';
import { SearchableSelect } from './SearchableSelect';
import { MultiSelect } from './MultiSelect';
import { SettingsSection } from './SettingsSection';
import { SettingsTabs } from './SettingsTabs';
import { mondayService } from '../../services/mondayService';
import { getWorkDaysPerWeek } from '../../utils/workDaysUtils';
import { PlannerSettings } from '../../types/settings.types';
import { isLanguagePickerEnabled } from '../../utils/featureFlags';
import { extractStatusLabels } from '../../utils/statusLabelUtils';
import { useLocale } from '../../hooks/useLocale';
import { useDisplayUnit } from '../../hooks/useDisplayUnit';
import { logger } from '../../utils/Logger';
import { useViewTracking } from '../../utils/viewTracking';
import { versionLabel } from '../../utils/versionLabel';

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  boardId?: number;
}

export const SettingsDialog: React.FC<SettingsDialogProps> = ({
  isOpen,
  onClose,
  boardId
}) => {
  const { t } = useTranslation();
  const locale = useLocale();
  // Usage telemetry (D3): report the settings view once per session, the first time it opens.
  // Passing '' while closed is ignored by the tracker, so this fires only on the first open.
  useViewTracking(logger, isOpen ? 'settings' : '');
  const { unit: displayUnit, setUnit: setDisplayUnit } = useDisplayUnit();
  const { settings, updateSettings: commitSettings } = useSettings();
  const [draftSettings, setDraftSettings] = useState<PlannerSettings | null>(null);

  // Initialize draft settings when dialog opens
  useEffect(() => {
    if (isOpen && settings && !draftSettings) {
      setDraftSettings({ ...settings });
    }
  }, [isOpen, settings]);

  // Clear draft settings when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setDraftSettings(null);
    }
  }, [isOpen]);

  const updateDraft = (updates: Partial<PlannerSettings>) => {
    setDraftSettings(prev => prev ? { ...prev, ...updates } : null);
  };

  // State for loading boards and columns
  const [allocationsBoards, setAllocationsBoards] = useState<Array<{ id: string; name: string }>>([]);
  const [employeesBoards, setEmployeesBoards] = useState<Array<{ id: string; name: string }>>([]);
  const [allocationsColumns, setAllocationsColumns] = useState<Array<{ id: string; title: string; type: string; settings?: string }>>([]);
  const [employeesColumns, setEmployeesColumns] = useState<Array<{ id: string; title: string; type: string; settings?: string }>>([]);
  const [projectsColumns, setProjectsColumns] = useState<Array<{ id: string; title: string; type: string; settings?: string }>>([]);
  // Day-off vacations board columns (DAY-OFF-INTEGRATION W3.6 — the D9 manual
  // mapping surface; field semantics per ../Day-off/CONTRACT.md).
  const [dayOffColumns, setDayOffColumns] = useState<Array<{ id: string; title: string; type: string; settings?: string }>>([]);
  const [loadingDayOffColumns, setLoadingDayOffColumns] = useState(false);
  // Which board dayOffColumns belong to (W3.7): the validator runs its live
  // existence/label checks only when this matches the configured board, so a
  // board switch in progress or a failed columns fetch never yields false
  // "deleted column" errors.
  const [dayOffColumnsBoardId, setDayOffColumnsBoardId] = useState<string | null>(null);

  const context = {
    boardId: boardId?.toString() || '',
    // Live Day-off board data for the W3.7 board-existence / deleted-column /
    // label-resolvability checks (../Day-off/CONTRACT.md §5.6 — fail loudly).
    dayOffLive:
      draftSettings?.dayOffBoardId && dayOffColumnsBoardId === draftSettings.dayOffBoardId
        ? { boardId: dayOffColumnsBoardId, columns: dayOffColumns }
        : undefined,
  };
  const { isValid, getFieldError } = useSettingsValidation((draftSettings || settings || {}) as any, context);
  const [linkedBoards, setLinkedBoards] = useState<Array<{ id: string; name: string }>>([]);
  const [statusLabels, setStatusLabels] = useState<Array<{ id: string; name: string }>>([]);
  const [classificationLabels, setClassificationLabels] = useState<Array<{ id: string; name: string }>>([]);
  const [employeeRoleLabels, setEmployeeRoleLabels] = useState<Array<{ id: string; name: string }>>([]);
  const [employeeStatusLabels, setEmployeeStatusLabels] = useState<Array<{ id: string; name: string }>>([]);
  const [capabilityLabels, setCapabilityLabels] = useState<Array<{ id: string; name: string }>>([]);
  
  const [loadingAllocationsBoard, setLoadingAllocationsBoard] = useState(false);
  const [loadingEmployeesBoard, setLoadingEmployeesBoard] = useState(false);
  const [loadingProjectsBoard, setLoadingProjectsBoard] = useState(false);
  const [loadingAllocationsColumns, setLoadingAllocationsColumns] = useState(false);
  const [loadingEmployeesColumns, setLoadingEmployeesColumns] = useState(false);
  const [loadingProjectsColumns, setLoadingProjectsColumns] = useState(false);
  const [loadingLinkedBoards, setLoadingLinkedBoards] = useState(false);
  const [showJsonView, setShowJsonView] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [lastChangedField, setLastChangedField] = useState<'day' | 'week' | 'month' | null>(null);
  const [notification, setNotification] = useState<{ message: string; type: 'error' | 'success' } | null>(null);

  // #90: candidates for the logs→allocations connect column (reported-hours
  // aggregate group-by). Detected from the reportedHours mirror's logs board.
  const [logsAllocCandidates, setLogsAllocCandidates] = useState<Array<{ id: string; title: string }>>([]);
  useEffect(() => {
    const rh = draftSettings?.reportedHoursColumnId;
    if (!rh || !draftSettings?.allocationsBoardId) { setLogsAllocCandidates([]); return; }
    let cancelled = false;
    (async () => {
      const candidates = await mondayService.findLogsAllocationColumns(draftSettings);
      if (cancelled) return;
      setLogsAllocCandidates(candidates);
      // Auto-default to the first candidate when none is chosen yet.
      if (candidates.length > 0 && !draftSettings.timeLogsAllocationColumnId) {
        updateDraft({ timeLogsAllocationColumnId: candidates[0].id });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftSettings?.reportedHoursColumnId, draftSettings?.allocationsBoardId]);

  // Clear notification after 5 seconds
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  // Export the current draft settings to a downloadable JSON file.
  // Wrapped in { settings: ... } so the exported file re-imports cleanly.
  const handleExportSettings = () => {
    try {
      const payload = { settings: draftSettings };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const dateStr = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `planner-settings-${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setShowJsonView(false);
      setNotification({ message: t('settings.dialog.exportSuccess'), type: 'success' });
    } catch (e) {
      logger.error('[SettingsDialog] Failed to export settings:', e);
      setNotification({ message: t('settings.dialog.exportError'), type: 'error' });
    }
  };

  // Open the hidden file picker for importing settings.
  const handleImportClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  // Read the selected JSON file, validate it, and merge it into the draft.
  // Accepts either a { settings: {...} } wrapper or a raw settings object.
  // Does NOT auto-save — the user must press "Save changes".
  const handleImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string);
        const incoming =
          parsed && typeof parsed === 'object' && !Array.isArray(parsed) &&
          parsed.settings && typeof parsed.settings === 'object' && !Array.isArray(parsed.settings)
            ? parsed.settings
            : parsed;
        if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
          throw new Error('Invalid settings structure');
        }
        updateDraft(incoming as Partial<PlannerSettings>);
        setShowJsonView(false);
        setNotification({ message: t('settings.dialog.importSuccess'), type: 'success' });
      } catch (err) {
        logger.error('[SettingsDialog] Failed to import settings:', err);
        setShowJsonView(false);
        setNotification({ message: t('settings.dialog.importError'), type: 'error' });
      }
    };
    reader.onerror = () => {
      logger.error('[SettingsDialog] Failed to read import file:', reader.error);
      setShowJsonView(false);
      setNotification({ message: t('settings.dialog.importError'), type: 'error' });
    };
    reader.readAsText(file);
  };

  // Helper for validating people column settings
  const validatePeopleColumn = (columnId: string, columns: any[]) => {
    const column = columns.find(c => c.id === columnId);
    if (column && column.type === 'people') {
      try {
        const settings = typeof column.settings === 'string' 
          ? JSON.parse(column.settings) 
          : column.settings || {};
        
        if (settings.max_people_allowed !== "1" && settings.max_people_allowed !== 1) {
          return false;
        }
      } catch (e) {
        logger.error('[SettingsDialog] Failed to parse column settings:', e);
      }
    }
    return true;
  };

  const handlePeopleColumnChange = (value: string, columnType: 'employee' | 'userId', columns: any[]) => {
    if (!validatePeopleColumn(value, columns)) {
      setNotification({
        message: t('settings.employees.peopleWarning'),
        type: 'error'
      });
      return;
    }

    if (columnType === 'employee') {
      updateDraft({ employeeColumnId: value });
    } else {
      updateDraft({ employeeUserIdColumnId: value });
    }
  };

  // Section open/close state
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    allocations: true,
    employees: false,
    projects: false,
    availabilityDayOff: false,
    general: false
  });

  // Load boards on mount
  useEffect(() => {
    if (isOpen) {
      loadBoards();
    }
  }, [isOpen]);

  // Load columns when board changes
  useEffect(() => {
    if (draftSettings?.allocationsBoardId) {
      loadAllocationsColumns(draftSettings.allocationsBoardId);
    }
  }, [draftSettings?.allocationsBoardId]);

  useEffect(() => {
    if (draftSettings?.employeesBoardId) {
      loadEmployeesColumns(draftSettings.employeesBoardId);
    }
  }, [draftSettings?.employeesBoardId]);

  useEffect(() => {
    if (draftSettings?.projectsBoardId) {
      loadProjectsColumns(draftSettings.projectsBoardId);
    }
  }, [draftSettings?.projectsBoardId]);

  // Day-off vacations board columns (same pattern as the other board loaders).
  // No reset branch: the pickers below are gated on dayOffBoardId, so stale
  // columns are never rendered while the board is unmapped.
  useEffect(() => {
    if (draftSettings?.dayOffBoardId) {
      loadDayOffColumns(draftSettings.dayOffBoardId);
    }
  }, [draftSettings?.dayOffBoardId]);

  // Handle extraction of linked boards from project column settings
  useEffect(() => {
    const projectColumn = allocationsColumns.find(c => c.id === draftSettings?.projectColumnId);
    if (projectColumn && projectColumn.type === 'board_relation') {
      try {
        const columnSettings = typeof projectColumn.settings === 'string' 
          ? JSON.parse(projectColumn.settings) 
          : projectColumn.settings || {};
        const boardIds = columnSettings.boardIds || [];
        if (boardIds.length > 0) {
          loadLinkedBoards(boardIds.map(String));
        } else {
          setLinkedBoards([]);
        }
      } catch (e) {
        logger.error('[SettingsDialog] Failed to parse project column settings:', e);
        setLinkedBoards([]);
      }
    } else {
      setLinkedBoards([]);
    }
  }, [draftSettings?.projectColumnId, allocationsColumns]);

  // Status/color label extraction (id + display name, ID-based) lives in
  // utils/statusLabelUtils since W3.7 — shared with useSettingsValidation so
  // the validator resolves label IDs against the exact same parse the pickers
  // offer from.

  // Handle extraction of labels from status column settings
  useEffect(() => {
    const statusColumn = projectsColumns.find(c => c.id === draftSettings?.projectStatusColumnId);
    setStatusLabels(extractStatusLabels(statusColumn));
  }, [draftSettings?.projectStatusColumnId, projectsColumns]);

  // Extract labels from the classification column (for internal/external mapping)
  useEffect(() => {
    const col = projectsColumns.find(c => c.id === draftSettings?.projectClassificationColumnId);
    setClassificationLabels(extractStatusLabels(col));
  }, [draftSettings?.projectClassificationColumnId, projectsColumns]);

  // Extract labels from employee role column (status type)
  useEffect(() => {
    const roleColumn = employeesColumns.find(c => c.id === draftSettings?.employeeRoleColumnId);
    if (roleColumn && roleColumn.type === 'status') {
      try {
        const columnSettings = typeof roleColumn.settings === 'string'
          ? JSON.parse(roleColumn.settings)
          : roleColumn.settings || {};

        if (columnSettings.labels) {
          const labels = Object.entries(columnSettings.labels)
            .filter(([id]) => id !== 'empty')
            .map(([id, label]: [string, any]) => ({
              id: typeof label === 'object' ? label.label : label,
              name: typeof label === 'object' ? label.label : label
            }));
          setEmployeeRoleLabels(labels);
        } else {
          setEmployeeRoleLabels([]);
        }
      } catch (e) {
        logger.error('[SettingsDialog] Failed to parse employee role settings:', e);
        setEmployeeRoleLabels([]);
      }
    } else {
      setEmployeeRoleLabels([]);
    }
  }, [draftSettings?.employeeRoleColumnId, employeesColumns]);

  // Extract labels from the employee status column (id-based — see [[feedback_status_id_match]])
  useEffect(() => {
    const col = employeesColumns.find(c => c.id === draftSettings?.employeeStatusColumnId);
    setEmployeeStatusLabels(extractStatusLabels(col));
  }, [draftSettings?.employeeStatusColumnId, employeesColumns]);

  // Extract options from capabilities dropdown column
  useEffect(() => {
    const capColumn = employeesColumns.find(c => c.id === draftSettings?.capabilitiesColumnId);
    if (capColumn && capColumn.type === 'dropdown') {
      try {
        const columnSettings = typeof capColumn.settings === 'string'
          ? JSON.parse(capColumn.settings)
          : capColumn.settings || {};

        // Dropdown columns use 'options' array (not 'labels')
        if (columnSettings.options && Array.isArray(columnSettings.options)) {
          const labels = columnSettings.options
            .filter((item: any) => item && item.name)
            .map((item: any) => ({
              id: item.name,
              name: item.name
            }));
          setCapabilityLabels(labels);
        } else if (columnSettings.labels && Array.isArray(columnSettings.labels)) {
          // Fallback for labels array format
          const labels = columnSettings.labels
            .filter((item: any) => item && item.name)
            .map((item: any) => ({
              id: item.name,
              name: item.name
            }));
          setCapabilityLabels(labels);
        } else {
          setCapabilityLabels([]);
        }
      } catch (e) {
        logger.error('[SettingsDialog] Failed to parse capabilities column settings:', e);
        setCapabilityLabels([]);
      }
    } else {
      setCapabilityLabels([]);
    }
  }, [draftSettings?.capabilitiesColumnId, employeesColumns]);

  const loadBoards = async () => {
    setLoadingAllocationsBoard(true);
    setLoadingEmployeesBoard(true);
    setLoadingProjectsBoard(true);
    try {
      const boards = await mondayService.fetchBoards();
      setAllocationsBoards(boards);
      setEmployeesBoards(boards);
    } catch (err) {
      logger.error('[SettingsDialog] Failed to load boards:', err);
    } finally {
      setLoadingAllocationsBoard(false);
      setLoadingEmployeesBoard(false);
      setLoadingProjectsBoard(false);
    }
  };

  const loadAllocationsColumns = async (boardId: string) => {
    setLoadingAllocationsColumns(true);
    try {
      const columns = await mondayService.fetchColumns(boardId);
      setAllocationsColumns(columns);
    } catch (err) {
      logger.error('[SettingsDialog] Failed to load columns:', err);
    } finally {
      setLoadingAllocationsColumns(false);
    }
  };

  const loadLinkedBoards = async (boardIds: string[]) => {
    setLoadingLinkedBoards(true);
    try {
      const boards = await mondayService.fetchBoardsByIds(boardIds);
      setLinkedBoards(boards);
    } catch (err) {
      logger.error('[SettingsDialog] Failed to load linked boards:', err);
    } finally {
      setLoadingLinkedBoards(false);
    }
  };

  const loadEmployeesColumns = async (boardId: string) => {
    setLoadingEmployeesColumns(true);
    try {
      const columns = await mondayService.fetchColumns(boardId);
      setEmployeesColumns(columns);
    } catch (err) {
      logger.error('[SettingsDialog] Failed to load columns:', err);
    } finally {
      setLoadingEmployeesColumns(false);
    }
  };

  const loadDayOffColumns = async (boardId: string) => {
    setLoadingDayOffColumns(true);
    try {
      const columns = await mondayService.fetchColumns(boardId);
      setDayOffColumns(columns);
      // Record the board these columns belong to AFTER a successful fetch —
      // on failure the validator sees no live data and skips live checks
      // (an empty SUCCESSFUL result means the board itself is gone).
      setDayOffColumnsBoardId(boardId);
    } catch (err) {
      logger.error('[SettingsDialog] Failed to load day-off columns:', err);
    } finally {
      setLoadingDayOffColumns(false);
    }
  };

  const loadProjectsColumns = async (boardId: string) => {
    setLoadingProjectsColumns(true);
    try {
      const columns = await mondayService.fetchColumns(boardId);
      setProjectsColumns(columns);
    } catch (err) {
      logger.error('[SettingsDialog] Failed to load columns:', err);
    } finally {
      setLoadingProjectsColumns(false);
    }
  };

  const toggleSection = (sectionId: string) => {
    setOpenSections(prev => ({
      ...prev,
      [sectionId]: !prev[sectionId]
    }));
  };

  const toggleWorkDay = (dayIndex: number) => {
    if (!draftSettings) return;
    const currentWorkDays = draftSettings.workDays || [0, 1, 2, 3, 4];
    const newWorkDays = currentWorkDays.includes(dayIndex)
      ? currentWorkDays.filter(d => d !== dayIndex)
      : [...currentWorkDays, dayIndex].sort();
    updateDraft({ workDays: newWorkDays });
  };

  const handleSyncHours = () => {
    if (!draftSettings || !lastChangedField) return;

    const workDays = draftSettings.workDays || [0, 1, 2, 3, 4];
    const daysPerWeek = getWorkDaysPerWeek(workDays);

    let newDay = draftSettings.maxHoursPerDay;
    let newWeek = draftSettings.maxHoursPerWeek;
    let newMonth = draftSettings.maxHoursPerMonth;

    if (lastChangedField === 'day') {
      newWeek = Number((newDay * daysPerWeek).toFixed(1));
      newMonth = Number((newWeek * 4).toFixed(1));
    } else if (lastChangedField === 'week') {
      newDay = Number((newWeek / daysPerWeek).toFixed(1));
      newMonth = Number((newWeek * 4).toFixed(1));
    } else if (lastChangedField === 'month') {
      newWeek = Number((newMonth / 4).toFixed(1));
      newDay = Number((newWeek / daysPerWeek).toFixed(1));
    }

    updateDraft({
      maxHoursPerDay: newDay,
      maxHoursPerWeek: newWeek,
      maxHoursPerMonth: newMonth,
    });
  };

  const isDirty = useMemo(() => {
    if (!settings || !draftSettings) return false;
    return JSON.stringify(settings) !== JSON.stringify(draftSettings);
  }, [settings, draftSettings]);

  const handleSave = async () => {
    if (draftSettings) {
      await commitSettings(draftSettings);
      onClose();
    }
  };

  const handleRequestClose = async () => {
    if (isDirty) {
      try {
        const { monday } = mondayService;
        const result = await monday.execute("confirm", {
          message: t('settings.unsavedConfirm.message'),
          confirmButton: t('settings.unsavedConfirm.saveAndClose'),
          cancelButton: t('settings.unsavedConfirm.closeWithoutSaving'),
          excludeCancelButton: false
        }) as any;

        if (result.data?.confirm) {
          await handleSave();
        } else if (result.data?.confirm === false) {
          onClose();
        }
        // If user closes the confirm dialog without choosing, we stay in the settings
      } catch (err) {
        // The confirm SDK call was previously unguarded — a channel/SDK rejection was a
        // silent unhandled promise rejection. Log it and keep the dialog open so the user's
        // unsaved changes are never stranded by a failed confirm.
        logger.error('[SettingsDialog] unsaved-changes confirm dialog failed; keeping dialog open:', err);
      }
    } else {
      onClose();
    }
  };

  // Check if sections are complete - ensure boolean
  const isAllocationsComplete = Boolean(
    draftSettings?.allocationsBoardId &&
    draftSettings?.startDateColumnId &&
    draftSettings?.endDateColumnId &&
    draftSettings?.hoursPerDayColumnId &&
    draftSettings?.projectColumnId &&
    draftSettings?.employeeColumnId &&
    draftSettings?.roleColumnId
  );

  const isEmployeesComplete = Boolean(
    draftSettings?.employeesBoardId &&
    draftSettings?.employeeNameColumnId &&
    draftSettings?.employeeRoleColumnId &&
    draftSettings?.employeeAllocationPercentColumnId &&
    draftSettings?.employeeUserIdColumnId
  );

  // Day-off mapping completeness (checkmark sugar only — requiredness/validation
  // is W3.7's): board + identity/date/kind mapping; when the D2 approval toggle
  // is ON, also the approval column + a non-empty approved label set.
  const isDayOffComplete = Boolean(
    draftSettings?.dayOffBoardId &&
    draftSettings?.dayOffEmployeeColumnId &&
    draftSettings?.dayOffStartDateColumnId &&
    draftSettings?.dayOffEndDateColumnId &&
    draftSettings?.dayOffKindColumnId &&
    draftSettings?.dayOffKindGeneralLabelId &&
    draftSettings?.dayOffKindPersonalLabelId &&
    (!draftSettings?.dayOffApprovalRequired ||
      (draftSettings?.dayOffApprovalColumnId && (draftSettings?.dayOffApprovedLabelIds || []).length > 0))
  );

  // Day-off label option lists — stable label IDs read via the column `settings`
  // field (extractStatusLabels is ID-based). Computed at render: tiny arrays,
  // and it avoids new set-state-in-effect pairs.
  const dayOffKindLabels = extractStatusLabels(dayOffColumns.find(c => c.id === draftSettings?.dayOffKindColumnId));
  const dayOffApprovalLabels = extractStatusLabels(dayOffColumns.find(c => c.id === draftSettings?.dayOffApprovalColumnId));

  // Calculate which tabs have errors (for red dot indicators)
  const allocationsErrorFields = ['allocationsBoardId', 'startDateColumnId', 'endDateColumnId', 'hoursPerDayColumnId', 'projectColumnId', 'employeeColumnId', 'roleColumnId'];
  const employeesErrorFields = ['employeesBoardId', 'employeeNameColumnId', 'employeeRoleColumnId', 'employeeAllocationPercentColumnId', 'employeeUserIdColumnId', 'employeeStatusColumnId', 'activeEmployeeStatusValues'];
  const projectsErrorFields = ['projectsBoardId', 'projectStatusColumnId', 'activeProjectStatusValues', 'projectClassificationColumnId', 'projectClassificationValues'];
  // Day-off mapping errors — populated by useSettingsValidation (W3.7): field
  // requiredness, board existence, deleted-column refs, label-ID resolvability,
  // approval mapping iff the D2 toggle is ON, and the identity-join requirement.
  const availabilityErrorFields = ['dayOffBoardId', 'dayOffIdentityJoin', 'dayOffEmployeeColumnId', 'dayOffStartDateColumnId', 'dayOffEndDateColumnId', 'dayOffKindColumnId', 'dayOffKindGeneralLabelId', 'dayOffKindPersonalLabelId', 'dayOffTypeColumnId', 'dayOffMandatoryColumnId', 'dayOffApprovalColumnId', 'dayOffApprovedLabelIds', 'dayOffRejectedLabelIds'];
  const generalErrorFields = ['workHours'];

  const hasAllocationsErrors = allocationsErrorFields.some(f => getFieldError(f));
  const hasEmployeesErrors = employeesErrorFields.some(f => getFieldError(f));
  const hasProjectsErrors = projectsErrorFields.some(f => getFieldError(f));
  const hasAvailabilityErrors = availabilityErrorFields.some(f => getFieldError(f));
  const hasGeneralErrors = generalErrorFields.some(f => getFieldError(f));

  const tabStatus = {
    allocations: { hasErrors: hasAllocationsErrors },
    employees: { hasErrors: hasEmployeesErrors },
    projects: { hasErrors: hasProjectsErrors },
    availability: { hasErrors: hasAvailabilityErrors },
    general: { hasErrors: hasGeneralErrors }
  };

  if (!isOpen || !draftSettings) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 pointer-events-auto">
      <div
        className="bg-bg-surface rounded-[12px] shadow-xl w-[90vw] max-w-[800px] max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        dir={locale.dir}
      >
        {/* Header */}
        <div className="px-6 py-4 flex justify-between items-center border-b border-border-subtle flex-shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold text-text-primary">{t('settings.dialog.title')}</h2>
            <button
              onClick={() => setShowJsonView(true)}
              className="p-1.5 text-text-subtle hover:text-accent hover:bg-accent-bg-soft rounded-md transition-all"
              title={t('settings.dialog.showJsonTitle')}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 18 22 12 16 6"></polyline>
                <polyline points="8 6 2 12 8 18"></polyline>
              </svg>
            </button>
          </div>
          <button
            onClick={handleRequestClose}
            className="text-text-subtle hover:text-text-muted p-1 rounded-md hover:bg-bg-hover transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        {/* Notification Banner */}
        {notification && (
          <div className={`px-6 py-3 flex items-center gap-3 animate-in slide-in-from-top duration-300 ${
            notification.type === 'error' ? 'bg-danger-soft text-danger border-b border-danger-border' : 'bg-success-soft text-success border-b border-success-border'
          }`}>
            {notification.type === 'error' ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                <polyline points="22 4 12 14.01 9 11.01"></polyline>
              </svg>
            )}
            <p className="text-xs font-medium flex-1">{notification.message}</p>
            <button onClick={() => setNotification(null)} className="p-1 hover:bg-black/5 rounded-full transition-colors">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6" dir={locale.dir}>
          <SettingsTabs tabStatus={tabStatus}>
            {/* Allocations Tab */}
            <div data-tab-id="allocations">
              <SettingsSection
                id="allocations-board"
                title={t('settings.allocations.title')}
                isOpen={openSections.allocations}
                onToggle={() => toggleSection('allocations')}
                isComplete={isAllocationsComplete}
                hasErrors={hasAllocationsErrors}
                description={t('settings.allocations.description')}
              >
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-text-secondary">{t('settings.allocations.fields.board')}</label>
                    <SearchableSelect
                      options={allocationsBoards || []}
                      value={draftSettings.allocationsBoardId}
                      onChange={(value) => updateDraft({ allocationsBoardId: value })}
                      placeholder={t('settings.placeholder.board')}
                      isLoading={loadingAllocationsBoard}
                    />
                    {getFieldError('allocationsBoardId') && (
                      <p className="text-danger text-xs">{getFieldError('allocationsBoardId')}</p>
                    )}
                  </div>

                  {draftSettings.allocationsBoardId && (
                    <>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-text-secondary">{t('settings.allocations.fields.startDate')}</label>
                        <SearchableSelect
                          options={(allocationsColumns || []).filter(c => c.type === 'date')}
                          value={draftSettings.startDateColumnId}
                          onChange={(value) => updateDraft({ startDateColumnId: value })}
                          placeholder={t('settings.placeholder.column')}
                          isLoading={loadingAllocationsColumns}
                        />
                        {getFieldError('startDateColumnId') && (
                          <p className="text-danger text-xs">{getFieldError('startDateColumnId')}</p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium text-text-secondary">{t('settings.allocations.fields.endDate')}</label>
                        <SearchableSelect
                          options={(allocationsColumns || []).filter(c => c.type === 'date')}
                          value={draftSettings.endDateColumnId}
                          onChange={(value) => updateDraft({ endDateColumnId: value })}
                          placeholder={t('settings.placeholder.column')}
                          isLoading={loadingAllocationsColumns}
                        />
                        {getFieldError('endDateColumnId') && (
                          <p className="text-danger text-xs">{getFieldError('endDateColumnId')}</p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium text-text-secondary">{t('settings.allocations.fields.hoursPerDay')}</label>
                        <SearchableSelect
                          options={(allocationsColumns || []).filter(c => c.type === 'numbers')}
                          value={draftSettings.hoursPerDayColumnId}
                          onChange={(value) => updateDraft({ hoursPerDayColumnId: value })}
                          placeholder={t('settings.placeholder.column')}
                          isLoading={loadingAllocationsColumns}
                        />
                        {getFieldError('hoursPerDayColumnId') && (
                          <p className="text-danger text-xs">{getFieldError('hoursPerDayColumnId')}</p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium text-text-secondary">{t('settings.allocations.fields.totalHours')}</label>
                        <SearchableSelect
                          options={(allocationsColumns || []).filter(c => c.type === 'numbers')}
                          value={draftSettings.totalHoursColumnId}
                          onChange={(value) => updateDraft({ totalHoursColumnId: value })}
                          placeholder={t('settings.placeholder.column')}
                          isLoading={loadingAllocationsColumns}
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium text-text-secondary">{t('settings.allocations.fields.fte')}</label>
                        <SearchableSelect
                          options={(allocationsColumns || []).filter(c => c.type === 'numbers')}
                          value={draftSettings.ftePercentageColumnId || ''}
                          onChange={(value) => updateDraft({ ftePercentageColumnId: value })}
                          placeholder={t('settings.placeholder.column')}
                          isLoading={loadingAllocationsColumns}
                        />
                        <p className="text-xs text-text-muted">{t('settings.allocations.fields.fteHelp')}</p>
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium text-text-secondary">{t('settings.allocations.fields.project')}</label>
                        <SearchableSelect
                          options={(allocationsColumns || []).filter(c => c.type === 'board_relation' || c.type === 'text')}
                          value={draftSettings.projectColumnId}
                          onChange={(value) => updateDraft({ projectColumnId: value })}
                          placeholder={t('settings.placeholder.column')}
                          isLoading={loadingAllocationsColumns}
                        />
                      {getFieldError('projectColumnId') && (
                        <p className="text-danger text-xs">{getFieldError('projectColumnId')}</p>
                      )}
                    </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium text-text-secondary">{t('settings.allocations.fields.employee')}</label>
                        <SearchableSelect
                          options={(allocationsColumns || []).filter(c => c.type === 'people')}
                          value={draftSettings.employeeColumnId}
                          onChange={(value) => handlePeopleColumnChange(value, 'employee', allocationsColumns)}
                          placeholder={t('settings.placeholder.column')}
                          isLoading={loadingAllocationsColumns}
                        />
                        {getFieldError('employeeColumnId') && (
                          <p className="text-danger text-xs">{getFieldError('employeeColumnId')}</p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium text-text-secondary">{t('settings.allocations.fields.role')}</label>
                        <SearchableSelect
                          options={(allocationsColumns || []).filter(c => c.type === 'status' || c.type === 'text')}
                          value={draftSettings.roleColumnId}
                          onChange={(value) => updateDraft({ roleColumnId: value })}
                          placeholder={t('settings.placeholder.column')}
                          isLoading={loadingAllocationsColumns}
                        />
                        {getFieldError('roleColumnId') && (
                          <p className="text-danger text-xs">{getFieldError('roleColumnId')}</p>
                        )}
                      </div>

                      {/* Allocation Capability Column - Optional */}
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-text-secondary">{t('settings.allocations.fields.capability')}</label>
                        <SearchableSelect
                          options={(allocationsColumns || []).filter(c => c.type === 'dropdown')}
                          value={draftSettings.allocationCapabilityColumnId || ''}
                          onChange={(value) => updateDraft({ allocationCapabilityColumnId: value })}
                          placeholder={t('settings.placeholder.capabilityColumn')}
                          isLoading={loadingAllocationsColumns}
                        />

                      </div>

                      <div className="space-y-2 pt-4 border-t border-border-faint">
                        <label className="text-sm font-medium text-text-secondary">{t('settings.allocations.fields.reportedHours')}</label>
                        <SearchableSelect
                          options={(allocationsColumns || []).filter(c => c.type === 'mirror' || c.type === 'lookup')}
                          value={draftSettings.reportedHoursColumnId || ''}
                          onChange={(value) => updateDraft({ reportedHoursColumnId: value })}
                          placeholder={t('settings.placeholder.column')}
                          isLoading={loadingAllocationsColumns}
                        />
                        <p className="text-xs text-text-muted">{t('settings.allocations.fields.reportedHoursHelp')}</p>
                      </div>

                      {/* #90: logs→allocations connect column for the reported-hours
                          aggregate. Auto-detected from the reportedHours mirror's logs
                          board; shown so the user can switch when multiple exist. */}
                      {logsAllocCandidates.length > 0 && (
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-text-secondary">עמודת קישור הקצאות בלוח דיווחי השעות</label>
                          <SearchableSelect
                            options={logsAllocCandidates.map(c => ({ id: c.id, title: c.title, type: 'board_relation' }))}
                            value={draftSettings.timeLogsAllocationColumnId || ''}
                            onChange={(value) => updateDraft({ timeLogsAllocationColumnId: value })}
                            placeholder={t('settings.placeholder.column')}
                          />
                          <p className="text-xs text-text-muted">מזוהה אוטומטית מעמודת השעות בפועל. בחר ידנית אם קיימות כמה עמודות קישור.</p>
                        </div>
                      )}

                      <div className="space-y-2">
                        <label className="text-sm font-medium text-text-secondary">{t('settings.allocations.fields.cost')}</label>
                        <SearchableSelect
                          options={(allocationsColumns || []).filter(c => c.type === 'numbers')}
                          value={draftSettings.allocationCostColumnId || ''}
                          onChange={(value) => updateDraft({ allocationCostColumnId: value })}
                          placeholder={t('settings.placeholder.column')}
                          isLoading={loadingAllocationsColumns}
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium text-text-secondary">{t('settings.allocations.fields.pm')}</label>
                        <SearchableSelect
                          options={(allocationsColumns || []).filter(c => c.type === 'people')}
                          value={draftSettings.allocationManagerColumnId || ''}
                          onChange={(value) => updateDraft({ allocationManagerColumnId: value })}
                          placeholder={t('settings.placeholder.column')}
                          isLoading={loadingAllocationsColumns}
                        />
                        <p className="text-xs text-text-muted">{t('settings.allocations.fields.pmHelp')}</p>
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium text-text-secondary">{t('settings.allocations.fields.client')}</label>
                        <SearchableSelect
                          options={(allocationsColumns || []).filter(c => c.type === 'board_relation')}
                          value={draftSettings.allocationClientColumnId || ''}
                          onChange={(value) => updateDraft({ allocationClientColumnId: value })}
                          placeholder={t('settings.placeholder.column')}
                          isLoading={loadingAllocationsColumns}
                        />
                        <p className="text-xs text-text-muted">{t('settings.allocations.fields.clientHelp')}</p>
                      </div>
                    </>
                  )}
                </div>
              </SettingsSection>
            </div>

            {/* Employees Tab */}
            <div data-tab-id="employees">
              <SettingsSection
                id="employees-board"
                title={t('settings.employees.title')}
                isOpen={openSections.employees}
                onToggle={() => toggleSection('employees')}
                isComplete={isEmployeesComplete}
                hasErrors={hasEmployeesErrors}
                description={t('settings.employees.description')}
              >
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-text-secondary">{t('settings.employees.fields.board')}</label>
                    <SearchableSelect
                      options={employeesBoards || []}
                      value={draftSettings.employeesBoardId}
                      onChange={(value) => updateDraft({ employeesBoardId: value })}
                      placeholder={t('settings.placeholder.board')}
                      isLoading={loadingEmployeesBoard}
                    />
                    {getFieldError('employeesBoardId') && (
                      <p className="text-danger text-xs">{getFieldError('employeesBoardId')}</p>
                    )}
                  </div>

                  {draftSettings.employeesBoardId && (
                    <>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-text-secondary">{t('settings.employees.fields.name')}</label>
                        <SearchableSelect
                          options={(employeesColumns || []).filter(c => c.type === 'name' || c.type === 'text')}
                          value={draftSettings.employeeNameColumnId}
                          onChange={(value) => updateDraft({ employeeNameColumnId: value })}
                          placeholder={t('settings.placeholder.column')}
                          isLoading={loadingEmployeesColumns}
                        />
                        {getFieldError('employeeNameColumnId') && (
                          <p className="text-danger text-xs">{getFieldError('employeeNameColumnId')}</p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium text-text-secondary">{t('settings.employees.fields.role')}</label>
                        <SearchableSelect
                          options={(employeesColumns || []).filter(c => c.type === 'status' || c.type === 'text')}
                          value={draftSettings.employeeRoleColumnId}
                          onChange={(value) => updateDraft({ employeeRoleColumnId: value })}
                          placeholder={t('settings.placeholder.column')}
                          isLoading={loadingEmployeesColumns}
                        />
                        {getFieldError('employeeRoleColumnId') && (
                          <p className="text-danger text-xs">{getFieldError('employeeRoleColumnId')}</p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium text-text-secondary">{t('settings.employees.fields.allocPercent')}</label>
                        <SearchableSelect
                          options={(employeesColumns || []).filter(c => c.type === 'numbers' || c.type === 'text')}
                          value={draftSettings.employeeAllocationPercentColumnId}
                          onChange={(value) => updateDraft({ employeeAllocationPercentColumnId: value })}
                          placeholder={t('settings.placeholder.column')}
                          isLoading={loadingEmployeesColumns}
                        />
                        {getFieldError('employeeAllocationPercentColumnId') && (
                          <p className="text-danger text-xs">{getFieldError('employeeAllocationPercentColumnId')}</p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium text-text-secondary">{t('settings.employees.fields.cost')}</label>
                        <SearchableSelect
                          options={(employeesColumns || []).filter(c => c.type === 'numbers')}
                          value={draftSettings.employeeCostColumnId}
                          onChange={(value) => updateDraft({ employeeCostColumnId: value })}
                          placeholder={t('settings.placeholder.column')}
                          isLoading={loadingEmployeesColumns}
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium text-text-secondary">{t('settings.employees.fields.user')}</label>
                        <SearchableSelect
                          options={(employeesColumns || []).filter(c => c.type === 'people')}
                          value={draftSettings.employeeUserIdColumnId}
                          onChange={(value) => handlePeopleColumnChange(value, 'userId', employeesColumns)}
                          placeholder={t('settings.placeholder.column')}
                          isLoading={loadingEmployeesColumns}
                        />
                        {getFieldError('employeeUserIdColumnId') && (
                          <p className="text-danger text-xs">{getFieldError('employeeUserIdColumnId')}</p>
                        )}
                      </div>

                      {/* Capabilities Column - Optional */}
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-text-secondary">{t('settings.employees.fields.capabilities')}</label>
                        <SearchableSelect
                          options={(employeesColumns || []).filter(c => c.type === 'dropdown')}
                          value={draftSettings.capabilitiesColumnId || ''}
                          onChange={(value) => updateDraft({ capabilitiesColumnId: value })}
                          placeholder={t('settings.placeholder.capabilitiesColumn')}
                          isLoading={loadingEmployeesColumns}
                        />
                        <p className="text-xs text-text-muted">
                          {t('settings.employees.fields.capabilitiesHelp')}
                        </p>
                      </div>

                      {/* Inactive Employees Filter */}
                      <hr className="my-4 border-border-faint" />

                      <div className="space-y-4">
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            id="filterInactiveEmployees"
                            checked={draftSettings.filterInactiveEmployees || false}
                            onChange={(e) => updateDraft({ filterInactiveEmployees: e.target.checked })}
                            className="w-5 h-5 rounded border-border-default text-accent focus:ring-accent"
                          />
                          <label htmlFor="filterInactiveEmployees" className="text-sm font-semibold text-text-primary cursor-pointer">
                            {t('settings.employees.filterInactive')}
                          </label>
                        </div>
                        <p className="text-xs text-text-muted mr-8">
                          {t('settings.employees.filterInactiveHelp')}
                        </p>

                        {draftSettings.filterInactiveEmployees && (
                          <div className="bg-accent-bg-soft p-4 rounded-lg border border-accent space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
                            <div className="space-y-2">
                              <label className="text-xs font-medium text-text-secondary">{t('settings.employees.statusColumn')}</label>
                              <SearchableSelect
                                options={(employeesColumns || []).filter(c => c.type === 'status' || c.type === 'color')}
                                value={draftSettings.employeeStatusColumnId || ''}
                                onChange={(value) => updateDraft({ employeeStatusColumnId: value })}
                                placeholder={t('settings.placeholder.statusColumn')}
                                isLoading={loadingEmployeesColumns}
                              />
                              {getFieldError('employeeStatusColumnId') && (
                                <p className="text-danger text-xs">{getFieldError('employeeStatusColumnId')}</p>
                              )}
                            </div>

                            {draftSettings.employeeStatusColumnId && (
                              <div className="space-y-2">
                                <label className="text-xs font-medium text-text-secondary">{t('settings.employees.activeStatusValue')}</label>
                                <MultiSelect
                                  options={employeeStatusLabels}
                                  value={draftSettings.activeEmployeeStatusValues || []}
                                  onChange={(values) => updateDraft({ activeEmployeeStatusValues: values })}
                                  placeholder={t('settings.placeholder.activeStatuses')}
                                />
                                {getFieldError('activeEmployeeStatusValues') && (
                                  <p className="text-danger text-xs">{getFieldError('activeEmployeeStatusValues')}</p>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                    </>
                  )}
                </div>
              </SettingsSection>
            </div>

            {/* Projects Tab */}
            <div data-tab-id="projects">
              <SettingsSection
                id="projects-board"
                title={t('settings.projects.title')}
                isOpen={openSections.projects}
                onToggle={() => toggleSection('projects')}
                hasErrors={hasProjectsErrors}
                description={t('settings.projects.description')}
              >
                <div className="space-y-4">
                  {/* Project Board Selection - from linked boards */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-text-secondary">{t('settings.projects.selectBoard')}</label>
                    <p className="text-xs text-text-muted">{t('settings.projects.selectBoardHelp')}</p>
                    <SearchableSelect
                      options={linkedBoards}
                      value={draftSettings.projectsBoardId || ''}
                      onChange={(value) => updateDraft({ projectsBoardId: value })}
                      placeholder={loadingLinkedBoards ? t('settings.loading.boards') : t('settings.placeholder.projectsBoard')}
                      isLoading={loadingLinkedBoards}
                      disabled={linkedBoards.length === 0}
                    />
                    {linkedBoards.length === 0 && !loadingLinkedBoards && (
                      <p className="text-warning-text text-xs">{t('settings.projects.noLinkedBoards')}</p>
                    )}
                  </div>

                  {draftSettings.projectsBoardId && (
                    <>
                      {/* Active Projects Filter */}
                      <hr className="my-4 border-border-faint" />
                      
                      <div className="space-y-4">
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            id="filterActiveProjects"
                            checked={draftSettings.filterActiveProjects || false}
                            onChange={(e) => updateDraft({ filterActiveProjects: e.target.checked })}
                            className="w-5 h-5 rounded border-border-default text-accent focus:ring-accent"
                          />
                          <label htmlFor="filterActiveProjects" className="text-sm font-semibold text-text-primary cursor-pointer">
                            {t('settings.projects.filterActive')}
                          </label>
                        </div>

                        {draftSettings.filterActiveProjects && (
                          <div className="bg-accent-bg-soft p-4 rounded-lg border border-accent space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
                            <div className="space-y-2">
                              <label className="text-xs font-medium text-text-secondary">{t('settings.projects.statusColumn')}</label>
                              <SearchableSelect
                                options={projectsColumns.filter(c => c.type === 'status' || c.type === 'color')}
                                value={draftSettings.projectStatusColumnId || ''}
                                onChange={(value) => updateDraft({ projectStatusColumnId: value })}
                                placeholder={t('settings.placeholder.statusColumn')}
                                isLoading={loadingProjectsColumns}
                              />
                              {getFieldError('projectStatusColumnId') && (
                                <p className="text-danger text-xs">{getFieldError('projectStatusColumnId')}</p>
                              )}
                            </div>

                            {draftSettings.projectStatusColumnId && (
                              <div className="space-y-2">
                                <label className="text-xs font-medium text-text-secondary">{t('settings.projects.activeStatusValue')}</label>
                                <MultiSelect
                                  options={statusLabels}
                                  value={draftSettings.activeProjectStatusValues || []}
                                  onChange={(values) => updateDraft({ activeProjectStatusValues: values })}
                                  placeholder={t('settings.placeholder.activeStatuses')}
                                />
                                {getFieldError('activeProjectStatusValues') && (
                                  <p className="text-danger text-xs">{getFieldError('activeProjectStatusValues')}</p>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Internal/External Classification */}
                      <hr className="my-4 border-border-faint" />

                      <div className="space-y-4">
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            id="enableProjectClassification"
                            checked={draftSettings.enableProjectClassification || false}
                            onChange={(e) => updateDraft({ enableProjectClassification: e.target.checked })}
                            className="w-5 h-5 rounded border-border-default text-accent focus:ring-accent"
                          />
                          <label htmlFor="enableProjectClassification" className="text-sm font-semibold text-text-primary cursor-pointer">
                            {t('settings.projects.classification.label')}
                          </label>
                        </div>

                        {draftSettings.enableProjectClassification && (
                          <div className="bg-accent-secondary-bg-soft p-4 rounded-lg border border-accent-secondary-border space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
                            <div className="space-y-2">
                              <label className="text-xs font-medium text-text-secondary">{t('settings.projects.classification.statusColumn')}</label>
                              <SearchableSelect
                                options={projectsColumns.filter(c => c.type === 'status' || c.type === 'color')}
                                value={draftSettings.projectClassificationColumnId || ''}
                                onChange={(value) => updateDraft({ projectClassificationColumnId: value })}
                                placeholder={t('settings.placeholder.classificationStatus')}
                                isLoading={loadingProjectsColumns}
                              />
                              {getFieldError('projectClassificationColumnId') && (
                                <p className="text-danger text-xs">{getFieldError('projectClassificationColumnId')}</p>
                              )}
                            </div>

                            {draftSettings.projectClassificationColumnId && (
                              <>
                                <div className="space-y-2">
                                  <label className="text-xs font-medium text-text-secondary">{t('settings.projects.classification.internal')}</label>
                                  <MultiSelect
                                    options={classificationLabels}
                                    value={draftSettings.internalProjectStatusValues || []}
                                    onChange={(values) => updateDraft({ internalProjectStatusValues: values })}
                                    placeholder={t('settings.placeholder.internalLabels')}
                                  />
                                </div>

                                <div className="space-y-2">
                                  <label className="text-xs font-medium text-text-secondary">{t('settings.projects.classification.external')}</label>
                                  <MultiSelect
                                    options={classificationLabels}
                                    value={draftSettings.externalProjectStatusValues || []}
                                    onChange={(values) => updateDraft({ externalProjectStatusValues: values })}
                                    placeholder={t('settings.placeholder.externalLabels')}
                                  />
                                </div>

                                {getFieldError('projectClassificationValues') && (
                                  <p className="text-danger text-xs">{getFieldError('projectClassificationValues')}</p>
                                )}
                                <p className="text-[11px] text-text-muted">
                                  {t('settings.projects.classification.note')}
                                </p>
                              </>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Project Manager Column */}
                      <hr className="my-4 border-border-faint" />

                      <div className="space-y-2">
                        <label className="text-xs font-medium text-text-secondary">{t('settings.projects.fields.pm')}</label>
                        <SearchableSelect
                          options={projectsColumns.filter(c => c.type === 'people')}
                          value={draftSettings.projectManagerColumnId || ''}
                          onChange={(value) => updateDraft({ projectManagerColumnId: value })}
                          placeholder={t('settings.placeholder.pmColumn')}
                          isLoading={loadingProjectsColumns}
                        />
                        <p className="text-xs text-text-muted">{t('settings.projects.fields.pmHelp')}</p>
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-medium text-text-secondary">{t('settings.projects.fields.client')}</label>
                        <SearchableSelect
                          options={projectsColumns.filter(c => c.type === 'board_relation')}
                          value={draftSettings.clientColumnId || ''}
                          onChange={(value) => updateDraft({ clientColumnId: value })}
                          placeholder={t('settings.placeholder.clientColumn')}
                          isLoading={loadingProjectsColumns}
                        />
                        <p className="text-xs text-text-muted">{t('settings.projects.fields.clientHelp')}</p>
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-medium text-text-secondary">{t('settings.projects.fields.type')}</label>
                        <SearchableSelect
                          options={projectsColumns.filter(c => c.type === 'status' || c.type === 'color')}
                          value={draftSettings.projectTypeColumnId || ''}
                          onChange={(value) => updateDraft({ projectTypeColumnId: value })}
                          placeholder={t('settings.placeholder.typeColumn')}
                          isLoading={loadingProjectsColumns}
                        />
                        <p className="text-xs text-text-muted">{t('settings.projects.fields.typeHelp')}</p>
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-medium text-text-secondary">{t('settings.projects.fields.plannedHours')}</label>
                        <SearchableSelect
                          options={projectsColumns.filter(c => c.type === 'numbers')}
                          value={draftSettings.projectPlannedHoursColumnId || ''}
                          onChange={(value) => updateDraft({ projectPlannedHoursColumnId: value })}
                          placeholder={t('settings.placeholder.plannedHoursColumn')}
                          isLoading={loadingProjectsColumns}
                        />
                        <p className="text-xs text-text-muted">{t('settings.projects.fields.plannedHoursHelp')}</p>
                      </div>
                    </>
                  )}
                </div>
              </SettingsSection>
            </div>

            {/* Availability Tab — the Day-off vacations board is the sole
                absence / company-holiday source for the capacity math (the
                manual mapping surface per D9 — field semantics in
                ../Day-off/CONTRACT.md). */}
            <div data-tab-id="availability">
              <SettingsSection
                id="availability-dayoff"
                title={t('settings.availability.dayoff.title')}
                isOpen={openSections.availabilityDayOff}
                onToggle={() => toggleSection('availabilityDayOff')}
                isComplete={isDayOffComplete}
                hasErrors={hasAvailabilityErrors}
                description={t('settings.availability.dayoff.description')}
              >
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-text-secondary">{t('settings.availability.dayoff.fields.board')}</label>
                    <p className="text-xs text-text-muted">{t('settings.availability.dayoff.fields.boardHelp')}</p>
                    <SearchableSelect
                      options={allocationsBoards}
                      value={draftSettings.dayOffBoardId || ''}
                      onChange={(value) => updateDraft({
                        dayOffBoardId: value,
                        // A board change invalidates every column/label mapping below.
                        // The D2 policy toggle survives — it is policy, not board mapping.
                        dayOffEmployeeColumnId: '',
                        dayOffStartDateColumnId: '',
                        dayOffEndDateColumnId: '',
                        dayOffKindColumnId: '',
                        dayOffKindGeneralLabelId: '',
                        dayOffKindPersonalLabelId: '',
                        dayOffTypeColumnId: '',
                        dayOffMandatoryColumnId: '',
                        dayOffApprovalColumnId: '',
                        dayOffApprovedLabelIds: [],
                        dayOffRejectedLabelIds: [],
                      })}
                      placeholder={loadingAllocationsBoard ? t('settings.loading.boards') : t('settings.placeholder.board')}
                      isLoading={loadingAllocationsBoard}
                    />
                    {getFieldError('dayOffBoardId') && (
                      <p className="text-danger text-xs">{getFieldError('dayOffBoardId')}</p>
                    )}
                    {/* Identity join (W3.7, CONTRACT.md §5.3): a configured Day-off
                        source requires the Employees-board user column — without it
                        Employee.id falls back to the item ID and every people-keyed
                        join silently misses. */}
                    {getFieldError('dayOffIdentityJoin') && (
                      <p className="text-danger text-xs">{getFieldError('dayOffIdentityJoin')}</p>
                    )}
                  </div>

                  {draftSettings.dayOffBoardId && (
                    <>
                      <hr className="my-4 border-border-faint" />

                      <div className="space-y-2">
                        <label className="text-xs font-medium text-text-secondary">{t('settings.availability.dayoff.fields.employee')}</label>
                        <p className="text-xs text-text-muted">{t('settings.availability.dayoff.fields.employeeHelp')}</p>
                        <SearchableSelect
                          options={dayOffColumns.filter(c => c.type === 'people')}
                          value={draftSettings.dayOffEmployeeColumnId || ''}
                          onChange={(value) => updateDraft({ dayOffEmployeeColumnId: value })}
                          placeholder={t('settings.placeholder.column')}
                          isLoading={loadingDayOffColumns}
                        />
                        {getFieldError('dayOffEmployeeColumnId') && (
                          <p className="text-danger text-xs">{getFieldError('dayOffEmployeeColumnId')}</p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-medium text-text-secondary">{t('settings.availability.dayoff.fields.startDate')}</label>
                        <SearchableSelect
                          options={dayOffColumns.filter(c => c.type === 'date')}
                          value={draftSettings.dayOffStartDateColumnId || ''}
                          onChange={(value) => updateDraft({ dayOffStartDateColumnId: value })}
                          placeholder={t('settings.placeholder.column')}
                          isLoading={loadingDayOffColumns}
                        />
                        {getFieldError('dayOffStartDateColumnId') && (
                          <p className="text-danger text-xs">{getFieldError('dayOffStartDateColumnId')}</p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-medium text-text-secondary">{t('settings.availability.dayoff.fields.endDate')}</label>
                        <SearchableSelect
                          options={dayOffColumns.filter(c => c.type === 'date')}
                          value={draftSettings.dayOffEndDateColumnId || ''}
                          onChange={(value) => updateDraft({ dayOffEndDateColumnId: value })}
                          placeholder={t('settings.placeholder.column')}
                          isLoading={loadingDayOffColumns}
                        />
                        {getFieldError('dayOffEndDateColumnId') && (
                          <p className="text-danger text-xs">{getFieldError('dayOffEndDateColumnId')}</p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-medium text-text-secondary">{t('settings.availability.dayoff.fields.kind')}</label>
                        <p className="text-xs text-text-muted">{t('settings.availability.dayoff.fields.kindHelp')}</p>
                        <SearchableSelect
                          options={dayOffColumns.filter(c => c.type === 'status' || c.type === 'color')}
                          value={draftSettings.dayOffKindColumnId || ''}
                          onChange={(value) => updateDraft({ dayOffKindColumnId: value, dayOffKindGeneralLabelId: '', dayOffKindPersonalLabelId: '' })}
                          placeholder={t('settings.placeholder.statusColumn')}
                          isLoading={loadingDayOffColumns}
                        />
                        {getFieldError('dayOffKindColumnId') && (
                          <p className="text-danger text-xs">{getFieldError('dayOffKindColumnId')}</p>
                        )}
                      </div>

                      {draftSettings.dayOffKindColumnId && (
                        <div className="bg-accent-bg-soft p-4 rounded-lg border border-accent space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
                          {/* The same label cannot mean both kinds — each picker
                              hides the other's selection (label IDs, not text). */}
                          <div className="space-y-2">
                            <label className="text-xs font-medium text-text-secondary">{t('settings.availability.dayoff.fields.generalLabel')}</label>
                            <SearchableSelect
                              options={dayOffKindLabels.filter(l => l.id !== draftSettings.dayOffKindPersonalLabelId)}
                              value={draftSettings.dayOffKindGeneralLabelId || ''}
                              onChange={(value) => updateDraft({ dayOffKindGeneralLabelId: value })}
                              placeholder={t('settings.placeholder.label')}
                              isLoading={loadingDayOffColumns}
                            />
                            {getFieldError('dayOffKindGeneralLabelId') && (
                              <p className="text-danger text-xs">{getFieldError('dayOffKindGeneralLabelId')}</p>
                            )}
                          </div>

                          <div className="space-y-2">
                            <label className="text-xs font-medium text-text-secondary">{t('settings.availability.dayoff.fields.personalLabel')}</label>
                            <SearchableSelect
                              options={dayOffKindLabels.filter(l => l.id !== draftSettings.dayOffKindGeneralLabelId)}
                              value={draftSettings.dayOffKindPersonalLabelId || ''}
                              onChange={(value) => updateDraft({ dayOffKindPersonalLabelId: value })}
                              placeholder={t('settings.placeholder.label')}
                              isLoading={loadingDayOffColumns}
                            />
                            {getFieldError('dayOffKindPersonalLabelId') && (
                              <p className="text-danger text-xs">{getFieldError('dayOffKindPersonalLabelId')}</p>
                            )}
                          </div>

                          <p className="text-[11px] text-text-muted">{t('settings.availability.dayoff.fields.kindLabelsHelp')}</p>
                        </div>
                      )}

                      <div className="space-y-2">
                        <label className="text-xs font-medium text-text-secondary">{t('settings.availability.dayoff.fields.type')}</label>
                        <p className="text-xs text-text-muted">{t('settings.availability.dayoff.fields.typeHelp')}</p>
                        <SearchableSelect
                          options={dayOffColumns.filter(c => c.type === 'status' || c.type === 'color')}
                          value={draftSettings.dayOffTypeColumnId || ''}
                          onChange={(value) => updateDraft({ dayOffTypeColumnId: value })}
                          placeholder={t('settings.placeholder.statusColumn')}
                          isLoading={loadingDayOffColumns}
                        />
                        {getFieldError('dayOffTypeColumnId') && (
                          <p className="text-danger text-xs">{getFieldError('dayOffTypeColumnId')}</p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-medium text-text-secondary">{t('settings.availability.dayoff.fields.mandatory')}</label>
                        <p className="text-xs text-text-muted">{t('settings.availability.dayoff.fields.mandatoryHelp')}</p>
                        <SearchableSelect
                          options={dayOffColumns.filter(c => c.type === 'checkbox')}
                          value={draftSettings.dayOffMandatoryColumnId || ''}
                          onChange={(value) => updateDraft({ dayOffMandatoryColumnId: value })}
                          placeholder={t('settings.placeholder.checkboxColumn')}
                          isLoading={loadingDayOffColumns}
                        />
                        {getFieldError('dayOffMandatoryColumnId') && (
                          <p className="text-danger text-xs">{getFieldError('dayOffMandatoryColumnId')}</p>
                        )}
                      </div>

                      {/* Approval policy (decision D2) */}
                      <hr className="my-4 border-border-faint" />

                      <div className="space-y-4">
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            id="dayOffApprovalRequired"
                            checked={draftSettings.dayOffApprovalRequired || false}
                            onChange={(e) => updateDraft({ dayOffApprovalRequired: e.target.checked })}
                            className="w-5 h-5 rounded border-border-default text-accent focus:ring-accent"
                          />
                          <label htmlFor="dayOffApprovalRequired" className="text-sm font-semibold text-text-primary cursor-pointer">
                            {t('settings.availability.dayoff.fields.approvalRequired')}
                          </label>
                        </div>
                        <p className="text-xs text-text-muted">{t('settings.availability.dayoff.fields.approvalRequiredHelp')}</p>

                        {/* The approval column + rejected mapping are policy-INDEPENDENT
                            (DEV-2): rejected items are excluded even when the toggle is
                            OFF, so this panel is always available. Approved labels stay
                            relevant (and required) only under an active policy. */}
                        <div className="bg-accent-bg-soft p-4 rounded-lg border border-accent space-y-4">
                          <div className="space-y-2">
                            <label className="text-xs font-medium text-text-secondary">{t('settings.availability.dayoff.fields.approvalColumn')}</label>
                            <p className="text-xs text-text-muted">{t('settings.availability.dayoff.fields.approvalColumnHelp')}</p>
                            <SearchableSelect
                              options={dayOffColumns.filter(c => c.type === 'status' || c.type === 'color')}
                              value={draftSettings.dayOffApprovalColumnId || ''}
                              onChange={(value) => updateDraft({ dayOffApprovalColumnId: value, dayOffApprovedLabelIds: [], dayOffRejectedLabelIds: [] })}
                              placeholder={t('settings.placeholder.statusColumn')}
                              isLoading={loadingDayOffColumns}
                            />
                            {getFieldError('dayOffApprovalColumnId') && (
                              <p className="text-danger text-xs">{getFieldError('dayOffApprovalColumnId')}</p>
                            )}
                          </div>

                          {draftSettings.dayOffApprovalColumnId && draftSettings.dayOffApprovalRequired && (
                            <div className="space-y-2">
                              <label className="text-xs font-medium text-text-secondary">{t('settings.availability.dayoff.fields.approvedValues')}</label>
                              <p className="text-xs text-text-muted">{t('settings.availability.dayoff.fields.approvedValuesHelp')}</p>
                              <MultiSelect
                                options={dayOffApprovalLabels}
                                value={draftSettings.dayOffApprovedLabelIds || []}
                                onChange={(values) => updateDraft({ dayOffApprovedLabelIds: values })}
                                placeholder={t('settings.placeholder.approvedStatuses')}
                              />
                              {getFieldError('dayOffApprovedLabelIds') && (
                                <p className="text-danger text-xs">{getFieldError('dayOffApprovedLabelIds')}</p>
                              )}
                            </div>
                          )}

                          {draftSettings.dayOffApprovalColumnId && (
                            <div className="space-y-2">
                              <label className="text-xs font-medium text-text-secondary">{t('settings.availability.dayoff.fields.rejectedValues')}</label>
                              <p className="text-xs text-text-muted">{t('settings.availability.dayoff.fields.rejectedValuesHelp')}</p>
                              <MultiSelect
                                options={dayOffApprovalLabels}
                                value={draftSettings.dayOffRejectedLabelIds || []}
                                onChange={(values) => updateDraft({ dayOffRejectedLabelIds: values })}
                                placeholder={t('settings.placeholder.rejectedStatuses')}
                              />
                              {getFieldError('dayOffRejectedLabelIds') && (
                                <p className="text-danger text-xs">{getFieldError('dayOffRejectedLabelIds')}</p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </SettingsSection>

            </div>

            {/* General Tab */}
            <div data-tab-id="general">
              <SettingsSection
                id="general-settings"
                title={t('settings.general.title')}
                isOpen={openSections.general}
                onToggle={() => toggleSection('general')}
                hasErrors={hasGeneralErrors}
                description={t('settings.general.description')}
              >
                <div className="space-y-4">
                  {/* Language picker — gated by VITE_ENABLE_LANGUAGE_PICKER until Increment 9. */}
                  {isLanguagePickerEnabled() && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-text-secondary">
                        {t('settings.languagePicker.label')}
                      </label>
                      <SearchableSelect
                        options={[
                          { id: 'auto', name: t('settings.languagePicker.auto') },
                          { id: 'he', name: t('settings.languagePicker.he') },
                          { id: 'en', name: t('settings.languagePicker.en') },
                        ]}
                        value={draftSettings.languageOverride ?? 'auto'}
                        onChange={(value) => {
                          // 'auto' / '' → null (resolve from Monday context). 'he'/'en' → explicit override.
                          updateDraft({ languageOverride: value === 'auto' || value === '' ? null : (value as 'he' | 'en') });
                        }}
                      />
                    </div>
                  )}

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-text-secondary">{t('settings.general.workDayStart')}</label>
                    <input
                      type="time"
                      value={draftSettings.workDayStart}
                      onChange={(e) => updateDraft({ workDayStart: e.target.value })}
                      className="w-full h-[40px] px-3 border border-border-default rounded-[6px] text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                      dir={locale.dir}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-text-secondary">{t('settings.general.workDayEnd')}</label>
                    <input
                      type="time"
                      value={draftSettings.workDayEnd}
                      onChange={(e) => updateDraft({ workDayEnd: e.target.value })}
                      className="w-full h-[40px] px-3 border border-border-default rounded-[6px] text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                      dir={locale.dir}
                    />
                    {getFieldError('workHours') && (
                      <p className="text-danger text-xs">{getFieldError('workHours')}</p>
                    )}
                  </div>

                  <hr className="my-4 border-border-faint" />

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-text-secondary">{t('settings.general.defaultZoom')}</label>
                    <div className="flex gap-2">
                      {([
                        { value: 'day', labelKey: 'gantt.zoom.day' },
                        { value: 'week', labelKey: 'gantt.zoom.week' },
                        { value: 'month', labelKey: 'gantt.zoom.month' },
                        { value: 'quarter', labelKey: 'gantt.zoom.quarter' },
                      ] as const).map(opt => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => updateDraft({ defaultZoomLevel: opt.value })}
                          className={`flex-1 py-2 px-3 rounded-lg text-xs font-medium border transition-all ${
                            (draftSettings.defaultZoomLevel || 'month') === opt.value
                              ? 'bg-accent-bg-soft border-accent text-accent-text-strong'
                              : 'bg-bg-surface border-border-subtle text-text-muted hover:border-border-default'
                          }`}
                        >
                          {t(opt.labelKey)}
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] text-text-subtle italic">{t('settings.general.defaultZoomHelp')}</p>
                  </div>

                  <hr className="my-4 border-border-faint" />

                  {/* Display unit — applies live, persisted by useDisplayUnit's
                      own monday-storage flow (independent of the draft/save). */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-text-secondary">
                      {t('settings.general.displayUnit')}
                    </label>
                    <div className="flex gap-2">
                      {([
                        { value: 'hours', labelKey: 'gantt.toolbar.displayUnitHours' },
                        { value: 'percent', labelKey: 'gantt.toolbar.displayUnitPercent' },
                      ] as const).map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setDisplayUnit(opt.value)}
                          className={`flex-1 py-2 px-3 rounded-lg text-xs font-medium border transition-all ${
                            displayUnit === opt.value
                              ? 'bg-accent-bg-soft border-accent text-accent-text-strong'
                              : 'bg-bg-surface border-border-subtle text-text-muted hover:border-border-default'
                          }`}
                        >
                          {t(opt.labelKey)}
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] text-text-subtle italic">{t('settings.general.displayUnitHelp')}</p>
                  </div>

                  <hr className="my-4 border-border-faint" />

                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold text-text-primary">{t('settings.general.workHours.title')}</h3>
                      <button
                        onClick={handleSyncHours}
                        disabled={!lastChangedField}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                          !lastChangedField
                            ? 'text-text-faint cursor-not-allowed'
                            : 'text-accent hover:bg-accent-bg-soft bg-bg-surface border border-accent shadow-sm'
                        }`}
                        title={lastChangedField
                          ? t(
                              lastChangedField === 'day'
                                ? 'settings.general.workHours.syncDayBy'
                                : lastChangedField === 'week'
                                  ? 'settings.general.workHours.syncWeekBy'
                                  : 'settings.general.workHours.syncMonthBy'
                            )
                          : t('settings.general.workHours.syncDisabledTooltip')
                        }
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 2v6h-6"></path>
                          <path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path>
                          <path d="M3 22v-6h6"></path>
                          <path d="M21 12a9 9 0 0 1-15 6.7L3 16"></path>
                        </svg>
                        {t('settings.general.workHours.syncButton')}
                      </button>
                    </div>
                    
                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-text-muted">{t('settings.general.workHours.hoursPerDay')}</label>
                        <input
                          type="number"
                          step="0.1"
                          value={draftSettings.maxHoursPerDay}
                          onChange={(e) => {
                            updateDraft({ maxHoursPerDay: parseFloat(e.target.value) || 0 });
                            setLastChangedField('day');
                          }}
                          className={`w-full h-[40px] px-3 border rounded-[6px] text-xs focus:outline-none focus:ring-2 focus:ring-accent transition-colors ${lastChangedField === 'day' ? 'border-accent bg-accent-bg-soft' : 'border-border-default'}`}
                        />
                      </div>
                      
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-text-muted">{t('settings.general.workHours.hoursPerWeek')}</label>
                        <input
                          type="number"
                          step="0.1"
                          value={draftSettings.maxHoursPerWeek}
                          onChange={(e) => {
                            updateDraft({ maxHoursPerWeek: parseFloat(e.target.value) || 0 });
                            setLastChangedField('week');
                          }}
                          className={`w-full h-[40px] px-3 border rounded-[6px] text-xs focus:outline-none focus:ring-2 focus:ring-accent transition-colors ${lastChangedField === 'week' ? 'border-accent bg-accent-bg-soft' : 'border-border-default'}`}
                        />
                      </div>
                      
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-text-muted">{t('settings.general.workHours.hoursPerMonth')}</label>
                        <input
                          type="number"
                          step="0.1"
                          value={draftSettings.maxHoursPerMonth}
                          onChange={(e) => {
                            updateDraft({ maxHoursPerMonth: parseFloat(e.target.value) || 0 });
                            setLastChangedField('month');
                          }}
                          className={`w-full h-[40px] px-3 border rounded-[6px] text-xs focus:outline-none focus:ring-2 focus:ring-accent transition-colors ${lastChangedField === 'month' ? 'border-accent bg-accent-bg-soft' : 'border-border-default'}`}
                        />
                      </div>
                    </div>
                    <p className="text-[11px] text-text-subtle italic">{t('settings.general.workHours.help')}</p>
                  </div>

                  <hr className="my-4 border-border-faint" />

                  <div className="space-y-4">
                    <h3 className="text-sm font-bold text-text-primary">{t('settings.general.workDays.title')}</h3>
                    <div className="flex flex-wrap gap-3">
                      {[0, 1, 2, 3, 4, 5, 6].map((index) => (
                        <label 
                          key={index} 
                          className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all cursor-pointer ${
                            (draftSettings.workDays || []).includes(index)
                              ? 'bg-accent-bg-soft border-accent text-accent-text-strong'
                              : 'bg-bg-surface border-border-subtle text-text-muted hover:border-border-default'
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="hidden"
                            checked={(draftSettings.workDays || []).includes(index)}
                            onChange={() => toggleWorkDay(index)}
                          />
                          <span className="text-xs font-medium">{t(`settings.general.workDays.day${index}`)}</span>
                        </label>
                      ))}
                    </div>
                    <p className="text-[11px] text-text-subtle italic">{t('settings.general.workDays.help')}</p>
                  </div>
                </div>
              </SettingsSection>
            </div>
          </SettingsTabs>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border-subtle flex justify-between items-center" dir={locale.dir}>
          <div className="text-xs text-text-muted">
            {isValid ? (
              <span className={isDirty ? "text-accent font-medium" : "text-success"}>
                {isDirty ? t('settings.footer.dirty') : t('settings.footer.allValid')}
              </span>
            ) : (
              <span className="text-warning-text flex items-center gap-1.5">
                <span className="w-2 h-2 bg-danger rounded-full" />
                {t('settings.footer.missingFields')}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleRequestClose}
              className="px-4 py-2 text-sm font-medium text-text-secondary bg-bg-hover rounded-[6px] hover:bg-bg-emphasis transition-colors"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={handleSave}
              disabled={!isDirty}
              className={`px-4 py-2 text-sm font-medium rounded-[6px] transition-colors ${
                isDirty
                  ? 'bg-accent text-white hover:bg-accent-hover shadow-md'
                  : 'bg-bg-hover text-text-subtle cursor-not-allowed'
              }`}
            >
              {t('settings.dialog.saveButton')}
            </button>
          </div>
        </div>

        {/* Version */}
        <p className="px-6 pb-3 text-xs text-text-muted text-center" dir="ltr">
          {versionLabel}
        </p>
      </div>

      {/* Backdrop */}
      <div
        className="absolute inset-0 -z-10"
        onClick={handleRequestClose}
      />

      {/* JSON View Overlay */}
      {showJsonView && (
        <div className="absolute inset-0 z-[110] flex items-center justify-center p-8 animate-in fade-in duration-200">
          <div 
            className="absolute inset-0 bg-code-overlay backdrop-blur-sm"
            onClick={() => setShowJsonView(false)}
          />
          <div className="relative bg-code-bg rounded-xl shadow-2xl w-full max-w-2xl max-h-full flex flex-col overflow-hidden border border-code-border">
            <div className="px-6 py-4 border-b border-code-border flex justify-between items-center bg-code-surface">
              <h3 className="text-code-text font-bold text-sm">{t('settings.dialog.showJsonTitle')}</h3>
              <div className="flex gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/json,.json"
                  onChange={handleImportFileChange}
                  className="hidden"
                />
                <button
                  onClick={handleImportClick}
                  className="px-3 py-1.5 bg-code-row hover:bg-code-row-alt text-code-text rounded text-xs transition-colors"
                >
                  {t('settings.dialog.importLabel')}
                </button>
                <button
                  onClick={handleExportSettings}
                  className="px-3 py-1.5 bg-code-row hover:bg-code-row-alt text-code-text rounded text-xs transition-colors"
                >
                  {t('settings.dialog.exportLabel')}
                </button>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(JSON.stringify(draftSettings, null, 2));
                  }}
                  className="px-3 py-1.5 bg-code-row hover:bg-code-row-alt text-code-text rounded text-xs transition-colors"
                >
                  {t('settings.dialog.copyJson')}
                </button>
                <button
                  onClick={() => setShowJsonView(false)}
                  className="p-1 text-code-text-muted hover:text-white transition-colors"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>
            </div>
            <div className="p-6 overflow-auto bg-surface-code flex-1">
              <pre className="text-code-accent font-mono text-xs leading-relaxed whitespace-pre-wrap">
                {JSON.stringify(draftSettings, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};