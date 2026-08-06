import { describeViolation } from '../../domain/bypassReason';

const SURFACE = {
  native: { icon: '🖥️', short: 'עורך נייטיבי', text: 'השינוי בוצע דרך העורך הנייטיבי של monday — במובייל (שם פיצ׳רים של עמודות אינם נטענים) או בשניות הראשונות לטעינת הלוח, לפני שהאפליקציה נטענה. ה-webhook אינו מבחין בין שני המצבים.' },
  api: { icon: '🔌', short: 'API / אינטגרציה', text: 'השינוי הגיע דרך ה-API של monday — טוקן אישי או אינטגרציה חיצונית — שאינם עוברים דרך הבורר של האפליקציה.' },
};

function fmtWhen(ts) {
  const d = new Date(ts);
  const MON = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];
  const pad = (x) => (x < 10 ? '0' : '') + x;
  return { day: `${d.getDate()} ${MON[d.getMonth()]}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}`, year: d.getFullYear() };
}

/** One bypass record in the monitor's drill-down list, collapsed or expanded. */
function BypassEventRow({ event, open, onToggle, labelsById, columnsById, usersById }) {
  const who = usersById?.[String(event.userId)] ?? `משתמש ${event.userId}`;
  const surface = SURFACE[event.surface === 'api' ? 'api' : 'native'];
  const when = fmtWhen(event.ts);
  const technical = describeViolation(event.classification ?? {}, labelsById ?? {}, columnsById ?? {}, who);
  const fromName = event.fromLabelName || (event.fromLabelId === null ? '— ריק —' : `#${event.fromLabelId}`);
  const toName = event.toLabelName || (event.toLabelId === null ? '— ריק —' : `#${event.toLabelId}`);
  return (
    <div className={`tw-mon-ev${open ? ' open' : ''}`}>
      <button type="button" className="tw-mon-ev-row" aria-expanded={open} onClick={onToggle}>
        <span className="tw-mon-ev-when"><b>{when.day}</b>{when.time}</span>
        <span className="tw-mon-ev-mid">
          <span className="tw-mon-ev-item">{event.itemName || `פריט ${event.itemId}`}</span>
          <span className="tw-mon-ev-trans">{fromName} <span className="tw-mon-arrow">←</span> {toName}</span>
          <span className="tw-mon-ev-who">שינה: <b>{who}</b></span>
        </span>
        <span className="tw-mon-ev-tags">
          <span className="tw-mon-surface">{surface.icon} {surface.short}</span>
          <span className={`tw-mon-status ${event.reverted ? 'reverted' : 'monitored'}`}>
            {event.reverted ? '● הוחזרה אוטומטית' : '● זוהתה — לא הוחזרה'}
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
            <span>אייטם: <b>{event.itemName || event.itemId}</b></span>
            <span>מי שינה: <b>{who}</b></span>
            <span>מתי: <b>{when.day} {when.year} · {when.time}</b></span>
          </div>
        </div>
      )}
    </div>
  );
}

export default BypassEventRow;
