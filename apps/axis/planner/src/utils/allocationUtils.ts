import { Group, Task, ViewMode, Employee } from '../types/gantt.types';
import { Allocation } from '../types/entities/allocation.types';
import { getColorForRole, RoleColorMap } from '../types/entities/role.types';
import { getProjectColor } from './colorUtils';
import type { PlannerSettings } from '../types/settings.types';
import { classifyProject, isClassificationEnabled, CLASSIFICATION_ORDER } from './projectClassification';

/**
 * Merges a freshly-fetched batch of allocations into an existing list, keyed by `id`.
 *
 * `incoming` wins on id collision (so a refetched allocation reflects the latest
 * server state); existing items whose id is NOT in `incoming` are preserved.
 * Existing-item order is kept stable, and genuinely-new incoming items are appended.
 *
 * Why this exists: the Gantt loads allocations in multiple stages for fast startup
 * (current window crossing today → background future → on-demand past). These
 * windows are date-disjoint, so a stage must never wipe another stage's data. A
 * wholesale `setRawAllocations(fresh)` replace did exactly that — see BUGS.md
 * "Future allocations vanish (multi-stage load clobber)".
 */
export const mergeAllocationsById = (
  existing: Allocation[],
  incoming: Allocation[]
): Allocation[] => {
  if (existing.length === 0) return incoming;
  const incomingById = new Map(incoming.map(a => [a.id.toString(), a]));
  // Existing items: replaced in place by their incoming version when present, else kept.
  const merged: Allocation[] = existing.map(a => incomingById.get(a.id.toString()) ?? a);
  // Append incoming items that weren't already present.
  const existingIds = new Set(existing.map(a => a.id.toString()));
  for (const a of incoming) {
    if (!existingIds.has(a.id.toString())) merged.push(a);
  }
  return merged;
};

