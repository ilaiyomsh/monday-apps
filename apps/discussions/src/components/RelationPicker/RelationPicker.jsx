import React, { useMemo, useState } from 'react';
import { Check, Filter, Search, Sort } from '@vibe/icons';
import {
  buildSections,
  countItems,
  nextOrder,
  ORDER_BOARD,
  ORDER_LABEL,
} from './relationPickerModel.js';
import styles from './RelationPicker.module.css';

/*
 * round378 (owner request, from a screenshot of monday's own dropdown) — the panel
 * a custom CONNECTED BOARD column opens, rebuilt to look like monday's "Choose
 * items": a header, the linked BOARD's name, a search box, and the candidates as
 * GROUP SECTIONS — a coloured group title with its items under it, each item
 * carrying that group's colour as a bar on its inline-start edge.
 *
 * This is the PANEL only. The trigger stays in the cell that owns it
 * (`TaskTableRow`), which already renders the base connected-board chip, so the
 * closed cell is untouched by this round.
 *
 * Two controls from monday's panel are deliberately NOT here, because in this app
 * they would be buttons that do nothing: "Boards settings" (monday's own column
 * settings dialog) and "+ Add item" (creating an item on the linked board). The
 * sort toggle IS real — it is the one header control the app can honour.
 *
 * RTL: every edge is expressed with LOGICAL properties in the stylesheet, so the
 * colour bar and the search icon sit on the RIGHT here and the layout is monday's
 * mirrored, not monday's rotated.
 */

export function RelationPicker({
  boardName = '',
  candidates = [],
  linkedIds,
  loading = false,
  allowMultiple = true,
  onToggle,
  onClearAll,
  columnTitle = '',
}) {
  const [query, setQuery] = useState('');
  const [order, setOrder] = useState(ORDER_BOARD);

  const linked = linkedIds instanceof Set ? linkedIds : new Set(linkedIds || []);
  const sections = useMemo(() => buildSections(candidates, { query, order }), [candidates, query, order]);
  const shown = countItems(sections);
  const hasCandidates = (candidates?.length || 0) > 0;

  return (
    <div className={styles.panel}>
      <header className={styles.head}>
        <span className={styles.headTitle}>בחירת פריטים</span>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => setOrder(nextOrder(order))}
          aria-label={`סדר התצוגה: ${ORDER_LABEL[order]}`}
          title={`סדר התצוגה: ${ORDER_LABEL[order]}`}
        >
          <Sort />
        </button>
      </header>

      {boardName && <div className={styles.boardName}>{boardName}</div>}

      <div className={styles.searchRow}>
        <div className={styles.searchBox}>
          <span className={styles.searchIcon} aria-hidden="true"><Search /></span>
          <input
            className={styles.searchInput}
            value={query}
            placeholder="חיפוש פריט"
            onChange={(e) => setQuery(e.target.value)}
            aria-label={columnTitle ? `חיפוש ב${columnTitle}` : 'חיפוש פריט'}
          />
        </div>
        {/*
          * monday's panel puts a filter control beside the box. Here it CLEARS the
          * search — the one filtering this panel actually has — so it is a live
          * control rather than a decorative icon, and it only appears once there is
          * something to clear.
          */}
        {query && (
          <button
            type="button"
            className={styles.iconBtn}
            onClick={() => setQuery('')}
            aria-label="ניקוי החיפוש"
            title="ניקוי החיפוש"
          >
            <Filter />
          </button>
        )}
      </div>

      <div className={styles.list}>
        {loading && <div className={styles.empty}>טוען פריטים…</div>}
        {!loading && !hasCandidates && <div className={styles.empty}>אין פריטים להצגה</div>}
        {/* A search that matches nothing is a different state from an empty board. */}
        {!loading && hasCandidates && shown === 0 && (
          <div className={styles.empty}>לא נמצאו פריטים מתאימים</div>
        )}
        {!loading && sections.map((section) => (
          <div key={section.id} className={styles.section}>
            {section.title && (
              <div className={styles.groupTitle} style={{ color: section.color }}>
                {section.title}
              </div>
            )}
            {section.items.map((it) => {
              const on = linked.has(it.id);
              return (
                <button
                  key={it.id}
                  type="button"
                  className={`${styles.item} ${on ? styles.itemOn : ''}`}
                  style={{ '--group-color': section.color }}
                  onClick={() => onToggle?.(it.id)}
                  aria-pressed={on}
                  title={it.name}
                >
                  <span className={styles.itemName}>{it.name}</span>
                  {on && <span className={styles.itemCheck} aria-hidden="true"><Check /></span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/*
        * Not part of monday's panel, and kept anyway: it is the only way to empty
        * the column from the cell, and removing it with the redesign would be a
        * behaviour regression dressed as a restyle. Single-select columns clear by
        * re-picking, so it only shows where it is the only route.
        */}
      {allowMultiple && linked.size > 0 && (
        <button type="button" className={styles.clearAll} onClick={() => onClearAll?.()}>
          נקה את כל הקישורים
        </button>
      )}
    </div>
  );
}

export default RelationPicker;
