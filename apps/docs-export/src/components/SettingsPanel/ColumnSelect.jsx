/**
 * One labelled single-select over the target board's columns.
 *
 * @module components/SettingsPanel/ColumnSelect
 *
 * **Body-portal Popover + a plain clickable list — NOT a native `<select>`, and not
 * Vibe `Combobox`/`Dropdown`.**
 *
 * This used to be a native `<select>`, chosen because Vibe's option clicks are dead
 * inside a monday board view and a browser-rendered menu cannot be swallowed by
 * anything in the iframe. That reasoning is still correct about Vibe — but a native
 * menu is drawn by the OS, so it arrives in the OS's own chrome (a dark macOS popup
 * with system checkmarks) and cannot be themed at all. Next to the Vibe inputs in the
 * same panel it read as a different application.
 *
 * The fix is the pattern this repo already proved twice: the bundled
 * `components/shared/Popover.jsx` (which portals to `document.body`, so the menu
 * escapes the board view's `overflow:hidden` chrome instead of being clipped) with a
 * plain `<button>` list inside it. `ReportView/CommitteeMultiPicker` is the multi-select
 * sibling of exactly this, and both now share one visual language.
 *
 * What the native element gave us for free and is therefore re-implemented here on
 * purpose — losing any of these is a regression, and each has a test:
 *   - keyboard: ↑/↓ to move, Home/End, Enter/Space to commit, Esc to dismiss, and
 *     type-ahead on the option labels.
 *   - `aria-activedescendant` + `role="listbox"`/`role="option"`, so a screen reader
 *     still announces this as a single-choice list.
 *   - focus returns to the trigger on close, so tab order is not lost.
 *
 * Options come in two groups: the types that make sense for the role first, then
 * everything else. That is the SOFT filter — the owner can always pick an odd column
 * and gets a warning instead of a block, because monday boards carry types this app
 * has never seen (a formula rendering a date, a lookup behaving like a mirror).
 */
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Text } from '@vibe/core';
import Popover from '../shared/Popover';
import { columnLabel } from './roleTypes.js';
import styles from './SettingsPanel.module.css';

const PLACEHOLDER = '— בחרו עמודה —';

/** How long a type-ahead buffer stays alive between keystrokes (ms). */
const TYPEAHEAD_RESET_MS = 700;

/**
 * Flatten the two groups into the single ordered list the keyboard walks, tagging each
 * entry with the group heading that precedes it so one pass renders both.
 *
 * The empty option is part of this list, not a special case: "no column" is a real,
 * selectable answer (it is how an owner un-maps a role), so the keyboard has to be
 * able to land on it like any other row.
 */
function buildRows(groups) {
  const named = [
    { label: 'עמודות מתאימות', columns: groups?.preferred ?? [] },
    { label: 'עמודות נוספות', columns: groups?.other ?? [] },
  ].filter((group) => group.columns.length > 0);

  // EMPTY groups are dropped, and a lone group is rendered flat with no heading. Both
  // cases are real: a role with no type opinion (`action`) puts everything in
  // `preferred`, and a board with no mirror column at all leaves `preferred` empty for
  // `committee` — a heading reading "suitable columns" above nothing would tell the
  // owner the opposite of the truth.
  const showHeadings = named.length > 1;

  const rows = [{ type: 'option', id: '', label: PLACEHOLDER }];
  for (const group of named) {
    if (showHeadings) rows.push({ type: 'heading', label: group.label });
    for (const column of group.columns) {
      rows.push({ type: 'option', id: column.id, label: columnLabel(column) });
    }
  }
  return rows;
}

/**
 * @param {Object} props
 * @param {string} props.id - DOM id, so the label's htmlFor really points at the control
 * @param {string} props.label - the Hebrew role name
 * @param {string} [props.hint] - one line under the control explaining the role
 * @param {string} props.value - the chosen column id ('' = nothing chosen)
 * @param {(columnId: string) => void} props.onChange
 * @param {{preferred: Array<Object>, other: Array<Object>}} props.groups
 * @param {boolean} [props.disabled]
 * @param {string} [props.warning] - '' when the pick is sensible
 */
