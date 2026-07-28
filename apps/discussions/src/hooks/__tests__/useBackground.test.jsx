import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// round204 — the background box hook: single editable monday Update with its own
// tracked id (backgroundStore), mirroring useSummary. Store + updates API are
// mocked; the toMondayHtml/toEditorHtml converters run for real.
const store = vi.hoisted(() => ({
  loadBackgroundUpdateId: vi.fn(),
  saveBackgroundUpdateId: vi.fn(),
  clearBackgroundUpdateId: vi.fn(),
}));
vi.mock('../../utils/backgroundStore.js', () => store);

const api = vi.hoisted(() => ({
  createUpdate: vi.fn(),
  editUpdate: vi.fn(),
  getItemUpdate: vi.fn(),
  deleteUpdate: vi.fn(),
}));
vi.mock('@api/updates.js', () => api);

import { useBackground } from '../useBackground.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useBackground', () => {
  it('loads the stored update body into editor HTML (with author meta)', async () => {
    store.loadBackgroundUpdateId.mockResolvedValue('u1');
    api.getItemUpdate.mockResolvedValue({
      id: 'u1', body: '<p>התייחסות קיימת</p>', creator: { name: 'דנה' }, updated_at: '2026-07-01',
    });
    const { result } = renderHook(() => useBackground('d1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.html).toContain('התייחסות קיימת');
    expect(result.current.author).toBe('דנה');
  });

  it('first save CREATES an update and remembers its id; the next save EDITS it', async () => {
    store.loadBackgroundUpdateId.mockResolvedValue(null);
    api.createUpdate.mockResolvedValue({ id: 'u9', body: '<p>א</p>' });
    api.editUpdate.mockResolvedValue({ id: 'u9', body: '<p>ב</p>' });
    const { result } = renderHook(() => useBackground('d1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let ok;
    await act(async () => { ok = await result.current.save('<p>א</p>'); });
    expect(ok).toBe(true);
    expect(api.createUpdate).toHaveBeenCalledTimes(1);
    expect(store.saveBackgroundUpdateId).toHaveBeenCalledWith('d1', 'u9');

    await act(async () => { ok = await result.current.save('<p>ב</p>'); });
    expect(ok).toBe(true);
    expect(api.editUpdate).toHaveBeenCalledWith('u9', expect.any(String));
    expect(api.createUpdate).toHaveBeenCalledTimes(1); // no second create
  });

  it('clears a stale stored id when the update no longer exists', async () => {
    store.loadBackgroundUpdateId.mockResolvedValue('gone');
    api.getItemUpdate.mockResolvedValue(null);
    const { result } = renderHook(() => useBackground('d1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(store.clearBackgroundUpdateId).toHaveBeenCalledWith('d1');
    expect(result.current.html).toBe('');
  });

  it('round270 — ensureUpdate creates the box update ONCE, exposes its id, and reuses it', async () => {
    store.loadBackgroundUpdateId.mockResolvedValue(null);
    api.createUpdate.mockResolvedValue({ id: 'u5' });
    const { result } = renderHook(() => useBackground('d1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let id;
    await act(async () => { id = await result.current.ensureUpdate(); });
    expect(id).toBe('u5');
    expect(api.createUpdate).toHaveBeenCalledTimes(1);
    expect(store.saveBackgroundUpdateId).toHaveBeenCalledWith('d1', 'u5');
    expect(result.current.updateId).toBe('u5');

    // a second call must REUSE the id, never create a duplicate update.
    await act(async () => { id = await result.current.ensureUpdate(); });
    expect(id).toBe('u5');
    expect(api.createUpdate).toHaveBeenCalledTimes(1);
  });

  it('round271 — clearDocuments deletes the update and recreates it with the SAME body (text kept)', async () => {
    store.loadBackgroundUpdateId.mockResolvedValue('u1');
    api.getItemUpdate.mockResolvedValue({ id: 'u1', body: '<p>טקסט</p>', creator: { name: 'דנה' } });
    api.deleteUpdate.mockResolvedValue({ id: 'u1' });
    api.createUpdate.mockResolvedValue({ id: 'u2', body: '<p>טקסט</p>' });
    const { result } = renderHook(() => useBackground('d1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let ok;
    await act(async () => { ok = await result.current.clearDocuments(); });
    expect(ok).toBe(true);
    expect(api.deleteUpdate).toHaveBeenCalledWith('u1');
    // recreated with the SAME body, so the box text survives the file-clear.
    expect(api.createUpdate).toHaveBeenCalledWith('d1', '<p>טקסט</p>');
    // the fresh update id is persisted + exposed.
    expect(store.saveBackgroundUpdateId).toHaveBeenCalledWith('d1', 'u2');
    expect(result.current.updateId).toBe('u2');
  });
});
