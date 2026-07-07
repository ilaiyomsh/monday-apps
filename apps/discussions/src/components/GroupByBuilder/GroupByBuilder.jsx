import React from 'react';
import { Group } from '@vibe/icons';
import { BuilderControl } from '@generated/components/MyTasksView/controls/BuilderControl.jsx';
import { Segment } from '@generated/components/MyTasksView/controls/Segment.jsx';
import bs from '@generated/components/MyTasksView/controls/builder.module.css';

/*
 * Group-by toolbar control for the discussion task tabs (TasksTab /
 * PreviousTasksTab). It reuses the EXACT chrome AND layout of the My Tasks
 * Group builder (BuilderControl pill + panel + a "Column" Segment and an
 * "Order" Segment, builder.module.css) so the three tabs present one identical
 * "Group by" module. Replaces the older MenuPill flat-list dropdown.
 *
 * The "no grouping" choice is NOT a list row — it is the panel's Clear action,
 * exactly like My Tasks (which unsets the group via Clear, not a "none" option).
 *
 * options: [{ value, label, icon?, orders: [{ key, label, icon }] }]
 *   — the groupable columns and, per column, its ordering choices. A `noneValue`
 *     entry (default 'none') is ignored in the picker and represented by Clear.
 * value:    { col, order }  — current column + order.
 * onChange: ({ col, order }) => void  — fires for both column and order picks
 *           (and Clear, with col === noneValue).
 */
export function GroupByBuilder({ options = [], value, onChange, onSave, noneValue = 'none', mobile = false }) {
  const cols = options.filter((o) => o.value !== noneValue);
  const col = value?.col ?? noneValue;
  const applied = col !== noneValue;
  const current = cols.find((o) => o.value === col) || null;

  const firstOrder = (o) => o?.orders?.[0]?.key;
  const pickCol = (v) => onChange?.({ col: v, order: firstOrder(cols.find((o) => o.value === v)) });
  const pickOrder = (ord) => onChange?.({ col, order: ord });

  const field = (m, label, seg) => (m
    ? <div className={bs.bField} key={label}><div className={bs.bFieldLabel}>{label}</div>{seg}</div>
    : seg);

  const renderBody = ({ mobile: m, openId, setOpenId }) => {
    const colSeg = (
      <Segment
        id="gcol" openId={openId} setOpenId={setOpenId} mobile={m} sheetTitle="Column"
        icon={current?.icon} text={current?.label || 'Choose a column'} placeholder={!current}
        options={cols.map((o) => ({ key: o.value, label: o.label, icon: o.icon, selected: o.value === col }))}
        onPick={pickCol} />
    );
    if (!current) {
      return m ? field(true, 'Column', colSeg) : <div className={bs.bRow}>{colSeg}</div>;
    }
    const orders = current.orders || [];
    const ord = orders.find((o) => o.key === value?.order) || orders[0];
    const ordSeg = orders.length ? (
      <Segment
        id="gord" openId={openId} setOpenId={setOpenId} mobile={m} sheetTitle="Order"
        icon={ord?.icon} text={ord?.label}
        options={orders.map((o) => ({ key: o.key, label: o.label, icon: o.icon, selected: o.key === (value?.order ?? ord?.key) }))}
        onPick={pickOrder} />
    ) : null;
    return m
      ? <>{field(true, 'Column', colSeg)}{ordSeg ? field(true, 'Order', ordSeg) : null}</>
      : <div className={bs.bRow}>{colSeg}{ordSeg}</div>;
  };

  return (
    <BuilderControl
      icon={Group} label="Group by" title="Group items by"
      applied={applied} badge={1} mobile={mobile}
      onClear={applied ? () => onChange?.({ col: noneValue }) : null}
      onSave={onSave}
      renderBody={renderBody}
    />
  );
}

export default GroupByBuilder;
