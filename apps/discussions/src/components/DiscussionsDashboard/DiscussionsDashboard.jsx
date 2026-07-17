import React, { useMemo, useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell, Tooltip, LabelList,
  PieChart, Pie,
} from 'recharts';
import { DatePickerPopover } from '@generated/components/DatePickerPopover';
import { BrandLoader } from '@generated/components/BrandLoader';
import { useDashboardData } from '@generated/hooks/useDashboardData.js';
import { aggregateDashboard } from './dashboardAgg.js';
import logger from '@generated/utils/logger.js';
import { useViewTracking } from '@generated/utils/viewTracking.js';
import styles from './DiscussionsDashboard.module.css';

const RANGE_LABELS = [
  { key: 'week', label: 'שבוע' },
  { key: 'month', label: 'חודש' },
  { key: 'quarter', label: 'רבעון' },
  { key: 'year', label: 'שנה' },
  { key: 'custom', label: 'טווח מותאם' },
];
const MODE_LABELS = [
  { key: 'sum', label: 'סכום' },
  { key: 'avg', label: 'ממוצע' },
  { key: 'median', label: 'חציון' },
];
const MODE_NOUN = { sum: 'סך', avg: 'ממוצע', median: 'חציון' };
// Validated categorical palette (dataviz skill) — fixed order, never cycled.
const SERIES = ['#0073ea', '#008300', '#e87ba4', '#c98500', '#4a3aa7'];
const DONE_COLOR = '#00854d';
const DELAYED_COLOR = '#d83a52';

function ChartTooltip({ active, payload, label, suffix = '' }) {
  if (!active || !payload?.length) return null;
  return (
    <div className={styles.tooltip}>
      <div style={{ fontWeight: 700 }}>{payload[0]?.payload?.label ?? label}</div>
      <div>{payload[0].value}{suffix}</div>
    </div>
  );
}

// Distinct-people options for the three dimension filters, built from the data.
function peopleOptions(discussions, key) {
  const map = new Map();
  discussions.forEach((d) => (Array.isArray(d[key]) ? d[key] : []).forEach((p) => {
    if (p?.id != null && !map.has(String(p.id))) map.set(String(p.id), p.name || String(p.id));
  }));
  return [...map.entries()].map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'he'));
}

