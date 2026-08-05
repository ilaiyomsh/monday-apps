import { describe, it, expect, vi, beforeEach } from 'vitest';

// The monday SDK singleton is mocked so the storage moves are observable.
vi.mock('../mondayApi/monday-client.js', () => ({
  monday: { storage: { getItem: vi.fn(), setItem: vi.fn(), deleteItem: vi.fn() } },
}));

import { monday } from '../mondayApi/monday-client.js';
import logger from '../logger.js';
import { moveTypeExportAssets, typeExportAssetsKey, legacyTypeExportAssetsKey } from '../exportAssets.js';

const context = { instanceId: '42' };
// round360 — writes land on the digest key; the legacy %-encoded key is still
// CLEARED on rename (either generation may hold the old name's data).
const keyFor = (name) => typeExportAssetsKey(context, name);
const legacyKeyFor = (name) => legacyTypeExportAssetsKey(context, name);

/*
 * round304 — a type's export assets (its logos / uploaded header-footer .docx) are
 * stored under a key that embeds the type NAME, so renaming the type must MOVE
 * them; otherwise the renamed template comes up without its brand file — exactly
 * the symptom the rename is supposed to avoid.
 */
describe('moveTypeExportAssets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    monday.storage.setItem.mockResolvedValue({ success: true });
    monday.storage.deleteItem.mockResolvedValue({ success: true });
  });

  it('copies the assets to the new name and deletes the old key', async () => {
    monday.storage.getItem.mockResolvedValue({ data: { value: JSON.stringify({ templateDocx: 'UEsDBBQ=' }) } });
    const moved = await moveTypeExportAssets(context, 'סבב', 'סבב שבועי');
    expect(moved).toBe(true);
    expect(monday.storage.setItem).toHaveBeenCalledTimes(1);
    expect(monday.storage.setItem.mock.calls[0][0]).toBe(keyFor('סבב שבועי'));
    expect(JSON.parse(monday.storage.setItem.mock.calls[0][1]).templateDocx).toBe('UEsDBBQ=');
    expect(monday.storage.deleteItem).toHaveBeenCalledWith(keyFor('סבב'));
    expect(monday.storage.deleteItem).toHaveBeenCalledWith(legacyKeyFor('סבב'));
  });

  it('does nothing when the old type has no assets (never writes an empty blob)', async () => {
    monday.storage.getItem.mockResolvedValue({ data: { value: JSON.stringify({}) } });
    const moved = await moveTypeExportAssets(context, 'סבב', 'סבב שבועי');
    expect(moved).toBe(false);
    expect(monday.storage.setItem).not.toHaveBeenCalled();
    expect(monday.storage.deleteItem).not.toHaveBeenCalled();
  });

  it('is a no-op for a missing or unchanged name', async () => {
    expect(await moveTypeExportAssets(context, 'סבב', 'סבב')).toBe(false);
    expect(await moveTypeExportAssets(context, '', 'חדש')).toBe(false);
    expect(await moveTypeExportAssets(context, 'סבב', '   ')).toBe(false);
    expect(monday.storage.getItem).not.toHaveBeenCalled();
  });

  it('reports a failed move instead of throwing — the rename itself must not break', async () => {
    monday.storage.getItem.mockResolvedValue({ data: { value: JSON.stringify({ headerLogo: 'data:x' }) } });
    monday.storage.setItem.mockRejectedValue(new Error('quota'));
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    // saveTypeExportAssets reports its own write failure through logger.error and
    // rethrows; silenced here so the assertion below is about the MOVE's handling.
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    const moved = await moveTypeExportAssets(context, 'סבב', 'סבב שבועי');
    expect(moved).toBe(false);
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.some((c) => c[0] === 'exportAssets')).toBe(true);
    // the old key is kept when the copy failed — the assets are not lost
    expect(monday.storage.deleteItem).not.toHaveBeenCalled();
  });
});
