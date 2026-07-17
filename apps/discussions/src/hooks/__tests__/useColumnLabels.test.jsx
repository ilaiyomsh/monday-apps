// round140 — useColumnLabels: shared per-instance column display-name overrides
// (settings.preferences.columnLabels), owner-gated. Mirrors useSavedViews'
// storage pattern: read-modify-write of the WHOLE columnLabels map, because
// updateSettings merges `preferences` shallowly per key.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const mockUpdateSettings = vi.fn(() => Promise.resolve());
let mockSettings = {};
vi.mock('../../contexts/SettingsContext.jsx', () => ({
  useSettings: () => ({ settings: mockSettings, updateSettings: mockUpdateSettings }),
}));

import { useColumnLabels } from '../useColumnLabels.js';

const DEFAULTS = { name: 'משימה', status: 'סטאטוס', deadline: 'דד ליין' };

describe('useColumnLabels', () => {
  beforeEach(() => {
    mockUpdateSettings.mockClear();
    mockSettings = {};
  });

  it('returns the defaults when no overrides are stored, and canRename follows canManageSettings', () => {
    const { result } = renderHook(() => useColumnLabels('tasks', DEFAULTS, { canManageSettings: false }));
    expect(result.current.titles).toEqual(DEFAULTS);
    expect(result.current.canRename).toBe(false);
    const owner = renderHook(() => useColumnLabels('tasks', DEFAULTS, { canManageSettings: true }));
    expect(owner.result.current.canRename).toBe(true);
  });

  it('merges stored overrides for THIS table over the defaults (other tables ignored)', () => {
    mockSettings = { preferences: { columnLabels: {
      tasks: { status: 'שלב' },
      myTasks: { status: 'אחר לגמרי' },
    } } };
    const { result } = renderHook(() => useColumnLabels('tasks', DEFAULTS, { canManageSettings: true }));
    expect(result.current.titles).toEqual({ name: 'משימה', status: 'שלב', deadline: 'דד ליין' });
  });

  it('renameColumn persists a trimmed override via a read-modify-write of the whole map', async () => {
    mockSettings = { preferences: { columnLabels: { myTasks: { status: 'קיים' } } } };
    const { result } = renderHook(() => useColumnLabels('tasks', DEFAULTS, { canManageSettings: true }));
    await act(() => result.current.renameColumn('status', '  שלב  '));
    expect(mockUpdateSettings).toHaveBeenCalledWith({
      preferences: { columnLabels: {
        myTasks: { status: 'קיים' },            // siblings survive
        tasks: { status: 'שלב' },               // trimmed
      } },
    });
  });

  it('an empty (or default-equal) name CLEARS the override back to the default', async () => {
    mockSettings = { preferences: { columnLabels: { tasks: { status: 'שלב', deadline: 'יעד' } } } };
    const { result } = renderHook(() => useColumnLabels('tasks', DEFAULTS, { canManageSettings: true }));
    await act(() => result.current.renameColumn('status', '   '));
    expect(mockUpdateSettings).toHaveBeenLastCalledWith({
      preferences: { columnLabels: { tasks: { deadline: 'יעד' } } },
    });
    await act(() => result.current.renameColumn('deadline', 'דד ליין')); // = default
    expect(mockUpdateSettings).toHaveBeenLastCalledWith({
      preferences: { columnLabels: { tasks: { status: 'שלב' } } },
    });
  });
});
