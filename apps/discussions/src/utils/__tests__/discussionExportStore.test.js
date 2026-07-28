import { describe, it, expect, vi, beforeEach } from 'vitest';

// round207 — per-discussion export overrides: key shape + field extraction +
// graceful null on storage failure are the load-bearing behaviors.
const storage = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
  deleteItem: vi.fn(),
}));
const warn = vi.hoisted(() => vi.fn());

vi.mock('../mondayApi/monday-client.js', () => ({ monday: { storage } }));
vi.mock('../logger.js', () => ({ default: { warn } }));

import {
  loadDiscussionExportTemplate,
  saveDiscussionExportTemplate,
  loadDiscussionExportAssets,
  saveDiscussionExportAssets,
  clearDiscussionExportOverrides,
} from '../discussionExportStore.js';

beforeEach(() => {
  storage.getItem.mockReset();
  storage.setItem.mockReset();
  storage.deleteItem.mockReset();
  warn.mockReset();
});

describe('discussionExportStore', () => {
  it('loads the discussion template from its own key and unwraps the template field', async () => {
    storage.getItem.mockResolvedValue({ data: { value: JSON.stringify({ template: { font: 'david' } }) } });
    const out = await loadDiscussionExportTemplate('42');
    expect(storage.getItem).toHaveBeenCalledWith('discussions_export_template_42');
    expect(out).toEqual({ font: 'david' });
  });

  it('loads the assets override from the assets key and unwraps the assets field', async () => {
    storage.getItem.mockResolvedValue({ data: { value: JSON.stringify({ assets: { headerLogo: 'x' } }) } });
    const out = await loadDiscussionExportAssets('42');
    expect(storage.getItem).toHaveBeenCalledWith('discussions_export_assets_42');
    expect(out).toEqual({ headerLogo: 'x' });
  });

  it('returns null (and warns) when storage fails, and null without touching storage when id is missing', async () => {
    storage.getItem.mockRejectedValue(new Error('boom'));
    await expect(loadDiscussionExportTemplate('42')).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();

    storage.getItem.mockClear();
    await expect(loadDiscussionExportTemplate(null)).resolves.toBeNull();
    await expect(loadDiscussionExportAssets(undefined)).resolves.toBeNull();
    expect(storage.getItem).not.toHaveBeenCalled();
  });

  it('save persists JSON under the per-discussion key; save(null) deletes the key', async () => {
    storage.setItem.mockResolvedValue({});
    storage.deleteItem.mockResolvedValue({});

    await saveDiscussionExportTemplate('7', { font: 'arial' });
    expect(storage.setItem).toHaveBeenCalledWith(
      'discussions_export_template_7',
      JSON.stringify({ template: { font: 'arial' } }),
    );

    await saveDiscussionExportTemplate('7', null);
    expect(storage.deleteItem).toHaveBeenCalledWith('discussions_export_template_7');

    await saveDiscussionExportAssets('7', { a: 1 });
    expect(storage.setItem).toHaveBeenCalledWith(
      'discussions_export_assets_7',
      JSON.stringify({ assets: { a: 1 } }),
    );
    await saveDiscussionExportAssets('7', null);
    expect(storage.deleteItem).toHaveBeenCalledWith('discussions_export_assets_7');
  });

  it('save failures are swallowed with a warn (export must not break over persistence)', async () => {
    storage.setItem.mockRejectedValue(new Error('quota'));
    await expect(saveDiscussionExportTemplate('7', { font: 'arial' })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  /*
   * round304 (PR review) — the RESET action ("חזרה לברירת המחדל") must be able to
   * fail loudly: announcing a reset that did not happen makes the action look
   * broken on the next open, since the override is still there.
   */
  describe('clearDiscussionExportOverrides', () => {
    it('deletes BOTH override keys and reports success', async () => {
      storage.deleteItem.mockResolvedValue({ success: true });
      await expect(clearDiscussionExportOverrides('42')).resolves.toBe(true);
      expect(storage.deleteItem).toHaveBeenCalledWith('discussions_export_template_42');
      expect(storage.deleteItem).toHaveBeenCalledWith('discussions_export_assets_42');
    });

    it('REJECTS when a delete fails — unlike the save helpers, it never swallows', async () => {
      storage.deleteItem.mockRejectedValue(new Error('storage unavailable'));
      await expect(clearDiscussionExportOverrides('42')).rejects.toThrow(/storage unavailable/);
    });

    it('is a no-op without a discussion id', async () => {
      await expect(clearDiscussionExportOverrides(null)).resolves.toBe(false);
      expect(storage.deleteItem).not.toHaveBeenCalled();
    });
  });
});
