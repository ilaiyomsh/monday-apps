import React, { useState, useEffect, useMemo, useCallback } from 'react';
import type { Task, ViewMode, Employee, Group } from '../../types/gantt.types';
import type { Allocation } from '../../types/entities/allocation.types';
import { format, parseISO, addDays, differenceInDays, startOfDay, endOfDay } from 'date-fns';
import { toMondayDateTimeString } from '../../utils/dateTimeHelpers';
import { useTranslation } from 'react-i18next';
import { mondayService } from '../../services/mondayService';
import { DatePickerInput } from './DatePickerInput';
import { useSettings } from '../../contexts/SettingsContext';
import { countWorkingDays, isWorkingDay } from '../../utils/workDaysUtils';
import { useOverlapValidation } from '../../hooks/useOverlapValidation';
import { useGantt } from '../../hooks/useGantt';
import { useLocale } from '../../hooks/useLocale';
import { logger } from '../../utils/Logger';
import { SearchableSelect, type SearchableSelectOption } from '../Settings/SearchableSelect';
import { Check, Delete, Duplicate } from '@vibe/icons';

interface AllocationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (task: any) => Promise<void> | void;
  onDelete?: (id: string | number) => void;
  onDuplicate?: (task: Task, newStartDate: string, newEndDate: string) => void;
  initialData?: Partial<Task>;
  groupNames: string[]; // These are projects in project view, employees in employee view
  viewMode: ViewMode;
  allProjects?: Group[];
  employees?: Employee[];
  availableRoles?: {id: string, name: string}[];
  allAllocations?: Allocation[];
  onSwitchToBulk?: (projectId: string, projectName: string) => void;
}

