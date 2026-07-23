import React, { useEffect, useRef, useState, useMemo } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
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
            <LineChart data={series} margin={{ top: 12, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e6e9ef" />
              <XAxis dataKey="bucket" tick={{ fontSize: 12 }} reversed />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} width={40} />
              <Tooltip
                labelFormatter={(v) => v}
                formatter={(v) => [v, metric === 'actions' ? 'פעולות' : 'כניסות']}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke={lineColor}
                strokeWidth={2.5}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
                isAnimationActive={false}
              />
            </LineChart>
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
