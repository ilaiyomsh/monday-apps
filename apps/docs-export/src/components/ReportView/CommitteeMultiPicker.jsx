/**
 * CommitteeMultiPicker — multi-select over the committees present in the range.
 *
 * @module components/ReportView/CommitteeMultiPicker
 *
 * Two deliberate implementation choices:
 *
 * 1. **Body-portal Popover + plain checkboxes, NOT Vibe `Combobox`/`Dropdown`.**
 *    Vibe's option clicks are dead inside a board view (the pattern that forced
 *    `components/shared/Popover.jsx` into existence in apps/discussions, where
 *    Dialog/Combobox clipped, double-rendered and dropped clicks inside board-view
 *    tables). Portaling to `document.body` also means the menu escapes the board
 *    view's `overflow:hidden` iframe chrome instead of being clipped by it.
 *
 * 2. **The options come from the FETCHED rows, never from a board query.** A mirror
 *    column cannot be filtered or enumerated server-side, so the option list IS the
 *    set of committees the reporter actually has rows for. That is a feature: a
 *    committee the user cannot report on is never offered, so an empty report is
 *    unreachable through this control.
 *
 * The list is short by construction (the committees in one person's daily/weekly
 * rows), so there is no search box and no virtualization — both would be noise.
 */
import React, { useCallback, useId, useMemo, useRef, useState } from 'react';
import { Text } from '@vibe/core';
import Popover from '../shared/Popover';
import styles from './CommitteeMultiPicker.module.css';

/**
 * @param {Object} props
 * @param {string[]} props.committees every committee present in the fetched rows
 * @param {string[]} props.selected the currently ticked committees
 * @param {function(string[]): void} props.onChange receives the FULL next selection
 * @param {boolean} [props.disabled]
 */
export function CommitteeMultiPicker({ committees, selected, onChange, disabled = false }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  // useId keeps every checkbox's id unique even when two pickers are mounted, so
  // <label for> always points at ITS OWN input (a duplicated id silently makes one
  // label toggle the other picker's checkbox).
  const idPrefix = useId();

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const allSelected = committees.length > 0 && selectedSet.size === committees.length;

  const toggle = useCallback(
    (name) => {
      // Rebuild from `committees` rather than pushing onto `selected`, so the
      // selection always comes out in the committees' own (first-appearance) order
      // — which is the order the report's rows are grouped in.
      const next = committees.filter((committee) =>
        committee === name ? !selectedSet.has(committee) : selectedSet.has(committee)
      );
      onChange(next);
    },
    [committees, selectedSet, onChange]
  );

  const selectAll = useCallback(() => onChange([...committees]), [committees, onChange]);
  const clearAll = useCallback(() => onChange([]), [onChange]);

  const triggerLabel = selected.length
    ? `בחירת ועדות (${selected.length})`
    : 'בחירת ועדות';

  return (
    <div className={styles.wrapper}>
      <button
        ref={anchorRef}
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {triggerLabel}
      </button>

      <Popover
        anchorRef={anchorRef}
        open={open}
        onClose={() => setOpen(false)}
        preferred="bottom-start"
        width={300}
        height={340}
        matchAnchorWidth
      >
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <button
              type="button"
              className={styles.bulkAction}
              onClick={selectAll}
              disabled={allSelected}
            >
              בחר הכול
            </button>
            <button
              type="button"
              className={styles.bulkAction}
              onClick={clearAll}
              disabled={selected.length === 0}
            >
              נקה בחירה
            </button>
          </div>

          <ul className={styles.list}>
            {committees.map((committee, index) => {
              const inputId = `${idPrefix}-committee-${index}`;
              return (
                <li key={committee} className={styles.row}>
                  <input
                    id={inputId}
                    type="checkbox"
                    className={styles.checkbox}
                    checked={selectedSet.has(committee)}
                    onChange={() => toggle(committee)}
                  />
                  {/* The label holds the committee name and NOTHING else: it is the
                      checkbox's accessible name, so a count/badge in here would
                      rename the option. */}
                  <label htmlFor={inputId} className={styles.label}>
                    {committee}
                  </label>
                </li>
              );
            })}
          </ul>

          <Text type="text3" color="secondary" className={styles.hint}>
            {`נבחרו ${selected.length} מתוך ${committees.length}`}
          </Text>
        </div>
      </Popover>
    </div>
  );
}

export default CommitteeMultiPicker;
