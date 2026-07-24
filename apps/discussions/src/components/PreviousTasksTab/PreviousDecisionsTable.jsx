import React, { useMemo } from 'react';
import { PersonList } from '@generated/components/PersonAvatar';
import { useStatusOptions } from '@generated/hooks/useStatusOptions';
import { isValidStatus } from '@generated/constants/statusConfig';
import grid from '@generated/components/TaskTable/TaskTable.module.css';
import rowStyles from '@generated/components/TaskTableRow/TaskTableRow.module.css';

const NEUTRAL = 'hsl(var(--status-default))';

// LTR grid, name frozen on the left — byte-matching the tasks table look.
const GRID_TEMPLATE = 'minmax(200px, 2fr) 150px 170px 130px 150px 110px minmax(150px, 1fr)';

function StatusCell({ value, labelById, colorById }) {
  const show = isValidStatus(value) && labelById[value] != null;
  return (
    <div className={`${grid.taskCell} ${rowStyles.statusCell}`}>
      {show
        ? <span className={rowStyles.statusFill} style={{ background: colorById[value] || NEUTRAL }}>{labelById[value]}</span>
        : null}
    </div>
  );
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
 * round277 — the previous-discussions DECISIONS table, rebuilt to reuse the tasks
 * table's own CSS (TaskTable + TaskTableRow modules): the SAME monday-item row
 * look, LTR with a frozen name column on the left, and the SAME status-fill chip
 * treatment. Read-only. Columns: החלטה / מחליט / מושפעים / עדיפות / מעקב החלטה /
 * תאריך / דיון מקור. Chip labels+colors come from the mapped decision columns.
 */
export function PreviousDecisionsTable({ decisions = [] }) {
  const priority = useStatusOptions('decisions', 'decisionPriorityID');
  const tracking = useStatusOptions('decisions', 'decisionTrackingID');
  const rowStyle = useMemo(() => ({ gridTemplateColumns: GRID_TEMPLATE }), []);

  return (
    <div className={grid.taskTableScroll}>
      <div className={grid.taskTable} dir="ltr">
        <div className={`${grid.taskRow} ${grid.taskHead}`} style={rowStyle}>
          <div className={`${grid.taskCell} ${grid.taskFirst} ${rowStyles.name}`}>החלטה</div>
          <div className={grid.taskCell}>מחליט</div>
          <div className={grid.taskCell}>מושפעים</div>
          <div className={grid.taskCell}>עדיפות</div>
          <div className={grid.taskCell}>מעקב החלטה</div>
          <div className={grid.taskCell}>תאריך</div>
          <div className={grid.taskCell}>דיון מקור</div>
        </div>

        {decisions.map((d) => (
          <div key={d.id} className={grid.taskRow} style={rowStyle}>
            <div className={`${grid.taskCell} ${grid.taskFirst} ${rowStyles.name}`}>
              <div className={rowStyles.nameInner}>
                <span className={rowStyles.nameText} title={d.name}>{d.name}</span>
              </div>
            </div>
            <div className={grid.taskCell}>
              <div className={rowStyles.assigneeCell}><PersonList people={d.deciderID || []} size="sm" showNames={false} max={2} /></div>
            </div>
            <div className={grid.taskCell}>
              <div className={rowStyles.assigneeCell}><PersonList people={d.affectedID || []} size="sm" showNames={false} max={3} /></div>
            </div>
            <StatusCell value={d.decisionPriorityID} labelById={priority.labelById} colorById={priority.colorById} />
            <StatusCell value={d.decisionTrackingID} labelById={tracking.labelById} colorById={tracking.colorById} />
            <div className={`${grid.taskCell} ${rowStyles.deadlineCell}`}>{fmtDate(d.decisionDateID)}</div>
            <div className={`${grid.taskCell} ${rowStyles.sourceCell}`}>{sourceName(d)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default PreviousDecisionsTable;
