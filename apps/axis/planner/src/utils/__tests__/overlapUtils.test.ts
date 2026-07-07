import { describe, it, expect } from 'vitest';
import { datesOverlap, findOverlappingAllocations } from '../overlapUtils';
import type { Allocation } from '../../types/entities/allocation.types';

describe('datesOverlap', () => {
  it('detects overlapping ranges', () => {
    expect(datesOverlap('2025-01-01', '2025-01-10', '2025-01-05', '2025-01-15')).toBe(true);
  });

  it('detects same-day overlap', () => {
    expect(datesOverlap('2025-01-01', '2025-01-05', '2025-01-05', '2025-01-10')).toBe(true);
  });

  it('detects fully contained range', () => {
    expect(datesOverlap('2025-01-01', '2025-01-31', '2025-01-10', '2025-01-20')).toBe(true);
  });

  it('returns false for non-overlapping ranges', () => {
    expect(datesOverlap('2025-01-01', '2025-01-05', '2025-01-06', '2025-01-10')).toBe(false);
  });

  it('works with Date objects', () => {
    expect(datesOverlap(
      new Date('2025-01-01'), new Date('2025-01-10'),
      new Date('2025-01-05'), new Date('2025-01-15')
    )).toBe(true);
  });

  it('works with mixed string and Date inputs', () => {
    expect(datesOverlap(
      '2025-01-01', new Date('2025-01-10'),
      new Date('2025-01-05'), '2025-01-15'
    )).toBe(true);
  });
});

describe('findOverlappingAllocations', () => {
  const makeAllocation = (id: string, employeeId: string, projectId: string, start: string, end: string): Allocation => ({
    id,
    employeeId,
    projectId,
    startDate: start,
    endDate: end,
    hoursPerDay: 8,
    projectName: 'Test',
    role: 'Dev',
    userName: 'Test User',
  } as Allocation);

  const allocations = [
    makeAllocation('1', 'emp1', 'proj1', '2025-01-01', '2025-01-10'),
    makeAllocation('2', 'emp1', 'proj1', '2025-01-15', '2025-01-20'),
    makeAllocation('3', 'emp2', 'proj1', '2025-01-01', '2025-01-10'),
    makeAllocation('4', 'emp1', 'proj2', '2025-01-01', '2025-01-10'),
  ];

  it('finds overlap for same employee+project', () => {
    const result = findOverlappingAllocations('emp1', 'proj1', '2025-01-05', '2025-01-12', allocations);
    expect(result.hasOverlap).toBe(true);
    expect(result.overlappingAllocations).toHaveLength(1);
    expect(result.overlappingAllocations[0].id).toBe('1');
  });

  it('returns no overlap for different employee', () => {
    const result = findOverlappingAllocations('emp3', 'proj1', '2025-01-01', '2025-01-10', allocations);
    expect(result.hasOverlap).toBe(false);
  });

  it('returns no overlap for different project', () => {
    const result = findOverlappingAllocations('emp1', 'proj3', '2025-01-01', '2025-01-10', allocations);
    expect(result.hasOverlap).toBe(false);
  });

  it('excludes specified allocation ID', () => {
    const result = findOverlappingAllocations('emp1', 'proj1', '2025-01-05', '2025-01-12', allocations, '1');
    expect(result.hasOverlap).toBe(false);
  });

  it('finds multiple overlaps', () => {
    const result = findOverlappingAllocations('emp1', 'proj1', '2025-01-05', '2025-01-18', allocations);
    expect(result.hasOverlap).toBe(true);
    expect(result.overlappingAllocations).toHaveLength(2);
  });

  it('returns no overlap when dates do not intersect', () => {
    const result = findOverlappingAllocations('emp1', 'proj1', '2025-02-01', '2025-02-10', allocations);
    expect(result.hasOverlap).toBe(false);
  });
});
