/**
 * Rng — a date range, always rendered left-to-right (earlier date first, e.g.
 * "13-15.7" or "2.6-10.6") regardless of the ambient direction, so it reads the
 * same in Hebrew and English. Compact numeric format via useL10n().fmtRange.
 */
import { useL10n } from '../../domain/useL10n';
import type { DayKey } from '../../domain/types';

export interface RngProps {
  start: DayKey;
  end: DayKey;
}

export function Rng({ start, end }: RngProps) {
  const { fmtRange } = useL10n();
  return (
    <span className="date-range" dir="ltr">
      {fmtRange(start, end)}
    </span>
  );
}
