import React, { useMemo, useState, useRef, useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Avatar } from '@vibe/core';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell, Tooltip, LabelList,
  PieChart, Pie,
} from 'recharts';
import { DatePickerPopover } from '@generated/components/DatePickerPopover';
import { BrandLoader } from '@generated/components/BrandLoader';
import { useDashboardData } from '@generated/hooks/useDashboardData.js';
import { useSettings } from '@generated/contexts/SettingsContext.jsx';
import { useUsers } from '@api/hooks/use-users';
import { openOrToggleItemCard } from '@generated/utils/itemCard.js';
import { aggregateDashboard } from './dashboardAgg.js';
import logger from '@generated/utils/logger.js';
import { useViewTracking } from '@generated/utils/viewTracking.js';
import styles from './DiscussionsDashboard.module.css';

const RANGE_LABELS = [
  { key: 'day', label: 'יום' },
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

const pad2 = (n) => String(n).padStart(2, '0');
function fmtDate(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`;
}
// First-letters fallback for an avatar with no photo (mirrors PersonAvatar).
function initialsOf(name) {
  return (name || '?').split(' ').map((n) => n[0]).join('').slice(0, 2);
}

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
  // round158 — the owner-set brand logo (data-URI in settings) now anchors the
  // dashboard's top-left corner (moved here off the discussions-view header).
  const { settings } = useSettings();
  const logoUrl = settings?.preferences?.logoUrl || null;

  // round158 — the dashboard opens on the DAY slice (owner spec): daily buckets
  // + a trailing-week window (round154 opened on 'week').
  const [preset, setPreset] = useState('day');
  const [custom, setCustom] = useState({ from: null, to: null });
  const [leadId, setLeadId] = useState('');
  const [typeValue, setTypeValue] = useState('');
  const [participantId, setParticipantId] = useState('');
  const [mode, setMode] = useState('sum');
  // Click-to-drill-down: which bar (period bucket) or donut slice (type) is open.
  const [drill, setDrill] = useState(null); // { kind:'period'|'type', key } | null
  const drillRef = useRef(null);

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

  // round156 — top-participants widget: resolve each leader's monday photo via
  // the shared users cache (fetches on demand, re-renders when avatars arrive).
  const topParticipants = model?.byParticipant || [];
  const partIds = useMemo(() => topParticipants.map((p) => String(p.id)), [topParticipants]);
  const { users: partUsers } = useUsers(partIds);
  const usersById = useMemo(() => new Map(partUsers.map((u) => [String(u.id), u])), [partUsers]);
  const maxPart = topParticipants.reduce((m, p) => Math.max(m, p.count), 0);

  // Toggle a bar/slice open; picking the same one again closes the list.
  const pickDrill = (kind, key) => {
    if (key == null) return;
    setDrill((prev) => (prev && prev.kind === kind && prev.key === key ? null : { kind, key }));
  };
  // Changing what's IN scope invalidates a bucket/type selection — close it.
  useEffect(() => { setDrill(null); }, [preset, custom, leadId, typeValue, participantId]);

  // Resolve the open selection to its discussion list (drill-down).
  const drillView = useMemo(() => {
    if (!drill || !model) return null;
    const src = drill.kind === 'period' ? model.byPeriod : model.byType;
    const match = src.find((x) => (drill.kind === 'period' ? x.key : x.label) === drill.key);
    if (!match || !match.items.length) return null;
    return { title: match.label, items: match.items };
  }, [drill, model]);

  useEffect(() => {
    if (drillView && drillRef.current) drillRef.current.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }, [drill]); // eslint-disable-line react-hooks/exhaustive-deps

  const noun = MODE_NOUN[mode];
  const eff = model?.effectiveness;
  const doneW = eff?.total ? (eff.done / eff.total) * 100 : 0;
  const delayedW = eff?.total ? (eff.delayed / eff.total) * 100 : 0;
  // round159 — hide empty period buckets from the bar chart (owner: a day / week
  // / month with no discussions in it isn't drawn as an empty column).
  const barData = model ? model.byPeriod.filter((b) => b.count > 0) : [];

  return (
    <div className={styles.root}>
      {/* Header — same pattern as "המשימות שלי"/"ההחלטות שלי": LTR row so the
          back arrow sits physically LEFT of the RTL title, on the shared gutter. */}
      <div className={styles.viewHeader}>
        {onBackToDiscussions && (
          <button
            type="button"
            className={styles.backArrowBtn}
            onClick={onBackToDiscussions}
            aria-label="בחזרה לתצוגת הדיונים"
            title="בחזרה לתצוגת הדיונים"
          >
            <ArrowLeft size={20} aria-hidden="true" />
          </button>
        )}
        <h1 className={styles.viewTitle}>דשבורד דיונים</h1>
      </div>

      <div className={styles.scroll}>
        {/* round158 — three-zone layout: a LEFT rail (client logo + vertical
            filter), then a 2×2 grid that locks same-row cell heights
            ([eff+cubes] ‖ bar) / (participants ‖ donut). */}
        <div className={styles.body}>
          <div className={styles.colFilter}>
            {logoUrl && (
              <div className={styles.logoCard}>
                <img className={styles.logoImg} src={logoUrl} alt="לוגו" />
              </div>
            )}
            <div className={styles.filterCard}>
              <div className={styles.fHead}>סינון</div>
              <div className={styles.fSection}>
                <div className={styles.fLabel}>טווח זמן</div>
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
              </div>
              <div className={styles.fSection}>
                <div className={styles.fLabel}>מסננים</div>
                <select className={styles.dimSelect} value={leadId} onChange={(e) => setLeadId(e.target.value)} aria-label="מנהל דיון">
                  <option value="">מנהל דיון: הכל</option>
                  {leadOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <select className={styles.dimSelect} value={typeValue} onChange={(e) => setTypeValue(e.target.value)} aria-label="סוג דיון">
                  <option value="">סוג דיון: הכל</option>
                  {typeOpts.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <select className={styles.dimSelect} value={participantId} onChange={(e) => setParticipantId(e.target.value)} aria-label="משתתף">
                  <option value="">משתתף: הכל</option>
                  {participantOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className={styles.fSection}>
                <div className={styles.fLabel}>צבירה</div>
                <div className={styles.pillGroup} role="group" aria-label="צבירה">
                  {MODE_LABELS.map((m) => (
                    <button key={m.key} type="button" className={`${styles.pill} ${mode === m.key ? styles.on : ''}`} onClick={() => setMode(m.key)}>
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
              {model && (
                <div className={styles.fFoot}>מציג <b>{model.totalDiscussions} דיונים</b> בטווח הנבחר</div>
              )}
            </div>
          </div>

          <div className={styles.main}>
            {loading ? (
              <div className={styles.spanAll}><BrandLoader /></div>
            ) : error || !model ? (
              <div className={`${styles.spanAll} ${styles.empty}`}>אירעה שגיאה בטעינת נתוני הדשבורד</div>
            ) : (
              <>
                {/* row 1, left cell — effectiveness + 4 KPI cubes */}
                <div className={styles.cellEff}>
                  {/* round159 — the score sits on the LEFT of the widget (like the
                      KPI cubes); the label + breakdown + bar stack on the right. */}
                  <div className={styles.hero}>
                    <div className={styles.heroBody}>
                      <span className={styles.heroLabel}>
                        אפקטיביות דיונים
                        {/* round154 item 7 (owner-approved formula) — a "?" to the LEFT
                            of the title with an RTL hover explanation of the score. */}
                        <span className={styles.effHelp}>
                          <button type="button" className={styles.effHelpIcon} aria-label="איך מחושב ציון האפקטיביות">?</button>
                          <span className={styles.effTip} role="tooltip">
                            ציון האפקטיביות = מספר המשימות שבוצעו מתוך סך כל המשימות של הדיונים שבטווח/בסינון הנוכחי (למשל 2 מתוך 26 = 8%). משימות בעיכוב — כאלה שעבר הדדליין שלהן וטרם בוצעו — מוצגות לצד המספר אך אינן נכנסות למכנה.
                          </span>
                        </span>
                      </span>
                      <span className={styles.heroSub}>{eff.done} משימות בוצעו · {eff.delayed} בעיכוב (עבר הדדליין וטרם בוצעו) · מתוך {eff.total}</span>
                      <div className={styles.effBar}>
                        <div style={{ width: `${doneW}%`, background: '#7fd8a9' }} />
                        <div style={{ width: 2, background: 'rgba(255,255,255,.6)' }} />
                        <div style={{ width: `${delayedW}%`, background: '#ffb3c0' }} />
                      </div>
                    </div>
                    <span className={styles.heroValue}>{eff.pct}%</span>
                  </div>
                  <div className={styles.kpis}>
                    <div className={styles.kpi} style={{ '--accent': SERIES[0] }}>
                      <div className={styles.kLabel}>סך דיונים</div>
                      <div className={styles.kValue}>{model.totalDiscussions}</div>
                    </div>
                    <div className={styles.kpi} style={{ '--accent': SERIES[2] }}>
                      <div className={styles.kLabel}>{noun} משתתפים בדיונים{mode !== 'sum' ? ' לדיון' : ''}</div>
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

                {/* row 1, right cell — daily bar chart (each bar its own color) */}
                <div className={`${styles.card} ${styles.barCard}`}>
                  <div className={styles.cardTitle}>דיונים {model.axisLabel}</div>
                  {barData.length === 0 ? <div className={styles.empty}>אין נתונים בטווח</div> : (
                    <div className={styles.chartFill}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={barData} margin={{ top: 18, right: 8, left: 8, bottom: 4 }}>
                          <CartesianGrid vertical={false} stroke="#edf0f6" />
                          <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9699a6' }} axisLine={false} tickLine={false} />
                          <YAxis hide />
                          <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(0,115,234,.06)' }} />
                          <Bar
                            dataKey="count"
                            radius={[4, 4, 0, 0]}
                            maxBarSize={46}
                            cursor="pointer"
                            onClick={(d) => pickDrill('period', d?.payload?.key ?? d?.key)}
                          >
                            {barData.map((entry, i) => <Cell key={entry.key} fill={SERIES[i % SERIES.length]} />)}
                            <LabelList dataKey="count" position="top" style={{ fontSize: 11, fill: '#323338', fontWeight: 600 }} />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>

                {/* row 2, left cell — top-5 participants */}
                <div className={`${styles.card} ${styles.partCard}`}>
                  <div className={styles.cardTitle}>משתתפים מובילים בדיונים · טופ 5</div>
                  {model.byParticipant.length === 0 ? <div className={styles.empty}>אין נתונים בטווח</div> : (
                    // round156 — a plain RTL row list (avatar RIGHT of the name, then
                    // a proportional bar, then the count). Replaces the recharts
                    // horizontal chart, whose Y-axis names got clipped / collided; the
                    // name now takes the row's flex space (ellipsis + hover title).
                    <div className={styles.partList}>
                      {model.byParticipant.map((p) => {
                        const u = usersById.get(String(p.id));
                        const name = u?.name || p.name;
                        const pct = maxPart ? Math.max(6, Math.round((p.count / maxPart) * 100)) : 0;
                        return (
                          <div key={p.id} className={styles.partRow}>
                            <span className={styles.partAvatar} title={name}>
                              <Avatar size="small" src={u?.photo_thumb || undefined} text={initialsOf(name)} type={u?.photo_thumb ? 'img' : 'text'} ariaLabel={name} />
                            </span>
                            <span className={styles.partName} title={name}>{name}</span>
                            <span className={styles.partBar}><span className={styles.partBarFill} style={{ width: `${pct}%` }} /></span>
                            <span className={styles.partCount}>{p.count}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* row 2, right cell — type donut (same height as participants) */}
                <div className={`${styles.card} ${styles.donutCard}`}>
                  <div className={styles.cardTitle}>התפלגות לפי סוג דיון</div>
                  {model.byType.length === 0 ? <div className={styles.empty}>אין נתונים בטווח</div> : (
                    <div className={styles.donutWrap}>
                      <ResponsiveContainer width={150} height={150}>
                        <PieChart>
                          <Pie
                            data={model.byType}
                            dataKey="count"
                            nameKey="label"
                            innerRadius={42}
                            outerRadius={68}
                            paddingAngle={2}
                            stroke="#fff"
                            strokeWidth={2}
                            cursor="pointer"
                            onClick={(d) => pickDrill('type', d?.label ?? d?.payload?.label)}
                          >
                            {model.byType.map((entry, i) => <Cell key={entry.label} fill={SERIES[i % SERIES.length]} />)}
                          </Pie>
                          <Tooltip content={<ChartTooltip />} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className={styles.legend}>
                        {model.byType.map((entry, i) => (
                          <button
                            key={entry.label}
                            type="button"
                            className={styles.legendRow}
                            onClick={() => pickDrill('type', entry.label)}
                          >
                            <span className={styles.sw} style={{ background: SERIES[i % SERIES.length] }} />
                            {entry.label} · <b>{entry.count}</b>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Drill-down: the discussions that compose the clicked bar / slice
            (mirrors the effectiveness-dashboard bar drill-down). Full width,
            below the grid. */}
        {!loading && !error && model && drillView && (
          <div className={styles.drill} ref={drillRef}>
            <div className={styles.drillHeader}>
              <span className={styles.drillTitle}>דיונים · {drillView.title} · {drillView.items.length}</span>
              <button type="button" className={styles.drillClose} onClick={() => setDrill(null)}>סגור ✕</button>
            </div>
            <div className={styles.drillList}>
              {drillView.items.map((it) => (
                <button key={it.id} type="button" className={styles.drillItem} onClick={() => openOrToggleItemCard(it.id)}>
                  <span className={styles.drillName}>{it.name}</span>
                  <span className={styles.drillDate}>{fmtDate(it.date)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default DiscussionsDashboard;
