/**
 * StatusBadge — request status pill. Ported from the prototype's StatusBadge;
 * labels resolved via STATUS_LABEL_KEY + t().
 */
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { STATUS_LABEL_KEY } from '../../domain/absence';
import { useDayOffData } from '../../contexts/DayOffDataProvider';
import type { RequestStatus } from '../../domain/types';

export interface StatusBadgeProps {
  status: RequestStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const { t } = useTranslation();
  const { statusColor } = useDayOffData();
  const color = statusColor(status);
  return (
    <span
      className={`status status-themed ${status}`}
      style={{ '--status-color': color } as CSSProperties}
    >
      {t(STATUS_LABEL_KEY[status])}
    </span>
  );
}
