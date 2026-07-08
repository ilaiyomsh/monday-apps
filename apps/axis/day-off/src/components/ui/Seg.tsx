/**
 * Seg — a small segmented control (pill toggle group). Ported from dashboard.jsx.
 * Each option may carry a `color` for a leading swatch dot.
 */
import type { CSSProperties } from 'react';

export interface SegOption<T extends string = string> {
  value: T;
  label: string;
  color?: string;
}

export interface SegProps<T extends string = string> {
  value: T;
  options: SegOption<T>[];
  onChange: (value: T) => void;
}

export function Seg<T extends string = string>({ value, options, onChange }: SegProps<T>) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button
          key={o.value}
          className={`seg-btn ${value === o.value ? 'active' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.color && <span className="seg-dot" style={{ background: o.color } as CSSProperties} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}