export const groupAllocations = (
  allocations: Allocation[],
  viewMode: ViewMode,
    roleColorMap?: RoleColorMap,
    options?: {
      activeProjects?: Array<{id: string, name: string, [key: string]: any}>;
      allEmployees?: Employee[];
      allEmployeesForPhotos?: Employee[];
      maxHoursPerDay?: number;
      projectDataMap?: Map<string, any>;
      settings?: PlannerSettings;
    }
  ): Group[] => {
  const groupsMap = new Map<string, Group>();

  // Pre-populate groups if options are provided
  if (viewMode === 'projects' && options?.activeProjects) {
    options.activeProjects.forEach(p => {
      groupsMap.set(p.id.toString(), {
        id: p.id.toString(),
        name: p.name,
        tasks: [],
        color: getProjectColor(p.id),
      });
    });
  } else if (viewMode === 'employees' && options?.allEmployees) {
    options.allEmployees.forEach(e => {
      groupsMap.set(e.id.toString(), {
        id: e.id.toString(),
        name: e.name,
        tasks: [],
      });
    });
  }

  allocations.forEach(allocation => {
    const groupId = (viewMode === 'projects' ? allocation.projectId : allocation.employeeId).toString();
    const groupName = viewMode === 'projects' ? (allocation.projectName || 'Unknown Project') : (allocation.userName || allocation.employeeId);

    if (!groupId || groupId === 'Unassigned') return;

    // קביעת צבע לפי מצב התצוגה:
    // - תצוגת עובדים: צבע לפי פרויקט
    // - תצוגת פרויקטים: צבע לפי תפקיד
    const taskColor = viewMode === 'employees'
      ? getProjectColor(allocation.projectId)
      : getColorForRole(allocation.role, roleColorMap);

    // Look up employee photo URL
    const employeeForPhoto = options?.allEmployeesForPhotos?.find(
      e => e.id === allocation.employeeId || e.userId === allocation.employeeId
    );

    // Use allocation's custom name if set, otherwise use default based on view mode
    // Projects view: show capability (or fallback to projectName)
    // Employees view: "projectName - capability" (or just projectName)
    const defaultName = viewMode === 'projects'
      ? (allocation.capability || allocation.projectName || 'Allocation')
      : (allocation.capability
          ? `${allocation.projectName || 'Project'} - ${allocation.capability}`
          : (allocation.projectName || 'Project'));

    const task: Task = {
      ...allocation,
      groupId: groupId,
      allocation: Math.round((allocation.hoursPerDay / (options?.maxHoursPerDay || 8.5)) * 100), // Default to 8.5h day for percentage
      name: allocation.name || defaultName,
      userInitials: allocation.userName ? allocation.userName.split(' ').map(n => n[0]).join('') : '',
      userPhotoUrl: employeeForPhoto?.photoUrl,
      color: taskColor,
      resourceId: allocation.employeeId,
      progress: 0,
    };

    if (!groupsMap.has(groupId)) {
      // צבע הקבוצה - רק בתצוגת פרויקטים
      const groupColor = viewMode === 'projects' 
        ? getProjectColor(allocation.projectId) 
        : undefined;

      groupsMap.set(groupId, {
        id: groupId,
        name: groupName,
        tasks: [],
        color: groupColor,
      });
    }

    groupsMap.get(groupId)?.tasks.push(task);
  });

  // Calculate project summaries for project view
  if (viewMode === 'projects') {
    groupsMap.forEach((group, projectId) => {
      // Calculate totals from allocations
      const totalPlannedHours = group.tasks.reduce((sum, task) => sum + (task.totalHours || 0), 0);
      const totalReportedHours = group.tasks.reduce((sum, task) => sum + (task.reportedHours || 0), 0);
      const totalCost = group.tasks.reduce((sum, task) => sum + (task.cost || 0), 0);
      const costPerHour = totalPlannedHours > 0 ? totalCost / totalPlannedHours : 0;

      // Get project data if available (for manager info / classification).
      // Fall back to `activeProjects` for empty pre-populated groups — those
      // projects aren't in projectDataMap (which is built from allocation
      // linked_items), but `activeProjects` carries the classification column.
      const projectData = options?.projectDataMap?.get(projectId.toString())
        ?? options?.activeProjects?.find(p => p.id.toString() === projectId.toString());

      // Extract manager and project type from projectData using settings
      let managerName: string | undefined;
      let managerPhotoUrl: string | undefined;
      let projectType: string | undefined;
      let projectTypeColor: string | undefined;

      if (projectData && options?.settings) {
        const settings = options.settings;

        // Get manager name and photo
        if (settings.projectManagerColumnId && projectData[settings.projectManagerColumnId]) {
          managerName = projectData[settings.projectManagerColumnId];
          // Look up manager photo from employees by userId
          const managerId = projectData[settings.projectManagerColumnId + '_id'];
          if (managerId && options.allEmployeesForPhotos) {
            const manager = options.allEmployeesForPhotos.find(e => e.userId === managerId);
            managerPhotoUrl = manager?.photoUrl;
          }
        }

        // Get project type label and color
        if (settings.projectTypeColumnId && projectData[settings.projectTypeColumnId]) {
          projectType = projectData[settings.projectTypeColumnId];
          projectTypeColor = projectData[settings.projectTypeColumnId + '_color'];
        }
      }

      group.projectSummary = {
        totalPlannedHours,
        totalReportedHours,
        totalCost,
        costPerHour,
        managerName,
        managerPhotoUrl,
        projectType,
        projectTypeColor,
        currency: '₪',  // Default to ILS
      };

      // Assign classification when toggle is on (used for sectioned grouping)
      if (isClassificationEnabled(options?.settings)) {
        group.classification = classifyProject(projectData, options?.settings);
      }
    });
  }

  const result = Array.from(groupsMap.values());

  // Stable sort by classification when enabled (projects view only)
  if (viewMode === 'projects' && isClassificationEnabled(options?.settings)) {
    const orderIndex = (cls: Group['classification']) =>
      CLASSIFICATION_ORDER.indexOf(cls ?? 'other');
    return result
      .map((g, i) => ({ g, i }))
      .sort((a, b) => {
        const diff = orderIndex(a.g.classification) - orderIndex(b.g.classification);
        return diff !== 0 ? diff : a.i - b.i;
      })
      .map(({ g }) => g);
  }

  return result;
};
