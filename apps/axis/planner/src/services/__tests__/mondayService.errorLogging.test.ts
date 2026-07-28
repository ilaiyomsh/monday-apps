import { describe, it, expect, vi, afterEach } from 'vitest';
import { mondayService } from '../mondayService';
import { logger } from '../../utils/Logger';

// Locks the two catch-layer observability fixes in mondayService:
//  - resolveLogsProjectColumnId's inner projects-board derivation (was a silent swallow)
//  - parseColumnSettings malformed-JSON (was a silent {} default)

afterEach(() => vi.restoreAllMocks());

describe('resolveLogsProjectColumnId error logging', () => {
  it('warns (not silent) and returns null when the projects-board derivation fetchColumns throws', async () => {
    // No projectsBoardId → derive from the allocations board's project relation column.
    const settings = { allocationsBoardId: 'a1', projectColumnId: 'pcol' } as never;
    vi.spyOn(mondayService, 'fetchColumns').mockRejectedValue(new Error('cols failed'));
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    const result = await mondayService.resolveLogsProjectColumnId(settings, 'logs1');

    expect(result).toBeNull();
    expect(warnSpy.mock.calls.some((c) => String(c[0]).includes('projects-board derivation failed'))).toBe(true);
  });
});

describe('parseColumnSettings malformed-JSON logging (via resolveLogsProjectColumnId)', () => {
  it('warns when a column carries malformed settings JSON instead of masking it silently', async () => {
    // projectsBoardId is set → skips derivation; logs-board columns are fetched and their
    // settings parsed. A board_relation column with malformed settings triggers the warn.
    const settings = { projectsBoardId: 'p1' } as never;
    vi.spyOn(mondayService, 'fetchColumns').mockResolvedValue([
      { id: 'c1', type: 'board_relation', settings: '{not valid json' },
    ] as never);
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    await mondayService.resolveLogsProjectColumnId(settings, 'logs1');

    expect(warnSpy.mock.calls.some((c) => String(c[0]).includes('malformed column settings'))).toBe(true);
  });
});