export function ColumnSelect({ id, label, hint, value, onChange, groups, disabled, warning }) {
  const rows = useMemo(() => buildRows(groups), [groups]);
  const options = useMemo(() => rows.filter((row) => row.type === 'option'), [rows]);

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef(null);
  const listRef = useRef(null);
  const typeaheadRef = useRef({ buffer: '', at: 0 });
  const listboxId = `${useId()}-listbox`;

  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.id === (value ?? ''))
  );
  const selectedLabel = options[selectedIndex]?.label ?? PLACEHOLDER;

  // Opening always starts on the CURRENT value, not at the top: the first ↓ should
  // move away from what is selected, which is what a native select does.
  useEffect(() => {
    if (open) setActiveIndex(selectedIndex);
  }, [open, selectedIndex]);

  const close = useCallback(({ refocus = true } = {}) => {
    setOpen(false);
    // Without this the focus ring is left on a node that just left the DOM and the
    // next Tab restarts from the top of the document.
    if (refocus) triggerRef.current?.focus();
  }, []);

  const commit = useCallback(
    (index) => {
      const option = options[index];
      if (!option) return;
      onChange(option.id);
      close();
    },
    [options, onChange, close]
  );

  const move = useCallback(
    (delta) => {
      setActiveIndex((current) => {
        const next = current + delta;
        // Clamp rather than wrap: wrapping past the end of a mapping list makes it
        // feel like the list scrolled when it did not.
        if (next < 0) return 0;
        if (next > options.length - 1) return options.length - 1;
        return next;
      });
    },
    [options.length]
  );

  /** Jump to the first option whose label starts with the accumulated keystrokes. */
  const typeahead = useCallback(
    (char) => {
      const now = Date.now();
      const state = typeaheadRef.current;
      state.buffer = now - state.at > TYPEAHEAD_RESET_MS ? char : state.buffer + char;
      state.at = now;

      const needle = state.buffer.toLowerCase();
      const found = options.findIndex((option) => option.label.toLowerCase().startsWith(needle));
      if (found >= 0) setActiveIndex(found);
    },
    [options]
  );

  const onTriggerKeyDown = useCallback(
    (event) => {
      if (disabled) return;
      // ↓/↑/Enter/Space all open the menu from the closed state, like a native select.
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
        setOpen(true);
      }
    },
    [disabled]
  );

  const onListKeyDown = useCallback(
    (event) => {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          move(1);
          break;
        case 'ArrowUp':
          event.preventDefault();
          move(-1);
          break;
        case 'Home':
          event.preventDefault();
          setActiveIndex(0);
          break;
        case 'End':
          event.preventDefault();
          setActiveIndex(options.length - 1);
          break;
        case 'Enter':
        case ' ':
          event.preventDefault();
          commit(activeIndex);
          break;
        case 'Escape':
          event.preventDefault();
          close();
          break;
        case 'Tab':
          // Let focus leave naturally, but do not leave an orphaned menu behind.
          close({ refocus: false });
          break;
        default:
          if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
            typeahead(event.key);
          }
      }
    },
    [move, options.length, commit, activeIndex, close, typeahead]
  );

  // Move real DOM focus into the list when it opens, so the keydown handler above
  // receives the keys instead of the trigger.
  useEffect(() => {
    if (open) listRef.current?.focus();
  }, [open]);

  // Keep the active row visible while the keyboard walks past the scroll edge.
  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector(`[data-option-index="${activeIndex}"]`);
    // Feature-detected, not assumed: jsdom does not implement scrollIntoView at all,
    // so an unguarded call throws inside the effect and takes the whole picker down.
    // Scrolling is a nicety; losing the control is not an acceptable price for it.
    if (typeof node?.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'nearest' });
    }
  }, [open, activeIndex]);

  const activeOptionId = `${listboxId}-option-${activeIndex}`;
  const isPlaceholder = (value ?? '') === '';

  return (
    <div className={styles.row}>
      <label className={styles.rowLabel} htmlFor={id}>
        <Text type="text2" weight="medium" element="span">
          {label}
        </Text>
      </label>

      <button
        id={id}
        ref={triggerRef}
        type="button"
        className={styles.select}
        // The chosen column id, mirroring what a native <select>'s `value` gave. The
        // visible text is "title (type)" and titles are owner-authored, so this is the
        // only stable way for a test (or future automation) to read the current mapping.
        data-value={value ?? ''}
        data-placeholder={isPlaceholder ? 'true' : undefined}
        disabled={disabled}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        onKeyDown={onTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
      >
        <span className={styles.selectValue}>{selectedLabel}</span>
        <span className={styles.selectCaret} aria-hidden>
          ⌄
        </span>
      </button>

      <Popover
        anchorRef={triggerRef}
        open={open}
        onClose={() => close({ refocus: false })}
        preferred="bottom-start"
        width={320}
        height={320}
        matchAnchorWidth
      >
        <ul
          id={listboxId}
          ref={listRef}
          role="listbox"
          tabIndex={-1}
          aria-label={label}
          aria-activedescendant={activeOptionId}
          className={styles.optionList}
          onKeyDown={onListKeyDown}
        >
          {(() => {
            let optionIndex = -1;
            return rows.map((row, rowIndex) => {
              if (row.type === 'heading') {
                return (
                  // Presentational: a group heading must not be announced as an option
                  // or counted in the listbox's option total.
                  <li
                    key={`heading-${rowIndex}`}
                    role="presentation"
                    className={styles.optionHeading}
                  >
                    {row.label}
                  </li>
                );
              }
              optionIndex += 1;
              const index = optionIndex;
              const isSelected = row.id === (value ?? '');
              const isActive = index === activeIndex;
              return (
                <li key={row.id || '__none__'} role="presentation">
                  <button
                    id={`${listboxId}-option-${index}`}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    data-option-index={index}
                    // The column id as a stable hook. The visible label is
                    // "title (type)" and titles are owner-authored, so tests and any
                    // future automation need something that cannot be renamed.
                    data-column-id={row.id}
                    data-active={isActive ? 'true' : undefined}
                    className={styles.option}
                    // onMouseDown, not onClick: the Popover's outside-click listener
                    // fires on mousedown, so a click handler would race it and the
                    // menu could close before the selection landed.
                    onMouseDown={(event) => {
                      event.preventDefault();
                      commit(index);
                    }}
                    onMouseEnter={() => setActiveIndex(index)}
                  >
                    <span className={styles.optionLabel}>{row.label}</span>
                    {isSelected ? (
                      <span className={styles.optionCheck} aria-hidden>
                        ✓
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            });
          })()}
        </ul>
      </Popover>

      {hint ? (
        <Text type="text3" color="secondary">
          {hint}
        </Text>
      ) : null}

      {warning ? (
        <Text type="text3" color="negative" data-testid={`warning-${id}`}>
          {warning}
        </Text>
      ) : null}
    </div>
  );
}

export default ColumnSelect;
