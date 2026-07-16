import React from 'react';
import styles from './HighlightedText.module.css';

/* Renders `text` with every case-insensitive occurrence of `query` wrapped in a
   highlighted <mark> — the visual "where did my search match" cue. All the
   name searches in this app filter SERVER-SIDE (where.name), so by the time a
   row renders there is no match info left; this recomputes the match at render
   time from the same query string the search sent. Empty query / no match →
   the plain string (no extra DOM). */
export function HighlightedText({ text, query }) {
  const name = text == null ? '' : String(text);
  const q = (query || '').trim();
  if (!q) return name;
  const lower = name.toLowerCase();
  const ql = q.toLowerCase();
  if (!lower.includes(ql)) return name;
  const parts = [];
  let i = 0;
  while (i < name.length) {
    const idx = lower.indexOf(ql, i);
    if (idx === -1) {
      parts.push(name.slice(i));
      break;
    }
    if (idx > i) parts.push(name.slice(i, idx));
    parts.push(
      <mark key={idx} className={styles.searchHl}>
        {name.slice(idx, idx + q.length)}
      </mark>
    );
    i = idx + q.length;
  }
  return <>{parts}</>;
}
