import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * round375 — the owner reported a connected-board column added on the tasks board
 * that showed up in the TABLE but could not be grouped by.
 *
 * The engines were all correct (see customRelationGroup.round375.test.jsx, which
 * drives the whole chain green). The defect was React freshness, not logic: the
 * three places that resolve the custom mapping used `useMemo(..., [])`, so each
 * captured the mapping ONCE PER MOUNT off the module-level config store. The
 * per-group TaskTable instances remount whenever the group set changes and pick a
 * newly mapped column up; TasksTab itself does not remount, so its Sort/Group/
 * Filter option lists kept a stale, shorter list. Table and toolbar disagreed.
 *
 * Guarding this with a render test would mean simulating a settings publish
 * across three components; the honest, durable guard is that none of the three
 * memos may go back to empty deps.
 */

const FILES = [
  'src/components/TasksTab/TasksTab.jsx',
  'src/components/PreviousTasksTab/PreviousTasksTab.jsx',
  'src/components/TaskTable/TaskTable.jsx',
];

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf-8');

describe('the custom-column mapping is resolved reactively, not once per mount', () => {
  it.each(FILES)('%s keys its custom-column memo off the live settings', (rel) => {
    const src = read(rel);
    const memo = src.slice(src.indexOf('customEntriesFor('));
    const block = memo.slice(0, memo.indexOf('  );') + 4);
    // The dependency must be the settings mapping — directly, or via a named
    // local for it (TasksTab reads it once as `taskColumnsConfig`) — never [].
    expect(block).toMatch(/settings\?\.columns\?\.tasks|taskColumnsConfig/);
    expect(/\n\s*\[\]\s*\n\s*\);/.test(block)).toBe(false);
  });

  it.each(FILES)('%s reads the mapping it depends on (so the dep is real)', (rel) => {
    const src = read(rel);
    // Depending on a value the body never reads is what eslint flags AND what
    // makes the "freshness key" pattern rot silently.
    expect(src).toMatch(/customEntriesFor\((taskColumnsConfig|settings\?\.columns\?\.tasks) \|\| getColumns\('tasks'\)\)/);
  });
});
