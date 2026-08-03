// round143 (audit stage 4) — useBatchTargets: the shared bulk-target resolver
// extracted from the five identical inline copies (TasksTab, PreviousTasksTab,
// MyTasksView, MyDecisionsView, DecisionsTab). Pins the exact semantics:
// a multi-selection that CONTAINS the origin row fans the edit out to the whole
// selection; anything else targets the origin alone; a capability filters the
// set to the allowed subset (mixed selections silently skip the rest).
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useBatchTargets } from '../useBatchTargets.js';

const allowAll = () => true;

describe('useBatchTargets', () => {
  it('origin NOT in the selection (or single/empty selection) → origin only', () => {
    const { result } = renderHook(() => useBatchTargets(new Set(['1', '2']), allowAll));
    expect(result.current('9', 'editTaskStatus')).toEqual(['9']);
    const single = renderHook(() => useBatchTargets(new Set(['1']), allowAll));
    expect(single.result.current('1', 'editTaskStatus')).toEqual(['1']);
  });

  it('origin inside a multi-selection → the WHOLE selection', () => {
    const { result } = renderHook(() => useBatchTargets(new Set(['1', '2', '3']), allowAll));
    expect(result.current('2', 'editTaskStatus').sort()).toEqual(['1', '2', '3']);
  });

  it('a capability filters the set to the allowed subset (mixed selection skips the rest)', () => {
    const allow = vi.fn((cap, id) => id !== '2');
    const { result } = renderHook(() => useBatchTargets(new Set(['1', '2', '3']), allow));
    expect(result.current('1', 'editTaskDeadline').sort()).toEqual(['1', '3']);
    expect(allow).toHaveBeenCalledWith('editTaskDeadline', expect.anything());
  });

  it('no capability → the base set UNfiltered (allow never consulted)', () => {
    const allow = vi.fn(() => false);
    const { result } = renderHook(() => useBatchTargets(new Set(['1', '2']), allow));
    expect(result.current('1').sort()).toEqual(['1', '2']);
    expect(allow).not.toHaveBeenCalled();
  });
});
