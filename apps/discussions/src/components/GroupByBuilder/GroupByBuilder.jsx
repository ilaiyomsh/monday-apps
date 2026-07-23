import React from 'react';
import { Group } from '@vibe/icons';
import { BuilderControl } from '@generated/components/MyTasksView/controls/BuilderControl.jsx';
import { GroupPickList } from '@generated/components/MyTasksView/controls/GroupPickList.jsx';

/*
 * "קבץ לפי" toolbar control for the discussion tabs (TasksTab /
 * PreviousTasksTab / DecisionsTab) — round224 REDESIGN (owner mockup,
 * approved): the panel is ONE flat radio list of the groupable columns; the
 * order is ALWAYS the top-down label order (each column's FIRST `orders` entry
 * is pinned on pick — no order picker), the default column is tagged
 * "ברירת מחדל", and for a NON-owner (no Save button) the panel closes the
 * moment a column is picked. The owner keeps it open so "שמור" (save the
 * default for everyone) is reachable. Chrome (pill + panel + Clear/Save) stays
 * the shared BuilderControl, so the module still matches My Tasks exactly.
 *
 * options: [{ value, label, icon?, orders: [{ key, ... }] }] — a `noneValue`
 * entry is ignored (Clear represents "no grouping", as before).
 * value:    { col, order } · onChange({ col, order }) · onSave (owners only).
 */
export function GroupByBuilder({ options = [], value, onChange, onSave, noneValue = 'none', mobile = false, defaultKey = 'status' }) {
  const cols = options.filter((o) => o.value !== noneValue);
  const col = value?.col ?? noneValue;
  const applied = col !== noneValue;

  const firstOrder = (o) => o?.orders?.[0]?.key;
  const pickCol = (v) => onChange?.({ col: v, order: firstOrder(cols.find((o) => o.value === v)) });

  const renderBody = ({ close }) => (
    <GroupPickList
      options={cols.map((o) => ({ key: o.value, label: o.label, icon: o.icon, selected: o.value === col }))}
      onPick={pickCol}
      close={close}
      closeOnPick={!onSave}
      defaultKey={defaultKey}
    />
  );

  return (
    <BuilderControl
      icon={Group} label="קבץ לפי" title="קבץ לפי"
      applied={applied} badge={1} mobile={mobile}
      onClear={applied ? () => onChange?.({ col: noneValue }) : null}
      onSave={onSave}
      renderBody={renderBody}
    />
  );
}

export default GroupByBuilder;
