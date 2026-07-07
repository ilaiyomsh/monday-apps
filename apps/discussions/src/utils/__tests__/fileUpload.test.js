import { describe, it, expect, vi, afterEach } from 'vitest';
import { uploadFileToColumn } from '../mondayApi/fileUpload.js';

describe('uploadFileToColumn', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('throws without a token', async () => {
    await expect(
      uploadFileToColumn({ itemId: '1', columnId: 'files', blob: new Blob(['x']), token: '' })
    ).rejects.toThrow(/token/i);
  });

  it('throws without item/column', async () => {
    await expect(
      uploadFileToColumn({ itemId: '', columnId: '', blob: new Blob(['x']), token: 'tok' })
    ).rejects.toThrow(/itemId/i);
  });

  it('POSTs multipart to /v2/file with the mutation + file part and returns the asset', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ data: { add_file_to_column: { id: '99', name: 'a.docx' } } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const r = await uploadFileToColumn({
      itemId: '123', columnId: 'files', blob: new Blob(['x']), filename: 'a.docx', token: 'tok',
    });

    expect(r).toEqual({ id: '99', name: 'a.docx' });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.monday.com/v2/file');
    expect(opts.method).toBe('POST');
    expect(opts.headers.Authorization).toBe('tok');
    expect(opts.body).toBeInstanceOf(FormData);
    const query = opts.body.get('query');
    expect(query).toContain('add_file_to_column');
    expect(query).toContain('item_id: 123');
    expect(query).toContain('column_id: "files"');
    expect(opts.body.get('variables[file]')).toBeTruthy();
  });

  it('throws on a GraphQL error response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ errors: [{ message: 'invalid column' }] }),
    }));
    await expect(
      uploadFileToColumn({ itemId: '1', columnId: 'files', blob: new Blob(['x']), token: 'tok' })
    ).rejects.toThrow(/invalid column/);
  });
});
