/**
 * Regression + windowing contract (perf/unified-load #90 follow-on).
 *
 * The unified path's load model changed:
 *   - FORWARD: the critical bundle (getCriticalBundle) pulls ALL current+future
 *     allocations in one shot (endDate >= today). There is NO separate future
 *     fetch anymore (fetchFutureAllocations was deleted).
 *   - BACKWARD: past allocations are ALWAYS loaded in the background — a first
 *     1yr window after the critical fetch settles, then +1yr per fetchMorePast()
 *     on scroll-back. The data layer (allocationsApi.getPastAllocations) is
 *     stateless-by-bounds; the hook owns the cursor (earliestLoadedDate) and the
 *     'idle'|'loading'|'ready'|'error' state.
 *
 * These tests assert: (a) no separate future fetch; (b) one background past
 * window after critical settles; (c) fetchMorePast advances earliestLoadedDate
 * ~1yr and merges by id WITHOUT clobbering existing windows (the change #44
 * merge-by-id safety); (d) a past-window failure → pastLoadState 'error' and
 * retryPast() recovers. Only IO/contexts are mocked.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { mergeAllocationsById } from '../../utils/allocationUtils';
import type { Allocation } from '../../types/entities/allocation.types';
import type { PlannerSettings } from '../../types/settings.types';

const { getCriticalBundle, getPastAllocations, getEmployees } = vi.hoisted(() => ({
  getCriticalBundle: vi.fn(),
  getPastAllocations: vi.fn(),
  getEmployees: vi.fn(),
}));
const { updateItem } = vi.hoisted(() => ({
  updateItem: vi.fn(),
}));

vi.mock('../../services/allocationsApi', () => ({
  allocationsApi: { getCriticalBundle, getPastAllocations, getEmployees },
}));
vi.mock('../../services/mondayService', () => ({
  mondayService: { updateItem },
}));
vi.mock('../../utils/batchMutations', () => ({ batchMutations: vi.fn() }));

let mockSettings: PlannerSettings;
vi.mock('../../contexts/SettingsContext', () => ({
  useSettings: () => ({ settings: mockSettings, isConfigured: true }),
}));
vi.mock('../../contexts/ActiveProjectsContext', () => ({
  useActiveProjects: () => ({
    activeProjects: [{ id: 'p1', name: 'רוטשילד 223' }],
    activeProjectIds: new Set(['p1']),
    refresh: vi.fn(),
  }),
}));
vi.mock('../../contexts/MondayContext', () => ({
  useMondayContext: () => ({ context: { user: { isAdmin: false } } }),
}));
vi.mock('./useUserPhotos', () => ({
  useUserPhotos: () => ({ photoMap: new Map(), getPhotoUrl: () => undefined }),
}));

import { useAllocations } from '../useAllocations';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const alloc = (over: Partial<Allocation>): Allocation => ({
  id: 'x', projectId: 'p1', employeeId: 'e1', role: 'יועץ בטיחות',
  startDate: '2026-05-01T00:00:00.000Z', endDate: '2026-07-01T00:00:00.000Z',
  hoursPerDay: 4, totalHours: 100, projectName: 'רוטשילד 223', ...over,
});
const CURRENT = alloc({ id: 'cur-1' }); // endDate >= today → in the critical bundle
const PAST_1 = alloc({ id: 'past-1', startDate: '2024-01-01T00:00:00.000Z', endDate: '2024-03-01T00:00:00.000Z' });
const PAST_2 = alloc({ id: 'past-2', startDate: '2023-01-01T00:00:00.000Z', endDate: '2023-03-01T00:00:00.000Z' });

type Bundle = {
  allocations: Allocation[]; employees: any[]; columns: any[];
  projectDataMap: Map<string, any>; reportedByAllocId: Map<string, number>;
};
type PastResult = { allocations: Allocation[]; projectDataMapDelta: Map<string, any> };

let bundleCalls: Array<ReturnType<typeof deferred<Bundle>>>;
let pastCalls: Array<ReturnType<typeof deferred<PastResult>>>;

beforeEach(() => {
  vi.clearAllMocks();
  // Unified path requires the reported-hours mirror + the logs→allocations relation.
  mockSettings = {
    allocationsBoardId: 'b1', roleColumnId: 'role', filterInactiveEmployees: false,
    reportedHoursColumnId: 'rep', timeLogsAllocationColumnId: 'rel',
    projectsBoardId: 'proj',
  } as Partial<PlannerSettings> as PlannerSettings;

  bundleCalls = [];
  getCriticalBundle.mockImplementation(() => {
    const d = deferred<Bundle>();
    bundleCalls.push(d);
    return d.promise;
  });
  pastCalls = [];
  getPastAllocations.mockImplementation(() => {
    const d = deferred<PastResult>();
    pastCalls.push(d);
    return d.promise;
  });
  getEmployees.mockResolvedValue([]);
});

const emptyBundle = (allocations: Allocation[]): Bundle => ({
  allocations, employees: [], columns: [],
  projectDataMap: new Map(), reportedByAllocId: new Map(),
});
const pastOk = (allocations: Allocation[]): PastResult => ({
  allocations, projectDataMapDelta: new Map(),
});

describe('mergeAllocationsById', () => {
  it('returns incoming as-is when nothing exists yet', () => {
    expect(mergeAllocationsById([], [CURRENT])).toEqual([CURRENT]);
  });
  it('preserves existing items whose id is absent from incoming (the core fix)', () => {
    const merged = mergeAllocationsById([PAST_1], [CURRENT]);
    expect(merged.map(a => a.id).sort()).toEqual(['cur-1', 'past-1']);
  });
  it('updates an existing item in place when incoming carries the same id', () => {
    const updated = { ...CURRENT, hoursPerDay: 8 };
    const merged = mergeAllocationsById([CURRENT, PAST_1], [updated]);
    expect(merged).toHaveLength(2);
    expect(merged.find(a => a.id === 'cur-1')!.hoursPerDay).toBe(8);
    expect(merged.find(a => a.id === 'past-1')).toBeDefined();
  });
  it('does not duplicate when the same batch is merged twice (idempotent)', () => {
    const once = mergeAllocationsById([], [CURRENT, PAST_1]);
    const twice = mergeAllocationsById(once, [CURRENT, PAST_1]);
    expect(twice.map(a => a.id).sort()).toEqual(['cur-1', 'past-1']);
  });
});

describe('useAllocations — folded-future + always-background-past windowing', () => {
  it('the critical bundle carries current+future; no separate future fetch exists', async () => {
    const { result } = renderHook(() => useAllocations('projects'));

    await waitFor(() => expect(getCriticalBundle).toHaveBeenCalledTimes(1));
    await act(async () => { bundleCalls[0].resolve(emptyBundle([CURRENT])); });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.rawAllocations.map(a => a.id)).toEqual(['cur-1']);
    // No fetchFutureAllocations on the surface — the hook never exposes it and
    // the unified bundle is the only forward source.
    expect((result.current as any).loadPastAllocations).toBeUndefined();
  });

  it('runs exactly ONE background past window, merging safely with the bundle', async () => {
    // The background-past effect (like the legacy background-future it replaced)
    // is gated on `loading`, which starts false on mount — so the first window
    // can race the critical bundle. merge-by-id (change #44) makes either order
    // safe: the past window must fire exactly once and never clobber the bundle.
    const { result } = renderHook(() => useAllocations('projects'));

    await waitFor(() => expect(getCriticalBundle).toHaveBeenCalledTimes(1));

    await act(async () => { bundleCalls[0].resolve(emptyBundle([CURRENT])); });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await waitFor(() => expect(getPastAllocations).toHaveBeenCalledTimes(1));
    await act(async () => { pastCalls[0].resolve(pastOk([PAST_1])); });

    await waitFor(() => expect(result.current.pastLoadState).toBe('ready'));
    expect(result.current.rawAllocations.map(a => a.id).sort()).toEqual(['cur-1', 'past-1']);
    expect(typeof result.current.earliestLoadedDate).toBe('string');
    // Still exactly one background window — it doesn't re-arm on its own.
    expect(getPastAllocations).toHaveBeenCalledTimes(1);
  });

  it('fetchMorePast advances the cursor ~1yr and merges by id without clobbering', async () => {
    const { result } = renderHook(() => useAllocations('projects'));

    await waitFor(() => expect(getCriticalBundle).toHaveBeenCalledTimes(1));
    await act(async () => { bundleCalls[0].resolve(emptyBundle([CURRENT])); });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await waitFor(() => expect(getPastAllocations).toHaveBeenCalledTimes(1));
    await act(async () => { pastCalls[0].resolve(pastOk([PAST_1])); });
    await waitFor(() => expect(result.current.pastLoadState).toBe('ready'));

    const firstBound = result.current.earliestLoadedDate as string;

    // Scroll-back triggers a second, older window.
    act(() => { result.current.fetchMorePast(); });
    await waitFor(() => expect(getPastAllocations).toHaveBeenCalledTimes(2));
    await act(async () => { pastCalls[1].resolve(pastOk([PAST_2])); });
    await waitFor(() => expect(result.current.pastLoadState).toBe('ready'));

    const secondBound = result.current.earliestLoadedDate as string;
    expect(secondBound < firstBound).toBe(true); // cursor moved older

    // Both windows survive alongside current — no clobber.
    expect(result.current.rawAllocations.map(a => a.id).sort()).toEqual(['cur-1', 'past-1', 'past-2']);

    // The second window's bound is ~1 year older than the first.
    const yearDiff = new Date(firstBound).getUTCFullYear() - new Date(secondBound).getUTCFullYear();
    expect(yearDiff).toBe(1);
  });

  it('a past-window failure sets pastLoadState=error; retryPast() recovers', async () => {
    const { result } = renderHook(() => useAllocations('projects'));

    await waitFor(() => expect(getCriticalBundle).toHaveBeenCalledTimes(1));
    await act(async () => { bundleCalls[0].resolve(emptyBundle([CURRENT])); });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await waitFor(() => expect(getPastAllocations).toHaveBeenCalledTimes(1));
    await act(async () => { pastCalls[0].reject(new Error('boom')); });

    await waitFor(() => expect(result.current.pastLoadState).toBe('error'));
    // Never fell back to a partial number — rawAllocations still only the bundle.
    expect(result.current.rawAllocations.map(a => a.id)).toEqual(['cur-1']);

    // Manual retry re-runs the failed window and recovers.
    act(() => { result.current.retryPast(); });
    await waitFor(() => expect(getPastAllocations.mock.calls.length).toBeGreaterThanOrEqual(2));
    const last = pastCalls[pastCalls.length - 1];
    await act(async () => { last.resolve(pastOk([PAST_1])); });

    await waitFor(() => expect(result.current.pastLoadState).toBe('ready'));
    expect(result.current.rawAllocations.map(a => a.id).sort()).toEqual(['cur-1', 'past-1']);
  });
});
