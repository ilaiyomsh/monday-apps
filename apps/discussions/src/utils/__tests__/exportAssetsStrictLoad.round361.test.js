import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/*
 * round361 (owner report after round360) — the type save now succeeds with NO error,
 * but re-entering the type's export editor shows no file. On the re-entry path every
 * storage-read failure is swallowed into EMPTY assets, so "the read failed" renders
 * exactly like "nothing was ever saved" — the editor cannot tell the owner (or us)
 * which one happened. Three contracts close that blindness:
 *
 *   1. STRICT loads: the type editor asks loadTypeExportAssets to THROW on a read
 *      failure ({strict:true}) so it can show a real error instead of an empty
 *      upload row. The default stays fail-soft (ExportDialog keeps degrading).
 *   2. The asset storage timeout is 30s, not the 5s inherited from the tiny-settings
 *      pattern — these values are multi-MB, and a slow read that trips a short
 *      timeout IS the suspected silent killer.
 *   3. missingStoredTemplateDocx: the type's OWN stored config carries the small,
 *      reliably-persisted `hasTemplateDocx` flag; when it says a file exists but the
 *      loaded assets have none, that mismatch is detectable and must be surfaced.
 *      The SEEDED config (system fallback) must NOT be used for this — a type that
 *      merely follows the system default would false-alarm on every open.
 */

const { storage } = vi.hoisted(() => ({
  storage: { setItem: vi.fn(), getItem: vi.fn(), deleteItem: vi.fn() },
}));
vi.mock('../mondayApi/monday-client.js', () => ({ monday: { storage } }));

import logger from '../logger.js';
import {
  loadTypeExportAssets,
  missingStoredTemplateDocx,
  EXPORT_ASSETS_TIMEOUT_MS,
} from '../exportAssets.js';

const CTX = { instanceId: 'inst-3' };
const ASSETS = { headerLogo: null, footerLogo: null, templateDocx: 'UEsDBBQ=' };
const echo = (value) => ({ data: { success: true, value } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(logger, 'error').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  storage.setItem.mockResolvedValue({ data: { success: true } });
  storage.getItem.mockResolvedValue({ data: { success: true, value: null } });
  storage.deleteItem.mockResolvedValue({ data: { success: true } });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('round361 — strict type-asset loads throw instead of masquerading as empty', () => {
  it('strict: a failing primary read REJECTS', async () => {
    storage.getItem.mockRejectedValue(new Error('network down'));
    await expect(loadTypeExportAssets(CTX, 'סבב', { strict: true })).rejects.toThrow();
  });

  it('default stays fail-soft: the same failure resolves to EMPTY (ExportDialog degrades)', async () => {
    storage.getItem.mockRejectedValue(new Error('network down'));
    await expect(loadTypeExportAssets(CTX, 'סבב')).resolves.toEqual({
      headerLogo: null,
      footerLogo: null,
      templateDocx: null,
    });
  });

  it('strict: a failing LEGACY fallback read rejects too — "empty" may not be a guess', async () => {
    // primary (digest) read is empty; the legacy read blows up
    let call = 0;
    storage.getItem.mockImplementation(async () => {
      call += 1;
      if (call === 1) return echo(null);
      throw new Error('timeout');
    });
    await expect(loadTypeExportAssets(CTX, 'סבב', { strict: true })).rejects.toThrow();
  });

  it('strict: a clean read still resolves with the assets', async () => {
    storage.getItem.mockResolvedValue(echo(JSON.stringify(ASSETS)));
    await expect(loadTypeExportAssets(CTX, 'סבב', { strict: true })).resolves.toMatchObject({
      templateDocx: 'UEsDBBQ=',
    });
  });
});

describe('round361 — the asset storage timeout fits multi-MB values', () => {
  it('is 30 seconds', () => {
    expect(EXPORT_ASSETS_TIMEOUT_MS).toBe(30000);
  });

  it('a read still pending at 29s has NOT failed; at 30s it times out', async () => {
    vi.useFakeTimers();
    storage.getItem.mockImplementation(() => new Promise(() => {}));
    let settled = null;
    const p = loadTypeExportAssets(CTX, 'סבב', { strict: true }).then(
      () => { settled = 'resolved'; },
      () => { settled = 'rejected'; }
    );
    await vi.advanceTimersByTimeAsync(29000);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(1500);
    await p;
    expect(settled).toBe('rejected');
  });
});

describe('round361 — missingStoredTemplateDocx (config says file, storage says none)', () => {
  it('true when the type\'s OWN config claims a stored file but the assets carry none', () => {
    expect(missingStoredTemplateDocx({ hasTemplateDocx: true }, { ...ASSETS, templateDocx: null })).toBe(true);
    expect(missingStoredTemplateDocx({ hasTemplateDocx: true }, null)).toBe(true);
  });

  it('false when the file is actually there', () => {
    expect(missingStoredTemplateDocx({ hasTemplateDocx: true }, ASSETS)).toBe(false);
  });

  it('false when the config never claimed a file — including the seeded-from-system trap', () => {
    expect(missingStoredTemplateDocx({ hasTemplateDocx: false }, null)).toBe(false);
    // a type with NO own template must pass null here, never the system-seeded
    // config — the system template legitimately claims ITS file, not the type's
    expect(missingStoredTemplateDocx(null, null)).toBe(false);
    expect(missingStoredTemplateDocx(undefined, { ...ASSETS, templateDocx: null })).toBe(false);
  });
});
