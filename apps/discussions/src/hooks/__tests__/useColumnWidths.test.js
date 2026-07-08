import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useColumnWidths } from '../useColumnWidths.js';

// No ColumnWidthsProvider in the test => the store falls back to empty widths, so
// the hook must build the grid template purely from the per-column `default`s and
// pass `fixed` tracks through verbatim.
describe('useColumnWidths', () => {
  it('builds grid-template-columns from defaults (and fixed tracks) when storage is empty', () => {
    const defs = [
      { key: 'name', default: 400, min: 200, max: 760 },
      { key: 'select', fixed: 36 },
      { key: 'status', default: 160, min: 100, max: 320 },
    ];
    const { result } = renderHook(() => useColumnWidths('myTasks', defs));
    expect(result.current.gridTemplate).toBe('400px 36px 160px');
    expect(typeof result.current.startResize).toBe('function');
  });
});
