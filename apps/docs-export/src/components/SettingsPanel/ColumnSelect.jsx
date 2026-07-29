/**
 * One labelled single-select over the target board's columns.
 *
 * @module components/SettingsPanel/ColumnSelect
 *
 * A NATIVE `<select>`, on purpose. Vibe's `Combobox` option clicks are dead inside a
 * monday board view, and the sibling `discussions` app had to hand-roll a portalled
 * picker to work around the same family of problems. A native select is rendered by
 * the browser rather than by the page, so nothing in the iframe can swallow the
 * click — and it brings RTL, keyboard navigation and the mobile wheel for free. It
 * is styled (SettingsPanel.module.css) to sit beside the Vibe inputs.
 *
 * Options come in two groups: the types that make sense for the role first, then
 * everything else under a second `<optgroup>`. That is the SOFT filter — the owner
 * can always pick an odd column and gets a warning instead of a block, because
 * monday boards carry types this app has never seen (a formula rendering a date, a
 * lookup behaving like a mirror).
 */
import React from 'react';
import { Text } from '@vibe/core';
import { columnLabel } from './roleTypes.js';
import styles from './SettingsPanel.module.css';

/**
 * @param {Object} props
 * @param {string} props.id - DOM id, so the label's htmlFor really points at it
 * @param {string} props.label - the Hebrew role name
 * @param {string} [props.hint] - one line under the control explaining the role
 * @param {string} props.value - the chosen column id ('' = nothing chosen)
 * @param {(columnId: string) => void} props.onChange
 * @param {{preferred: Array<Object>, other: Array<Object>}} props.groups
 * @param {boolean} [props.disabled]
 * @param {string} [props.warning] - '' when the pick is sensible
 */
export function ColumnSelect({ id, label, hint, value, onChange, groups, disabled, warning }) {
  // EMPTY groups are dropped, and a lone group is rendered flat with no label. Both
  // cases are real: a role with no type opinion (`action`) puts everything in
  // `preferred`, and a board with no mirror column at all leaves `preferred` empty
  // for `committee` — an <optgroup label="suitable columns"> holding nothing would
  // tell the owner the opposite of the truth.
  const named = [
    { label: 'עמודות מתאימות', columns: groups?.preferred ?? [] },
    { label: 'עמודות נוספות', columns: groups?.other ?? [] },
  ].filter((group) => group.columns.length > 0);
  const grouped = named.length > 1;

  return (
    <div className={styles.row}>
      <label className={styles.rowLabel} htmlFor={id}>
        <Text type="text2" weight="medium" element="span">
          {label}
        </Text>
      </label>

      <select
        id={id}
        className={styles.select}
        value={value ?? ''}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">— בחרו עמודה —</option>
        {grouped
          ? named.map((group) => (
              <optgroup label={group.label} key={group.label}>
                {group.columns.map((column) => (
                  <option key={column.id} value={column.id}>
                    {columnLabel(column)}
                  </option>
                ))}
              </optgroup>
            ))
          : (named[0]?.columns ?? []).map((column) => (
              <option key={column.id} value={column.id}>
                {columnLabel(column)}
              </option>
            ))}
      </select>

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
