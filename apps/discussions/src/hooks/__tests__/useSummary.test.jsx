import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// Mock the updates API + the storage layer; keep the real sanitizer (jsdom DOM).
vi.mock('@api/updates.js', () => ({
  createUpdate: vi.fn(),
  editUpdate: vi.fn(),
  getItemUpdate: vi.fn(),
  deleteUpdate: vi.fn(),
}));
vi.mock('../../utils/summaryStore.js', () => ({
  loadSummaryUpdateId: vi.fn(),
  saveSummaryUpdateId: vi.fn(async () => {}),
  clearSummaryUpdateId: vi.fn(async () => {}),
}));
vi.mock('../../utils/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { useSummary } from '../useSummary.js';
import { createUpdate, editUpdate, getItemUpdate, deleteUpdate } from '@api/updates.js';
import { loadSummaryUpdateId, saveSummaryUpdateId } from '../../utils/summaryStore.js';

const update = (over = {}) => ({
  id: 'U1', body: '<p>x</p>', text_body: 'x',
  created_at: '2026-01-01', updated_at: '2026-01-02', creator: { id: '7', name: 'דנה' },
  ...over,
});

async function mounted(discussionId = 'D1') {
  const hook = renderHook(() => useSummary(discussionId));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

beforeEach(() => {
  vi.clearAllMocks();
  loadSummaryUpdateId.mockResolvedValue(null);
  getItemUpdate.mockResolvedValue(null);
  createUpdate.mockResolvedValue(update({ id: 'NEW' }));
  editUpdate.mockResolvedValue(update());
});

describe('useSummary load', () => {
  it('starts empty when no update id is stored', async () => {
    const { result } = await mounted();
    expect(result.current.html).toBe('');
    expect(getItemUpdate).not.toHaveBeenCalled();
  });

  it('loads the stored update body + author/date', async () => {
    loadSummaryUpdateId.mockResolvedValue('U1');
    getItemUpdate.mockResolvedValue(update({ body: '<p>קיים</p>' }));
    const { result } = await mounted();
    expect(result.current.html).toBe('<p>קיים</p>');
    expect(result.current.author).toBe('דנה');
    expect(result.current.updatedAt).toBe('2026-01-02');
  });
});

describe('useSummary save', () => {
  it('creates a new update (and stores its id) on the first save', async () => {
    const { result } = await mounted();
    let ok;
    await act(async () => { ok = await result.current.save('<p>חדש</p>'); });
    expect(ok).toBe(true);
    expect(createUpdate).toHaveBeenCalledWith('D1', '<p>חדש</p>');
    expect(editUpdate).not.toHaveBeenCalled();
    expect(saveSummaryUpdateId).toHaveBeenCalledWith('D1', 'NEW');
  });

  it('edits the existing update in place when one is already stored', async () => {
    loadSummaryUpdateId.mockResolvedValue('U1');
    getItemUpdate.mockResolvedValue(update({ body: '<p>קיים</p>' }));
    const { result } = await mounted();
    await act(async () => { await result.current.save('<p>מעודכן</p>'); });
    expect(editUpdate).toHaveBeenCalledWith('U1', '<p>מעודכן</p>');
    expect(createUpdate).not.toHaveBeenCalled();
  });

  it('recreates the update if editing returns null (it was deleted)', async () => {
    loadSummaryUpdateId.mockResolvedValue('U1');
    getItemUpdate.mockResolvedValue(update({ body: '<p>קיים</p>' }));
    editUpdate.mockResolvedValue(null);
    createUpdate.mockResolvedValue(update({ id: 'U2' }));
    const { result } = await mounted();
    let ok;
    await act(async () => { ok = await result.current.save('<p>שוב</p>'); });
    expect(editUpdate).toHaveBeenCalledWith('U1', '<p>שוב</p>');
    expect(createUpdate).toHaveBeenCalledWith('D1', '<p>שוב</p>');
    expect(saveSummaryUpdateId).toHaveBeenCalledWith('D1', 'U2');
    expect(ok).toBe(true);
  });

  it('returns false when the server returns no update', async () => {
    createUpdate.mockResolvedValue(null);
    const { result } = await mounted();
    let ok;
    await act(async () => { ok = await result.current.save('<p>x</p>'); });
    expect(ok).toBe(false);
  });

  it('round270 — ensureUpdate creates the box update ONCE, exposes its id, and reuses it', async () => {
    createUpdate.mockResolvedValue(update({ id: 'NEW' }));
    const { result } = await mounted();

    let id;
    await act(async () => { id = await result.current.ensureUpdate(); });
    expect(id).toBe('NEW');
    expect(createUpdate).toHaveBeenCalledTimes(1);
    expect(saveSummaryUpdateId).toHaveBeenCalledWith('D1', 'NEW');
    expect(result.current.updateId).toBe('NEW');

    // a second call must REUSE the id, never create a duplicate update.
    await act(async () => { id = await result.current.ensureUpdate(); });
    expect(id).toBe('NEW');
    expect(createUpdate).toHaveBeenCalledTimes(1);
  });

  it('round271 — clearDocuments deletes the update and recreates it with the SAME body (text kept)', async () => {
    loadSummaryUpdateId.mockResolvedValue('U1');
    getItemUpdate.mockResolvedValue(update({ id: 'U1', body: '<p>טקסט</p>' }));
    deleteUpdate.mockResolvedValue({ id: 'U1' });
    createUpdate.mockResolvedValue(update({ id: 'U2', body: '<p>טקסט</p>' }));
    const { result } = await mounted();

    let ok;
    await act(async () => { ok = await result.current.clearDocuments(); });
    expect(ok).toBe(true);
    expect(deleteUpdate).toHaveBeenCalledWith('U1');
    // recreated with the SAME body, so the box text survives the file-clear.
    expect(createUpdate).toHaveBeenCalledWith('D1', '<p>טקסט</p>');
    // the fresh update id is persisted + exposed.
    expect(saveSummaryUpdateId).toHaveBeenCalledWith('D1', 'U2');
    expect(result.current.updateId).toBe('U2');
  });
});
