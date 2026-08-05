import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * round358 (owner report) — a .docx uploaded into a TYPE's export template and saved
 * was simply not there afterwards, with no error anywhere. Root cause class: nothing
 * in the app inspects monday.storage.setItem's RESPONSE — monday can reject a write
 * (value too large, etc.) by resolving `{ data: { success: false } }` rather than
 * throwing, and the code treated that as saved.
 *
 * The contract this file pins, for both the instance-global and the per-type save:
 *   1. a resolved `success: false` is a FAILURE — the save throws with monday's reason;
 *   2. a write that "succeeded" but does not READ BACK with the same content is a
 *      failure too (the verify catches whatever silent-failure shape monday invents
 *      next);
 *   3. the happy path still resolves, and the verify read is best-effort — an
 *      unreadable read-back must not fail a write that DID land (it would re-create
 *      the false alarm in the opposite direction).
 */

const { storage } = vi.hoisted(() => ({
  storage: { setItem: vi.fn(), getItem: vi.fn() },
}));
vi.mock('../mondayApi/monday-client.js', () => ({ monday: { storage } }));

import logger from '../logger.js';
import { saveExportAssets, saveTypeExportAssets } from '../exportAssets.js';

const CTX = { instanceId: 'inst-1' };
const ASSETS = { headerLogo: 'data:image/png;base64,AAA', footerLogo: null, templateDocx: 'UEsDBBQ=' };

// monday's read-back answer for a value that really landed.
const echo = (value) => ({ data: { success: true, value } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(logger, 'error').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  storage.setItem.mockResolvedValue({ data: { success: true } });
  storage.getItem.mockImplementation(async () => echo(JSON.stringify({ ...ASSETS })));
});

describe('round358 — a rejected setItem is a FAILURE, not a save', () => {
  it('type save: success:false rejects with monday\'s reason', async () => {
    storage.setItem.mockResolvedValue({ data: { success: false, reason: 'value too large' } });
    await expect(saveTypeExportAssets(CTX, 'סבב', ASSETS)).rejects.toThrow(/value too large|נדחתה/);
  });

  it('instance save: success:false rejects too', async () => {
    storage.setItem.mockResolvedValue({ data: { success: false } });
    await expect(saveExportAssets(CTX, ASSETS)).rejects.toThrow();
  });

  it('local dev (no instance context) keeps tolerating an unavailable storage', async () => {
    storage.setItem.mockResolvedValue({ data: { success: false } });
    await expect(saveTypeExportAssets({}, 'סבב', ASSETS)).resolves.toBeTruthy();
  });
});

describe('round358 — verify-after-write catches a silent loss', () => {
  it('type save: a read-back missing the templateDocx rejects', async () => {
    // monday said success, but the stored value came back without the file — the
    // exact symptom the owner hit ("שמרנו והקובץ לא שם").
    storage.getItem.mockResolvedValue(echo(JSON.stringify({ ...ASSETS, templateDocx: null })));
    await expect(saveTypeExportAssets(CTX, 'סבב', ASSETS)).rejects.toThrow(/לא נקלטה|אימות/);
  });

  it('type save: a matching read-back resolves clean', async () => {
    await expect(saveTypeExportAssets(CTX, 'סבב', ASSETS)).resolves.toMatchObject({ templateDocx: 'UEsDBBQ=' });
  });

  it('an UNREADABLE read-back does not fail a write that landed (verify is best-effort)', async () => {
    storage.getItem.mockRejectedValue(new Error('timeout'));
    await expect(saveTypeExportAssets(CTX, 'סבב', ASSETS)).resolves.toBeTruthy();
  });

  it('instance save gets the same verify', async () => {
    storage.getItem.mockResolvedValue(echo(JSON.stringify({ headerLogo: null, footerLogo: null, templateDocx: null })));
    await expect(saveExportAssets(CTX, ASSETS)).rejects.toThrow();
  });
});
