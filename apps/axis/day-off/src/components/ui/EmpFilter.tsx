/**
 * EmpFilter — dropdown to filter the dashboard by a single team member (or all).
 * Ported from dashboard.jsx; reads the team from useDayOffData() instead of
 * window.DayOffData.
 */
import { useEffect, useState } from 'react';
import { useDayOffData } from '../../contexts/DayOffDataProvider';
import { useL10n } from '../../domain/useL10n';
import { Avatar } from './Avatar';
import { Icon } from './Icon';

export interface EmpFilterProps {
  /** 'all' or an employee id. */
  value: string;
  onChange: (value: string) => void;
}

export function EmpFilter({ value, onChange }: EmpFilterProps) {
  const { t } = useL10n();
  const { teamIds, teams, myTeams, empById } = useDayOffData();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (!(e.target as Element)?.closest('.emp-select')) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const teamName = (id: string) => {
    const tm = myTeams.find((x) => x.id === id);
    return tm ? tm.name || t('settings.team.namePlaceholder', { n: teams.indexOf(tm) + 1 }) : '';
  };
  // Offer team options only when the user belongs to more than one team.
  const showTeams = myTeams.length > 1;

  const curLabel =
    value === 'all'
      ? t('common.allTeam')
      : value.startsWith('team:')
        ? teamName(value.slice(5))
        : empById(value)?.name ?? '';

  const select = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <div className="yr-select emp-select">
      <button className="yr-btn" onClick={() => setOpen((o) => !o)}>
        <Icon name="users" size={16} />
        <span>{curLabel}</span>
        <Icon name="chevron-down" size={15} style={{ color: 'var(--color-text-secondary)' }} />
      </button>
      {open && (
        <div className="yr-menu">
          <button className={`yr-opt ${value === 'all' ? 'active' : ''}`} onClick={() => select('all')}>
            <span>{t('common.allTeam')}</span>
            {value === 'all' && (
              <Icon name="check" size={15} style={{ marginInlineStart: 'auto', color: 'var(--color-primary)' }} />
            )}
          </button>
          {showTeams &&
            myTeams.map((tm, i) => {
              const v = `team:${tm.id}`;
              return (
                <button key={tm.id} className={`yr-opt ${value === v ? 'active' : ''}`} onClick={() => select(v)}>
                  <Icon name="users" size={15} />
                  <span>{tm.name || t('settings.team.namePlaceholder', { n: i + 1 })}</span>
                  {value === v && (
                    <Icon name="check" size={15} style={{ marginInlineStart: 'auto', color: 'var(--color-primary)' }} />
                  )}
                </button>
              );
            })}
          {teamIds.map((id) => {
            const e = empById(id);
            return (
              <button
                key={id}
                className={`yr-opt ${value === id ? 'active' : ''}`}
                onClick={() => {
                  onChange(id);
                  setOpen(false);
                }}
              >
                <Avatar emp={e} size="sm" />
                <span>{e?.name}</span>
                {value === id && (
                  <Icon name="check" size={15} style={{ marginInlineStart: 'auto', color: 'var(--color-primary)' }} />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
