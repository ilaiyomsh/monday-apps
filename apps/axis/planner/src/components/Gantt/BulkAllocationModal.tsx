import React, { useState, useMemo, useCallback } from 'react';
import type { Task, Employee } from '../../types/gantt.types';
import type { Allocation } from '../../types/entities/allocation.types';
import { format, parseISO, addDays, startOfDay, endOfDay } from 'date-fns';
import { toMondayDateTimeString } from '../../utils/dateTimeHelpers';
import { useTranslation } from 'react-i18next';
import { DatePickerInput } from './DatePickerInput';
import { useSettings } from '../../contexts/SettingsContext';
import { countWorkingDays, isWorkingDay } from '../../utils/workDaysUtils';
import { findOverlappingAllocations } from '../../utils/overlapUtils';
import { SearchableSelect, type SearchableSelectOption } from '../Settings/SearchableSelect';
import { useGantt } from '../../hooks/useGantt';
import { useLocale } from '../../hooks/useLocale';
import { logger } from '../../utils/Logger';

interface BulkAllocationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (allocation: Omit<Task, 'id'>) => Promise<void>;
  projectId: string;
  projectName: string;
  employees: Employee[];
  allAllocations: Allocation[];
  onSwitchToSingle?: (projectId: string, projectName: string) => void;
}

type AllocationInputMode = 'effort' | 'total' | 'percentage';

interface BulkAllocationRow {
  id: string;
  capability: string;
  employeeId: string;
  userName: string;
  role: string;
  startDate: string;
  endDate: string;
  totalHours: number;
  usesSharedDates: boolean;
  usesSharedHours: boolean;
}

const roundTo1 = (n: number) => Math.round(n * 10) / 10;

