/**
 * The four optional table-header overrides.
 *
 * @module components/SettingsPanel/HeaderOverrides
 *
 * Empty means "use the board column's title", which is the right default: the owner
 * already named the column on the board, and a header that silently drifts from it
 * is a support call. So the RESOLVED value is shown as each field's PLACEHOLDER —
 * the owner can see what the report will say without typing anything.
 *
 * Order matches the table: index 0 is the RIGHTMOST cell in the RTL table.
 */
import React from 'react';
import { Text, TextField } from '@vibe/core';
import { TABLE_ROLES } from '../../domain/settingsSchema.js';
import { resolveHeader, roleMeta } from './roleTypes.js';
import styles from './SettingsPanel.module.css';

/**
 * @param {Object} props
 * @param {Object} props.draft - the panel's draft settings
 * @param {Array<{id: string, title: string, type: string}>} props.boardColumns
 * @param {(role: string, text: string) => void} props.onChange
 */
export function HeaderOverrides({ draft, boardColumns, onChange }) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>
        <Text type="text1" weight="bold" element="span">
          כותרות הטבלה
        </Text>
        <Text type="text3" color="secondary" element="span">
          אופציונלי — שדה ריק מציג את שם העמודה בלוח
        </Text>
      </div>

      <div className={styles.rows}>
        {TABLE_ROLES.map((role) => {
          const title = `כותרת לעמודת ${roleMeta(role)?.label ?? role}`;
          // The DEFAULT, not the current value: `headers: {}` strips the override so
          // resolveHeader falls through to the mapped column's board title.
          const fallback = resolveHeader({ columns: draft?.columns, headers: {} }, role, boardColumns);
          return (
            <div className={styles.row} key={role}>
              <TextField
                id={`docs-export-header-${role}`}
                /* Prefixed, not just the role name: the role name is already the
                 * label of that role's column dropdown, and two controls sharing an
                 * accessible name is a real screen-reader ambiguity. */
                title={title}
                /* Vibe v4 quirk: without inputAriaLabel the PLACEHOLDER becomes the
                 * input's aria-label — and here the placeholder is a board column
                 * title, so this field would steal the name of that role's dropdown. */
                inputAriaLabel={title}
                placeholder={fallback || 'שם העמודה בלוח'}
                /* MANDATORY with a value+onChange pair. Vibe v4's TextField is
                 * UNCONTROLLED by default: it seeds internal state from `value` once
                 * and ignores every later change, so without this the field would
                 * not refresh when a newer settings blob re-seeds the draft. */
                controlled
                value={String(draft?.headers?.[role] ?? '')}
                size="small"
                onChange={(next) => onChange(role, String(next ?? ''))}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default HeaderOverrides;
