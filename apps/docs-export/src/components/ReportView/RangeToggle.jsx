/**
 * RangeToggle — יומי / שבועי, plus the window those words actually resolve to.
 *
 * @module components/ReportView/RangeToggle
 *
 * The resolved label is not decoration. "שבועי" is ambiguous to a user (this week?
 * the last seven days? starting Sunday or Monday?), and the answer depends on a
 * setting they cannot see (`settings.weekStartsOn`). Printing "26.07.2026 -
 * 01.08.2026" next to the control is what makes the report verifiable BEFORE the
 * download instead of after someone reads it.
 *
 * Native `<button>`s on purpose — see GenerateButton.jsx for the full reason
 * (Vibe v4.2.5 renders `aria-disabled` but never the DOM `disabled` attribute, so
 * a Vibe button is not really disableable for assistive tech or for tests).
 */
import React from 'react';
import { Text } from '@vibe/core';
import styles from './RangeToggle.module.css';

/** The two windows this app reports on. Order = display order (RTL: right→left). */
const OPTIONS = [
  { kind: 'daily', label: 'יומי' },
  { kind: 'weekly', label: 'שבועי' },
];

/**
 * @param {Object} props
 * @param {'daily'|'weekly'} props.value the selected kind
 * @param {function('daily'|'weekly'): void} props.onChange
 * @param {string} props.rangeLabel the resolved window, e.g. '29.07.2026'
 * @param {boolean} [props.disabled] true while the query for the current window runs
 */
export function RangeToggle({ value, onChange, rangeLabel, disabled = false }) {
  return (
    <div className={styles.wrapper}>
      {/* role=group + a label so a screen reader announces the pair as one control
          rather than two unrelated buttons. */}
      <div className={styles.group} role="group" aria-label="טווח הדוח">
        {OPTIONS.map((option) => {
          const isSelected = value === option.kind;
          return (
            <button
              key={option.kind}
              type="button"
              // aria-pressed is the correct state for a segmented toggle: the
              // buttons stay buttons, one of them is "on".
              aria-pressed={isSelected}
              className={isSelected ? `${styles.option} ${styles.selected}` : styles.option}
              onClick={() => onChange(option.kind)}
              disabled={disabled}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {/* The label sits in its own element with NOTHING else in it — the tests
          match it exactly, and a user scanning the header reads one date range. */}
      {rangeLabel ? (
        <Text type="text2" color="secondary" className={styles.rangeLabel}>
          {rangeLabel}
        </Text>
      ) : null}
    </div>
  );
}

export default RangeToggle;
