import { type ReactNode } from 'react';
import { useL10n } from '../../domain/useL10n';
import { Icon } from './Icon';

interface CalToolbarProps {
  monthDate: Date;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  right?: ReactNode;
}

export function CalToolbar({ monthDate, onPrev, onNext, onToday, right }: CalToolbarProps) {
  const { t, monthName } = useL10n();
  return (
    <div className="cal-toolbar">
      <button className="today-btn" onClick={onToday}>
        {t('calendar.today')}
      </button>
      <div className="nav-arrows">
        <button className="nav-btn" onClick={onPrev} aria-label={t('calendar.prevMonth')}>
          <Icon name="chevron-left" size={20} className="rtl-flip" />
        </button>
        <button className="nav-btn" onClick={onNext} aria-label={t('calendar.nextMonth')}>
          <Icon name="chevron-right" size={20} className="rtl-flip" />
        </button>
      </div>
      <span className="cal-label">
        {monthName(monthDate.getMonth())} {monthDate.getFullYear()}
      </span>
      <div className="toolbar-spacer" />
      {right}
    </div>
  );
}
