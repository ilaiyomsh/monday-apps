import { describe, it, expect } from 'vitest';
import { customGroupDims, customEngineDims } from '@generated/utils/customColumns.js';
import { groupTabTasks } from '@generated/components/MyTasksView/grouping.js';
import { customFilterDims } from '@generated/components/MyTasksView/controls/controls.js';
import { sortTasks } from '@generated/components/MyTasksView/controls/controls.js';

/*
 * round375 — the owner reports that a CONNECTED-BOARD column added on the tasks
 * board cannot be grouped by. These tests drive the exact chain the toolbar uses,
 * with the exact value shape parseValue produces for a board_relation
 * (`{ ids, linkedItems: [{ id, name }], text }`), so the failing link is located
 * rather than guessed at.
 */

const COL = { alias: 'custom7ID', type: 'board_relation', title: 'קישור' };
const rel = (...items) => ({ ids: items.map((i) => i.id), linkedItems: items, text: items.map((i) => i.name).join(', ') });
const A = { id: '101', name: 'פרויקט א' };
const B = { id: '102', name: 'פרויקט ב' };

describe('a tasks-board connected-board column reaches every builder', () => {
  it('appears as a GROUP option', () => {
    expect(customGroupDims([COL]).map((d) => d.key)).toContain('custom7ID');
  });

  it('appears as a FILTER dim on the shared value-set control', () => {
    expect(customFilterDims([COL])).toEqual([{ key: 'custom7ID', control: 'values', title: 'קישור' }]);
  });

  it('carries a descriptor into the engines', () => {
    expect(customEngineDims([COL], {})).toEqual({ custom7ID: { kind: 'relation' } });
  });
});

describe('grouping tasks by that column', () => {
  const dims = customEngineDims([COL], {});
  const list = [
    { id: 't1', custom7ID: rel(A) },
    { id: 't2', custom7ID: rel(A) },
    { id: 't3', custom7ID: rel(B) },
    { id: 't4', custom7ID: rel(B, A) },  // a COMBINATION — its own bucket
    { id: 't5', custom7ID: rel() },      // linked to nothing
    { id: 't6' },                        // column never written
  ];

  it('buckets by the linked items, not into one lump', () => {
    const groups = groupTabTasks(list, { by: 'custom7ID', custom: dims });
    // 3 real buckets (א, ב, and the א+ב combination) + the empty bucket
    expect(groups).toHaveLength(4);
    const byLabel = Object.fromEntries(groups.map((g) => [g.label, g.items.map((t) => t.id)]));
    expect(byLabel['פרויקט א']).toEqual(['t1', 't2']);
    expect(byLabel['פרויקט ב']).toEqual(['t3']);
    expect(byLabel['פרויקט א, פרויקט ב']).toEqual(['t4']);
    expect(byLabel['ללא ערך']).toEqual(['t5', 't6']);
  });

  it('gives each labelled bucket a colour, and puts the empty bucket last', () => {
    const groups = groupTabTasks(list, { by: 'custom7ID', custom: dims });
    expect(groups.at(-1).label).toBe('ללא ערך');
    expect(groups.filter((g) => g.label !== 'ללא ערך').every((g) => !!g.color)).toBe(true);
  });

  it('sorts by the linked names, empty last', () => {
    const out = sortTasks(
      [{ id: 'x' }, { id: 'b', custom7ID: rel(B) }, { id: 'a', custom7ID: rel(A) }],
      { col: 'custom7ID', dir: 'azAsc', active: true },
      { custom: dims }
    );
    expect(out.map((t) => t.id)).toEqual(['a', 'b', 'x']);
  });
});
