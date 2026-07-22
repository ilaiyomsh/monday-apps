import React from 'react';
import { BuilderIcon } from './BuilderIcon.jsx';
import bs from './builder.module.css';

/*
 * round224 (owner mockup, approved) — the FLAT "קבץ לפי" pick list shared by
 * every group builder in the app (My Tasks, My Decisions, TasksTab,
 * PreviousTasksTab, DecisionsTab via GroupByBuilder): one radio-style row per
 * groupable column, no order picker (the order is ALWAYS the top-down label
 * order, pinned by the caller), the default column tagged "ברירת מחדל".
 *
 * closeOnPick — owner spec: for a NON-owner (no Save button) the panel closes
 * the moment a column is picked; an owner keeps it open so "שמור" is reachable.
 */
export function GroupPickList({ options = [], onPick, close = null, closeOnPick = false, defaultKey = 'status' }) {
  return (
    <div className={bs.gpList} role="listbox" aria-label="קבץ לפי">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="option"
          aria-selected={!!o.selected}
          className={`${bs.gpRow} ${o.selected ? bs.gpRowSel : ''}`}
          onClick={() => {
            onPick?.(o.key);
            if (closeOnPick) close?.();
          }}
        >
          <span className={bs.gpRadio} aria-hidden="true" />
          {o.icon ? <BuilderIcon name={o.icon} className={bs.gpIcon} /> : null}
          <span className={bs.gpLabel}>{o.label}</span>
          {o.key === defaultKey ? <span className={bs.gpDefault}>ברירת מחדל</span> : null}
        </button>
      ))}
    </div>
  );
}

export default GroupPickList;
