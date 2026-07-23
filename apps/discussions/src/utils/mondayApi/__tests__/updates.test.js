import { describe, it, expect, vi, beforeEach } from 'vitest';

// round270 — getUpdateFiles: reads the assets attached to ONE update of an item
// (documents live ON the update, owner model B) and maps them to the bar's shape.
const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../monday-client.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, api };
});

import { getUpdateFiles } from '../updates.js';

beforeEach(() => { api.mockReset(); });

describe('getUpdateFiles (round270)', () => {
  it('maps an update\'s assets to {assetId,name,url,extension} (public_url wins)', async () => {
    api.mockResolvedValue({
      items: [{
        id: '7',
        updates: [{
          id: '55',
          assets: [
            { id: 11, name: 'a.pdf', url: 'https://x/raw/a', public_url: 'https://x/a.pdf', file_extension: 'pdf' },
            { id: 22, name: 'b.xlsx', url: 'https://x/raw/b', public_url: 'https://x/b.xlsx', file_extension: 'xlsx' },
          ],
        }],
      }],
    });
    const files = await getUpdateFiles('7', '55');
    expect(files).toEqual([
      { assetId: '11', name: 'a.pdf', url: 'https://x/a.pdf', extension: 'pdf' },
      { assetId: '22', name: 'b.xlsx', url: 'https://x/b.xlsx', extension: 'xlsx' },
    ]);
  });

  it('falls back to `url` when there is no public_url, then to null; defaults a missing name', async () => {
    api.mockResolvedValue({
      items: [{
        updates: [{
          assets: [
            { id: 33, name: 'c.png', url: 'https://x/raw/c', public_url: null, file_extension: 'png' },
            { id: 44, url: null, public_url: null, file_extension: null },
          ],
        }],
      }],
    });
    expect(await getUpdateFiles('7', '55')).toEqual([
      { assetId: '33', name: 'c.png', url: 'https://x/raw/c', extension: 'png' },
      { assetId: '44', name: 'קובץ', url: null, extension: null },
    ]);
  });

  it('returns [] without calling the API when itemId/updateId is missing', async () => {
    expect(await getUpdateFiles('', '55')).toEqual([]);
    expect(await getUpdateFiles('7', null)).toEqual([]);
    expect(api).not.toHaveBeenCalled();
  });

  it('returns [] when the update is absent or carries no assets', async () => {
    api.mockResolvedValue({ items: [{ updates: [] }] });
    expect(await getUpdateFiles('7', '55')).toEqual([]);
    api.mockResolvedValue({ items: [{ updates: [{ id: '55' }] }] });
    expect(await getUpdateFiles('7', '55')).toEqual([]);
  });
});
