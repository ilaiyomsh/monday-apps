import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * round360 (owner report, narrowed live) — saving export assets fails ONLY for a
 * discussion TYPE, never for the instance-global template, with the very same file.
 * The type value is even SMALLER than the global one (the type stores only what was
 * entered in its editor), so size cannot be the discriminator. The one structural
 * difference is the STORAGE KEY: the global key is short ASCII, while the type key
 * embedded the type's free Hebrew name percent-encoded
 * (`..._type_<inst>_%D7%93%D7%99...`) — and monday's storage backend rejects that
 * write with `success:false` (an undocumented constraint; the docs state only a
 * 256-char cap). Before round358 nothing read the setItem response, so every
 * per-type asset save with a Hebrew name failed SILENTLY, which is exactly the
 * history of this bug.
 *
 * The contract this file pins:
 *   1. the type key is short, pure-ASCII and bounded — for ANY type name (Hebrew,
 *      emoji, very long) — via a deterministic digest, never the raw/encoded name;
 *   2. reads FALL BACK to the legacy percent-encoded key, so an account where the
 *      legacy write did land (short ASCII type names) keeps its assets;
 *   3. a legacy hit is MIGRATED forward best-effort (rewritten under the new key,
 *      legacy deleted only after the new write is accepted) and never throws;
 *   4. renaming a type moves the assets to the NEW name's digest key and clears
 *      both possible source keys.
 */

const { storage } = vi.hoisted(() => ({
  storage: { setItem: vi.fn(), getItem: vi.fn(), deleteItem: vi.fn() },
}));
vi.mock('../mondayApi/monday-client.js', () => ({ monday: { storage } }));

import logger from '../logger.js';
import {
  loadTypeExportAssets,
  saveTypeExportAssets,
  moveTypeExportAssets,
  typeExportAssetsKey,
  legacyTypeExportAssetsKey,
} from '../exportAssets.js';

const CTX = { instanceId: 'inst-9' };
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

describe('round360 — the type key is short ASCII for any type name', () => {
  it('a Hebrew type name yields a pure-ASCII key with no percent-escapes', () => {
    const key = typeExportAssetsKey(CTX, 'ישיבת הנהלה שבועית');
    expect(key.startsWith('discussions_export_assets_type_inst-9_')).toBe(true);
    // the two properties monday's backend chokes on: % escapes / non-ASCII
    expect(key).not.toContain('%');
    expect(/^[\x21-\x7e]+$/.test(key)).toBe(true);
  });

  it('the key stays under monday\'s 256-char cap even for an absurdly long name', () => {
    const key = typeExportAssetsKey(CTX, 'דיון '.repeat(60));
    expect(key.length).toBeLessThan(128);
  });

  it('same name → same key; different names → different keys', () => {
    expect(typeExportAssetsKey(CTX, 'סבב')).toBe(typeExportAssetsKey(CTX, 'סבב'));
    expect(typeExportAssetsKey(CTX, 'סבב')).not.toBe(typeExportAssetsKey(CTX, 'סבב '));
    expect(typeExportAssetsKey(CTX, 'א')).not.toBe(typeExportAssetsKey(CTX, 'ב'));
  });

  it('save writes under the digest key, not the legacy encoded key', async () => {
    storage.getItem.mockImplementation(async () => echo(JSON.stringify(ASSETS)));
    await saveTypeExportAssets(CTX, 'סבב', ASSETS);
    const keys = storage.setItem.mock.calls.map(([k]) => k);
    expect(keys).toContain(typeExportAssetsKey(CTX, 'סבב'));
    expect(keys).not.toContain(legacyTypeExportAssetsKey(CTX, 'סבב'));
  });
});

describe('round360 — legacy fallback + forward migration', () => {
  // computed lazily — at collection time the functions may not exist yet (red phase)
  const NEW_KEY = () => typeExportAssetsKey(CTX, 'סבב');
  const OLD_KEY = () => legacyTypeExportAssetsKey(CTX, 'סבב');

  it('load prefers the digest key when it holds a value', async () => {
    storage.getItem.mockImplementation(async (k) =>
      k === NEW_KEY() ? echo(JSON.stringify(ASSETS)) : echo(null)
    );
    const a = await loadTypeExportAssets(CTX, 'סבב');
    expect(a.templateDocx).toBe('UEsDBBQ=');
    // no need to even look at the legacy key
    expect(storage.getItem.mock.calls.map(([k]) => k)).toEqual([NEW_KEY()]);
  });

  it('load falls back to the legacy key and returns its assets', async () => {
    storage.getItem.mockImplementation(async (k) =>
      k === OLD_KEY() ? echo(JSON.stringify(ASSETS)) : echo(null)
    );
    const a = await loadTypeExportAssets(CTX, 'סבב');
    expect(a.templateDocx).toBe('UEsDBBQ=');
  });

  it('a legacy hit is rewritten under the digest key, and the legacy key deleted', async () => {
    storage.getItem.mockImplementation(async (k) =>
      k === OLD_KEY() ? echo(JSON.stringify(ASSETS)) : echo(null)
    );
    await loadTypeExportAssets(CTX, 'סבב');
    expect(storage.setItem).toHaveBeenCalledWith(NEW_KEY(), JSON.stringify(ASSETS));
    expect(storage.deleteItem).toHaveBeenCalledWith(OLD_KEY());
  });

  it('when the migration WRITE is rejected, the legacy key is kept (no data loss) and the load still resolves', async () => {
    storage.getItem.mockImplementation(async (k) =>
      k === OLD_KEY() ? echo(JSON.stringify(ASSETS)) : echo(null)
    );
    storage.setItem.mockResolvedValue({ data: { success: false, error: 'nope' } });
    const a = await loadTypeExportAssets(CTX, 'סבב');
    expect(a.templateDocx).toBe('UEsDBBQ=');
    expect(storage.deleteItem).not.toHaveBeenCalled();
  });

  it('a migration failure never rejects the load (fail-soft)', async () => {
    storage.getItem.mockImplementation(async (k) =>
      k === OLD_KEY() ? echo(JSON.stringify(ASSETS)) : echo(null)
    );
    storage.setItem.mockRejectedValue(new Error('boom'));
    await expect(loadTypeExportAssets(CTX, 'סבב')).resolves.toMatchObject({ templateDocx: 'UEsDBBQ=' });
  });
});

describe('round360 — rename moves assets to the new name\'s digest key', () => {
  it('reads the old name (either key form), writes the new digest key, deletes both old keys', async () => {
    const OLD_LEGACY = legacyTypeExportAssetsKey(CTX, 'ישן');
    storage.getItem.mockImplementation(async (k) =>
      k === OLD_LEGACY ? echo(JSON.stringify(ASSETS)) : echo(null)
    );
    // the save's verify read must see the new value once written
    const written = {};
    storage.setItem.mockImplementation(async (k, v) => {
      written[k] = v;
      return { data: { success: true } };
    });
    storage.getItem.mockImplementation(async (k) => {
      if (written[k]) return echo(written[k]);
      return k === OLD_LEGACY ? echo(JSON.stringify(ASSETS)) : echo(null);
    });
    const moved = await moveTypeExportAssets(CTX, 'ישן', 'חדש');
    expect(moved).toBe(true);
    expect(Object.keys(written)).toContain(typeExportAssetsKey(CTX, 'חדש'));
    const deleted = storage.deleteItem.mock.calls.map(([k]) => k);
    expect(deleted).toContain(typeExportAssetsKey(CTX, 'ישן'));
    expect(deleted).toContain(OLD_LEGACY);
  });
});