export const BulkAllocationModal: React.FC<BulkAllocationModalProps> = ({
  isOpen,
  onClose,
  onSave,
  projectId,
  projectName,
  employees,
  allAllocations,
  onSwitchToSingle,
}) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const { settings } = useSettings();
  const { showToast, holidaysByDate } = useGantt();
  const workDays = settings?.workDays || [0, 1, 2, 3, 4];
  const dailyStandard = settings?.maxHoursPerDay || 8.5;

  // Shared controls
  const [sharedStartDate, setSharedStartDate] = useState<Date>(new Date());
  const [sharedEndDate, setSharedEndDate] = useState<Date>(addDays(new Date(), 4));
  const [sharedTotalHours, setSharedTotalHours] = useState<number>(8.5);
  const [inputMode, setInputMode] = useState<AllocationInputMode>('percentage');

  // Derived shared percentage from shared hours
  const sharedWorkingDays = useMemo(() => {
    return Math.max(1, countWorkingDays(sharedStartDate, sharedEndDate, workDays, holidaysByDate));
  }, [sharedStartDate, sharedEndDate, workDays, holidaysByDate]);

  const sharedHoursPerDay = useMemo(() => {
    return roundTo1(sharedTotalHours / sharedWorkingDays);
  }, [sharedTotalHours, sharedWorkingDays]);

  const sharedPercentage = useMemo(() => {
    return Math.round((sharedHoursPerDay / dailyStandard) * 100);
  }, [sharedHoursPerDay, dailyStandard]);

  // Rows
  const [rows, setRows] = useState<BulkAllocationRow[]>([]);

  // Save state
  const [isSaving, setIsSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [showConfirmClose, setShowConfirmClose] = useState(false);

  // Capability list from employees
  const capabilities = useMemo(() => {
    const allCaps = new Set<string>();
    employees.forEach(emp => {
      emp.capabilities?.forEach(cap => allCaps.add(cap));
    });
    return Array.from(allCaps).sort((a, b) => a.localeCompare(b, locale.dateLocale));
  }, [employees, locale.dateLocale]);

  // Calculate employee availability for the selected date range
  const calculateEmployeeAvailability = useCallback((employeeId: string, rowStartDate: string, rowEndDate: string): number => {
    if (!rowStartDate || !rowEndDate) return 0;

    const rangeStart = startOfDay(parseISO(rowStartDate));
    const rangeEnd = endOfDay(parseISO(rowEndDate));

    const employeeAllocations = allAllocations.filter(a => {
      if (a.employeeId !== employeeId) return false;
      const allocStart = startOfDay(new Date(a.startDate));
      const allocEnd = endOfDay(new Date(a.endDate));
      return allocStart <= rangeEnd && allocEnd >= rangeStart;
    });

    if (employeeAllocations.length === 0) return 0;

    let totalHours = 0;
    let workingDaysCount = 0;

    const current = new Date(rangeStart);
    while (current <= rangeEnd) {
      if (isWorkingDay(current, workDays)) {
        workingDaysCount++;
        employeeAllocations.forEach(a => {
          const allocStart = startOfDay(new Date(a.startDate));
          const allocEnd = endOfDay(new Date(a.endDate));
          if (current >= allocStart && current <= allocEnd) {
            totalHours += a.hoursPerDay || 0;
          }
        });
      }
      current.setDate(current.getDate() + 1);
    }

    if (workingDaysCount === 0) return 0;
    const avgDailyHours = totalHours / workingDaysCount;
    return Math.round((avgDailyHours / dailyStandard) * 100);
  }, [allAllocations, workDays, dailyStandard]);

  // Convert percentage to total hours based on working days
  const percentageToTotalHours = useCallback((pct: number, days: number) => {
    const hoursPerDay = (pct / 100) * dailyStandard;
    return roundTo1(hoursPerDay * days);
  }, [dailyStandard]);

  // Add a row for a capability
  const addRow = useCallback((capability: string) => {
    const startStr = toMondayDateTimeString(sharedStartDate);
    const endStr = toMondayDateTimeString(sharedEndDate);

    setRows(prev => [...prev, {
      id: crypto.randomUUID(),
      capability,
      employeeId: '',
      userName: '',
      role: '',
      startDate: startStr,
      endDate: endStr,
      totalHours: sharedTotalHours,
      usesSharedDates: true,
      usesSharedHours: true,
    }]);
  }, [sharedStartDate, sharedEndDate, sharedTotalHours]);

  // Remove a row
  const removeRow = useCallback((rowId: string) => {
    setRows(prev => prev.filter(r => r.id !== rowId));
  }, []);

  // Update a specific row field
  const updateRow = useCallback((rowId: string, updates: Partial<BulkAllocationRow>) => {
    setRows(prev => prev.map(r => r.id === rowId ? { ...r, ...updates } : r));
  }, []);

  // When shared start date changes, update all synced rows
  const handleSharedStartDateChange = useCallback((date: Date | undefined) => {
    if (!date) return;
    setSharedStartDate(date);
    const newEnd = date > sharedEndDate ? date : sharedEndDate;
    if (date > sharedEndDate) {
      setSharedEndDate(date);
    }
    const startStr = toMondayDateTimeString(date);
    const endStr = toMondayDateTimeString(newEnd);
    setRows(prev => prev.map(r => {
      if (!r.usesSharedDates) return r;
      return { ...r, startDate: startStr, endDate: endStr };
    }));
  }, [sharedEndDate]);

  const handleSharedEndDateChange = useCallback((date: Date | undefined) => {
    if (!date) return;
    setSharedEndDate(date);
    const newStart = date < sharedStartDate ? date : sharedStartDate;
    if (date < sharedStartDate) {
      setSharedStartDate(date);
    }
    const endStr = toMondayDateTimeString(date);
    const startStr = toMondayDateTimeString(newStart);
    setRows(prev => prev.map(r => {
      if (!r.usesSharedDates) return r;
      return { ...r, startDate: startStr, endDate: endStr };
    }));
  }, [sharedStartDate]);

  // When shared hours change, update all synced rows
  const handleSharedHoursChange = useCallback((hours: number) => {
    setSharedTotalHours(hours);
    setRows(prev => prev.map(r => {
      if (!r.usesSharedHours) return r;
      return { ...r, totalHours: hours };
    }));
  }, []);

  // When shared hours/day changes, convert to total and propagate
  const handleSharedEffortChange = useCallback((hpd: number) => {
    const hours = roundTo1(hpd * sharedWorkingDays);
    setSharedTotalHours(hours);
    setRows(prev => prev.map(r => {
      if (!r.usesSharedHours) return r;
      return { ...r, totalHours: hours };
    }));
  }, [sharedWorkingDays]);

  // When shared percentage changes, convert to hours and propagate
  const handleSharedPercentageChange = useCallback((pct: number) => {
    const hours = percentageToTotalHours(pct, sharedWorkingDays);
    setSharedTotalHours(hours);
    setRows(prev => prev.map(r => {
      if (!r.usesSharedHours) return r;
      return { ...r, totalHours: hours };
    }));
  }, [percentageToTotalHours, sharedWorkingDays]);

  // Build employee options for a specific row (filtered by capability, with availability)
  const getEmployeeOptions = useCallback((row: BulkAllocationRow): SearchableSelectOption[] => {
    // Calculate the percentage this row's allocation would add
    const rowDays = Math.max(1, countWorkingDays(parseISO(row.startDate), parseISO(row.endDate), workDays, holidaysByDate));
    const rowHoursPerDay = row.totalHours / rowDays;
    const rowPercentage = Math.round((rowHoursPerDay / dailyStandard) * 100);

    return employees
      .filter(emp => emp.capabilities?.includes(row.capability))
      .map(emp => {
        const availability = calculateEmployeeAvailability(emp.id, row.startDate, row.endDate);
        const projected = availability + rowPercentage;
        const displayName = emp.role ? `${emp.name} (${emp.role})` : emp.name;
        return {
          id: emp.id,
          name: displayName,
          meta: {
            availability,
            projected,
            color: projected > 100 ? 'var(--color-danger)' : projected > 80 ? 'var(--color-warning)' : 'var(--color-success)',
          }
        };
      });
  }, [employees, calculateEmployeeAvailability, workDays, dailyStandard, holidaysByDate]);

  // Validate a row before save
  const validateRow = useCallback((row: BulkAllocationRow): string | null => {
    if (!row.employeeId) return t('bulkAllocation.validation.employeeRequired');
    if (row.totalHours <= 0) return t('bulkAllocation.validation.hoursPositive');

    const overlap = findOverlappingAllocations(
      row.employeeId,
      projectId,
      row.startDate,
      row.endDate,
      allAllocations
    );
    if (overlap.hasOverlap) return t('bulkAllocation.validation.overlap');

    return null;
  }, [projectId, allAllocations, t]);

  // Check overlap per row for display
  const rowErrors = useMemo(() => {
    const errors = new Map<string, string>();
    rows.forEach(row => {
      const err = validateRow(row);
      if (err) errors.set(row.id, err);
    });
    return errors;
  }, [rows, validateRow]);

  // Save all rows
  const handleSave = async () => {
    const validRows = rows.filter(r => !validateRow(r));
    if (validRows.length === 0) return;

    setIsSaving(true);
    setSaveProgress({ done: 0, total: validRows.length });

    let succeeded = 0;
    let failed = 0;

    for (const row of validRows) {
      try {
        const days = Math.max(1, countWorkingDays(parseISO(row.startDate), parseISO(row.endDate), workDays, holidaysByDate));
        const hoursPerDay = roundTo1(row.totalHours / days);
        const ftePercentage = Math.round((hoursPerDay / dailyStandard) * 100);

        await onSave({
          projectId,
          projectName,
          groupId: projectId,
          employeeId: row.employeeId,
          userName: row.userName,
          role: row.role,
          capability: row.capability,
          name: `${projectName} - ${row.capability}`,
          startDate: row.startDate,
          endDate: row.endDate,
          totalHours: row.totalHours,
          hoursPerDay,
          ftePercentage,
        } as Omit<Task, 'id'>);

        succeeded++;
      } catch (err) {
        failed++;
        logger.error(`Failed to save allocation for ${row.capability}:`, err);
      }
      setSaveProgress({ done: succeeded + failed, total: validRows.length });
    }

    setIsSaving(false);
    if (failed === 0) {
      onClose();
    } else {
      showToast(t('bulkAllocation.toast.partialSave', { succeeded, failed }), 'error');
    }
  };

  // Count of valid (saveable) rows
  const validCount = rows.filter(r => !validateRow(r)).length;

  // Cancel handler - show confirmation if rows exist
  const handleCancel = useCallback(() => {
    if (rows.length > 0) {
      setShowConfirmClose(true);
    } else {
      onClose();
    }
  }, [rows.length, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[var(--z-layer-1)] flex items-center justify-center bg-transparent pointer-events-auto">
      <div
        className="bg-bg-surface rounded-xl shadow-2xl w-[var(--w-modal-lg)] h-[80vh] flex flex-col animate-in fade-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
        dir={locale.dir}
      >
        {/* Header */}
        <div className="px-4 py-2.5 flex items-center justify-between border-b border-border-faint flex-shrink-0">
          {/* Mode toggle */}
          {onSwitchToSingle ? (
            <div className="flex items-center gap-1 bg-bg-section p-0.5 rounded-lg w-fit mx-auto">
              <button
                type="button"
                onClick={() => onSwitchToSingle(projectId, projectName)}
                className="px-3 py-1 text-xs font-bold rounded-md text-text-muted hover:text-text-secondary"
              >
                {t('allocation.mode.single')}
              </button>
              <button
                type="button"
                className="px-3 py-1 text-xs font-bold rounded-md bg-bg-surface shadow-sm text-accent"
              >
                {t('allocation.mode.bulk')}
              </button>
            </div>
          ) : <div />}
          <button onClick={handleCancel} className="text-text-subtle hover:text-text-muted p-1 rounded-md hover:bg-bg-hover transition-all duration-150 hover:scale-105">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Body - sidebar + main */}
        <div className="flex flex-1 overflow-hidden">
          {/* Main form area */}
          <div className="flex-1 p-6 overflow-y-auto border-l border-border-faint">
            {/* Shared controls - clean layout without heavy header */}
            <div className="mb-6 flex items-end gap-4">
              {/* Dates */}
              <div className="flex gap-3 flex-1">
                <div className="flex-1">
                  <DatePickerInput
                    label={t('bulkAllocation.fields.start')}
                    date={sharedStartDate}
                    onDateChange={handleSharedStartDateChange}
                  />
                </div>
                <div className="flex-1">
                  <DatePickerInput
                    label={t('bulkAllocation.fields.end')}
                    date={sharedEndDate}
                    onDateChange={handleSharedEndDateChange}
                  />
                </div>
              </div>

              {/* Separator */}
              <div className="h-10 w-px bg-bg-emphasis flex-shrink-0" />

              {/* Effort input with radio toggle - 3 modes like AllocationModal */}
              <div className="flex gap-3 items-end flex-1">
                {/* Hours/Day */}
                <div className="flex-1">
                  <label
                    className="flex items-center gap-1.5 cursor-pointer mb-1"
                    onClick={() => setInputMode('effort')}
                  >
                    <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${inputMode === 'effort' ? 'border-accent bg-accent' : 'border-border-default'}`}>
                      {inputMode === 'effort' && <div className="w-1.5 h-1.5 rounded-full bg-white"/>}
                    </div>
                    <span className="text-xs font-medium text-text-muted">{t('allocation.fields.hoursPerDay')}</span>
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={sharedHoursPerDay}
                    disabled={inputMode !== 'effort'}
                    onChange={e => handleSharedEffortChange(parseFloat(e.target.value) || 0)}
                    className={`w-full h-[40px] px-3 border rounded-md text-center text-base font-medium transition-colors ${
                      inputMode === 'effort'
                        ? 'border-accent bg-bg-surface text-text-primary'
                        : 'bg-bg-section text-text-subtle border-border-subtle cursor-not-allowed'
                    }`}
                  />
                </div>

                {/* Total Hours */}
                <div className="flex-1">
                  <label
                    className="flex items-center gap-1.5 cursor-pointer mb-1"
                    onClick={() => setInputMode('total')}
                  >
                    <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${inputMode === 'total' ? 'border-accent bg-accent' : 'border-border-default'}`}>
                      {inputMode === 'total' && <div className="w-1.5 h-1.5 rounded-full bg-white"/>}
                    </div>
                    <span className="text-xs font-medium text-text-muted">{t('allocation.fields.totalHours')}</span>
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    value={sharedTotalHours}
                    disabled={inputMode !== 'total'}
                    onChange={e => handleSharedHoursChange(parseFloat(e.target.value) || 0)}
                    className={`w-full h-[40px] px-3 border rounded-md text-center text-base font-medium transition-colors ${
                      inputMode === 'total'
                        ? 'border-accent bg-bg-surface text-text-primary'
                        : 'bg-bg-section text-text-subtle border-border-subtle cursor-not-allowed'
                    }`}
                  />
                </div>

                {/* Percentage */}
                <div className="flex-1">
                  <label
                    className="flex items-center gap-1.5 cursor-pointer mb-1"
                    onClick={() => setInputMode('percentage')}
                  >
                    <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${inputMode === 'percentage' ? 'border-accent bg-accent' : 'border-border-default'}`}>
                      {inputMode === 'percentage' && <div className="w-1.5 h-1.5 rounded-full bg-white"/>}
                    </div>
                    <span className="text-xs font-medium text-text-muted">{t('allocation.fields.fte')}</span>
                  </label>
                  <input
                    type="number"
                    step="5"
                    min="0"
                    value={sharedPercentage}
                    disabled={inputMode !== 'percentage'}
                    onChange={e => handleSharedPercentageChange(Math.max(0, parseFloat(e.target.value) || 0))}
                    className={`w-full h-[40px] px-3 border rounded-md text-center text-base font-medium transition-colors ${
                      inputMode === 'percentage'
                        ? 'border-accent bg-bg-surface text-text-primary'
                        : 'bg-bg-section text-text-subtle border-border-subtle cursor-not-allowed'
                    }`}
                  />
                </div>
              </div>

              {/* Working days info */}
              <span className="text-xs text-text-subtle pb-1 flex-shrink-0">{t('allocation.workingDays', { count: sharedWorkingDays })}</span>
            </div>

            {/* Allocation rows */}
            {rows.length === 0 ? (
              <div className="text-center py-16 text-text-subtle">
                <svg className="w-14 h-14 mx-auto mb-4 text-text-faint" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                </svg>
                <p className="text-lg">{t('bulkAllocation.emptyState')}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {rows.map((row) => {
                  const error = rowErrors.get(row.id);
                  const rowWorkingDays = Math.max(1, countWorkingDays(parseISO(row.startDate), parseISO(row.endDate), workDays, holidaysByDate));
                  const hoursPerDay = roundTo1(row.totalHours / rowWorkingDays);
                  const rowPercentage = Math.round((hoursPerDay / dailyStandard) * 100);

                  return (
                    <div key={row.id} className={`p-4 rounded-lg border ${error && row.employeeId ? 'border-warning-border bg-warning-soft' : 'border-border-subtle bg-bg-surface'}`}>
                      {/* Row header */}
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-base font-bold text-text-secondary">{row.capability}</span>
                        <div className="flex items-center gap-3">
                          {row.totalHours > 0 && (
                            <span className="text-xs text-text-subtle">
                              {t('bulkAllocation.row.metaSummary', {
                                hoursPerDay,
                                percent: rowPercentage,
                                days: rowWorkingDays,
                              })}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => removeRow(row.id)}
                            className="text-text-subtle hover:text-danger p-0.5 rounded hover:bg-danger-soft transition-all duration-150 hover:scale-105"
                            title={t('bulkAllocation.row.remove')}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                          </button>
                        </div>
                      </div>

                      {/* Employee + overrides in one row */}
                      <div className="flex gap-3 items-end">
                        {/* Employee select */}
                        <div className="w-[380px] flex-shrink-0">
                          <SearchableSelect
                            compact
                            options={getEmployeeOptions(row)}
                            value={row.employeeId}
                            onChange={(employeeId) => {
                              const employee = employees.find(e => e.id === employeeId);
                              if (employee) {
                                updateRow(row.id, {
                                  employeeId: employee.userId || employee.id,
                                  userName: employee.name,
                                  role: employee.role,
                                });
                              }
                            }}
                            placeholder={t('allocation.placeholder.employee')}
                            renderOption={(option, isSelected) => (
                              <div className="flex items-center justify-between w-full" dir={locale.dir}>
                                <div className="flex items-center gap-2 text-start">
                                  {isSelected && (
                                    <svg className="w-4 h-4 text-accent flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                    </svg>
                                  )}
                                  <span className={`text-right ${isSelected ? 'font-bold' : ''}`}>{option.name}</span>
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
                        </div>

                        {/* Date overrides */}
                        <div className="flex gap-2 items-end flex-1">
                          <div className="flex-1 min-w-[100px]">
                            <div className="flex items-center gap-1 mb-0.5">
                              <label className="text-xs text-text-subtle">{t('bulkAllocation.fields.start')}</label>
                              {!row.usesSharedDates && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const startStr = toMondayDateTimeString(sharedStartDate);
                                    const endStr = toMondayDateTimeString(sharedEndDate);
                                    updateRow(row.id, { startDate: startStr, endDate: endStr, usesSharedDates: true });
                                  }}
                                  className="text-xs text-accent hover:text-accent-text-strong"
                                >
                                  {t('bulkAllocation.row.reset')}
                                </button>
                              )}
                            </div>
                            <DatePickerInput
                              label=""
                              date={parseISO(row.startDate)}
                              onDateChange={(date) => {
                                if (!date) return;
                                const startStr = toMondayDateTimeString(date);
                                let endStr = row.endDate;
                                if (date > parseISO(row.endDate)) {
                                  endStr = startStr;
                                }
                                updateRow(row.id, { startDate: startStr, endDate: endStr, usesSharedDates: false });
                              }}
                            />
                          </div>
                          <div className="flex-1 min-w-[100px]">
                            <label className="text-xs text-text-subtle block mb-0.5">{t('bulkAllocation.fields.end')}</label>
                            <DatePickerInput
                              label=""
                              date={parseISO(row.endDate)}
                              onDateChange={(date) => {
                                if (!date) return;
                                const endStr = toMondayDateTimeString(date);
                                let startStr = row.startDate;
                                if (date < parseISO(row.startDate)) {
                                  startStr = endStr;
                                }
                                updateRow(row.id, { startDate: startStr, endDate: endStr, usesSharedDates: false });
                              }}
                            />
                          </div>
                        </div>

                        {/* Effort override - synced with inputMode */}
                        <div className="w-[90px]">
                          <div className="flex items-center gap-1 mb-0.5">
                            <label className="text-xs text-text-subtle">
                              {inputMode === 'effort'
                                ? t('bulkAllocation.row.hoursPerDayShort')
                                : inputMode === 'percentage'
                                  ? t('allocation.fields.fte')
                                  : t('bulkAllocation.row.totalHoursShort')}
                            </label>
                            {!row.usesSharedHours && (
                              <button
                                type="button"
                                onClick={() => updateRow(row.id, { totalHours: sharedTotalHours, usesSharedHours: true })}
                                className="text-xs text-accent hover:text-accent-text-strong"
                              >
                                {t('bulkAllocation.row.reset')}
                              </button>
                            )}
                          </div>
                          <input
                            type="number"
                            step={inputMode === 'percentage' ? '5' : inputMode === 'effort' ? '0.1' : '0.5'}
                            min="0"
                            value={inputMode === 'effort' ? hoursPerDay : inputMode === 'percentage' ? rowPercentage : row.totalHours}
                            onChange={e => {
                              const val = parseFloat(e.target.value) || 0;
                              let newTotalHours: number;
                              if (inputMode === 'effort') {
                                newTotalHours = roundTo1(val * rowWorkingDays);
                              } else if (inputMode === 'percentage') {
                                const hpd = (val / 100) * dailyStandard;
                                newTotalHours = roundTo1(hpd * rowWorkingDays);
                              } else {
                                newTotalHours = val;
                              }
                              updateRow(row.id, { totalHours: newTotalHours, usesSharedHours: false });
                            }}
                            className="w-full h-[40px] px-2 border border-border-subtle rounded-md text-center text-base font-medium bg-bg-surface"
                          />
                        </div>
                      </div>

                      {/* Error message */}
                      {error && row.employeeId && (
                        <div className="mt-2 text-xs text-warning-text flex items-center gap-1">
                          <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                          </svg>
                          {error}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Sidebar - capabilities list */}
          <div className="w-[220px] p-5 bg-bg-app overflow-y-auto flex-shrink-0">
            <h3 className="text-sm font-medium text-text-muted mb-3">{t('bulkAllocation.sidebar.title')}</h3>
            {capabilities.length === 0 ? (
              <p className="text-xs text-text-subtle">{t('bulkAllocation.sidebar.empty')}</p>
            ) : (
              <div className="space-y-1">
                {capabilities.map(cap => {
                  const capRows = rows.filter(r => r.capability === cap);
                  const rowCount = capRows.length;
                  // Calculate total FTE for this capability across all rows
                  const capTotalFte = capRows.reduce((sum, r) => {
                    const days = Math.max(1, countWorkingDays(parseISO(r.startDate), parseISO(r.endDate), workDays, holidaysByDate));
                    const hpd = r.totalHours / days;
                    return sum + Math.round((hpd / dailyStandard) * 100);
                  }, 0);
                  return (
                    <button
                      key={cap}
                      type="button"
                      onClick={() => addRow(cap)}
                      className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm text-text-secondary hover:bg-accent-bg-soft hover:text-accent-text-strong transition-all duration-150 text-right"
                    >
                      <span className="truncate">{cap}</span>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {rowCount > 0 && (
                          <span className="text-xs bg-accent-bg-badge text-accent px-1.5 rounded-full font-bold">
                            {capTotalFte}%
                          </span>
                        )}
                        <svg className="w-4 h-4 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border-faint flex justify-end gap-3 flex-shrink-0">
          <button
            type="button"
            onClick={handleCancel}
            disabled={isSaving}
            className="w-[140px] py-2.5 bg-bg-hover rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-bg-emphasis transition-all duration-150 hover:scale-[1.02] hover:shadow-md"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || validCount === 0}
            className="w-[140px] py-2.5 bg-accent text-white rounded-md text-sm font-bold shadow-lg disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2 hover:bg-accent-hover transition-all duration-150 hover:scale-[1.02] hover:shadow-md"
          >
            {isSaving ? (
              <>
                <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                {t('bulkAllocation.savingProgress', { done: saveProgress.done, total: saveProgress.total })}
              </>
            ) : (
              t('common.save')
            )}
          </button>
        </div>

        {/* Confirm close dialog */}
        {showConfirmClose && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/30 rounded-[12px]">
            <div className="bg-bg-surface rounded-lg shadow-xl p-6 max-w-[340px] text-center" dir={locale.dir}>
              <p className="text-base font-medium text-text-secondary mb-5">{t('bulkAllocation.confirmClose.message')}</p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowConfirmClose(false);
                    onClose();
                  }}
                  className="flex-1 py-2.5 bg-bg-hover rounded-md text-sm font-medium hover:bg-bg-emphasis transition-all duration-150 hover:scale-[1.02] hover:shadow-md"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowConfirmClose(false);
                    handleSave();
                  }}
                  className="flex-1 py-2.5 bg-accent text-white rounded-md text-sm font-bold hover:bg-accent-hover transition-all duration-150 hover:scale-[1.02] hover:shadow-md"
                >
                  {t('common.confirm')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="absolute inset-0 -z-10" onClick={handleCancel} />
    </div>
  );
};
