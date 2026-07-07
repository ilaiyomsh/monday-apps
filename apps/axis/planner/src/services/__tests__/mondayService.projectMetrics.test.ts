import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Same funnel mock as the day-off tests: the per-project aggregates go through
// apiQueue. We drive the aggregate responses here and assert on the parsed maps.
const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('../apiQueue', () => ({ apiQueue: { execute } }));
vi.mock('monday-sdk-js', () => ({ default: () => ({}) }));

import { mondayService } from '../mondayService';
import { logger } from '../../utils/Logger';
import type { PlannerSettings } from '../../types/settings.types';

/** Build an aggregate result group: one project id + its summed value. */
const group = (projId: string | null, value: number) => ({
  entries: [
    { alias: 'group_id', value: { value: projId } },
    { alias: 'val', value: { result: value } },
  ],
});

const aggResponse = (alias: string, groups: unknown[]) => ({
  data: { [alias]: { results: groups } },
});

const baseSettings = {
  allocationsBoardId: 'alloc-1',
  totalHoursColumnId: 'numeric_alloc',
  projectColumnId: 'rel_proj_alloc',
} as unknown as PlannerSettings;

beforeEach(() => {
  execute.mockReset();
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mondayService.fetchAllocatedHoursByProject', () => {
  it('sums allocated hours per project and keys the map by project id', async () => {
    execute.mockResolvedValueOnce(
      aggResponse('agg', [group('111', 294.4), group('222', 10)])
    );

    const map = await mondayService.fetchAllocatedHoursByProject(baseSettings);

    expect(map.get('111')).toBe(294.4);
    expect(map.get('222')).toBe(10);
    expect(map.size).toBe(2);
  });

  it('DROPS the null-project bucket (rows whose relation column is empty)', async () => {
    // The real API returns one group with proj_id=null aggregating every
    // unlinked row — it must never leak into a project total.
    execute.mockResolvedValueOnce(
      aggResponse('agg', [group(null, 2728.8), group('111', 50)])
    );

    const map = await mondayService.fetchAllocatedHoursByProject(baseSettings);

    expect(map.has('null')).toBe(false);
    expect(map.get('111')).toBe(50);
    expect(map.size).toBe(1);
  });

  it('returns an empty map when required columns are unmapped (no API call)', async () => {
    const map = await mondayService.fetchAllocatedHoursByProject({
      ...baseSettings,
      totalHoursColumnId: '',
    } as PlannerSettings);

    expect(map.size).toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });
});
