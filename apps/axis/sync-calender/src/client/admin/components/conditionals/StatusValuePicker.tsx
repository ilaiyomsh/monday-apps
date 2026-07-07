import { useEffect, useRef, useState } from 'react';
import { parseStatusLabels, type StatusLabelOption } from '../../lib/columnSettings';
import type { Column, ConditionalValue } from '../../types';

interface Props {
  column: Column;
  value: ConditionalValue | null;
  disabled?: boolean;
  onChange: (next: ConditionalValue | null) => void;
}

// Fallback for labels missing a color in settings_str (rare — monday always
// provides one but we guard anyway so the tile is never invisible).
const FALLBACK_COLOR = '#c4c4c4';

function tileColor(o: StatusLabelOption): string {
  return o.color || FALLBACK_COLOR;
}

// Picks a readable text color for the tile given its fill. The light greys
// (~#c4c4c4) come out illegible with white text — everything else gets white.
function textOn(bg: string): string {
  if (!bg) return '#fff';
  const lower = bg.toLowerCase();
  if (lower === '#c4c4c4' || lower === '#9cd326') return '#323338';
  return '#fff';
}

export function StatusValuePicker({ column, value, disabled, onChange }: Props) {
  const labels = parseStatusLabels(column);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (labels.length === 0) {
    return <span style={{ color: '#676879', fontSize: 12 }}>No labels on this column.</span>;
  }

  const currentId = value?.type === 'status' ? value.value.id : null;
  const selected = currentId != null ? labels.find((l) => l.id === currentId) ?? null : null;
  const triggerBg = selected ? tileColor(selected) : '#c4c4c4';
  const triggerColor = textOn(triggerBg);

  return (
    <div className="status-picker" ref={ref}>
      <button
        type="button"
        className="status-trigger"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span
          className="status-label"
          style={{ background: triggerBg, color: triggerColor }}
        >
          {selected ? selected.label : 'Pick a status…'}
        </span>
        <span className="status-fold" />
      </button>
      {open && (
        <div className="status-menu" role="listbox">
          <div className="status-grid">
            {labels.map((o) => {
              const bg = tileColor(o);
              const isSel = o.id === currentId;
              return (
                <button
                  key={o.id}
                  type="button"
                  role="option"
                  aria-selected={isSel}
                  className={`status-tile${isSel ? ' selected' : ''}`}
                  style={{ background: bg, color: textOn(bg) }}
                  onClick={() => {
                    onChange({ type: 'status', value: { id: o.id } });
                    setOpen(false);
                  }}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
