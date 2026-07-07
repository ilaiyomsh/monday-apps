import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';

export interface DropdownOption<T extends string | number> {
  value: T;
  label: string;
}

interface DropdownSelectProps<T extends string | number> {
  value: T;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  icon?: string;
  className?: string;
  scrollSelectedToTopOnOpen?: boolean;
}

export function DropdownSelect<T extends string | number>({
  value,
  options,
  onChange,
  icon,
  className = '',
  scrollSelectedToTopOnOpen = false,
}: DropdownSelectProps<T>) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest('.dropdown-select')) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const current = useMemo(
    () => options.find((opt) => String(opt.value) === String(value)) ?? options[0],
    [options, value],
  );

  useEffect(() => {
    if (!open || !scrollSelectedToTopOnOpen) return;
    const selected = rootRef.current?.querySelector('.yr-opt.active') as HTMLElement | null;
    if (!selected || !menuRef.current) return;
    menuRef.current.scrollTop = selected.offsetTop;
  }, [open, scrollSelectedToTopOnOpen, value]);

  return (
    <div className={`yr-select dropdown-select ${className}`} ref={rootRef}>
      <button className="yr-btn" onClick={() => setOpen((o) => !o)}>
        {icon ? <Icon name={icon} size={16} /> : null}
        <span>{current?.label}</span>
        <Icon name="chevron-down" size={15} style={{ color: 'var(--color-text-secondary)' }} />
      </button>
      {open && (
        <div className="yr-menu" ref={menuRef}>
          {options.map((opt) => (
            <button
              key={String(opt.value)}
              className={`yr-opt ${String(opt.value) === String(value) ? 'active' : ''}`}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
            >
              <span>{opt.label}</span>
              {String(opt.value) === String(value) && (
                <Icon name="check" size={15} style={{ marginInlineStart: 'auto', color: 'var(--color-primary)' }} />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

