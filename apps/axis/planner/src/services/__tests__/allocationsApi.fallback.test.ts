import { describe, it, expect, vi, afterEach } from 'vitest';
import { allocationsApi } from '../allocationsApi';
import { mondayService } from '../mondayService';
import { logger } from '../../utils/Logger';

// Locks the observability fix in getAllWithProjectData: a fetchCurrentAllocations failure ships
// through the Axiom-wired logger (was console.warn, invisible to remote monitoring) and falls
// back to the full fetch.

const settings = { allocationsBoardId: 'b1' } as never;

afterEach(() => vi.restoreAllMocks());

describe('allocationsApi.getAllWithProjectData fallback logging', () => {
  it('logs a WARN and falls back to fetchItems when fetchCurrentAllocations throws', async () => {
    vi.spyOn(mondayService, 'fetchCurrentAllocations').mockRejectedValue(new Error('operator not supported'));
    vi.spyOn(mondayService, 'fetchItems').mockResolvedValue([]);
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    const result = await allocationsApi.getAllWithProjectData(settings);

    expect(mondayService.fetchItems).toHaveBeenCalledWith('b1');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain('fetchCurrentAllocations failed');
    expect(result.allocations).toEqual([]);
  });

  it('does NOT warn and does NOT fall back when fetchCurrentAllocations succeeds', async () => {
    vi.spyOn(mondayService, 'fetchCurrentAllocations').mockResolvedValue([]);
    const fetchItemsSpy = vi.spyOn(mondayService, 'fetchItems').mockResolvedValue([]);
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    await allocationsApi.getAllWithProjectData(settings);

    expect(warnSpy).not.toHaveBeenCalled();
    expect(fetchItemsSpy).not.toHaveBeenCalled();
  });
});
