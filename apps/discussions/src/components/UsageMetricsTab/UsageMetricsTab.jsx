import React, { useEffect, useRef, useState, useMemo } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { BrandLoader } from '@generated/components/BrandLoader';
import { loadUsageData, buildSeries, averageDailyUsers } from '@generated/utils/usageMetrics.js';
import logger from '@generated/utils/logger.js';
import styles from './UsageMetricsTab.module.css';

const METRICS = [
  { key: 'entries', label: 'כניסות (משתמשים ייחודיים)' },
  { key: 'actions', label: 'פעולות באפליקציה' },
];
const GRANULARITIES = [
  { key: 'day', label: 'יום' },
  { key: 'week', label: 'שבוע' },
  { key: 'month', label: 'חודש' },
];

/**
 * Owner-only usage dashboard (round265). Loads the per-user usage dataset from
 * monday.storage (via utils/usageMetrics), then renders a LINE (trend) chart of
 * either unique entries or total actions, bucketed by day / week / month, plus an
 * average-daily-users KPI. The standard BrandLoader shows while loading.
 *
 * `active` gates the (fan-out) read so it runs only when the owner opens this tab
 * — never on every settings open — keeping the rest of the app untouched.
 */
export function UsageMetricsTab({ active }) {
  const [loading, setLoading] = useState(true);
  const [userDocs, setUserDocs] = useState(null);
  const [metric, setMetric] = useState('entries');
  const [granularity, setGranularity] = useState('day');
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!active || loadedRef.current) return;
    loadedRef.current = true;
    let alive = true;
    setLoading(true);
    loadUsageData()
      .then((docs) => { if (alive) { setUserDocs(docs); setLoading(false); } })
      .catch((err) => {
        // loadUsageData already tolerates storage failures, but guard the promise
        // so a rejection is recorded rather than swallowed, and still leaves the
        // tab in a clean empty state.
        logger.warn('UsageMetricsTab', 'טעינת מדדי השימוש נכשלה', err);
        if (alive) { setUserDocs({}); setLoading(false); }
      });
    return () => { alive = false; };
  }, [active]);

  const series = useMemo(
    () => (userDocs ? buildSeries(userDocs, granularity, metric) : []),
    [userDocs, granularity, metric]
  );
  const avgDaily = useMemo(() => (userDocs ? averageDailyUsers(userDocs) : 0), [userDocs]);
  const totalActions = useMemo(
    () => (userDocs ? buildSeries(userDocs, 'month', 'actions').reduce((s, r) => s + r.value, 0) : 0),
    [userDocs]
  );

  if (loading) {
    return (
      <div className={styles.center} dir="rtl">
        <BrandLoader />
      </div>
    );
  }

  const hasData = series.length > 0;
  const lineColor = metric === 'actions' ? '#6b4ee6' : '#0073ea';
  // round288 — short axis tick labels so the X values are readable instead of
  // clipped ISO strings: day/week bucket "YYYY-MM-DD" → "DD/MM"; month
  // "YYYY-MM" → "MM/YY".
  const fmtTick = (b) => {
    const s = String(b ?? '');
    const p = s.split('-');
    if (granularity === 'month') return p.length >= 2 ? `${p[1]}/${p[0].slice(2)}` : s;
    return p.length >= 3 ? `${p[2]}/${p[1]}` : s;
  };

  return (
    <div className={styles.root} dir="rtl">
      {/* KPI row */}
      <div className={styles.kpis}>
        <div className={styles.kpi}>
          <span className={styles.kpiValue}>{avgDaily.toFixed(1)}</span>
          <span className={styles.kpiLabel}>ממוצע משתמשים ביום</span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiValue}>{totalActions.toLocaleString('he-IL')}</span>
          <span className={styles.kpiLabel}>סך פעולות שנרשמו</span>
        </div>
      </div>

      {/* controls */}
      <div className={styles.controls}>
        <div className={styles.segGroup} role="group" aria-label="מדד">
          {METRICS.map((m) => (
            <button
              key={m.key}
              type="button"
              className={`${styles.seg} ${metric === m.key ? styles.segOn : ''}`}
              onClick={() => setMetric(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className={styles.segGroup} role="group" aria-label="רזולוציה">
          {GRANULARITIES.map((g) => (
            <button
              key={g.key}
              type="button"
              className={`${styles.seg} ${granularity === g.key ? styles.segOn : ''}`}
              onClick={() => setGranularity(g.key)}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      {/* trend chart */}
      {hasData ? (
        <div className={styles.chartWrap}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 12, right: 22, left: 6, bottom: 14 }}>
              <defs>
                <linearGradient id="usageFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={lineColor} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              {/* round288 — readable, elegant axes: horizontal grid only; short
                  date ticks (DD/MM); bold tick text; edge padding so the first/last
                  X label isn't clipped; a wider Y gutter. */}
              <CartesianGrid strokeDasharray="3 3" stroke="#e6e9ef" vertical={false} />
              <XAxis
                dataKey="bucket"
                reversed
                tickFormatter={fmtTick}
                tick={{ fontSize: 13, fontWeight: 600, fill: '#676879' }}
                tickMargin={10}
                height={34}
                axisLine={{ stroke: '#c3c6d4' }}
                tickLine={{ stroke: '#c3c6d4' }}
                interval="preserveStartEnd"
                minTickGap={28}
                padding={{ left: 16, right: 16 }}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 13, fontWeight: 600, fill: '#676879' }}
                tickMargin={6}
                width={46}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                labelFormatter={fmtTick}
                formatter={(v) => [v, metric === 'actions' ? 'פעולות' : 'כניסות']}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke={lineColor}
                strokeWidth={2.5}
                fill="url(#usageFill)"
                dot={{ r: 3, fill: lineColor }}
                activeDot={{ r: 5 }}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className={styles.empty}>אין עדיין נתוני שימוש להצגה.</div>
      )}

      <p className={styles.note}>
        הנתונים נאספים לכל משתמשי האפליקציה. כניסה נספרת פעם ביום למשתמש; פעולה = כל לחיצה על כפתור.
      </p>
    </div>
  );
}

export default UsageMetricsTab;
