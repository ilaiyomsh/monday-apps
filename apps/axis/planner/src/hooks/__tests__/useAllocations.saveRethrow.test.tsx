/**
 * Save-failure propagation contract (review M1).
 *
 * Both write paths must REJECT to their caller (AllocationModal.handleSubmit) so the
 * modal's catch fires the specific save-error toast and keeps the modal open:
 *   - addAllocation  (create) — already rethrew; locked here as the parity anchor.
 *   - updateAllocation (edit) — used to catch+revert and SWALLOW the error, silently
 *     closing the modal as if the save succeeded. M1 makes it rethrow after reverting.
 *
 * Only IO/contexts are mocked.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { Allocation } from '../../types/entities/allocation.types';
import type { PlannerSettings } from '../../types/settings.types';

const { getCriticalBundle, getPastAllocations, getEmployees, create, update } = vi.hoisted(() => ({
  getCriticalBundle: vi.fn(),
  getPastAllocations: vi.fn(),
  getEmployees: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));

vi.mock('../../services/allocationsApi', () => ({
  allocationsApi: { getCriticalBundle, getPastAllocations, getEmployees, create, update },
}));
vi.mock('../../services/mondayService', () => ({ mondayService: { updateItem: vi.fn() } }));
vi.mock('../../utils/batchMutations', () => ({ batchMutations: vi.fn() }));

let mockSettings: PlannerSettings;
vi.mock('../../contexts/SettingsContext', () => ({
  useSettings: () => ({ settings: mockSettings, isConfigured: true }),
}));
vi.mock('../../contexts/ActiveProjectsContext', () => ({
  useActiveProjects: () => ({
    activeProjects: [{ id: 'p1', name: 'רוטשילד 223' }],
    activeProjectIds: new Set(['p1']),
    refresh: vi.fn(),
  }),
}));
vi.mock('../../contexts/MondayContext', () => ({
  useMondayContext: () => ({ context: { user: { isAdmin: false } } }),
}));
vi.mock('./useUserPhotos', () => ({
  useUserPhotos: () => ({ photoMap: new Map(), getPhotoUrl: () => undefined }),
}));

import { useAllocations } from '../useAllocations';

const alloc = (over: Partial<Allocation>): Allocation => ({
  id: 'x', projectId: 'p1', employeeId: 'e1', role: 'יועץ בטיחות',
  startDate: '2026-05-01T00:00:00.000Z', endDate: '2026-07-01T00:00:00.000Z',
  hoursPerDay: 4, totalHours: 100, projectName: 'רוטשילד 223', ...over,
});
const CURRENT = alloc({ id: 'cur-1' });

beforeEach(() => {
  vi.clearAllMocks();
  mockSettings = {
    allocationsBoardId: 'b1', roleColumnId: 'role', filterInactiveEmployees: false,
    reportedHoursColumnId: 'rep', timeLogsAllocationColumnId: 'rel', projectsBoardId: 'proj',
  } as Partial<PlannerSettings> as PlannerSettings;

  getCriticalBundle.mockResolvedValue({
    allocations: [CURRENT], employees: [], columns: [],
    projectDataMap: new Map(), reportedByAllocId: new Map(),
  });
  getPastAllocations.mockResolvedValue({ allocations: [], projectDataMapDelta: new Map() });
  getEmployees.mockResolvedValue([]);
});

async function mountReady() {
  const { result } = renderHook(() => useAllocations('projects'));
  await waitFor(() => expect(result.current.loading).toBe(false));
  return result;
}

describe('useAllocations — save-failure propagation (M1)', () => {
  it('updateAllocation REJECTS when the API update fails (no silent success)', async () => {
    const result = await mountReady();
    update.mockRejectedValueOnce(new Error('edit boom'));

    await expect(
      act(async () => {
        await result.current.updateAllocation({ ...CURRENT, hoursPerDay: 8 } as any);
      })
    ).rejects.toThrow('edit boom');
  });

  it('updateAllocation resolves normally on a successful update', async () => {
    const result = await mountReady();
    update.mockResolvedValueOnce(undefined);

    await act(async () => {
      await result.current.updateAllocation({ ...CURRENT, hoursPerDay: 8 } as any);
    });
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('addAllocation REJECTS when the API create fails (parity anchor)', async () => {
    const result = await mountReady();
    create.mockRejectedValueOnce(new Error('create boom'));

    await expect(
      act(async () => {
        await result.current.addAllocation({
          projectId: 'p1', employeeId: 'e1', role: 'r',
          startDate: CURRENT.startDate, endDate: CURRENT.endDate,
          hoursPerDay: 4, totalHours: 100,
        } as any);
      })
    ).rejects.toThrow('create boom');
  });
});
