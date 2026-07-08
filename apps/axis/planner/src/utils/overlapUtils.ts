import { parseISO } from 'date-fns';
import { Allocation } from '../types/entities/allocation.types';

export interface OverlapResult {
  hasOverlap: boolean;
  overlappingAllocations: Allocation[];
}

/**
 * Check if two date ranges overlap.
 * Uses <= for adjacent dates to be considered overlapping (same day = conflict).
 */
export const datesOverlap = (
  startA: string | Date,
  endA: string | Date,
  startB: string | Date,
  endB: string | Date
): boolean => {
  const sA = typeof startA === 'string' ? parseISO(startA) : startA;
  const eA = typeof endA === 'string' ? parseISO(endA) : endA;
  const sB = typeof startB === 'string' ? parseISO(startB) : startB;
  const eB = typeof endB === 'string' ? parseISO(endB) : endB;

  // Use <= for adjacent dates to be considered overlapping
  return sA <= eB && sB <= eA;
};

/**
 * Find allocations that overlap with the given employee+project+date range.
 *
 * @param employeeId - The employee ID to check
 * @param projectId - The project ID to check
 * @param startDate - Start date of the range (ISO string)
 * @param endDate - End date of the range (ISO string)
 * @param existingAllocations - All existing allocations to check against
 * @param excludeId - Optional allocation ID to exclude (for edit mode)
 * @returns OverlapResult with hasOverlap flag and list of overlapping allocations
 */
export const findOverlappingAllocations = (
  employeeId: string,
  projectId: string,
  startDate: string,
  endDate: string,
  existingAllocations: Allocation[],
  excludeId?: string | number
): OverlapResult => {
  const overlapping = existingAllocations.filter(alloc => {
    // Exclude the current allocation being edited
    if (excludeId !== undefined && alloc.id.toString() === excludeId.toString()) {
      return false;
    }

    // Normalize all IDs to strings for comparison
    const allocEmployeeId = alloc.employeeId?.toString() || '';
    const allocProjectId = alloc.projectId?.toString() || '';

    // Check for same employee AND same project
    if (allocEmployeeId !== employeeId || allocProjectId !== projectId) {
      return false;
    }

    return datesOverlap(startDate, endDate, alloc.startDate, alloc.endDate);
  });

  return {
    hasOverlap: overlapping.length > 0,
    overlappingAllocations: overlapping
  };
};