export const AllocationModal: React.FC<AllocationModalProps> = ({
  isOpen,
  onClose,
  onSave,
  onDelete,
  onDuplicate,
  initialData,
  viewMode,
  allProjects = [],
  employees = [],
  availableRoles = [],
  allAllocations = [],
  onSwitchToBulk,
}) => {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const { showToast, holidaysByDate } = useGantt();
  const locale = useLocale();
  const workDays = settings?.workDays || [0, 1, 2, 3, 4];
  const dailyStandard = settings?.maxHoursPerDay || 8.5;

  const [allocationType, setAllocationType] = useState<'effort' | 'total' | 'percentage'>('percentage');
  const [isSaving, setIsSaving] = useState(false);

  // Selected capability for filtering employees (not saved to allocations board)
  const [selectedCapability, setSelectedCapability] = useState<string>('');

  // Duplicate flow state
  const [showDuplicateChoice, setShowDuplicateChoice] = useState(false);
  const [duplicateSourceTask, setDuplicateSourceTask] = useState<Partial<Task> | null>(null);

  // Default 20% allocation: hoursPerDay will be calculated from dailyStandard in useEffect
  const [formData, setFormData] = useState<Partial<Task>>({
    groupId: '',
    role: '',
    userName: '',
    name: '',
    startDate: toMondayDateTimeString(new Date()),
    endDate: toMondayDateTimeString(addDays(new Date(), 4)),
    hoursPerDay: 0,
    totalHours: 0,
  });

  // Calculate working days between dates
  const daysCount = useMemo(() => {
    if (!formData.startDate || !formData.endDate) return 1;
    try {
      const start = parseISO(formData.startDate as string);
      const end = parseISO(formData.endDate as string);
      return Math.max(1, countWorkingDays(start, end, workDays, holidaysByDate));
    } catch (e) {
      return 1;
    }
  }, [formData.startDate, formData.endDate, workDays, holidaysByDate]);

  // Determine effective employeeId and projectId for overlap validation
  // In employee view: groupId is the employee, projectId is selected in dropdown
  // In project view: groupId is the project, employeeId comes from employee dropdown
  const effectiveEmployeeId = useMemo(() => {
    if (viewMode === 'employees') {
      // In employee view, the group IS the employee
      const groupIdStr = formData.groupId?.toString();
      return groupIdStr || formData.employeeId;
    }
    // In project view, employeeId comes from employee dropdown
    return formData.employeeId;
  }, [viewMode, formData.groupId, formData.employeeId]);

  const effectiveProjectId = useMemo(() => {
    if (viewMode === 'projects') {
      // In project view, the group IS the project
      const groupIdStr = formData.groupId?.toString();
      return groupIdStr || formData.projectId?.toString();
    }
    // In employee view, projectId comes from the dropdown selection
    return formData.projectId?.toString();
  }, [viewMode, formData.groupId, formData.projectId]);

  // Overlap validation
  const overlapCheck = useOverlapValidation(
    effectiveEmployeeId,
    effectiveProjectId,
    formData.startDate as string | undefined,
    formData.endDate as string | undefined,
    allAllocations,
    initialData?.id
  );

  // Calculate employee availability for the selected date range
  // Returns average daily load percentage for an employee during the selected period
  const calculateEmployeeAvailability = useCallback((employeeId: string): number => {
    if (!formData.startDate || !formData.endDate) return 0;

    const rangeStart = startOfDay(parseISO(formData.startDate as string));
    const rangeEnd = endOfDay(parseISO(formData.endDate as string));

    // Get all allocations for this employee that overlap with our date range
    const employeeAllocations = allAllocations.filter(a => {
      if (a.employeeId !== employeeId) return false;
      // Exclude current allocation being edited
      if (initialData?.id && a.id === initialData.id) return false;

      const allocStart = startOfDay(parseISO(a.startDate));
      const allocEnd = endOfDay(parseISO(a.endDate));

      // Check for overlap
      return allocStart <= rangeEnd && allocEnd >= rangeStart;
    });

    if (employeeAllocations.length === 0) return 0;

    // Calculate total hours allocated per day in the range
    let totalHours = 0;
    let workingDaysCount = 0;

    const current = new Date(rangeStart);
    while (current <= rangeEnd) {
      if (isWorkingDay(current, workDays)) {
        workingDaysCount++;
        const dateKey = format(current, 'yyyy-MM-dd');

        // Sum hours from all allocations that cover this day
        employeeAllocations.forEach(a => {
          const allocStart = startOfDay(parseISO(a.startDate));
          const allocEnd = endOfDay(parseISO(a.endDate));

          if (current >= allocStart && current <= allocEnd) {
            totalHours += a.hoursPerDay || 0;
          }
        });
      }
      current.setDate(current.getDate() + 1);
    }

    if (workingDaysCount === 0) return 0;

    // Calculate average daily load as percentage of daily standard
    const avgDailyHours = totalHours / workingDaysCount;
    return Math.round((avgDailyHours / dailyStandard) * 100);
  }, [formData.startDate, formData.endDate, allAllocations, initialData?.id, workDays, dailyStandard]);

  // Build project options with SearchableSelect format
  const projectOptions: SearchableSelectOption[] = useMemo(() => {
    return allProjects.map(p => ({
      id: p.id.toString(),
      name: p.name
    }));
  }, [allProjects]);

  // Build capability options from all employees' capabilities (union of all capabilities)
  // This shows what employees CAN do, used for filtering
  const capabilityOptions: SearchableSelectOption[] = useMemo(() => {
    const allCaps = new Set<string>();
    employees.forEach(emp => {
      emp.capabilities?.forEach(cap => allCaps.add(cap));
    });
    // If no capabilities found, fall back to availableRoles
    if (allCaps.size === 0) {
      return availableRoles.map(r => ({
        id: r.id,
        name: r.name
      }));
    }
    return Array.from(allCaps).map(cap => ({ id: cap, name: cap }));
  }, [employees, availableRoles]);

  // Build employee options with availability data and official role display
  const allocationPercentage = Math.round(((formData.hoursPerDay || 0) / dailyStandard) * 100);
  const employeeOptionsWithAvailability: SearchableSelectOption[] = useMemo(() => {
    return employees.map(emp => {
      const availability = calculateEmployeeAvailability(emp.id);
      const projected = availability + allocationPercentage;
      // Show official role in parentheses: "Name (Official Role)"
      const displayName = emp.role ? `${emp.name} (${emp.role})` : emp.name;
      return {
        id: emp.id,
        name: displayName,
        meta: {
          availability,
          projected,
          color: projected > 100 ? 'var(--color-danger)' : projected > 80 ? 'var(--color-warning)' : 'var(--color-success)',
          originalName: emp.name,
          officialRole: emp.role,
        }
      };
    });
  }, [employees, calculateEmployeeAvailability, allocationPercentage]);

  // Derived percentage from totalHours (the "king") to avoid rounding drift
  const derivedPercentage = useMemo(() => {
    const total = formData.totalHours || 0;
    if (daysCount === 0) return 0;
    const hpd = total / daysCount;
    return Math.round((hpd / dailyStandard) * 100);
  }, [formData.totalHours, daysCount, dailyStandard]);

  // Round to 1 decimal place - totalHours is the "king"
  const roundTo1 = (n: number) => Math.round(n * 10) / 10;

  // Helper to calculate derived values without creating a loop.
  // For 'percentage' mode, callers attach the new percentage as `ftePercentage`
  // so syncValues can convert it back to totalHours (the source of truth).
  type FormShape = Partial<Task> & { ftePercentage?: number };
  const syncValues = (data: FormShape, type: 'effort' | 'total' | 'percentage', days: number): Partial<Task> => {
    const updated: FormShape = { ...data };
    if (type === 'effort') {
      // User edited hoursPerDay -> calculate totalHours
      const total = days * (updated.hoursPerDay || 0);
      updated.totalHours = roundTo1(total);
    } else if (type === 'total') {
      // User edited totalHours -> derive hoursPerDay (totalHours is king)
      const effort = (updated.totalHours || 0) / days;
      updated.hoursPerDay = roundTo1(effort);
    } else if (type === 'percentage') {
      // Convert percentage to totalHours first (king), then derive hoursPerDay
      const pct = updated.ftePercentage || 0;
      const exactHoursPerDay = (pct / 100) * dailyStandard;
      const totalHours = exactHoursPerDay * days;
      updated.totalHours = roundTo1(totalHours);
      // Derive hoursPerDay back from rounded totalHours to stay consistent
      updated.hoursPerDay = roundTo1(updated.totalHours / days);
    }
    return updated;
  };

  // Reset form data when modal opens
  useEffect(() => {
    if (isOpen) {
      // Check if this is a duplicate source request (from context menu or duplicate button)
      if (initialData?._duplicateSource) {
        const sourceData = { ...initialData };
        delete sourceData._duplicateSource;
        setDuplicateSourceTask(sourceData);
        setShowDuplicateChoice(true);
        return;
      }

      // Reset duplicate state
      setShowDuplicateChoice(false);
      setDuplicateSourceTask(null);

      // Use empty object if initialData is undefined
      const data = initialData || {};
      const isNew = !data.id;

      // For existing allocations, try to find the employee's capability
      // For new allocations, reset to empty
      if (isNew) {
        setSelectedCapability('');
      } else {
        // Try to find the employee and use one of their capabilities
        const employeeId = data.employeeId;
        const employee = employees.find(e => e.id === employeeId || e.userId === employeeId);
        if (employee && employee.capabilities && employee.capabilities.length > 0) {
          // Prefer a capability that matches the saved role, otherwise use first capability
          const matchingCap = employee.capabilities.find(cap => cap === data.role);
          setSelectedCapability(matchingCap || employee.capabilities[0]);
        } else {
          // Fallback to saved role
          setSelectedCapability(data.role || '');
        }
      }

      // Default for new allocations: 20% FTE (round to 1 decimal)
      const defaultHoursPerDay = roundTo1(0.20 * dailyStandard);

      let nextData: Partial<Task> = {
        groupId: '',
        role: '',
        userName: '',
        name: '',
        startDate: toMondayDateTimeString(new Date()),
        endDate: toMondayDateTimeString(addDays(new Date(), 4)),
        totalHours: 0, // Will be calculated by syncValues
        ...data,
        // Apply default hoursPerDay AFTER spread for new allocations
        hoursPerDay: isNew ? defaultHoursPerDay : (data.hoursPerDay || 0),
      };

      // Calculate working days for initial sync
      const start = parseISO(nextData.startDate as string);
      const end = parseISO(nextData.endDate as string);
      const initialDays = Math.max(1, countWorkingDays(start, end, workDays, holidaysByDate));

      // Decide which mode to display
      // Default to total hours mode for both new and edit
      let displayType: 'effort' | 'total' | 'percentage' = 'total';

      // For existing allocations, preserve stored values to avoid rounding drift
      // Don't recalculate - just use what was saved
      let syncMode: 'effort' | 'total' | null = null;
      if (!isNew && (data.totalHours || 0) > 0 && (data.hoursPerDay || 0) > 0) {
        // Both values exist - don't sync, preserve original values
        syncMode = null;
      } else if (!isNew && (data.totalHours || 0) > 0) {
        // Only totalHours exists - calculate hoursPerDay from it
        syncMode = 'total';
      } else if (!isNew && (data.hoursPerDay || 0) > 0) {
        // Only hoursPerDay exists - calculate totalHours from it
        syncMode = 'effort';
      } else if (isNew) {
        // New allocation - calculate totalHours from default hoursPerDay (20% FTE)
        // Display mode is 'total', but we sync from hoursPerDay to totalHours
        syncMode = 'effort';
      }

      // Projects view specific logic - set projectId and projectName from groupId
      if (viewMode === 'projects') {
        if (!nextData.projectId && nextData.groupId) {
          nextData.projectId = nextData.groupId;
        }
        if (nextData.projectId && !nextData.projectName) {
          const project = allProjects.find(p => p.id === nextData.projectId || p.id === nextData.projectId?.toString());
          if (project) {
            nextData.projectName = project.name;
          }
        }
      }

      // Employee view specific logic
      if (viewMode === 'employees') {
        if (!nextData.employeeId && nextData.groupId) {
          nextData.employeeId = nextData.groupId as string;
        }
        if (nextData.employeeId) {
          const emp = employees.find(e => e.id === nextData.employeeId);
          if (emp) {
            nextData.userName = nextData.userName || emp.name;
            nextData.role = nextData.role || emp.role;
          }
        }
      }

      setAllocationType(displayType);
      // Apply sync only if needed - preserve original values when both exist
      if (syncMode) {
        setFormData(syncValues(nextData, syncMode, initialDays));
      } else {
        // Both values exist - use stored values directly without recalculating
        setFormData(nextData);
      }
    }
  }, [isOpen, initialData, viewMode, employees, allProjects, dailyStandard, workDays]);

  const handleStartDateChange = (date: Date | undefined) => {
    if (!date) return;

    const newStart = toMondayDateTimeString(date);
    let newEnd = formData.endDate as string;

    // If start > end, adjust end to match start
    if (date > parseISO(formData.endDate as string)) {
      newEnd = newStart;
    }

    const newDays = Math.max(1, countWorkingDays(parseISO(newStart), parseISO(newEnd), workDays, holidaysByDate));
    setFormData(prev => {
      const next = { ...prev, startDate: newStart, endDate: newEnd };
      return syncValues(next, allocationType, newDays);
    });
  };

  const handleEndDateChange = (date: Date | undefined) => {
    if (!date) return;

    const newEnd = toMondayDateTimeString(date);
    let newStart = formData.startDate as string;

    // If end < start, adjust start to match end
    if (date < parseISO(formData.startDate as string)) {
      newStart = newEnd;
    }

    const newDays = Math.max(1, countWorkingDays(parseISO(newStart), parseISO(newEnd), workDays, holidaysByDate));
    setFormData(prev => {
      const next = { ...prev, startDate: newStart, endDate: newEnd };
      return syncValues(next, allocationType, newDays);
    });
  };


  // Handle duplicate choice: same employee or other employee
  const handleDuplicateChoice = useCallback((mode: 'same' | 'other') => {
    if (!duplicateSourceTask) return;

    setShowDuplicateChoice(false);

    const source = duplicateSourceTask;
    const sourceStart = parseISO(source.startDate as string);
    const sourceEnd = parseISO(source.endDate as string);
    const durationDays = differenceInDays(sourceEnd, sourceStart);

    let newData: Partial<Task>;

    if (mode === 'same') {
      // Same employee: start right after original ends, same duration
      const newStart = addDays(sourceEnd, 1);
      const newEnd = addDays(newStart, durationDays);
      newData = {
        ...source,
        id: undefined,
        name: '',
        reportedHours: 0, // New allocation — no reported hours yet
        startDate: toMondayDateTimeString(newStart),
        endDate: toMondayDateTimeString(newEnd),
      };
    } else {
      // Other employee: same dates, clear employee fields
      newData = {
        ...source,
        id: undefined,
        name: '',
        reportedHours: 0, // New allocation — no reported hours yet
        employeeId: '',
        userName: '',
        userInitials: '',
        role: '',
      };
    }

    // Set the form data by simulating a fresh modal open with this data
    // We need to go through the normal initialization flow
    const isNew = true;
    const data = newData;

    // Find employee capability if mode is 'same'
    if (mode === 'same' && data.employeeId) {
      const employee = employees.find(e => e.id === data.employeeId || e.userId === data.employeeId);
      if (employee?.capabilities?.length) {
        const matchingCap = employee.capabilities.find(cap => cap === data.role);
        setSelectedCapability(matchingCap || employee.capabilities[0]);
      } else {
        setSelectedCapability(data.role || '');
      }
    } else {
      setSelectedCapability('');
    }

    // Set up form data
    const start = parseISO(data.startDate as string);
    const end = parseISO(data.endDate as string);
    const initialDays = Math.max(1, countWorkingDays(start, end, workDays, holidaysByDate));

    // Projects view: ensure projectId is set
    if (viewMode === 'projects') {
      if (!data.projectId && data.groupId) data.projectId = data.groupId;
      if (data.projectId && !data.projectName) {
        const project = allProjects.find(p => p.id === data.projectId || p.id === data.projectId?.toString());
        if (project) data.projectName = project.name;
      }
    }

    // Employee view: ensure employeeId is set
    if (viewMode === 'employees') {
      if (!data.employeeId && data.groupId) data.employeeId = data.groupId as string;
      if (data.employeeId) {
        const emp = employees.find(e => e.id === data.employeeId);
        if (emp) {
          data.userName = data.userName || emp.name;
          data.role = data.role || emp.role;
        }
      }
    }

    setAllocationType('total');
    if ((data.totalHours || 0) > 0 && (data.hoursPerDay || 0) > 0) {
      // Both values exist — preserve totalHours as source of truth,
      // derive hoursPerDay from it to avoid rounding drift
      setFormData(syncValues(data, 'total', initialDays));
    } else if ((data.hoursPerDay || 0) > 0) {
      setFormData(syncValues(data, 'effort', initialDays));
    } else {
      setFormData(data);
    }

    setDuplicateSourceTask(null);
  }, [duplicateSourceTask, employees, viewMode, allProjects, workDays]);

  // Compute default name based on project and capability
  // Format: "Project - Capability" (or just project if capability is missing)
  const defaultName = useMemo(() => {
    let projectName = formData.projectName;

    // In projects view, get project name from groupId if not directly set
    if (viewMode === 'projects' && !projectName && formData.groupId) {
      const project = allProjects.find(p => p.id === formData.groupId);
      projectName = project?.name;
    }

    const capability = selectedCapability || '';

    if (projectName && capability) {
      return `${projectName} - ${capability}`;
    }
    if (projectName) {
      return projectName;
    }
    return '';
  }, [formData.projectName, formData.groupId, viewMode, allProjects, selectedCapability]);

  // Form submission with validation
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validation
    if (viewMode === 'employees' && (!formData.projectId || formData.projectId === 'Unassigned')) {
      showToast(t('allocation.toast.projectRequired'), 'error');
      return;
    }
    if (viewMode === 'projects' && !formData.employeeId) {
      showToast(t('allocation.toast.employeeRequired'), 'error');
      return;
    }

    // Block if overlap detected
    if (overlapCheck.hasOverlap) {
      showToast(t('allocation.toast.overlapBlock'), 'error');
      return;
    }

    // Include FTE percentage and capability in saved data
    setIsSaving(true);
    try {
      await onSave({
        ...formData,
        name: formData.name || defaultName || '',
        ftePercentage: derivedPercentage,
        capability: selectedCapability || undefined,
      });
      onClose();
    } catch (err) {
      logger.error('Failed to save allocation:', err);
      showToast(t('allocation.toast.saveError'), 'error');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[var(--z-layer-1)] flex items-center justify-center bg-transparent pointer-events-auto">
      <div className="bg-bg-surface rounded-xl shadow-2xl w-[var(--w-modal-sm)] animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()} dir={locale.dir}>
        {/* Header */}
        <div className="px-4 py-2.5 flex items-center justify-between border-b border-border-faint">
          {/* Mode toggle - only for new allocations in projects view */}
          {viewMode === 'projects' && !initialData?.id && onSwitchToBulk ? (
            <div className="flex items-center gap-1 bg-bg-section p-0.5 rounded-lg w-fit mx-auto">
              <button
                type="button"
                className="px-3 py-1 text-xs font-bold rounded-md bg-bg-surface shadow-sm text-accent"
              >
                {t('allocation.mode.single')}
              </button>
              <button
                type="button"
                onClick={() => {
                  const projectId = (formData.projectId || formData.groupId || '').toString();
                  const projectName = formData.projectName || '';
                  onSwitchToBulk(projectId, projectName);
                }}
                className="px-3 py-1 text-xs font-bold rounded-md text-text-muted hover:text-text-secondary"
              >
                {t('allocation.mode.bulk')}
              </button>
            </div>
          ) : <div />}
          <button onClick={onClose} className="text-text-subtle hover:text-text-muted p-1 rounded-md hover:bg-bg-hover transition-all duration-150 hover:scale-105">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Stats bar - shown when editing an existing allocation with reported hours */}
        {initialData?.id && initialData.totalHours != null && initialData.totalHours > 0 && (
          <div className="px-4 py-2.5 bg-bg-app border-b border-border-faint flex items-center justify-around gap-3 text-center">
            <div>
              <div className="text-xs text-text-subtle font-medium">{t('allocation.stats.plannedTotal')}</div>
              <div className="text-sm font-bold text-text-secondary">{initialData.totalHours.toFixed(1)} {t('allocation.stats.hoursShort')}</div>
            </div>
            <div className="w-px h-8 bg-bg-emphasis" />
            <div>
              <div className="text-xs text-text-subtle font-medium">{t('allocation.stats.actualTotal')}</div>
              <div className="text-sm font-bold text-text-secondary">{(formData.reportedHours ?? 0).toFixed(1)} {t('allocation.stats.hoursShort')}</div>
            </div>
            <div className="w-px h-8 bg-bg-emphasis" />
            <div>
              <div className="text-xs text-text-subtle font-medium">{t('allocation.stats.actualPercent')}</div>
              <div className={`text-sm font-bold ${
                ((formData.reportedHours ?? 0) / initialData.totalHours) * 100 > 100 ? 'text-danger' : 'text-text-secondary'
              }`}>
                {Math.round(((formData.reportedHours ?? 0) / initialData.totalHours) * 100)}%
              </div>
            </div>
          </div>
        )}

        <form className="p-4 space-y-3" onSubmit={handleSubmit}>
          {/* Project Dropdown (Employee View) */}
          {viewMode === 'employees' && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-text-muted">{t('allocation.fields.project')} *</label>
              <SearchableSelect
                compact
                options={projectOptions}
                value={formData.projectId?.toString() || ''}
                onChange={(projectId) => {
                  const project = allProjects.find(p => p.id.toString() === projectId);
                  if (project) {
                    setFormData(prev => ({ ...prev, projectId: project.id, projectName: project.name }));
                  }
                }}
                placeholder={t('allocation.placeholder.project')}
              />
            </div>
          )}

          {/* Capability + Employee stacked in projects view */}
          {viewMode === 'projects' ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-sm font-medium text-text-muted">{t('allocation.fields.capability')}</label>
                <SearchableSelect
                  compact
                  options={capabilityOptions}
                  value={capabilityOptions.find(c => c.name === selectedCapability)?.id || ''}
                  onChange={(capabilityId) => {
                    const capability = capabilityOptions.find(c => c.id === capabilityId);
                    if (capability && capability.name) {
                      setSelectedCapability(capability.name);
                      setFormData(prev => ({ ...prev, employeeId: '', userName: '', userInitials: '' }));
                    }
                  }}
                  placeholder={t('allocation.placeholder.capability')}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-text-muted">{t('allocation.fields.employee')}</label>
              <SearchableSelect
                compact
                options={employeeOptionsWithAvailability.filter(emp => {
                  // Filter by capability if one is selected
                  if (!selectedCapability) return true;
                  const employee = employees.find(e => e.id === emp.id);
                  // Check if employee has the selected capability in their capabilities array
                  return employee?.capabilities?.includes(selectedCapability);
                })}
                value={formData.employeeId || ''}
                onChange={(employeeId) => {
                  const employee = employees.find(e => e.id === employeeId);
                  if (employee) {
                    setFormData(prev => ({
                      ...prev,
                      employeeId: employee.userId || employee.id,
                      userName: employee.name,
                      userInitials: employee.name.split(' ').map(n => n[0]).join('').toUpperCase(),
                      // Auto-set role to employee's official role
                      role: employee.role
                    }));
                  }
                }}
                placeholder={t('allocation.placeholder.employee')}
                disabled={formData.reportedHours != null && formData.reportedHours > 0}
                renderOption={(option, isSelected) => (
                  <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-2">
                      {isSelected && (
                        <svg className="w-4 h-4 text-accent" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                      <span className={isSelected ? 'font-bold' : ''}>{option.name}</span>
                    </div>
                    {option.meta?.availability !== undefined && (
                      <span
                        className="text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
                        style={{
                          backgroundColor: `color-mix(in srgb, ${option.meta.color || 'var(--color-success)'} 12%, transparent)`,
                          color: option.meta.color || 'var(--color-success)'
                        }}
                      >
                        {option.meta.availability}%{option.meta.projected !== undefined && (
                          <span className="opacity-60"> ← </span>
                        )}{option.meta.projected !== undefined && (
                          <span>{option.meta.projected}%</span>
                        )}
                      </span>
                    )}
                  </div>
                )}
              />
              {formData.reportedHours != null && formData.reportedHours > 0 && (
                <p className="text-xs text-warning-text">{t('allocation.warning.cannotSwapEmployeeWithReported')}</p>
              )}
            </div>
          </div>
          ) : (
            /* Capability Dropdown - employee view only */
            <div className="space-y-2">
              <label className="text-sm font-medium text-text-muted">{t('allocation.fields.capability')}</label>
              <SearchableSelect
                compact
                options={capabilityOptions}
                value={capabilityOptions.find(c => c.name === selectedCapability)?.id || ''}
                onChange={(capabilityId) => {
                  const capability = capabilityOptions.find(c => c.id === capabilityId);
                  if (capability && capability.name) {
                    setSelectedCapability(capability.name);
                  }
                }}
                placeholder={t('allocation.placeholder.capability')}
              />
            </div>
          )}

          {/* Effort Inputs - Horizontal 3-column Layout */}
          <div className="grid grid-cols-3 gap-3 mx-auto">
            {/* Hours/Day Column */}
            <div className="space-y-1">
              <label
                className="flex items-center gap-2 cursor-pointer"
                onClick={() => {
                  setAllocationType('effort');
                  setFormData(prev => syncValues(prev, 'effort', daysCount));
                }}
              >
                <input type="radio" className="sr-only" checked={allocationType === 'effort'} readOnly />
                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${allocationType === 'effort' ? 'border-accent bg-accent' : 'border-border-default'}`}>
                  {allocationType === 'effort' && <div className="w-1.5 h-1.5 rounded-full bg-bg-surface"/>}
                </div>
                <span className="text-sm font-medium text-text-muted">{t('allocation.fields.hoursPerDay')}</span>
              </label>
              <input
                type="number"
                step="0.1"
                value={formData.hoursPerDay || 0}
                disabled={allocationType !== 'effort'}
                onChange={e => {
                  const val = parseFloat(e.target.value) || 0;
                  setFormData(prev => syncValues({ ...prev, hoursPerDay: val }, 'effort', daysCount));
                }}
                className={`w-full h-9 px-3 border rounded-md text-center text-sm font-medium transition-colors ${
                  allocationType === 'effort'
                    ? 'border-accent bg-bg-surface text-text-primary'
                    : 'bg-bg-section text-text-subtle border-border-subtle cursor-not-allowed'
                }`}
              />
            </div>

            {/* Total Hours Column */}
            <div className="space-y-1">
              <label
                className="flex items-center gap-2 cursor-pointer"
                onClick={() => {
                  setAllocationType('total');
                  setFormData(prev => syncValues(prev, 'total', daysCount));
                }}
              >
                <input type="radio" className="sr-only" checked={allocationType === 'total'} readOnly />
                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${allocationType === 'total' ? 'border-accent bg-accent' : 'border-border-default'}`}>
                  {allocationType === 'total' && <div className="w-1.5 h-1.5 rounded-full bg-bg-surface"/>}
                </div>
                <span className="text-sm font-medium text-text-muted">{t('allocation.fields.totalHours')}</span>
              </label>
              <input
                type="number"
                step="0.5"
                value={formData.totalHours || 0}
                disabled={allocationType !== 'total'}
                onChange={e => {
                  const val = parseFloat(e.target.value) || 0;
                  setFormData(prev => syncValues({ ...prev, totalHours: val }, 'total', daysCount));
                }}
                className={`w-full h-9 px-3 border rounded-md text-center text-sm font-medium transition-colors ${
                  allocationType === 'total'
                    ? 'border-accent bg-bg-surface text-text-primary'
                    : 'bg-bg-section text-text-subtle border-border-subtle cursor-not-allowed'
                }`}
              />
            </div>

            {/* FTE % Column */}
            <div className="space-y-1">
              <label
                className="flex items-center gap-2 cursor-pointer"
                onClick={() => {
                  setAllocationType('percentage');
                }}
              >
                <input type="radio" className="sr-only" checked={allocationType === 'percentage'} readOnly />
                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${allocationType === 'percentage' ? 'border-accent bg-accent' : 'border-border-default'}`}>
                  {allocationType === 'percentage' && <div className="w-1.5 h-1.5 rounded-full bg-bg-surface"/>}
                </div>
                <span className="text-sm font-medium text-text-muted">{t('allocation.fields.fte')}</span>
              </label>
              <input
                type="number"
                step="5"
                min="0"
                value={derivedPercentage}
                disabled={allocationType !== 'percentage'}
                onChange={e => {
                  // No upper limit - allow overtime (>100%)
                  const val = Math.max(0, parseFloat(e.target.value) || 0);
                  // Pass percentage via ftePercentage field for syncValues to use
                  setFormData(prev => syncValues({ ...prev, ftePercentage: val }, 'percentage', daysCount));
                }}
                className={`w-full h-9 px-3 border rounded-md text-center text-sm font-medium transition-colors ${
                  allocationType === 'percentage'
                    ? 'border-accent bg-bg-surface text-text-primary'
                    : 'bg-bg-section text-text-subtle border-border-subtle cursor-not-allowed'
                }`}
              />
            </div>
          </div>

          {/* Date Inputs — always laid out start→end left-to-right, matching
              the gantt timeline direction (drag goes L→R) regardless of locale. */}
          <div className="space-y-1.5">
            <div className="flex items-end gap-3 justify-center" dir="ltr">
              <div className="flex-1">
                <DatePickerInput
                  label={t('allocation.fields.startDate')}
                  date={formData.startDate ? parseISO(formData.startDate as string) : undefined}
                  onDateChange={handleStartDateChange}
                />
              </div>
              <div className="flex items-center h-[var(--h-input)] text-text-faint text-2xl">→</div>
              <div className="flex-1">
                <DatePickerInput
                  label={t('allocation.fields.endDate')}
                  date={formData.endDate ? parseISO(formData.endDate as string) : undefined}
                  onDateChange={handleEndDateChange}
                />
              </div>
            </div>
            <div className="text-end">
              <span className="text-xs text-text-subtle">{t('allocation.workingDays', { count: daysCount })}</span>
            </div>
          </div>

          {/* Overlap Warning */}
          {overlapCheck.hasOverlap && (
            <div className="p-3 bg-warning-soft border border-warning-border rounded-lg flex items-start gap-2">
              <svg className="w-5 h-5 text-warning-text flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <div className="text-warning-text">
                <span className="font-bold">{t('allocation.warning.overlapTitle')}</span>
                <p className="text-xs mt-1">{t('allocation.warning.overlapBody')}</p>
              </div>
            </div>
          )}

          {/* Actions — unified: same color, same size */}
          <div className="pt-2 flex gap-2 justify-end">
            {initialData?.id && onDelete && (
              <button
                type="button"
                onClick={() => {
                  onDelete(initialData.id!);
                  onClose();
                }}
                className="px-3 py-1.5 rounded-md text-xs font-bold flex items-center justify-center gap-1.5 bg-transparent text-text-primary hover:bg-bg-hover transition-all duration-150"
              >
                <Delete className="w-3.5 h-3.5" />
                {t('allocation.button.delete')}
              </button>
            )}
            {initialData?.id && (
              <button
                type="button"
                onClick={() => {
                  setDuplicateSourceTask(formData);
                  setShowDuplicateChoice(true);
                }}
                className="px-3 py-1.5 rounded-md text-xs font-bold flex items-center justify-center gap-1.5 bg-transparent text-text-primary hover:bg-bg-hover transition-all duration-150"
              >
                <Duplicate className="w-3.5 h-3.5" />
                {t('allocation.button.duplicate')}
              </button>
            )}
            <button
              type="submit"
              disabled={isSaving}
              className="px-3 py-1.5 rounded-md text-xs font-bold flex items-center justify-center gap-1.5 bg-accent text-white disabled:opacity-70 disabled:cursor-not-allowed hover:bg-accent-hover transition-all duration-150 hover:scale-[1.02] hover:shadow-md"
            >
              {isSaving ? (
                <>
                  <svg className="animate-spin h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  {t('allocation.button.saving')}
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  {t('allocation.button.save')}
                </>
              )}
            </button>
          </div>
        </form>

        {/* Duplicate Choice Dialog */}
        {showDuplicateChoice && (
          <div className="absolute inset-0 bg-black/30 flex items-center justify-center z-[var(--z-layer-3)] rounded-xl">
            <div className="bg-bg-surface rounded-lg p-6 w-[var(--w-modal-confirm)] shadow-2xl" dir={locale.dir} onClick={e => e.stopPropagation()}>
              <h4 className="text-lg font-bold mb-5 text-text-primary text-center">{t('allocation.duplicate.title')}</h4>

              <div className="space-y-3 mb-5">
                <button
                  type="button"
                  onClick={() => handleDuplicateChoice('same')}
                  className="w-full p-4 border-2 border-border-subtle rounded-xl hover:border-accent hover:bg-accent-bg-soft transition-all duration-150 text-start group"
                >
                  <div className="font-bold text-sm text-text-secondary group-hover:text-accent">{t('allocation.duplicate.same')}</div>
                  <div className="text-xs text-text-subtle mt-1">{t('allocation.duplicate.sameDetails')}</div>
                </button>
                <button
                  type="button"
                  onClick={() => handleDuplicateChoice('other')}
                  className="w-full p-4 border-2 border-border-subtle rounded-xl hover:border-accent hover:bg-accent-bg-soft transition-all duration-150 text-start group"
                >
                  <div className="font-bold text-sm text-text-secondary group-hover:text-accent">{t('allocation.duplicate.other')}</div>
                  <div className="text-xs text-text-subtle mt-1">{t('allocation.duplicate.otherDetails')}</div>
                </button>
              </div>

              <button
                type="button"
                onClick={() => {
                  setShowDuplicateChoice(false);
                  setDuplicateSourceTask(null);
                }}
                className="w-full py-2.5 bg-bg-hover rounded-md text-sm hover:bg-bg-emphasis transition-all duration-150"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="absolute inset-0 -z-10" onClick={onClose} />
    </div>
  );
};
