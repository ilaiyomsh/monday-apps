// KPI-row guard. The live payload's kpi_summary is a single-row summarize that the
// server exposes as `{}` when that one APL panel fails (telemetry-service.js) — every
// other panel can still succeed. KpiRow.tsx used to read kpi.error_rate.toFixed(2)
// straight off that object, so a missing panel turned into a TypeError that tripped the
// WHOLE-app ErrorBoundary. normalizeKpi() is the pure guard: it returns a fully-numeric
// summary to render, or null so the row shows a placeholder instead of crashing.

/** The seven numeric fields of a KPI summary, in row order. */
export const KPI_FIELDS = [
  'total',
  'errors',
  'usage',
  'health',
  'distinct_accounts',
  'distinct_apps',
  'error_rate',
];

/**
 * Coerce a raw kpi_summary into a safe, fully-numeric summary — or null when there is no
 * usable panel data (missing object, empty `{}`, or every field non-numeric), which the
 * caller renders as a skeleton. Non-finite / non-number fields degrade to 0 rather than
 * throwing; a summary that has at least one real numeric field is kept.
 * @param {unknown} raw
 * @returns {{total:number, errors:number, usage:number, health:number, distinct_accounts:number, distinct_apps:number, error_rate:number} | null}
 */
export function normalizeKpi(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  let hasNumeric = false;
  for (const field of KPI_FIELDS) {
    const v = raw[field];
    if (typeof v === 'number' && Number.isFinite(v)) {
      out[field] = v;
      hasNumeric = true;
    } else {
      out[field] = 0;
    }
  }
  return hasNumeric ? out : null;
}
