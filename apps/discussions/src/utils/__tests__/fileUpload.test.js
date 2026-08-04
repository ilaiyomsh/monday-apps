import { describe, it, expect, vi, afterEach } from 'vitest';

// clearFileColumn goes through the seamless monday.api(); mock it so we can
// assert the mutation variables without a network call.
const apiMock = vi.hoisted(() => vi.fn());
vi.mock('../mondayApi/monday-client.js', () => ({ api: apiMock }));

import {
  uploadFileToColumn,
  uploadFileToColumnSeamless,
  clearFileColumn,
} from '../mondayApi/fileUpload.js';

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

// F-1 (security scan 2026-08-04, docs/SECURITY-SCAN-REPORT.md): `columnId` used to be
// interpolated into the mutation DOCUMENT TEXT. These lock the typed-variable form — the
// document must be a constant, with every id travelling as data.
describe('uploadFileToColumnSeamless — no interpolation into the query document', () => {
  afterEach(() => { apiMock.mockReset(); });

  it('passes item and column as typed GraphQL variables, not as document text', async () => {
    apiMock.mockResolvedValue({ add_file_to_column: { id: '7', name: 'a.docx' } });
    const file = new Blob(['x']);

    const r = await uploadFileToColumnSeamless({ itemId: 123, columnId: 'files', file });

    expect(r).toEqual({ id: '7', name: 'a.docx' });
    const [query, vars] = apiMock.mock.calls[0];
    expect(query).toContain('$col: String!');
    expect(query).toContain('column_id: $col');
    expect(query).toContain('item_id: $item');
    // the two interpolation sinks must be gone
    expect(query).not.toContain('column_id: "');
    expect(query).not.toContain('123');
    expect(vars).toMatchObject({ item: '123', col: 'files', file });
  });

  it('a columnId carrying GraphQL syntax cannot alter the document', async () => {
    apiMock.mockResolvedValue({ add_file_to_column: { id: '7' } });
    // a break-out attempt: close the arg list, smuggle a second mutation field
    const malicious = 'files", file: $file) { id } evil: create_item (board_id: 1, item_name: "x';

    await uploadFileToColumnSeamless({ itemId: 1, columnId: malicious, file: new Blob(['x']) });

    const [query, vars] = apiMock.mock.calls[0];
    expect(query).not.toContain('create_item');
    expect(query).not.toContain('evil');
    expect(query).not.toContain(malicious);
    // it still reaches the server, but as a value the parser can never execute
    expect(vars.col).toBe(malicious);
  });
});

describe('uploadFileToColumn — legacy multipart path, column id format guard', () => {
  it('rejects a columnId that is not a monday column identifier', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      uploadFileToColumn({
        itemId: '1',
        columnId: 'files", file: $file) { id } evil: x(',
        blob: new Blob(['x']),
        token: 'tok',
      })
    ).rejects.toThrow(/columnId/i);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('clearFileColumn (round244)', () => {
  afterEach(() => { apiMock.mockReset(); });

  it('throws when any of itemId / columnId / boardId is missing', async () => {
    await expect(clearFileColumn({ itemId: '', columnId: 'files', boardId: '9' })).rejects.toThrow(/required/i);
    await expect(clearFileColumn({ itemId: '1', columnId: '', boardId: '9' })).rejects.toThrow(/required/i);
    await expect(clearFileColumn({ itemId: '1', columnId: 'files', boardId: '' })).rejects.toThrow(/required/i);
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('calls change_column_value with the {"clear_all":true} value and stringified ids', async () => {
    apiMock.mockResolvedValue({ change_column_value: { id: '1' } });
    await clearFileColumn({ itemId: 123, columnId: 'files', boardId: 456 });
    expect(apiMock).toHaveBeenCalledTimes(1);
    const [query, vars] = apiMock.mock.calls[0];
    expect(query).toContain('change_column_value');
    expect(vars).toEqual({ board: '456', item: '123', col: 'files', val: '{"clear_all":true}' });
  });
});
