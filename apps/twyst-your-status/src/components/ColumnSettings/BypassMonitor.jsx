import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { describeViolation } from '../../domain/bypassReason';
import { periodRange, previousRange } from '../../domain/reportingPeriod';
import { fetchBypasses } from '../../services/bypassMonitor';
import logger from '../../utils/logger';

/**
 * BypassMonitor — the owners-only panel that surfaces how many status changes
 * bypassed the column's rules (native editor / API), by period, with a
 * drill-down per event (round323). Read-only: it renders what the guard server
 * recorded. All the logic it leans on is unit-tested — periodRange/previousRange
 * (date math), fetchBypasses (the request), describeViolation (the Hebrew text);
 * this file is the view that composes them.
 *
 * Honest surface labels: the webhook can only tell "native editor" from
 * "API/integration", NOT mobile from the cold-load window — so the monitor says
 * exactly that and no more.
 *
 * @param {{
 *   boardId: string, columnId: string,
 *   labelsById: Record<string,string>, columnsById: Record<string,string>,
 *   usersById: Record<string,string>,
 * }} props
 */
const PERIODS = [
  { key: 'week', label: 'השבוע' },
  { key: 'month', label: 'החודש' },
  { key: 'year', label: 'השנה' },
  { key: 'custom', label: 'טווח תאריכים' },
];

const SURFACE = {
  native: { icon: '🖥️', short: 'עורך נייטיבי', text: 'השינוי בוצע דרך העורך הנייטיבי של monday — במובייל (שם פיצ׳רים של עמודות אינם נטענים) או בשניות הראשונות לטעינת הלוח, לפני שהאפליקציה נטענה. ה-webhook אינו מבחין בין שני המצבים.' },
  api: { icon: '🔌', short: 'API / אינטגרציה', text: 'השינוי הגיע דרך ה-API של monday — טוקן אישי או אינטגרציה חיצונית — שאינם עוברים דרך הבורר של האפליקציה.' },
};

