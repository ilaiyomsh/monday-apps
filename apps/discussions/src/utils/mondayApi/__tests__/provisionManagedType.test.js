import { describe, it, expect, vi, beforeEach } from 'vitest';

// Route the api() mock by mutation name; record every call for assertions.
const { api, state } = vi.hoisted(() => {
  const state = { calls: [] };
  return {
    state,
    api: vi.fn(async (q) => {
      const s = String(q);
      state.calls.push(s);
      if (s.includes('create_dropdown_managed_column')) {
        return { create_dropdown_managed_column: { id: 'mc-fresh' } };
      }
      if (s.includes('attach_dropdown_managed_column')) {
        return { attach_dropdown_managed_column: { id: 'col-attached' } };
      }
      return {};
    }),
  };
});
vi.mock('../monday-client.js', () => ({ api }));
vi.mock('../../logger.js', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { ensureManagedTypeColumn } from '../provisionBoards.js';

const called = (frag) => state.calls.filter((q) => q.includes(frag)).length;

beforeEach(() => {
  api.mockClear();
  state.calls = [];
});

describe('ensureManagedTypeColumn (round126 — reuse one managed column across boards)', () => {
  it('with a KNOWN managed UUID it attaches WITHOUT minting a new account-level column', async () => {
    const res = await ensureManagedTypeColumn('999', [], 'mc-known');
    expect(called('create_dropdown_managed_column')).toBe(0);
    expect(called('attach_dropdown_managed_column')).toBe(1);
    expect(res).toEqual({ id: 'col-attached', managedColumnId: 'mc-known' });
  });

  it('without a UUID it creates the account-level column first, then attaches', async () => {
    const res = await ensureManagedTypeColumn('999', []);
    expect(called('create_dropdown_managed_column')).toBe(1);
    expect(called('attach_dropdown_managed_column')).toBe(1);
    expect(res.managedColumnId).toBe('mc-fresh');
  });

  it('reuses an existing dropdown titled "סוג דיון" and passes the known UUID through', async () => {
    const existing = [{ id: 'col-old', title: 'סוג דיון', type: 'dropdown' }];
    const res = await ensureManagedTypeColumn('999', existing, 'mc-known');
    expect(api).not.toHaveBeenCalled();
    expect(res).toEqual({ id: 'col-old', managedColumnId: 'mc-known' });
  });
});
