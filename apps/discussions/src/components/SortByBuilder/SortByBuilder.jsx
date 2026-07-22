import React from 'react';
import { Sort } from '@vibe/icons';
import { BuilderControl } from '@generated/components/MyTasksView/controls/BuilderControl.jsx';
import { Segment } from '@generated/components/MyTasksView/controls/Segment.jsx';
import { SORT_COLUMNS } from '@generated/components/MyTasksView/controls/controls.js';
import bs from '@generated/components/MyTasksView/controls/builder.module.css';

/*
 * Sort-by toolbar control for the discussion task tabs (TasksTab / DecisionsTab
 * / PreviousTasksTab). It reuses the EXACT chrome AND layout of the My Tasks
 * Sort builder (BuilderControl pill + panel + a "Column" Segment and a
 * "Direction" Segment, builder.module.css) so every tab presents one identical
 * "Sort" module — the parallel of GroupByBuilder for sorting.
 *
 * The sort direction keys map 1:1 to controls.js `sortTasks`, so a tab wires the
 * builder's { col, dir } straight into sortTasks(list, sort, maps). The three
 * shared direction sets below are LIFTED from controls.js SORT_COLUMNS so the
 * labels/icons/keys stay identical to My Tasks (status, date, text columns).
 *
 * options: [{ value, label, icon?, note?, dirs: [{ key, label, icon }] }]
 *   — the sortable columns and, per column, its direction choices. `value` must
 *     be a sortTasks column key ('status' | 'deadline' | 'name' | 'priority').
 * value:    { col, dir, active }  — current column + direction (+ active flag).
 * onChange: ({ col, dir }) => void  — fires for both column and direction picks.
 * onClear:  () => void              — the panel's Clear action (unsets sort).
 */
const dirsFor = (key) => (SORT_COLUMNS.find((c) => c.key === key) || {}).dirs || [];
export const SORT_STATUS_DIRS = dirsFor('status'); // labelAsc/labelDesc/azAsc/azDesc
export const SORT_DATE_DIRS = dirsFor('deadline'); // deadlineAsc/deadlineDesc
export const SORT_TEXT_DIRS = dirsFor('name'); // nameAsc/nameDesc

export function SortByBuilder({ options = [], value, onChange, onClear, onSave, mobile = false }) {
  const col = value?.col ?? null;
  const applied = !!(value?.active && col);
  const current = options.find((o) => o.value === col) || null;

  const firstDir = (o) => o?.dirs?.[0]?.key;
  const pickCol = (v) => onChange?.({ col: v, dir: firstDir(options.find((o) => o.value === v)) });
  const pickDir = (d) => onChange?.({ col, dir: d });

  const field = (m, label, seg) => (m
    ? <div className={bs.bField} key={label}><div className={bs.bFieldLabel}>{label}</div>{seg}</div>
    : seg);

  const renderBody = ({ mobile: m, openId, setOpenId }) => {
    const colSeg = (
      <Segment
        id="scol" openId={openId} setOpenId={setOpenId} mobile={m} sheetTitle="עמודה"
        icon={current?.icon} text={current?.label || 'בחרו עמודה'} placeholder={!current}
        options={options.map((o) => ({ key: o.value, label: o.label, icon: o.icon, selected: o.value === col }))}
        onPick={pickCol} />
    );
    if (!current) {
      return m ? field(true, 'עמודה', colSeg) : <div className={bs.bRow}>{colSeg}</div>;
    }
    const dirs = current.dirs || [];
    const dir = dirs.find((d) => d.key === value?.dir) || dirs[0];
    const dirSeg = dirs.length ? (
      <Segment
        id="sdir" openId={openId} setOpenId={setOpenId} mobile={m} sheetTitle="כיוון" note={current.note}
        icon={dir?.icon} text={dir?.label}
        options={dirs.map((d) => ({ key: d.key, label: d.label, icon: d.icon, selected: d.key === (value?.dir ?? dir?.key) }))}
        onPick={pickDir} />
    ) : null;
    return m
      ? <>{field(true, 'עמודה', colSeg)}{dirSeg ? field(true, 'כיוון', dirSeg) : null}</>
      : <div className={bs.bRow}>{colSeg}{dirSeg}</div>;
  };

  return (
    <BuilderControl
      icon={Sort} label="סדר" title="סדר לפי"
      applied={applied} badge={1} mobile={mobile}
      onClear={applied ? onClear : null}
      onSave={onSave}
      renderBody={renderBody}
    />
  );
}

export default SortByBuilder;
