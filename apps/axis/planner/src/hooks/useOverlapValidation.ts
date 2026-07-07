import { useMemo } from 'react';
import { Allocation } from '../types/entities/allocation.types';
import { findOverlappingAllocations, OverlapResult } from '../utils/overlapUtils';

/**
 * Hook to validate allocation overlap in real-time.
 * Returns overlap status that updates whenever inputs change.
 *
 * @param employeeId - Current employee ID being allocated
 * @param projectId - Current project ID being allocated
 * @param startDate - Start date (ISO string)
 * @param endDate - End date (ISO string)
 * @param allAllocations - All existing allocations to check against
 * @param currentId - ID of current allocation (for edit mode - excludes self)
 * @returns OverlapResult with hasOverlap and overlappingAllocations
 */
export const useOverlapValidation = (
  employeeId: string | undefined,
  projectId: string | undefined,
  startDate: string | undefined,
  endDate: string | undefined,
  allAllocations: Allocation[],
  currentId?: string | number
): OverlapResult => {
  return useMemo(() => {
    // Return no overlap if any required field is missing
    if (!employeeId || !projectId || !startDate || !endDate) {
      return { hasOverlap: false, overlappingAllocations: [] };
    }

    // Don't check overlap for unassigned employees
    // "Unassigned", empty string, or any non-numeric ID means no specific employee
    const isUnassigned = employeeId === 'Unassigned' ||
                         employeeId === '' ||
                         employeeId === 'Unknown Employee' ||
                         isNaN(Number(employeeId));

    if (isUnassigned) {
      return { hasOverlap: false, overlappingAllocations: [] };
    }

    return findOverlappingAllocations(
      employeeId,
      projectId.toString(),
      startDate,
      endDate,
      allAllocations,
      currentId
    );
  }, [employeeId, projectId, startDate, endDate, allAllocations, currentId]);
};
