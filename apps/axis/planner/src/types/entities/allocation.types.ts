import { TaskId, GroupId } from '../gantt.types';

export interface Allocation {
  id: TaskId;
  name?: string; // Custom allocation name (defaults to "{projectName} - {role}")
  projectId: GroupId;
  employeeId: string;
  role: string;
  capability?: string; // The capability/hat the employee is using for this allocation
  startDate: string; // ISO String
  endDate: string;   // ISO String
  hoursPerDay: number;
  totalHours: number;
  ftePercentage?: number; // FTE percentage (calculated from hoursPerDay / maxHoursPerDay * 100)
  projectName?: string;
  userName?: string;
  reportedHours?: number; // Actual hours from mirror column
  cost?: number; // Cost per allocation from allocation board
  managerId?: string; // Project manager ID (people column)
  clientItemId?: string; // Client item ID (board_relation column)
}
