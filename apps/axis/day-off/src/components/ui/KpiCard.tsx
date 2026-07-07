/**
 * KpiCard — a single KPI tile (label + big value). `accent` is a CSS color
 * string exposed via the `--accent` var.
 */
import type { CSSProperties, ReactNode } from 'react';

export interface KpiCardProps {
  label: string;
  accent: string;
  value: ReactNode;
  unit?: string;
}

export function KpiCard({ label, accent, value, unit }: KpiCardProps) {
  return (
    <div className="kpi-card" style={{ '--accent': accent } as CSSProperties}>
      <div className="kpi-top">
        <span className="kpi-label">{label}</span>
      </div>
      <div className="kpi-value">
        {value}
        {unit && <span className="kpi-unit">{unit}</span>}
      </div>
    </div>
  );
}
