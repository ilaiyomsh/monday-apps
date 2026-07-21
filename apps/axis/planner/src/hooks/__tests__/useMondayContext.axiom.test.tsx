import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { getMondayMock } from '../../test-utils/mondayMock';

// Spy on the re-exported setAxiomContext while keeping the real mondayIdsForAxiom mapping.
// vi.hoisted so the spy exists before the hoisted vi.mock factory runs.
const { setAxiomContextSpy } = vi.hoisted(() => ({ setAxiomContextSpy: vi.fn() }));
vi.mock('../../utils/errorReporting', async (orig) => {
  const actual = await orig<typeof import('../../utils/errorReporting')>();
  return { ...actual, setAxiomContext: setAxiomContextSpy };
});
vi.mock('monday-sdk-js', () => ({ default: () => getMondayMock() }));

import { useMondayContextInternal } from '../useMondayContext';

// Locks the setAxiomContext wiring: when the monday context resolves, the Axiom transport is
// enriched with the iframe identity (mapped ids). The mapping itself is gated in
// errorReporting.test.ts (mondayIdsForAxiom); this pins that the hook actually calls it.

beforeEach(() => {
  getMondayMock().__reset();
  setAxiomContextSpy.mockClear();
  getMondayMock().__seedContext({
    account: { id: 'acc1' },
    user: { id: 'u1', isAdmin: true, isViewOnly: false, isGuest: false, currentLanguage: 'en' },
    boardId: 42,
    instanceId: 99,
  } as never);
});
afterEach(() => vi.restoreAllMocks());

describe('useMondayContext → setAxiomContext wiring', () => {
  it('calls setAxiomContext with the mapped iframe ids once context resolves', async () => {
    const { result } = renderHook(() => useMondayContextInternal());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(setAxiomContextSpy).toHaveBeenCalledWith({
      accountId: 'acc1',
      userId: 'u1',
      boardId: 42,
      instanceId: 99,
    });
  });
});
