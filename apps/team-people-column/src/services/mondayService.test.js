// Characterization tests for mondayService's storage-write success contract.
//
// monday.storage.setItem RESOLVES even when the write did not persist — the
// failure is in-band ({ data: { success:false } }). The service must throw on
// that, so a failed save flows into the caller's catch/log/display path instead
// of being confirmed to the user as saved. Driven against the dev-harness stub
// (vitest aliases monday-sdk-js -> the stub), whose `storageErrorNext` toggle
// reproduces the resolved-but-failed write. No hand-built responses.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { harness } from '../dev-harness/monday-sdk-stub.js';
import mondayService from './mondayService.js';
import logger from '../utils/logger.js';

beforeEach(() => {
  harness.reset();
  harness.failures.latencyMs = 0;
});

afterEach(() => {
  harness.reset();
});

describe('mondayService.setColumnConfig', () => {
  it('persists the JSON-stringified value in GLOBAL storage under teamPeople:<boardId>:<columnId>', async () => {
    await mondayService.setColumnConfig('18421604809', 'team_people_col', { version: 1 });
    // Stub scopes global storage under `global:<key>`. Column config MUST live in
    // global (not instance) storage: column-view dialogs have no instanceId, so
    // instance writes resolve success:false in production.
    expect(
      JSON.parse(harness.readStorage('global:teamPeople:18421604809:team_people_col')),
    ).toEqual({ version: 1 });
  });

  it('round-trips through getColumnConfig for the same boardId+columnId', async () => {
    await mondayService.setColumnConfig('18421604809', 'team_people_col', { version: 1 });
    await expect(
      mondayService.getColumnConfig('18421604809', 'team_people_col'),
    ).resolves.toEqual({ version: 1 });
  });

  it('throws when the resolved setItem response reports success:false', async () => {
    harness.failures.storageErrorNext = true; // next storage op resolves { data:{ success:false } }
    await expect(
      mondayService.setColumnConfig('18421604809', 'team_people_col', { version: 1 }),
    ).rejects.toThrow(
      /Failed to persist column-config storage key "teamPeople:18421604809:team_people_col"/,
    );
  });
});

describe('mondayService.setAppStorage', () => {
  it('resolves and persists the JSON-stringified value on a successful write', async () => {
    await mondayService.setAppStorage('appKey', { a: 1 });
    // Stub scopes app (global) storage under `global:<key>`.
    expect(JSON.parse(harness.readStorage('global:appKey'))).toEqual({ a: 1 });
  });

  it('throws when the resolved setItem response reports success:false', async () => {
    harness.failures.storageErrorNext = true;
    await expect(mondayService.setAppStorage('appKey', { a: 1 })).rejects.toThrow(
      /Failed to persist app storage key "appKey"/,
    );
  });

  it('logs via logger.error and rethrows the SAME error when the underlying write rejects', async () => {
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    harness.failures.storageRejectNext = true; // hard failure: setItem() rejects, not success:false
    await expect(mondayService.setAppStorage('appKey', { a: 1 })).rejects.toThrow(
      /dev-harness: simulated storage rejection/,
    );
    expect(spy).toHaveBeenCalledWith(
      'mondayService',
      expect.stringContaining('Failed to write app storage key "appKey"'),
      expect.any(Error),
    );
    spy.mockRestore();
  });

  it('does NOT swallow the failure (no successful resolve after a rejected write)', async () => {
    harness.failures.storageErrorNext = true;
    let threw = false;
    try {
      await mondayService.setAppStorage('appKey', { a: 1 });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});

describe('mondayService.getAppStorage', () => {
  it('resolves the previously-stored value, JSON-parsed', async () => {
    await mondayService.setAppStorage('appKey', { a: 1 });
    await expect(mondayService.getAppStorage('appKey')).resolves.toEqual({ a: 1 });
  });

  it('resolves null for a key that was never written', async () => {
    await expect(mondayService.getAppStorage('missingKey')).resolves.toBeNull();
  });

  it('logs via logger.error and rethrows the SAME error when the underlying read rejects', async () => {
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    harness.failures.storageRejectNext = true; // hard failure: getItem() rejects
    await expect(mondayService.getAppStorage('appKey')).rejects.toThrow(
      /dev-harness: simulated storage rejection/,
    );
    expect(spy).toHaveBeenCalledWith(
      'mondayService',
      expect.stringContaining('Failed to read app storage key "appKey"'),
      expect.any(Error),
    );
    spy.mockRestore();
  });
});
