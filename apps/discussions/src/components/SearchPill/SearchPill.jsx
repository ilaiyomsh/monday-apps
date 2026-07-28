import React, { useState } from 'react';
import { Search, CloseSmall } from '@vibe/icons';
import styles from './SearchPill.module.css';

/*
 * round132 — shared toolbar Search pill (owner request: הנחיות קודמות, נושאים,
 * משימות והחלטות were missing the Search cell the My Tasks toolbar has).
 * Mirrors the My Tasks look/behavior: a plain "Search" pill that expands into
 * an inline input on click, with a leading clear-X while a value exists, and
 * collapses back to the pill on blur when empty. Filtering itself is the
 * consumer's job — this component only owns the value.
 */
export function SearchPill({ value, onChange, placeholder = 'חיפוש' }) {
  const [open, setOpen] = useState(false);
  const expanded = open || (value || '').length > 0;

  if (!expanded) {
    return (
      <button type="button" className={styles.pill} onClick={() => setOpen(true)}>
        <Search className={styles.pillIcon} />
        <span>{placeholder}</span>
      </button>
    );
  }

  return (
    <div className={styles.searchPill}>
      {value ? (
        <button
          type="button"
          className={styles.searchClear}
          aria-label="נקה חיפוש"
          onClick={() => onChange('')}
        >
          <CloseSmall size={16} />
        </button>
      ) : null}
      <Search className={styles.pillIcon} aria-hidden="true" />
      <input
        className={styles.searchInput}
        autoFocus
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => { if (!value) setOpen(false); }}
        aria-label={placeholder}
      />
    </div>
  );
}

// Shared matcher for the tabs' client-side pipelines: case-insensitive
// "contains" over an item name; an empty/blank term matches everything.
export function matchesSearch(name, term) {
  const q = String(term || '').trim().toLowerCase();
  if (!q) return true;
  return String(name || '').toLowerCase().includes(q);
}

export default SearchPill;
