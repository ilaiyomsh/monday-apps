/**
 * settingsAccess — the column-owner gate for the settings screen (round322).
 * Contract: an ADOPTED column admits only its own owners; an UNADOPTED column
 * falls back to the board-owner gate so the board's owners can do (and claim)
 * the first setup; a read that THROWS propagates (a failed check is never a
 * silent denial).
 */

import { describe, expect, it, vi } from 'vitest';

import { loadSettingsAccess } from './settingsAccess.js';

const OWNED = {
  version: 1,
  hiddenLabelIds: [],
  labels: {},
  owners: { ownerIds: ['7', '9'], primaryOwnerId: '7' },
};

const makeDeps = (overrides = {}) => ({
  getColumnConfig: vi.fn().mockResolvedValue(OWNED),
  loadIsBoardOwner: vi.fn().mockResolvedValue(true),
  ...overrides,
});

const target = { boardId: '5098', columnId: 'status_col', userId: '9' };

describe('loadSettingsAccess — adopted column', () => {
  it('admits a listed column owner and never consults the board-owner gate', async () => {
    const deps = makeDeps();
    const result = await loadSettingsAccess(target, deps);
    expect(result).toEqual({ canConfigure: true, adopted: true });
    expect(deps.loadIsBoardOwner).not.toHaveBeenCalled();
  });

  it('denies a non-owner even if they own the board — the column list is the authority', async () => {
    const deps = makeDeps({ loadIsBoardOwner: vi.fn().mockResolvedValue(true) });
    const result = await loadSettingsAccess({ ...target, userId: '42' }, deps);
    expect(result).toEqual({ canConfigure: false, adopted: true });
    expect(deps.loadIsBoardOwner).not.toHaveBeenCalled();
  });

  it('reads the config with the board and column from the monday context', async () => {
    const deps = makeDeps();
    await loadSettingsAccess(target, deps);
    expect(deps.getColumnConfig).toHaveBeenCalledWith('5098', 'status_col');
  });
});

describe('loadSettingsAccess — unadopted column falls back to the board-owner gate', () => {
  it('admits a board owner when the column has no owners record yet (null config)', async () => {
    const deps = makeDeps({
      getColumnConfig: vi.fn().mockResolvedValue(null),
      loadIsBoardOwner: vi.fn().mockResolvedValue(true),
    });
    const result = await loadSettingsAccess(target, deps);
    expect(result).toEqual({ canConfigure: true, adopted: false });
    expect(deps.loadIsBoardOwner).toHaveBeenCalledWith({ boardId: '5098', userId: '9' });
  });

  it('denies a non-board-owner on an unadopted column', async () => {
    const deps = makeDeps({
      getColumnConfig: vi.fn().mockResolvedValue({ version: 1, hiddenLabelIds: [], labels: {} }),
      loadIsBoardOwner: vi.fn().mockResolvedValue(false),
    });
    const result = await loadSettingsAccess(target, deps);
    expect(result).toEqual({ canConfigure: false, adopted: false });
  });

  it('treats an owners record with an empty id list as unadopted (board-owner fallback)', async () => {
    const deps = makeDeps({
      getColumnConfig: vi.fn().mockResolvedValue({
        version: 1, hiddenLabelIds: [], labels: {}, owners: { ownerIds: [] },
      }),
      loadIsBoardOwner: vi.fn().mockResolvedValue(true),
    });
    const result = await loadSettingsAccess(target, deps);
    expect(result).toEqual({ canConfigure: true, adopted: false });
  });
});

describe('loadSettingsAccess — failures propagate, they are never a silent denial', () => {
  it('rethrows when the config read rejects', async () => {
    const deps = makeDeps({ getColumnConfig: vi.fn().mockRejectedValue(new Error('storage down')) });
    await expect(loadSettingsAccess(target, deps)).rejects.toThrow('storage down');
  });

  it('rethrows when the board-owner fallback rejects on an unadopted column', async () => {
    const deps = makeDeps({
      getColumnConfig: vi.fn().mockResolvedValue(null),
      loadIsBoardOwner: vi.fn().mockRejectedValue(new Error('board gate failed')),
    });
    await expect(loadSettingsAccess(target, deps)).rejects.toThrow('board gate failed');
  });

  it.each([
    ['boardId', { ...target, boardId: '' }],
    ['columnId', { ...target, columnId: '  ' }],
    ['userId', { ...target, userId: undefined }],
  ])('throws when %s is missing from the context', async (_name, badTarget) => {
    const deps = makeDeps();
    await expect(loadSettingsAccess(badTarget, deps)).rejects.toThrow();
    expect(deps.getColumnConfig).not.toHaveBeenCalled();
  });
});
