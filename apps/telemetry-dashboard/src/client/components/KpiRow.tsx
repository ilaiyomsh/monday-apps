// KPI row — seven stat tiles summarizing the current window/filters. Stat tiles
// are not charts: big proportional figure, muted label, one accent tile for the
// error rate (status-tinted). Values use plain figures; no color-only meaning.

import { useTheme } from '../lib/theme';
import { STATUS } from '../lib/palette';
import type { KpiSummary } from '../lib/types';
import { fmt } from './charts/shared';

interface Tile {
  label: string;
  value: string;
  accent?: string;
}

export function KpiRow({ kpi }: { kpi: KpiSummary }) {
  const { chrome } = useTheme();

  const rateAccent =
    kpi.error_rate >= 10 ? STATUS.critical : kpi.error_rate >= 3 ? STATUS.warning : STATUS.good;

  const tiles: Tile[] = [
    { label: 'Total records', value: fmt(kpi.total) },
    { label: 'Errors', value: fmt(kpi.errors), accent: STATUS.critical },
    { label: 'Usage', value: fmt(kpi.usage) },
    { label: 'Health', value: fmt(kpi.health) },
    { label: 'Accounts', value: fmt(kpi.distinct_accounts) },
    { label: 'Apps', value: fmt(kpi.distinct_apps) },
    { label: 'Error rate', value: `${kpi.error_rate.toFixed(2)}%`, accent: rateAccent },
  ];

  return (
    <div className="kpi-row">
      {tiles.map((t) => (
        <div className="kpi" key={t.label} style={{ borderColor: chrome.border }}>
          <div className="kpi__value" style={{ color: t.accent ?? chrome.textPrimary }}>
            {t.value}
          </div>
          <div className="kpi__label" style={{ color: chrome.textSecondary }}>
            {t.label}
          </div>
        </div>
      ))}
    </div>
  );
}
