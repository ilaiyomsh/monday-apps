import { useMemo } from 'react';
import { differenceInDays } from 'date-fns';
import type { Task, Employee } from '../types/gantt.types';
import { countWorkingDays } from '../utils/workDaysUtils';

export interface ProjectCostMetrics {
  totalPlannedHours: number;
  averageHourlyCost: number;
  totalPlannedCost: number;
  employeesWithCost: number;
}

/**
 * Hook to calculate cost metrics for a project
 * @param projectId - The project ID to calculate costs for
 * @param allocations - All allocations (tasks)
 * @param employees - All employees with their cost data
 * @param workDays - Array of working days (0-6, where 0 is Sunday)
 */
export const useProjectCosts = (
  projectId: string | number,
  allocations: Task[],
  employees: Employee[],
  workDays: number[] = [0, 1, 2, 3, 4]
): ProjectCostMetrics => {
  return useMemo(() => {
    // Filter allocations for this project
    const projectAllocations = allocations.filter(a => 
      a.projectId?.toString() === projectId.toString() ||
      a.groupId?.toString() === projectId.toString()
    );

    let totalHours = 0;
    let totalCost = 0;
    let employeesWithCost = 0;

    projectAllocations.forEach(alloc => {
      // Calculate working days in the allocation period
      const startDate = new Date(alloc.startDate);
      const endDate = new Date(alloc.endDate);
      const workingDays = countWorkingDays(startDate, endDate, workDays);
      
      // Calculate total hours for this allocation
      const hours = (alloc.hoursPerDay || 0) * workingDays;
      totalHours += hours;

      // Find the employee to get their cost
      const employee = employees.find(e => 
        e.name === alloc.userName || 
        e.id === alloc.employeeId
      );

      if (employee?.cost && employee.cost > 0) {
        totalCost += hours * employee.cost;
        employeesWithCost++;
      }
    });

    // Calculate average hourly cost (only from employees with cost data)
    const averageHourlyCost = totalHours > 0 && totalCost > 0 
      ? totalCost / totalHours 
      : 0;

    return {
      totalPlannedHours: Math.round(totalHours * 10) / 10,
      averageHourlyCost: Math.round(averageHourlyCost * 10) / 10,
      totalPlannedCost: Math.round(totalCost),
      employeesWithCost
    };
  }, [projectId, allocations, employees, workDays]);
};

/**
 * Format cost as a currency string. The currency stays ILS (₪) regardless of
 * UI language — that's a business invariant for this app — only the locale
 * (separator/grouping/glyph order) follows `Intl.NumberFormat`'s `locale` arg.
 */
export const formatCost = (amount: number, locale: string = 'he-IL'): string => {
  if (amount === 0) return '-';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'ILS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount);
};