export function DiscussionsDashboard({ onBackToDiscussions }) {
  // v2 usage telemetry: one view_open per session for the dashboard view (D3).
  useViewTracking(logger, 'dashboard');
  const { data, loading, error } = useDashboardData();

  const [preset, setPreset] = useState('month');
  const [custom, setCustom] = useState({ from: null, to: null });
  const [leadId, setLeadId] = useState('');
  const [typeValue, setTypeValue] = useState('');
  const [participantId, setParticipantId] = useState('');
  const [mode, setMode] = useState('sum');

  const discussions = data?.discussions || [];
  const leadOpts = useMemo(() => peopleOptions(discussions, 'lead'), [discussions]);
  const participantOpts = useMemo(() => peopleOptions(discussions, 'participants'), [discussions]);
  const typeOpts = useMemo(() => {
    const s = new Set();
    discussions.forEach((d) => { if (d.type) s.add(d.type); });
    return [...s].sort((a, b) => a.localeCompare(b, 'he'));
  }, [discussions]);

  const model = useMemo(() => (data ? aggregateDashboard(data, {
    preset, custom, mode,
    leadId: leadId || null,
    typeValue: typeValue || null,
    participantId: participantId || null,
  }) : null), [data, preset, custom, mode, leadId, typeValue, participantId]);

  const noun = MODE_NOUN[mode];
  const eff = model?.effectiveness;
  const doneW = eff?.total ? (eff.done / eff.total) * 100 : 0;
  const delayedW = eff?.total ? (eff.delayed / eff.total) * 100 : 0;

  return (
    <div className={styles.root}>
      <div className={styles.topBar}>
        <button type="button" className={styles.backBtn} onClick={onBackToDiscussions}>← דיונים</button>
        <span className={styles.title}>📊 דשבורד דיונים</span>
      </div>

      <div className={styles.filters}>
        <div className={styles.pillGroup} role="group" aria-label="טווח זמן">
          {RANGE_LABELS.map((r) => (
            <button key={r.key} type="button" className={`${styles.pill} ${preset === r.key ? styles.on : ''}`} onClick={() => setPreset(r.key)}>
              {r.label}
            </button>
          ))}
        </div>
        {preset === 'custom' && (
          <span className={styles.customRange}>
            <DatePickerPopover variant="field" value={custom.from} onChange={(d) => setCustom((c) => ({ ...c, from: d }))} />
            <span className={styles.dash}>–</span>
            <DatePickerPopover variant="field" value={custom.to} onChange={(d) => setCustom((c) => ({ ...c, to: d }))} />
          </span>
        )}
        <select className={styles.dim} value={leadId} onChange={(e) => setLeadId(e.target.value)} aria-label="מנהל דיון">
          <option value="">מנהל דיון: הכל</option>
          {leadOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select className={styles.dim} value={typeValue} onChange={(e) => setTypeValue(e.target.value)} aria-label="סוג דיון">
          <option value="">סוג דיון: הכל</option>
          {typeOpts.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className={styles.dim} value={participantId} onChange={(e) => setParticipantId(e.target.value)} aria-label="משתתף">
          <option value="">משתתף: הכל</option>
          {participantOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <span className={styles.spacer} />
        <div className={styles.pillGroup} role="group" aria-label="צבירה">
          {MODE_LABELS.map((m) => (
            <button key={m.key} type="button" className={`${styles.pill} ${mode === m.key ? styles.on : ''}`} onClick={() => setMode(m.key)}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <BrandLoader />
      ) : error ? (
        <div className={styles.empty}>אירעה שגיאה בטעינת נתוני הדשבורד</div>
      ) : (
        <>
          <div className={styles.heroRow}>
            <div className={styles.hero}>
              <span className={styles.heroLabel}>אפקטיביות דיונים</span>
              <span className={styles.heroValue}>{eff.pct}%</span>
              <span className={styles.heroSub}>{eff.done} משימות בוצעו · {eff.delayed} בעיכוב (עבר הדדליין וטרם בוצעו) · מתוך {eff.total}</span>
              <div className={styles.effBar}>
                <div style={{ width: `${doneW}%`, background: '#7fd8a9' }} />
                <div style={{ width: 2, background: 'rgba(255,255,255,.6)' }} />
                <div style={{ width: `${delayedW}%`, background: '#ffb3c0' }} />
              </div>
            </div>
            <div className={styles.kpis}>
              <div className={styles.kpi} style={{ '--accent': SERIES[0] }}>
                <div className={styles.kLabel}>סך דיונים</div>
                <div className={styles.kValue}>{model.totalDiscussions}</div>
              </div>
              <div className={styles.kpi} style={{ '--accent': SERIES[2] }}>
                <div className={styles.kLabel}>{noun} השתתפויות{mode !== 'sum' ? ' לדיון' : ''}</div>
                <div className={styles.kValue}>{model.participations}</div>
              </div>
              <div className={styles.kpi} style={{ '--accent': SERIES[4] }}>
                <div className={styles.kLabel}>{noun} החלטות{mode !== 'sum' ? ' לדיון' : ''}</div>
                <div className={styles.kValue}>{model.decisionsPerDiscussion}</div>
              </div>
              <div className={styles.kpi} style={{ '--accent': SERIES[3] }}>
                <div className={styles.kLabel}>{noun} משימות{mode !== 'sum' ? ' לדיון' : ''}</div>
                <div className={styles.kValue}>{model.tasksPerDiscussion}</div>
              </div>
            </div>
          </div>

          <div className={styles.grid}>
            <div className={styles.card}>
              <div className={styles.cardTitle}>דיונים לפי חודש</div>
              {model.byMonth.length === 0 ? <div className={styles.empty}>אין נתונים בטווח</div> : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={model.byMonth} margin={{ top: 18, right: 8, left: 8, bottom: 4 }}>
                    <CartesianGrid vertical={false} stroke="#edf0f6" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9699a6' }} axisLine={false} tickLine={false} />
                    <YAxis hide />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(0,115,234,.06)' }} />
                    <Bar dataKey="count" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={46}>
                      <LabelList dataKey="count" position="top" style={{ fontSize: 11, fill: '#323338', fontWeight: 600 }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className={styles.card}>
              <div className={styles.cardTitle}>התפלגות לפי סוג דיון</div>
              {model.byType.length === 0 ? <div className={styles.empty}>אין נתונים בטווח</div> : (
                <div className={styles.donutWrap}>
                  <ResponsiveContainer width={150} height={150}>
                    <PieChart>
                      <Pie data={model.byType} dataKey="count" nameKey="label" innerRadius={42} outerRadius={68} paddingAngle={2} stroke="#fff" strokeWidth={2}>
                        {model.byType.map((entry, i) => <Cell key={entry.label} fill={SERIES[i % SERIES.length]} />)}
                      </Pie>
                      <Tooltip content={<ChartTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className={styles.legend}>
                    {model.byType.map((entry, i) => (
                      <span key={entry.label}>
                        <span className={styles.sw} style={{ background: SERIES[i % SERIES.length] }} />
                        {entry.label} · <b>{entry.count}</b>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className={styles.card}>
              <div className={styles.cardTitle}>השתתפויות — 5 מובילים</div>
              {model.byParticipant.length === 0 ? <div className={styles.empty}>אין נתונים בטווח</div> : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart layout="vertical" data={model.byParticipant} margin={{ top: 4, right: 28, left: 8, bottom: 4 }}>
                    <CartesianGrid horizontal={false} stroke="#edf0f6" />
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 11, fill: '#676879' }} axisLine={false} tickLine={false} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(232,123,164,.08)' }} />
                    <Bar dataKey="count" fill={SERIES[2]} radius={[0, 4, 4, 0]} maxBarSize={22}>
                      <LabelList dataKey="count" position="right" style={{ fontSize: 11, fill: '#323338', fontWeight: 600 }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default DiscussionsDashboard;