function BypassMonitor({ boardId, columnId, labelsById, columnsById, usersById }) {
  const [period, setPeriod] = useState('week');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [state, setState] = useState({ status: 'loading', events: [] });
  const [prevCount, setPrevCount] = useState(null);
  const [expanded, setExpanded] = useState(true);
  const [openIdx, setOpenIdx] = useState(null);

  const range = useMemo(() => periodRange(period, Date.now(), custom), [period, custom]);

  const load = useCallback(async () => {
    setState({ status: 'loading', events: [] });
    setPrevCount(null);
    try {
      const prev = previousRange(period, range);
      const [cur, prior] = await Promise.all([
        fetchBypasses({ boardId, columnId, fromMs: range.fromMs, toMs: range.toMs }),
        fetchBypasses({ boardId, columnId, fromMs: prev.fromMs, toMs: prev.toMs }),
      ]);
      setState(cur);
      if (prior.status === 'ok') setPrevCount(prior.events.length);
    } catch (err) {
      logger.error('BypassMonitor', 'Failed to load bypass events', err);
      setState({ status: 'failed', events: [] });
    }
  }, [boardId, columnId, period, range]);

  useEffect(() => { load(); }, [load]);

  // The monitor is simply absent when the guard server is not configured for
  // this build — no empty scaffolding, no error.
  if (state.status === 'disabled') return null;

  const events = state.status === 'ok' ? state.events : [];
  const n = events.length;

  const renderTrend = () => {
    if (period === 'custom' || prevCount === null) return null;
    const word = period === 'week' ? 'משבוע שעבר' : period === 'month' ? 'מחודש שעבר' : 'משנה שעברה';
    const delta = n - prevCount;
    if (delta > 0) return <span className="tw-mon-trend up">▲ {delta} {word} ({prevCount})</span>;
    if (delta < 0) return <span className="tw-mon-trend down">▼ {Math.abs(delta)} {word} ({prevCount})</span>;
    return <span className="tw-mon-trend flat">ללא שינוי {word} ({prevCount})</span>;
  };

  const surfaceCounts = events.reduce((acc, e) => {
    const k = e.surface === 'api' ? 'api' : 'native';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  return (
    <section className="tw-mon" aria-label="עקיפות ההגדרות">
      <div className="tw-mon-head">
        <span className="tw-mon-kicker">🛡️ ניטור עקיפות</span>
        <p className="tw-mon-sub">
          כמה פעמים נקבע לייבל בדרך שההגדרות לא מתירות — שינוי מהנייד, או עריכה בשניות
          הראשונות לטעינת הלוח. המספרים עוזרים להחליט אם להפעיל החזרה אוטומטית.
        </p>
      </div>

      <div className="tw-mon-period">
        <div className="tw-seg" role="group" aria-label="בחירת תקופה">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              aria-pressed={period === p.key}
              onClick={() => { setPeriod(p.key); setOpenIdx(null); }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <span className="tw-mon-range">{range.label}</span>
      </div>
      {period === 'custom' && (
        <div className="tw-mon-custom">
          <label>מ־ <input type="date" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} /></label>
          <label>עד <input type="date" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} /></label>
        </div>
      )}

      {state.status === 'loading' && <div className="tw-mon-note">טוען…</div>}
      {state.status === 'not_activated' && (
        <div className="tw-mon-note">השומר עדיין לא חובר לחשבון. חברו אותו כדי להתחיל לנטר עקיפות.</div>
      )}
      {state.status === 'forbidden' && (
        <div className="tw-mon-note">רק בעלי העמודה יכולים לצפות בניטור.</div>
      )}
      {state.status === 'failed' && (
        <div className="tw-mon-note tw-mon-err">לא הצלחנו לטעון את נתוני הניטור. <button type="button" className="tw-mon-link" onClick={load}>נסו שוב</button></div>
      )}

      {state.status === 'ok' && (
        <>
          <button
            type="button"
            className="tw-mon-metric"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            <span className={`tw-mon-num${n === 0 ? ' zero' : ''}`}>{n}<small>{n === 1 ? 'עקיפה' : 'עקיפות'}</small></span>
            <span className="tw-mon-mid">
              <span className="tw-mon-metric-label">שינויים שעקפו את ההגדרות שנקבעו לעמודה</span>
              {renderTrend()}
              <span className="tw-mon-break">
                {surfaceCounts.native ? <span className="tw-mon-brk">🖥️ עורך נייטיבי <b>{surfaceCounts.native}</b></span> : null}
                {surfaceCounts.api ? <span className="tw-mon-brk">🔌 API <b>{surfaceCounts.api}</b></span> : null}
              </span>
            </span>
            <span className="tw-mon-chev" aria-hidden="true">{expanded ? '▲' : '▼'} פירוט</span>
          </button>

          {expanded && (
            <div className="tw-mon-events">
              {n === 0 ? (
                <div className="tw-mon-empty">🎉 לא זוהו עקיפות בתקופה זו. כל שינויי הסטטוס עברו דרך הבורר.</div>
              ) : (
                events.map((e, i) => renderEvent(e, i, {
                  open: openIdx === i,
                  onToggle: () => setOpenIdx((cur) => (cur === i ? null : i)),
                  labelsById, columnsById, usersById,
                }))
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function fmtWhen(ts) {
  const d = new Date(ts);
  const MON = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];
  const pad = (x) => (x < 10 ? '0' : '') + x;
  return { day: `${d.getDate()} ${MON[d.getMonth()]}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}`, year: d.getFullYear() };
}

function renderEvent(e, i, { open, onToggle, labelsById, columnsById, usersById }) {
  const who = usersById?.[String(e.userId)] ?? `משתמש ${e.userId}`;
  const surface = SURFACE[e.surface === 'api' ? 'api' : 'native'];
  const when = fmtWhen(e.ts);
  const technical = describeViolation(e.classification ?? {}, labelsById ?? {}, columnsById ?? {}, who);
  const fromName = e.fromLabelName || (e.fromLabelId === null ? '— ריק —' : `#${e.fromLabelId}`);
  const toName = e.toLabelName || (e.toLabelId === null ? '— ריק —' : `#${e.toLabelId}`);
  return (
    <div className={`tw-mon-ev${open ? ' open' : ''}`} key={i}>
      <button type="button" className="tw-mon-ev-row" aria-expanded={open} onClick={onToggle}>
        <span className="tw-mon-ev-when"><b>{when.day}</b>{when.time}</span>
        <span className="tw-mon-ev-mid">
          <span className="tw-mon-ev-item">{e.itemName || `פריט ${e.itemId}`}</span>
          <span className="tw-mon-ev-trans">{fromName} <span className="tw-mon-arrow">←</span> {toName}</span>
          <span className="tw-mon-ev-who">שינה: <b>{who}</b></span>
        </span>
        <span className="tw-mon-ev-tags">
          <span className="tw-mon-surface">{surface.icon} {surface.short}</span>
          <span className={`tw-mon-status ${e.reverted ? 'reverted' : 'monitored'}`}>
            {e.reverted ? '● הוחזרה אוטומטית' : '● זוהתה — לא הוחזרה'}
          </span>
        </span>
      </button>
      {open && (
        <div className="tw-mon-ev-detail">
          <div className="tw-mon-dt">
            <span className="tw-mon-dt-h">איך זה עקף את האפליקציה</span>
            <p>{surface.text}</p>
          </div>
          <div className="tw-mon-dt">
            <span className="tw-mon-dt-h">למה זה מנוגד להגדרות</span>
            <p>{technical}</p>
          </div>
          <div className="tw-mon-dt-meta">
            <span>אייטם: <b>{e.itemName || e.itemId}</b></span>
            <span>מי שינה: <b>{who}</b></span>
            <span>מתי: <b>{when.day} {when.year} · {when.time}</b></span>
          </div>
        </div>
      )}
    </div>
  );
}

export default BypassMonitor;
