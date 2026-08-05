/**
 * The five role → column mappings.
 *
 * @module components/SettingsPanel/ColumnRoleMapper
 *
 * Nothing in this app hardcodes a column id; these five picks ARE the app's
 * configuration. Two of them do double duty and that is stated in their hint, since
 * it is the single most surprising thing about the mapping:
 *   - `date` is both table column 4 AND the daily/weekly range filter;
 *   - `committee` is both table column 2 AND the multi-select the user picks from;
 *   - `person` is in NO table column — it is the personal scope, and it applies to
 *     owners and admins exactly like everyone else.
 *
 * Labels, hints, per-role type preferences and the warning text all live in
 * `roleTypes.js` (pure, tested); this file only renders them.
 */
import React from 'react';
import { Loader, Text } from '@vibe/core';
import { ROLE_META, partitionColumnsForRole, typeWarning } from './roleTypes.js';
import ColumnSelect from './ColumnSelect.jsx';
import styles from './SettingsPanel.module.css';

/**
 * @param {Object} props
 * @param {Object} props.columnsByRole - the draft's `columns` map
 * @param {Array<{id: string, title: string, type: string}>} props.boardColumns
 * @param {(role: string, columnId: string) => void} props.onChange
 * @param {boolean} [props.isLoading] - board meta still loading
 * @param {boolean} [props.hasBoard] - a board id is present
 */
export function ColumnRoleMapper({ columnsByRole, boardColumns, onChange, isLoading, hasBoard }) {
  const columns = Array.isArray(boardColumns) ? boardColumns : [];
  const byId = new Map(columns.map((column) => [column.id, column]));

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>
        <Text type="text1" weight="bold" element="span">
          מיפוי העמודות
        </Text>
        <Text type="text3" color="secondary" element="span">
          חמישה תפקידים, חמש עמודות מהלוח
        </Text>
      </div>

      {!hasBoard ? (
        <Text type="text3" color="secondary" data-testid="mapper-no-board">
          בחרו קודם לוח יעד, ואז יופיעו כאן העמודות שלו.
        </Text>
      ) : null}

      {hasBoard && isLoading ? (
        <div className={styles.templateRow}>
          <Loader size="xs" />
          <Text type="text3" color="secondary">
            טוענים את עמודות הלוח…
          </Text>
        </div>
      ) : null}

      <div className={styles.rows}>
        {ROLE_META.map(({ role, label, hint }) => (
          <ColumnSelect
            key={role}
            id={`docs-export-role-${role}`}
            label={label}
            hint={hint}
            value={columnsByRole?.[role] ?? ''}
            groups={partitionColumnsForRole(columns, role)}
            disabled={!hasBoard || columns.length === 0}
            warning={typeWarning(role, byId.get(columnsByRole?.[role]))}
            onChange={(columnId) => onChange(role, columnId)}
          />
        ))}
      </div>
    </div>
  );
}

export default ColumnRoleMapper;
