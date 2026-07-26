import React from 'react';
import { MyDecisionsTable } from '@generated/components/MyDecisionsView/MyDecisionsTable.jsx';

/*
 * The previous-discussions DECISIONS table.
 *
 * round277 first reused the tasks-table CSS to make the decisions view LOOK like
 * the tasks board. round279 (owner spec) — the IDEAL structure/design/behavior is
 * the personal "ההחלטות שלי" table, so this now simply renders that exact
 * component (`MyDecisionsTable`): the same frozen-name board layout, the same
 * column set (מחליט / מושפעים / עדיפות / סטאטוס / מעקב החלטה / תאריך / דיון מקור),
 * the same inline cell editing, and the same owner column reorder + resize +
 * rename (shared 'myDecisions' tableId — one column arrangement across both
 * decisions surfaces).
 *
 * Editing writes straight to the decisions board via the optimistic updaters from
 * usePreviousDecisions (`data`), each gated PER ROW by `canDecision`. `data`
 * carries { decisions, loading, updateDecision* }; the loading/empty states are
 * handled by the caller (PreviousTasksTab).
 */
export function PreviousDecisionsTable({
  decisions = [],
  data,
  canDecision = () => true,
  canManageSettings = false,
  // Group tint (round280) — when the previous-decisions view is grouped, each
  // group's header color is threaded down to MyDecisionsTable as the row tint,
  // exactly like the personal "ההחלטות שלי" grouped tables. Presentational only.
  color,
  // round286 — column show/hide (owner "הסתר"), a Set of hidden column keys
  // applied at MyDecisionsTable's final render layer (order/width preserved).
  hiddenColumns,
}) {
  const d = data || {};
  return (
    <MyDecisionsTable
      decisions={decisions}
      color={color}
      hiddenColumns={hiddenColumns}
      canDecision={canDecision}
      canManageSettings={canManageSettings}
      onStatusChange={d.updateDecisionStatus}
      onTrackingChange={d.updateDecisionTracking}
      onPriorityChange={d.updateDecisionPriority}
      onDateChange={d.updateDecisionDate}
      onDeciderChange={d.updateDecisionDecider}
      onAffectedChange={d.updateDecisionAffected}
      onRenameDecision={d.updateDecisionName}
    />
  );
}

export default PreviousDecisionsTable;
