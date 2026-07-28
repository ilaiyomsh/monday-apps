import { describe, it, expect, vi, beforeEach } from 'vitest';

// The monday SDK singleton is mocked so loadExportAssets' storage read can be driven to fail
// deterministically (no real network, no 5s timeout).
vi.mock('../mondayApi/monday-client.js', () => ({
  monday: { storage: { getItem: vi.fn() } },
}));

import { monday } from '../mondayApi/monday-client.js';
import logger from '../logger.js';
import { loadExportAssets } from '../exportAssets.js';

const EMPTY = { headerLogo: null, footerLogo: null, templateDocx: null };

describe('loadExportAssets — a storage-read failure is logged, not silently swallowed', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('logs a WARN tagged exportAssets and returns empty assets when the stored value is unparseable', async () => {
    monday.storage.getItem.mockResolvedValue({ data: { value: '{not valid json' } });
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const out = await loadExportAssets({ instanceId: '42' });
    expect(out).toEqual(EMPTY);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe('exportAssets');
  });

  it('logs a WARN and returns empty assets when the storage read rejects', async () => {
    monday.storage.getItem.mockRejectedValue(new Error('storage unavailable'));
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const out = await loadExportAssets({ instanceId: '42' });
    expect(out).toEqual(EMPTY);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe('exportAssets');
    // Wording is the app's Hebrew operator message; what this locks is that the rejection
    // is REPORTED (module + a non-empty message + the Error itself), never swallowed.
    expect(warn.mock.calls[0][1]).toEqual(expect.stringMatching(/\S/));
    expect(warn.mock.calls[0][2]).toBeInstanceOf(Error);
  });

  it('does NOT log on the happy path (a valid stored value)', async () => {
    monday.storage.getItem.mockResolvedValue({ data: { value: JSON.stringify({ headerLogo: 'data:x' }) } });
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const out = await loadExportAssets({ instanceId: '42' });
    expect(out.headerLogo).toBe('data:x');
    expect(warn).not.toHaveBeenCalled();
  });
});
