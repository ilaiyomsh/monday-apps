/**
 * viewTracking.test.ts — the pure, dedup'd createViewTracker (decision D3). The React hook
 * useViewTracking is a thin wrapper over this and is exercised via app integration.
 */
import { describe, it, expect, vi } from 'vitest';
import { createViewTracker } from '../src/usage/viewTracking';
import type { Logger } from '../src/logger';

function fakeLogger() {
  const track = vi.fn();
  return { logger: { track } as unknown as Logger, track };
}

describe('createViewTracker', () => {
  it('fires logger.track("view_open", {view, ...dims}) once per distinct view', () => {
    const { logger, track } = fakeLogger();
    const vt = createViewTracker(logger);
    vt.track('calendar');
    vt.track('calendar'); // dedup — no second call
    vt.track('list', { tab: 'x' });
    expect(track).toHaveBeenCalledTimes(2);
    expect(track).toHaveBeenNthCalledWith(1, 'view_open', { view: 'calendar' });
    expect(track).toHaveBeenNthCalledWith(2, 'view_open', { view: 'list', tab: 'x' });
  });
  it('ignores an empty view, and reset() re-arms the dedup memory', () => {
    const { logger, track } = fakeLogger();
    const vt = createViewTracker(logger);
    vt.track('');
    expect(track).not.toHaveBeenCalled();
    vt.track('a');
    vt.track('a');
    expect(track).toHaveBeenCalledTimes(1);
    vt.reset();
    vt.track('a');
    expect(track).toHaveBeenCalledTimes(2);
  });
});
