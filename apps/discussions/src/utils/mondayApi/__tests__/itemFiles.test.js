import { describe, it, expect, vi, beforeEach } from 'vitest';

// round204 — getItemFiles: parses a FileValue's value JSON and matches each
// entry's assetId against the item's assets to attach the download url.
const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../monday-client.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, api };
});
vi.mock('../../logger.js', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { getItemFiles } from '../itemFiles.js';

beforeEach(() => { api.mockReset(); });

describe('getItemFiles', () => {
  it('matches column files to item assets by assetId (url from public_url)', async () => {
    api.mockResolvedValue({
      items: [{
        assets: [
          { id: '11', name: 'a.pdf', public_url: 'https://x/a.pdf', file_extension: 'pdf' },
          { id: '22', name: 'b.xlsx', public_url: 'https://x/b.xlsx', file_extension: 'xlsx' },
        ],
        column_values: [{ id: 'files_col', value: JSON.stringify({ files: [
          { name: 'a.pdf', assetId: 11 },
          { name: 'b.xlsx', assetId: 22 },
        ] }) }],
      }],
    });
    const files = await getItemFiles('7', 'files_col');
    expect(files).toEqual([
      { assetId: '11', name: 'a.pdf', url: 'https://x/a.pdf', extension: 'pdf' },
      { assetId: '22', name: 'b.xlsx', url: 'https://x/b.xlsx', extension: 'xlsx' },
    ]);
  });

  it('returns [] for an empty/unmapped column and survives bad value JSON', async () => {
    expect(await getItemFiles('7', null)).toEqual([]);
    api.mockResolvedValue({ items: [{ assets: [], column_values: [{ id: 'c', value: null }] }] });
    expect(await getItemFiles('7', 'c')).toEqual([]);
    api.mockResolvedValue({ items: [{ assets: [], column_values: [{ id: 'c', value: '{bad json' }] }] });
    expect(await getItemFiles('7', 'c')).toEqual([]);
  });

  it('keeps a file whose asset is missing (name only, no url)', async () => {
    api.mockResolvedValue({
      items: [{
        assets: [],
        column_values: [{ id: 'c', value: JSON.stringify({ files: [{ name: 'ghost.docx', assetId: 99 }] }) }],
      }],
    });
    expect(await getItemFiles('7', 'c')).toEqual([
      { assetId: '99', name: 'ghost.docx', url: null, extension: null },
    ]);
  });
});
