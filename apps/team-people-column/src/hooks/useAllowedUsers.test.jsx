import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

import { harness } from '../dev-harness/monday-sdk-stub.js';
import { installAppApiHandlers } from '../test-utils/probeFixtures.js';
import logger from '../utils/logger.js';
import { AppError } from '../services/allowedUsersService.js';
import useAllowedUsers from './useAllowedUsers.js';

// Settings + context that match the captured probes exactly (probes/MANIFEST.md):
// source item 12511436134 on WZ-TeamPeople-source, its own people column
// multiple_person_mm562c71, relation board_relation_mm56dy57 -> target board
// 18421604791 people column multiple_person_mm5694pg -> team 1348990 ("test ilai").
const SETTINGS = {
  version: 1,
  relationColumnId: 'board_relation_mm56dy57',
  linkedBoardId: '18421604791',
  peopleColumnId: 'multiple_person_mm5694pg',
  policy: { selectionMode: 'multi', aggregation: 'union', includeListedPersons: true },
};
const context = { itemId: '12511436134', columnId: 'multiple_person_mm562c71' };

// The exactly-3 seeded members of team "test ilai", he-name sorted (the shape
// buildAllowedList produces and the service returns).
const MEMBER_IDS = ['37022703', '48274917', '96863017'];
const MEMBER_NAMES = ['עידו פיוטרקובסקי', 'עילי שלם', 'רוני ארגמן'];

beforeEach(() => {
  harness.reset();
  vi.restoreAllMocks();
});

afterEach(() => {
  harness.reset();
});

describe('useAllowedUsers — happy chain', () => {
  it('reaches status "ready" (step "ready") with EXACTLY the 3 members of team "test ilai"', async () => {
    installAppApiHandlers(harness);

    const { result } = renderHook(() => useAllowedUsers(context, SETTINGS, { enabled: true }));

    await waitFor(() => expect(result.current.status).toBe('ready'));

    expect(result.current.step).toBe('ready');
    expect(result.current.error).toBe(null);
    expect(result.current.result.users.map((u) => u.id)).toEqual(MEMBER_IDS);
    expect(result.current.result.users.map((u) => u.name)).toEqual(MEMBER_NAMES);
    expect(result.current.result.teams).toEqual([{ id: '1348990', name: 'test ilai' }]);
    expect(result.current.result.emptyChain).toBe(false);
  });
});

describe('useAllowedUsers — disabled', () => {
  it('stays "idle" and never fetches when enabled is false (no handlers installed: a wrong fetch would flip to "error")', async () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    // Intentionally NO installAppApiHandlers: if the hook ignored `enabled` and
    // fetched, the stub would answer with an error and status would become
    // "error" — so a still-"idle" status proves the fetch was skipped.

    const { result } = renderHook(() => useAllowedUsers(context, SETTINGS, { enabled: false }));

    // Let more than the harness latency (30ms) elapse: any fired async chain
    // would have transitioned the status by now.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });

    expect(result.current.status).toBe('idle');
    expect(result.current.result).toBe(null);
    expect(result.current.error).toBe(null);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe('useAllowedUsers — failure then recovery', () => {
  it('surfaces AppError(API_ERROR) as status "error", logs the failure EXACTLY once, and retry() recovers to "ready"', async () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    installAppApiHandlers(harness);
    // First api() call (q1) rejects -> the service wraps it into AppError(API_ERROR).
    // apiRejectNext is one-shot: it is consumed by that failed attempt, so the
    // subsequent retry() hits the real captured handlers and succeeds.
    harness.failures.apiRejectNext = true;

    const { result } = renderHook(() => useAllowedUsers(context, SETTINGS, { enabled: true }));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBeInstanceOf(AppError);
    expect(result.current.error.code).toBe('API_ERROR');
    expect(errorSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.retry();
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    expect(result.current.result.users.map((u) => u.id)).toEqual(MEMBER_IDS);
    // The successful retry logged nothing further — still exactly one failure logged.
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
