// Shared chart primitives: a theme-aware tooltip and small formatters. Text in
// tooltips wears ink tokens, never the series color (data-viz rule).

import type { ReactNode } from 'react';
import { useTheme } from '../../lib/theme';

export const nf = new Intl.NumberFormat('en-US');
export const fmt = (n: number) => nf.format(Math.round(n));

// Compact form for AXIS ticks (1200 → "1.2K"), so numeric ticks stay short and
// never get clipped by a narrow axis gutter. Tooltips keep the full `fmt` value.
const cf = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
export const compact = (n: number) => cf.format(Math.round(n));

interface TooltipRow {
  label: string;
  value: string;
  swatch?: string;
}

export function TooltipShell({ title, rows }: { title?: string; rows: TooltipRow[] }): ReactNode {
  const { chrome } = useTheme();
  return (
    <div
      style={{
        background: chrome.surface,
        border: `1px solid ${chrome.border}`,
        borderRadius: 8,
        padding: '8px 10px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.14)',
        fontSize: 12,
        lineHeight: 1.5,
        color: chrome.textPrimary,
        minWidth: 120,
      }}
    >
      {title && (
        <div style={{ fontWeight: 600, marginBottom: 4, color: chrome.textPrimary }}>{title}</div>
      )}
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'space-between' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: chrome.textSecondary }}>
            {r.swatch && (
              <span
                style={{ width: 10, height: 10, borderRadius: 2, background: r.swatch, display: 'inline-block' }}
              />
            )}
            {r.label}
          </span>
          <span style={{ fontVariantNumeric: 'tabular-nums', color: chrome.textPrimary }}>{r.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Small legend chip row — identity is never color-alone (paired with a label). */
export function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  const { chrome } = useTheme();
  return (
    <div className="legend">
      {items.map((it) => (
        <span key={it.label} className="legend__item" style={{ color: chrome.textSecondary }}>
          <span className="legend__swatch" style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

export function EmptyPanel({ note = 'No data in this window' }: { note?: string }) {
  const { chrome } = useTheme();
  return (
    <div className="empty" style={{ color: chrome.muted }}>
      {note}
    </div>
  );
}
