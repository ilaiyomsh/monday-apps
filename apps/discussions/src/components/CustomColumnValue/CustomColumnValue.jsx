import React from 'react';
import { PersonList } from '@generated/components/PersonAvatar';
import { fmtTimeLabel } from '@generated/utils/dateTime.js';
import { monday } from '@api/monday-client.js';
import logger from '@generated/utils/logger.js';
import styles from './CustomColumnValue.module.css';

/*
 * round364 — READ-ONLY renderer for an owner-added custom column value, shared
 * by the discussion-management details row and the task tables. `type` is the
 * mapping entry's stored monday column type; `value` is what parseValue
 * produced for it (see monday-client.js):
 *   people   → [{ id, name }]            date  → Date|null (hasTime flag)
 *   dropdown → label text|null           text/long_text → string|null
 *   file     → string of URLs|null       board_relation → { linkedItems, ids, text }
 *   status   → stable label ID (number)  ← round372
 * Anything empty renders the muted em-dash, so a mapped-but-blank cell reads
 * as intentionally empty rather than broken.
 *
 * round372 — a STATUS value is the label's stable ID, not its text, so this
 * renderer cannot resolve it alone: the caller passes `statusOpts`
 * ({ labelById, colorById }) from useStatusOptions for that column's alias. With
 * no map available the cell shows the em-dash rather than the raw id — a bare
 * "2" in a cell is worse than an honest blank.
 */

const NEUTRAL = 'hsl(var(--status-default))';

const Empty = () => <span className={styles.muted}>—</span>;

function openItemCard(itemId) {
  try {
    monday.execute('openItemCard', { itemId: Number(itemId), kind: 'updates' });
  } catch (err) {
    if (!err?.__loggedId) logger.warn('CustomColumnValue', 'פתיחת כרטיס פריט מקושר נכשלה', err);
  }
}

/** File column text is the asset URL list; each URL becomes a short link. */
function fileLinks(text) {
  const parts = String(text || '').split(/,\s*/).map((s) => s.trim()).filter(Boolean);
  return parts.map((url, i) => {
    // Not a URL at all (some accounts get plain file NAMES in cv.text) — the
    // caller falls back to rendering the raw text, nothing to log.
    if (!/^https?:\/\//i.test(url)) return null;
    let name = `קובץ ${i + 1}`;
    try {
      const tail = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
      if (tail) name = tail;
    } catch (err) {
      // Malformed despite the scheme check — keep the generic label, once in the log.
      if (!err?.__loggedId) logger.warn('CustomColumnValue', 'כתובת קובץ לא תקינה בעמודה מותאמת — מוצג שם גנרי', err);
    }
    return (
      <a key={url} className={styles.fileLink} href={url} target="_blank" rel="noreferrer" title={name}>
        {name}
      </a>
    );
  });
}

export function CustomColumnValue({ type, value, statusOpts }) {
  switch (type) {
    // round372 — 'color' is monday's legacy name for the same column type.
    case 'status':
    case 'color': {
      // A label id of 0 is REAL, so test the type, never truthiness.
      if (typeof value !== 'number') return <Empty />;
      const label = statusOpts?.labelById?.[value];
      if (!label) return <Empty />;
      return (
        <span
          className={styles.statusFill}
          style={{ background: statusOpts?.colorById?.[value] || NEUTRAL }}
          title={label}
        >
          {label}
        </span>
      );
    }
    case 'people':
    case 'person':
    case 'multiple_person': {
      const people = Array.isArray(value) ? value : [];
      if (!people.length) return <Empty />;
      return <PersonList people={people} size="sm" showNames max={3} />;
    }
    case 'date': {
      if (!(value instanceof Date) || Number.isNaN(value.getTime())) return <Empty />;
      const time = fmtTimeLabel(value);
      return (
        <span className={styles.text}>
          {value.toLocaleDateString('en-GB')}
          {time ? ` · ${time}` : ''}
        </span>
      );
    }
    case 'board_relation':
    case 'connect_boards': {
      const linked = value?.linkedItems || [];
      if (!linked.length) return <Empty />;
      const shown = linked.slice(0, 3);
      return (
        <span className={styles.chips}>
          {shown.map((it) => (
            <button
              key={it.id}
              type="button"
              className={styles.linkChip}
              title={it.name}
              onClick={() => openItemCard(it.id)}
            >
              {it.name}
            </button>
          ))}
          {linked.length > shown.length && (
            <span className={styles.more}>+{linked.length - shown.length}</span>
          )}
        </span>
      );
    }
    case 'file': {
      const links = fileLinks(value).filter(Boolean);
      if (links.length) return <span className={styles.chips}>{links}</span>;
      return value ? <span className={styles.text} title={String(value)}>{String(value)}</span> : <Empty />;
    }
    // dropdown values are already the label text; text/long_text are strings.
    default: {
      const text = value == null ? '' : String(value);
      if (!text.trim()) return <Empty />;
      return <span className={styles.text} title={text}>{text}</span>;
    }
  }
}

export default CustomColumnValue;
