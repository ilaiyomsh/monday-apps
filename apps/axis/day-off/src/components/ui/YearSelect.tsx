import { useState, useEffect } from 'react';
import { Icon } from './Icon';

interface YearSelectProps {
  year: number;
  years: number[];
  onChange: (year: number) => void;
}

export function YearSelect({ year, years, onChange }: YearSelectProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest('.yr-select')) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  return (
    <div className="yr-select">
      <button className="yr-btn" onClick={() => setOpen((o) => !o)}>
        <Icon name="calendar" size={16} />
        <span>{year}</span>
        <Icon name="chevron-down" size={15} style={{ color: 'var(--color-text-secondary)' }} />
      </button>
      {open && (
        <div className="yr-menu">
          {years.map((y) => (
            <button
              key={y}
              className={`yr-opt ${y === year ? 'active' : ''}`}
              onClick={() => {
                onChange(y);
                setOpen(false);
              }}
            >
              <span>{y}</span>
              {y === year && (
                <Icon name="check" size={15} style={{ marginInlineStart: 'auto', color: 'var(--color-primary)' }} />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
