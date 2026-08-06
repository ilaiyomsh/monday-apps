import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * round370 §2 (owner bug report) — "כאשר אני מוסיף עמודת קישור לא ממופה מראש …
 * זה כמו תוקע את כל המסך ולא ניתן לבצע פעולות".
 *
 * The freeze is an INFINITE RENDER LOOP, and its root cause is a reference
 * identity, not the API. `useRelationItems` built its return value as a fresh
 * object literal on every render, so the per-column collector in TaskTable —
 *
 *     const rel = useRelationItems('tasks', alias);
 *     useEffect(() => { onItems(alias, rel); }, [alias, rel, onItems]);
 *
 * — saw a NEW `rel` every render, fired the effect, set state on the table, which
 * re-rendered the collector, which produced another new `rel`… forever. The
 * browser tab stops responding; nothing throws, so nothing is logged.
 *
 * Its sibling `useDropdownOptions` returns its state object DIRECTLY, which is
 * exactly why a custom dropdown column never froze anything. So the invariant
 * this file locks is: the returned view is referentially STABLE while nothing
 * about the column changed. The first test reproduces the loop through the real
 * collector shape; the second states the invariant directly.
 */

vi.mock('@generated/utils/mondayApi/monday-client.js', () => ({
  api: vi.fn(async () => ({ boards: [{ columns: [{ id: 'c1', type: 'board_relation', settings: { boardIds: [] } }] }] })),
}));
vi.mock('@generated/utils/mondayApi/board-config-store.js', () => ({
  getColumns: () => ({ custom1ID: { id: 'c1', type: 'board_relation', title: 'לוח מקושר' } }),
  getBoardId: () => '111',
}));
vi.mock('@generated/utils/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { useRelationItems, __resetRelationItemsCache } from '../useRelationItems.js';

beforeEach(() => {
  __resetRelationItemsCache();
  vi.clearAllMocks();
});

// The collector/table pair from TaskTable, reduced to the part that loops.
function Collector({ alias, onItems }) {
  const rel = useRelationItems('tasks', alias);
  React.useEffect(() => { onItems(alias, rel); }, [alias, rel, onItems]);
  return null;
}

/*
 * The CAP is an instrument, not the verdict: past it the Host stops rendering the
 * collector, which unmounts the effect and lets the tree settle. Without it a
 * genuine loop never yields control back and the test would HANG instead of
 * failing — a hang proves nothing and blocks the whole suite.
 */
const CAP = 20;

function Host({ stats }) {
  // Only the SETTER matters here: storing the reported view is what re-renders the
  // host, which is the second half of the loop. The value itself is never read.
  const [, setMap] = React.useState({});
  const onItems = React.useCallback((alias, rel) => {
    setMap((m) => (m[alias] === rel ? m : { ...m, [alias]: rel }));
  }, []);
  stats.n += 1;
  if (stats.n > CAP) return null; // circuit-breaker: stop feeding the loop
  return <Collector alias="custom1ID" onItems={onItems} />;
}

describe('round370 — a custom relation column must not spin the render loop', () => {
  it('settles after the load instead of re-rendering forever', async () => {
    const stats = { n: 0 };
    render(<Host stats={stats} />);
    await waitFor(() => expect(stats.n).toBeGreaterThan(1));
    // Let React keep going if it wants to, then read the count. A loop driven by
    // a fresh object per render climbs to the cap; a settled tree stays put.
    await new Promise((r) => setTimeout(r, 60));
    expect(stats.n).toBeLessThan(CAP);
  });

  it('returns a referentially STABLE view across re-renders (the invariant)', async () => {
    const seen = [];
    function Probe() {
      const rel = useRelationItems('tasks', 'custom1ID');
      seen.push(rel);
      return null;
    }
    const { rerender } = render(<Probe />);
    await waitFor(() => expect(seen.length).toBeGreaterThan(1));
    rerender(<Probe />);
    rerender(<Probe />);
    const last = seen[seen.length - 1];
    // every render AFTER the load resolved hands back the very same object
    expect(seen[seen.length - 2]).toBe(last);
    expect(seen[seen.length - 3]).toBe(last);
  });
});
