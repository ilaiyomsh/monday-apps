import React, { memo, useMemo, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { format, parseISO } from 'date-fns';
import { useTranslation } from 'react-i18next';
import type { DailyLoad, ZoomLevel } from '../../../types/gantt.types';
import { formatNum } from '../../../utils/effortUtils';
import { useGantt } from '../../../hooks/useGantt';
import { useLocale } from '../../../hooks/useLocale';

const FULL_CIRCLE_SIZE = 36;

// The ONE fixed, uniform load color scale, by utilization (allocated ÷
// availability). Identical across every circle in the app (spec §3.5):
//   ≤40%     → light green
//   40–80%   → medium green
//   80–100%  → dark green
//   100–200% → soft red
//   >200%    → strong red
// Text is always white.
export const getUtilizationColor = (percent: number) => {
  if (percent > 200) return 'bg-load-critical';
  if (percent > 100) return 'bg-load-over';
  if (percent >= 80) return 'bg-load-high';
  if (percent >= 40) return 'bg-load-medium';
  return 'bg-load-low';
};

export interface LoadCellAbsenceInfo {
  classification: string;
}

interface LoadCellProps {
  load: DailyLoad;
  totalCapacity: number; // Daily capacity
  zoomLevel: ZoomLevel;
  /**
   * When the period has no availability at all (weekend/holiday/absence for the
   * whole period), this carries the absence classification (if any) so the
   * empty cell can name the reason in its tooltip.
   */
  absenceInfo?: LoadCellAbsenceInfo;
  // Optional identity rows for the hover tooltip — passed by callers that
  // know which entity the cell represents (employee load row, role load row).
  employeeName?: string;
  roleName?: string;
  ftePercent?: number;
  // Explicit tooltip title override (e.g. "עומס חברה", "עומס מנהל") —
  // bypasses the employee/role fallback so callers can label by row context.
  tooltipTitle?: string;
  // Rule 6: a new data window is landing and load is recomputing — render a
  // neutral skeleton circle (NO value) so we never flash a partial/wrong number.
  recomputing?: boolean;
  // Rule 7: the past-window fetch failed — render an error ring with a retry
  // glyph wired to onRetry, never a current+future-only fallback number.
  error?: { onRetry: () => void } | null;
}

/**
 * Renders a single time period cell in the company load row
 */
export const LoadCell: React.FC<LoadCellProps> = memo(({ load, totalCapacity, absenceInfo, employeeName, roleName, ftePercent, tooltipTitle, recomputing, error }) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const { displayUnit } = useGantt();
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number; below: boolean } | null>(null);

  const openTooltip = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    // Flip below the cell when the viewport doesn't have enough room above —
    // otherwise the title gets clipped under the app's top bar.
    const below = rect.top < 260;
    setTooltipPos({
      x: rect.left + rect.width / 2,
      y: below ? rect.bottom : rect.top,
      below,
    });
    setShowTooltip(true);
  }, []);
  const closeTooltip = useCallback(() => setShowTooltip(false), []);

  // Rule 7 (error) takes precedence over Rule 6 (skeleton), both over the value:
  // never render a partial/wrong number while a past window is in flight or has
  // failed. Three visually distinct states (error ring / skeleton / value).
  if (error) {
    return (
      <div className="relative flex flex-col items-center justify-center h-full border-r border-border-faint px-1 min-w-[40px] group gap-0.5">
        <div className="absolute inset-0 bg-bg-app" />
        <button
          type="button"
          onClick={error.onRetry}
          aria-label={t('companyLoad.retry')}
          className="rounded-full border-2 border-danger bg-transparent flex items-center justify-center transition-transform duration-150 ease-out hover:scale-110 cursor-pointer text-danger"
          style={{ width: FULL_CIRCLE_SIZE, height: FULL_CIRCLE_SIZE, aspectRatio: '1 / 1' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 4v6h6M23 20v-6h-6" />
            <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
          </svg>
        </button>
      </div>
    );
  }
  if (recomputing) {
    return (
      <div className="relative flex flex-col items-center justify-center h-full border-r border-border-faint px-1 min-w-[40px] group gap-0.5">
        <div className="absolute inset-0 bg-bg-app" />
        <div
          className="rounded-full bg-bg-emphasis animate-pulse"
          style={{ width: FULL_CIRCLE_SIZE, height: FULL_CIRCLE_SIZE, aspectRatio: '1 / 1' }}
        />
      </div>
    );
  }

  const { utilizationPercent, availableHours, allocatedHours, daysInPeriod, periodStart, periodEnd } = load;

  const periodCapacity = totalCapacity * daysInPeriod;

  // No availability in the whole period (weekend/holiday/absence) → the cell is
  // EMPTY, not 0% and not red (spec §3.2). The day-off simply doesn't exist in
  // the load math, so we never punish an allocation that happens to fall on it.
  const noAvailability = periodCapacity <= 0;

  // Plain call, NOT useMemo: the error/recomputing early-returns above mean a
  // hook here would change the hook count between renders when a circle flips
  // state (Rules of Hooks violation → crash). getUtilizationColor is a trivial
  // pure switch, so memoization buys nothing.
  const circleColor = getUtilizationColor(utilizationPercent);

  // Format period for tooltip
  const startStr = format(parseISO(periodStart), 'd/M/yy');
  const endStr = format(parseISO(periodEnd), 'd/M/yy');
  const periodLabel = daysInPeriod > 1 ? `${startStr} - ${endStr}` : format(parseISO(periodStart), 'd/M/yyyy');

  // Role's actual capacity for the period (= allocated + free). This is the
  // denominator behind the utilization %, so surfacing it makes the math
  // transparent on hover.
  const periodAvailability = allocatedHours + availableHours;
  // Express that availability as a % of the period's full theoretical capacity
  // (daily standard × total calendar days in the period). Weekends/holidays
  // drag it below 100% — e.g., a typical month reads ~73%.
  // periodEnd is endOfDay, so the inclusive day count is already captured by the
  // rounded diff — adding +1 here double-counts and halves a single-day cell to 50%.
  const calendarDays = Math.max(
    1,
    Math.round((Date.parse(periodEnd) - Date.parse(periodStart)) / 86400000),
  );
  const fullStandard = totalCapacity * calendarDays;
  const availabilityPercent = fullStandard > 0
    ? Math.round((periodAvailability / fullStandard) * 100)
    : 0;

  // Build the structured tooltip rows shown on hover over a load circle.
  const tooltipHeader = tooltipTitle || employeeName || roleName || t('companyLoad.tooltipTitle');
  type Row = { label: string; value: string; ltr?: boolean };
  const tooltipRows: Row[] = [];
  if (employeeName && roleName) {
    tooltipRows.push({ label: t('availability.tooltip.roleLabel'), value: roleName });
  }
  if (typeof ftePercent === 'number') {
    tooltipRows.push({ label: t('availability.tooltip.fteLabel'), value: `${ftePercent}%` });
  }
  tooltipRows.push({ label: t('availability.tooltip.periodLabel'), value: periodLabel, ltr: true });
  tooltipRows.push({
    label: t('availability.tooltip.availabilityLabel'),
    value: t('taskBar.tooltip.percentHours', {
      percent: availabilityPercent,
      hours: formatNum(periodAvailability),
    }),
  });
  const utilLabel = utilizationPercent > 200 ? '>200' : `${Math.round(utilizationPercent)}`;
  tooltipRows.push({
    label: t('availability.tooltip.allocationLabel'),
    value: t('taskBar.tooltip.percentHours', { percent: utilLabel, hours: formatNum(allocatedHours) }),
  });
  tooltipRows.push({
    label: t('availability.tooltip.freeLabel'),
    value: t('availability.tooltip.hoursValue', { hours: formatNum(availableHours) }),
    ltr: availableHours < 0,
  });
  if (absenceInfo) {
    tooltipRows.push({ label: t('availability.tooltip.statusLabel'), value: absenceInfo.classification });
  }

  // Cap the percent label at >200% for readability.
  const isOverflowPercent = utilizationPercent > 200;
  const innerText = displayUnit === 'percent'
    ? (isOverflowPercent ? '>200%' : `${Math.round(utilizationPercent)}%`)
    : formatNum(availableHours);

  return (
    <>
      <div
        className="relative flex flex-col items-center justify-center h-full border-r border-border-faint px-1 min-w-[40px] group gap-0.5"
        onMouseEnter={openTooltip}
        onMouseLeave={closeTooltip}
      >
        {/* Background cell effect */}
        <div className="absolute inset-0 bg-bg-app group-hover:bg-accent-bg-soft transition-colors" />

        {noAvailability ? (
          // Empty marker: a hollow, neutral ring — reads as "nothing here",
          // distinct from any green/red load circle. The reason (weekend /
          // holiday / absence classification) is surfaced in the tooltip.
          <div
            className="rounded-full border-2 border-dashed border-border-default bg-transparent flex items-center justify-center transition-transform duration-150 ease-out hover:scale-110"
            style={{ width: FULL_CIRCLE_SIZE, height: FULL_CIRCLE_SIZE, aspectRatio: '1 / 1' }}
          >
            <span className="text-xs font-bold text-text-subtle pointer-events-none">–</span>
          </div>
        ) : (
          <div
            className={`rounded-full shadow-sm ${circleColor} opacity-90 flex items-center justify-center transition-transform duration-150 ease-out hover:scale-125`}
            style={{
              width: FULL_CIRCLE_SIZE,
              height: FULL_CIRCLE_SIZE,
              aspectRatio: '1 / 1',
            }}
          >
            <span className="text-xs font-bold text-white pointer-events-none">
              {innerText}
            </span>
          </div>
        )}
      </div>
      {showTooltip && tooltipPos && createPortal(
        <div
          className="fixed p-3 bg-bg-inverted text-white text-xs rounded-lg shadow-xl z-[9999] min-w-[260px] pointer-events-none animate-in fade-in zoom-in-95 duration-200"
          style={{
            left: tooltipPos.x,
            top: tooltipPos.below ? tooltipPos.y + 10 : Math.max(8, tooltipPos.y - 10),
            transform: tooltipPos.below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
          }}
          dir={locale.dir}
        >
          <div className="font-bold text-sm border-b border-white/20 pb-1.5 mb-1.5">{tooltipHeader}</div>
          <div className="space-y-1 text-xs">
            {tooltipRows.map((r, i) => (
              <div key={i} className="flex justify-between gap-4">
                <span className="text-white/70">{r.label}</span>
                <span className="font-medium" dir={r.ltr ? 'ltr' : undefined}>{r.value}</span>
              </div>
            ))}
          </div>
        </div>,
        document.body
      )}
    </>
  );
});

LoadCell.displayName = 'LoadCell';
