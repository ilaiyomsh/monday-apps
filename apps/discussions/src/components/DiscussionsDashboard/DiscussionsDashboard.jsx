import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { ArrowLeft, Pencil, Check, RotateCcw, EyeOff, GripVertical } from 'lucide-react';
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
import {
  WIDGET_IDS, WIDGETS, ROW_H, GRID_GAP,
  resolveLayout, moveRect, resizeRect, rectToPx, pxDeltaToCells, layoutRows,
} from './dashboardLayout.js';
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

export function DiscussionsDashboard({ onBackToDiscussions, canManageSettings = false }) {
  // v2 usage telemetry: one view_open per session for the dashboard view (D3).
  useViewTracking(logger, 'dashboard');
  const { data, loading, error } = useDashboardData();
  // round158 — the owner-set brand logo (data-URI in settings) now anchors the
  // dashboard's top-left corner (moved here off the discussions-view header).
  const { settings, updateSettings } = useSettings();
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

  // ---- round160: owner-editable free-form widget layout ---------------------
  // A stored { widgetId: {x,y,w,h,hidden} } map (settings.preferences, owner-only
  // write) resolves over the default grid; in edit mode each widget can be
  // dragged, edge/corner-resized, and hidden. Non-owners get the saved layout,
  // read-only.
  const storedLayout = settings?.preferences?.dashboardLayout;
  const layout = useMemo(() => resolveLayout(storedLayout), [storedLayout]);
  const canEditLayout = !!canManageSettings;
  const [editing, setEditing] = useState(false);
  const [drag, setDrag] = useState(null); // { id, rect } — live preview during a gesture
  const gestureRef = useRef(null);
  const canvasRef = useRef(null);
  const [canvasW, setCanvasW] = useState(0);

  const measureCanvas = useCallback((node) => {
    if (node) { canvasRef.current = node; setCanvasW(node.clientWidth || 0); }
  }, []);
  useEffect(() => {
    const el = canvasRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setCanvasW(el.clientWidth || 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, [loading, error, editing]);

  const toStored = useCallback((l) => {
    const out = {};
    WIDGET_IDS.forEach((id) => {
      const it = l[id];
      out[id] = { x: it.x, y: it.y, w: it.w, h: it.h, hidden: !!it.hidden };
    });
    return out;
  }, []);
  const persistLayout = useCallback((stored) => {
    if (canEditLayout) updateSettings({ preferences: { dashboardLayout: stored } });
  }, [canEditLayout, updateSettings]);
  const commitRect = useCallback((id, rect) => {
    persistLayout(toStored({ ...layout, [id]: { ...layout[id], ...rect } }));
  }, [layout, toStored, persistLayout]);
  const toggleHidden = useCallback((id) => {
    persistLayout(toStored({ ...layout, [id]: { ...layout[id], hidden: !layout[id].hidden } }));
  }, [layout, toStored, persistLayout]);
  const resetLayout = useCallback(() => { persistLayout({}); }, [persistLayout]);

  // One pointer handler for both move (dir=null) and edge/corner resize.
  const beginGesture = useCallback((e, id, dir) => {
    if (!editing) return;
    e.preventDefault();
    e.stopPropagation();
    const g = { id, dir, startX: e.clientX, startY: e.clientY, startRect: layout[id] };
    gestureRef.current = g;
    setDrag({ id, rect: g.startRect });
    const nextRect = (ev) => {
      const { dCols, dRows } = pxDeltaToCells(ev.clientX - g.startX, ev.clientY - g.startY, canvasW || 1);
      return g.dir ? resizeRect(g.startRect, g.dir, dCols, dRows) : moveRect(g.startRect, dCols, dRows);
    };
    const onMove = (ev) => { if (gestureRef.current) setDrag({ id: g.id, rect: nextRect(ev) }); };
    const onUp = (ev) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (gestureRef.current) { commitRect(g.id, nextRect(ev)); gestureRef.current = null; }
      setDrag(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [editing, layout, canvasW, commitRect]);

  const viewLayout = drag ? { ...layout, [drag.id]: { ...layout[drag.id], ...drag.rect } } : layout;
  const canvasHeight = layoutRows(viewLayout) * (ROW_H + GRID_GAP);
  const hiddenWidgets = WIDGETS.filter((w) => layout[w.id]?.hidden);

  // Content for one widget id. Only called in the loaded branch, so `model` and
  // `eff` are defined here.
  const cube = (accent, label, value) => (
    <div className={styles.kpi} style={{ '--accent': accent }}>
      <div className={styles.kLabel}>{label}</div>
      <div className={styles.kValue}>{value}</div>
    </div>
  );
  const renderWidget = (id) => {
    switch (id) {
      case 'logo':
        return logoUrl
          ? <div className={styles.logoCard}><img className={styles.logoImg} src={logoUrl} alt="לוגו" /></div>
          : <div className={`${styles.logoCard} ${styles.logoEmpty}`}>לוגו</div>;
      case 'filter':
        return (
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
            <div className={styles.fFoot}>מציג <b>{model.totalDiscussions} דיונים</b> בטווח הנבחר</div>
          </div>
        );
      case 'effectiveness':
        return (
          <div className={styles.hero}>
            <div className={styles.heroBody}>
              <span className={styles.heroLabel}>
                אפקטיביות דיונים
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
        );
      case 'cubeDiscussions':
        return cube(SERIES[0], 'סך דיונים', model.totalDiscussions);
      case 'cubeParticipants':
        return cube(SERIES[2], `${noun} משתתפים בדיונים${mode !== 'sum' ? ' לדיון' : ''}`, model.participations);
      case 'cubeDecisions':
        return cube(SERIES[4], `${noun} החלטות${mode !== 'sum' ? ' לדיון' : ''}`, model.decisionsPerDiscussion);
      case 'cubeTasks':
        return cube(SERIES[3], `${noun} משימות${mode !== 'sum' ? ' לדיון' : ''}`, model.tasksPerDiscussion);
      case 'bar':
        return (
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
        );
      case 'donut':
        return (
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
        );
      case 'participants':
        return (
          <div className={`${styles.card} ${styles.partCard}`}>
            <div className={styles.cardTitle}>משתתפים מובילים בדיונים · טופ 5</div>
            {model.byParticipant.length === 0 ? <div className={styles.empty}>אין נתונים בטווח</div> : (
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
        );
      default:
        return null;
    }
  };

  const ready = !loading && !error && !!model;

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
        {/* round160 — owner-only layout editor controls. */}
        {canEditLayout && ready && (
          <div className={styles.dashTools}>
            {editing ? (
              <>
                <button type="button" className={styles.toolBtn} onClick={resetLayout} title="החזרת הפריסה לברירת המחדל">
                  <RotateCcw size={15} aria-hidden="true" /> אפס
                </button>
                <button type="button" className={`${styles.toolBtn} ${styles.toolBtnDone}`} onClick={() => setEditing(false)}>
                  <Check size={15} aria-hidden="true" /> סיום עריכה
                </button>
              </>
            ) : (
              <button type="button" className={styles.toolBtn} onClick={() => setEditing(true)}>
                <Pencil size={15} aria-hidden="true" /> ערוך פריסה
              </button>
            )}
          </div>
        )}
      </div>

      <div className={styles.scroll}>
        {loading ? (
          <div className={styles.centerMsg}><BrandLoader /></div>
        ) : !ready ? (
          <div className={`${styles.centerMsg} ${styles.empty}`}>אירעה שגיאה בטעינת נתוני הדשבורד</div>
        ) : (
          <>
            {editing && hiddenWidgets.length > 0 && (
              <div className={styles.hiddenTray}>
                <span className={styles.trayLabel}>ווידג׳טים מוסתרים:</span>
                {hiddenWidgets.map((w) => (
                  <button key={w.id} type="button" className={styles.trayChip} onClick={() => toggleHidden(w.id)} title="החזרה לתצוגה">
                    {w.label} <span aria-hidden="true">＋</span>
                  </button>
                ))}
              </div>
            )}
            <div
              ref={measureCanvas}
              className={`${styles.canvas} ${editing ? styles.canvasEditing : ''}`}
              style={{ height: canvasHeight }}
            >
              {WIDGET_IDS.map((id) => {
                const rect = viewLayout[id];
                if (rect.hidden) return null;
                const px = rectToPx(rect, Math.max(canvasW, 1));
                return (
                  <div
                    key={id}
                    className={`${styles.widgetBox} ${editing ? styles.widgetEditing : ''} ${drag?.id === id ? styles.widgetActive : ''}`}
                    style={{ left: px.left, top: px.top, width: px.width, height: px.height }}
                  >
                    <div className={styles.widgetInner}>{renderWidget(id)}</div>
                    {editing && (
                      <>
                        <div className={styles.moveHandle} onPointerDown={(e) => beginGesture(e, id, null)} title="גרור להזזה">
                          <GripVertical size={14} aria-hidden="true" />
                        </div>
                        <button type="button" className={styles.hideBtn} onClick={() => toggleHidden(id)} title="הסתרת ווידג׳ט">
                          <EyeOff size={14} aria-hidden="true" />
                        </button>
                        <div className={`${styles.rHandle} ${styles.rhN}`} onPointerDown={(e) => beginGesture(e, id, 'n')} />
                        <div className={`${styles.rHandle} ${styles.rhS}`} onPointerDown={(e) => beginGesture(e, id, 's')} />
                        <div className={`${styles.rHandle} ${styles.rhE}`} onPointerDown={(e) => beginGesture(e, id, 'e')} />
                        <div className={`${styles.rHandle} ${styles.rhW}`} onPointerDown={(e) => beginGesture(e, id, 'w')} />
                        <div className={`${styles.rHandle} ${styles.rhSE}`} onPointerDown={(e) => beginGesture(e, id, 'se')} />
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Drill-down: the discussions that compose the clicked bar / slice.
            Full width, below the canvas. */}
        {ready && drillView && (
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
