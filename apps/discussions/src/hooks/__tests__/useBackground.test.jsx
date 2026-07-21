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
});
