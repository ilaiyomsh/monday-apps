import React from 'react';
import { PersonList } from '@generated/components/PersonAvatar';
import { useStatusOptions } from '@generated/hooks/useStatusOptions';
import { isValidStatus } from '@generated/constants/statusConfig';
import styles from './PreviousDecisionsTable.module.css';

const NEUTRAL = 'hsl(var(--status-default))';

function StatusChip({ value, labelById, colorById }) {
  if (!isValidStatus(value) || labelById[value] == null) return <span className={styles.empty}>—</span>;
  return <span className={styles.chip} style={{ background: colorById[value] || NEUTRAL }}>{labelById[value]}</span>;
}

function fmtDate(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value?.date || value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function sourceName(decision) {
  const rel = decision?.discussionLinkID;
  return rel?.linkedItems?.[0]?.name || rel?.text || '';
}

/*
 * round275 — read-only decisions table for the "דיונים קודמים" tab (decisions
 * from previous discussions). Columns mirror the decisions views: החלטה / מחליט /
 * מושפעים / עדיפות / מעקב החלטה / תאריך / דיון מקור. Chip colors/labels come from
 * the mapped decision status columns (owner-configured), same as everywhere.
 */
export function PreviousDecisionsTable({ decisions = [] }) {
  const priority = useStatusOptions('decisions', 'decisionPriorityID');
  const tracking = useStatusOptions('decisions', 'decisionTrackingID');

  return (
    <div className={styles.wrap} dir="rtl">
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.frozen}>החלטה</th>
            <th>מחליט</th>
            <th>מושפעים</th>
            <th>עדיפות</th>
            <th>מעקב החלטה</th>
            <th>תאריך</th>
            <th>דיון מקור</th>
          </tr>
        </thead>
        <tbody>
          {decisions.map((d) => (
            <tr key={d.id}>
              <td className={`${styles.frozen} ${styles.name}`}>{d.name}</td>
              <td><PersonList people={d.deciderID || []} size="sm" showNames={false} max={2} /></td>
              <td><PersonList people={d.affectedID || []} size="sm" showNames={false} max={3} /></td>
              <td><StatusChip value={d.decisionPriorityID} labelById={priority.labelById} colorById={priority.colorById} /></td>
              <td><StatusChip value={d.decisionTrackingID} labelById={tracking.labelById} colorById={tracking.colorById} /></td>
              <td className={styles.date}>{fmtDate(d.decisionDateID)}</td>
              <td className={styles.source}>{sourceName(d)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default PreviousDecisionsTable;
