// KPI row — seven stat tiles summarizing the current window/filters. Stat tiles
// are not charts: big proportional figure, muted label, one accent tile for the
// error rate (status-tinted). Values use plain figures; no color-only meaning.

import { useTheme } from '../lib/theme';
import { STATUS } from '../lib/palette';
import type { KpiSummary } from '../lib/types';
import { normalizeKpi } from '../lib/kpi';
import { fmt } from './charts/shared';

interface Tile {
  label: string;
  value: string;
  accent?: string;
}

const SKELETON_LABELS = [
  'Total records',
  'Errors',
  'Usage',
  'Health',
  'Accounts',
  'Apps',
  'Error rate',
];

// kpi_summary can arrive as {} when the live kpi panel alone failed (the other panels
// still rendered). Guard it here so a missing panel shows placeholders instead of
// tripping the whole-app ErrorBoundary. The prop is typed loose because the runtime
// value from the server is not guaranteed to match KpiSummary.
export function KpiRow({ kpi }: { kpi: KpiSummary | Record<string, unknown> | null | undefined }) {
  const { chrome } = useTheme();
  const safe = normalizeKpi(kpi);

  if (!safe) {
    return (
      <div className="kpi-row">
        {SKELETON_LABELS.map((label) => (
          <div className="kpi" key={label} style={{ borderColor: chrome.border }}>
            <div className="kpi__value" style={{ color: chrome.muted }}>—</div>
            <div className="kpi__label" style={{ color: chrome.textSecondary }}>{label}</div>
          </div>
        ))}
      </div>
    );
  }

  const rateAccent =
    safe.error_rate >= 10 ? STATUS.critical : safe.error_rate >= 3 ? STATUS.warning : STATUS.good;

  const tiles: Tile[] = [
    { label: 'Total records', value: fmt(safe.total) },
    { label: 'Errors', value: fmt(safe.errors), accent: STATUS.critical },
    { label: 'Usage', value: fmt(safe.usage) },
    { label: 'Health', value: fmt(safe.health) },
    { label: 'Accounts', value: fmt(safe.distinct_accounts) },
    { label: 'Apps', value: fmt(safe.distinct_apps) },
    { label: 'Error rate', value: `${safe.error_rate.toFixed(2)}%`, accent: rateAccent },
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
