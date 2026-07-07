import { Allocation } from '../types/entities/allocation.types';
import { countWorkingDays } from './workDaysUtils';
import { Employee } from '../types/entities/employee.types';
import type { PlannerSettings } from '../types/settings.types';
import { ViewMode, GroupId } from '../types/gantt.types';
import { logger } from './Logger';

/**
 * Transforms a Monday item into an Allocation entity
 */
export const transformMondayItemToAllocation = (
  item: any,
  settings: PlannerSettings,
  // #90 unified-load: when provided, reported hours come from the aggregate map
  // (keyed by allocation id) instead of the per-row mirror, and the project name
  // is resolved from the separately-fetched projectDataMap (lean fetch carries
  // only linked_item_ids). Both optional — omitting them keeps legacy behavior.
  opts?: { reportedByAllocId?: Map<string, number>; projectDataMap?: Map<string, any> }
): Allocation => {
  const columnValues = item.column_values || [];
  
  const getColumnData = (columnId: string) => {
    const col = columnValues.find((c: any) => c.id === columnId);
    if (!col) return { id: 'Unassigned', text: 'Unassigned' };
    
    // Board Relation column support (full objects — legacy heavy fetch)
    if (col.linked_items && col.linked_items.length > 0) {
      return {
        id: col.linked_items[0].id,
        text: col.linked_items[0].name || col.text || `Project ${col.linked_items[0].id}`
      };
    }

    // Board Relation, lean fetch (#90): only ids are present — the linked item's
    // name comes from the separately-fetched projectDataMap (resolved below).
    if (col.linked_item_ids && col.linked_item_ids.length > 0) {
      return { id: col.linked_item_ids[0].toString(), text: col.text || '' };
    }

    // People column support (via PeopleValue fragment)
    if (col.persons_and_teams && col.persons_and_teams.length > 0) {
      return { id: col.persons_and_teams[0].id.toString(), text: col.text || `User ${col.persons_and_teams[0].id}` };
    }

    return { id: col.text || 'Unassigned', text: col.text || 'Unassigned' };
  };

  const projectData = getColumnData(settings.projectColumnId);
  const employeeData = getColumnData(settings.employeeColumnId);
  const managerData = settings.allocationManagerColumnId
    ? getColumnData(settings.allocationManagerColumnId)
    : { id: undefined, text: undefined };
  const clientData = settings.allocationClientColumnId
    ? getColumnData(settings.allocationClientColumnId)
    : { id: undefined, text: undefined };

  const getValue = (columnId: string) => {
    const col = columnValues.find((c: any) => c.id === columnId);
    if (!col) return null;
    return col.text;
  };

  // Get value from mirror column (uses display_value instead of text)
  const getMirrorValue = (columnId: string | undefined) => {
    if (!columnId) return null;
    const col = columnValues.find((c: any) => c.id === columnId);
    if (!col) return null;
    // Mirror columns use display_value, not text
    return col.display_value || col.text || null;
  };

  // Reported (actual) hours.
  // #90: prefer the aggregate map (server-summed, keyed by allocation id). Falls
  // back to the legacy mirror parse (display_value is a comma-separated list of
  // every linked time-log value, summed here) when no map is supplied.
  let reportedHours = 0;
  if (opts?.reportedByAllocId) {
    reportedHours = opts.reportedByAllocId.get(item.id?.toString()) ?? 0;
  } else {
    const reportedHoursStr = getMirrorValue(settings.reportedHoursColumnId);
    if (reportedHoursStr) {
      const values = reportedHoursStr.split(',').map((v: string) => parseFloat(v.trim()) || 0);
      reportedHours = values.reduce((sum: number, val: number) => sum + val, 0);
    }
  }

  // Parse allocation cost
  let cost = 0;
  if (settings.allocationCostColumnId) {
    const costValue = getValue(settings.allocationCostColumnId);
    if (costValue) {
      cost = parseFloat(costValue) || 0;
    }
  }

  // Parse FTE percentage if column is configured
  let ftePercentage: number | undefined = undefined;
  if (settings.ftePercentageColumnId) {
    const fteValue = getValue(settings.ftePercentageColumnId);
    if (fteValue) {
      ftePercentage = parseFloat(fteValue) || undefined;
    }
  }

  // Round to 1 decimal place to avoid floating point precision issues
  const roundTo1 = (n: number) => Math.round(n * 10) / 10;

  // Extract capability from dropdown column if configured
  let capability: string | undefined;
  if (settings.allocationCapabilityColumnId) {
    const capCol = columnValues.find((c: any) => c.id === settings.allocationCapabilityColumnId);
    if (capCol?.text) {
      capability = capCol.text;
    }
  }

  return {
    id: item.id,
    name: item.name || '',
    projectId: projectData.id,
    employeeId: employeeData.id,
    role: getValue(settings.roleColumnId) || '',
    capability,
    startDate: getValue(settings.startDateColumnId) || '',
    endDate: getValue(settings.endDateColumnId) || '',
    hoursPerDay: roundTo1(parseFloat(getValue(settings.hoursPerDayColumnId) || '0')),
    totalHours: roundTo1(parseFloat(getValue(settings.totalHoursColumnId) || '0')),
    ftePercentage,
    // Lean fetch carries no linked name; resolve from projectDataMap when present.
    projectName: projectData.text || opts?.projectDataMap?.get(projectData.id?.toString())?.name || '',
    userName: employeeData.text,
    reportedHours,
    cost,
    managerId: managerData.id && managerData.id !== 'Unassigned' ? managerData.id : undefined,
    clientItemId: clientData.id && clientData.id !== 'Unassigned' ? clientData.id?.toString() : undefined,
  };
};

/**
 * Transforms a Monday item into an Employee entity
 */
export const transformMondayItemToEmployee = (
  item: any,
  settings: PlannerSettings
): Employee => {
  const columnValues = item.column_values || [];
  
  const getValue = (columnId: string) => {
    const col = columnValues.find((c: any) => c.id === columnId);
    return col ? col.text : null;
  };

  const allocationStr = getValue(settings.employeeAllocationPercentColumnId) || '100%';
  const allocationPercentage = parseInt(allocationStr.replace('%', '')) || 100;

  // Extract User ID from people column (via PeopleValue fragment)
  let userId = undefined;
  const userCol = columnValues.find((c: any) => c.id === settings.employeeUserIdColumnId);
  if (userCol?.persons_and_teams && userCol.persons_and_teams.length > 0) {
    userId = userCol.persons_and_teams[0].id?.toString();
  }

  // Extract capabilities from dropdown column (multi-select)
  let capabilities: string[] = [];
  if (settings.capabilitiesColumnId) {
    const capCol = columnValues.find((c: any) => c.id === settings.capabilitiesColumnId);
    if (capCol && capCol.text) {
      // Dropdown columns store selected values in text as comma-separated
      capabilities = capCol.text.split(', ').map((s: string) => s.trim()).filter(Boolean);
    }
  }

  // Fallback: if no capabilities configured or empty, use official role
  const officialRole = getValue(settings.employeeRoleColumnId) || '';
  if (capabilities.length === 0 && officialRole) {
    capabilities = [officialRole];
  }

  // Determine active status. Default to true when no filter is configured.
  // Match by label id (the `index` on StatusValue), not text — see [[feedback_status_id_match]].
  let isActive = true;
  if (settings.filterInactiveEmployees && settings.employeeStatusColumnId) {
    const statusCol = columnValues.find((c: any) => c.id === settings.employeeStatusColumnId);
    const activeIds = settings.activeEmployeeStatusValues || [];
    if (statusCol && activeIds.length > 0) {
      const labelId = statusCol.index !== undefined && statusCol.index !== null
        ? statusCol.index.toString()
        : null;
      isActive = labelId !== null && activeIds.includes(labelId);
    } else {
      isActive = false; // misconfigured / missing column on this row ⇒ treat as inactive
    }
  }

  return {
    id: userId || item.id,
    name: item.name || getValue(settings.employeeNameColumnId) || '',
    role: officialRole,
    capabilities,
    allocationPercentage,
    cost: parseFloat(getValue(settings.employeeCostColumnId) || '0'),
    userId,
    isActive,
  };
};

/**
 * Prepares column values for a Monday mutation
 */
export const prepareAllocationMutationValues = (
  allocation: Partial<Allocation>,
  settings: PlannerSettings,
  viewMode: ViewMode,
  groupId?: GroupId
): any => {
  const values: any = {};

  // Round to 1 decimal place - totalHours is the "king"
  const roundTo1 = (n: number) => Math.round(n * 10) / 10;

  if (allocation.startDate) values[settings.startDateColumnId] = { date: allocation.startDate.split('T')[0] };
  if (allocation.endDate) values[settings.endDateColumnId] = { date: allocation.endDate.split('T')[0] };

  // totalHours is the primary value ("the king") - save it directly with 1 decimal precision
  // hoursPerDay is derived from totalHours / days
  if (allocation.totalHours !== undefined) {
    if (settings.totalHoursColumnId) values[settings.totalHoursColumnId] = roundTo1(allocation.totalHours).toString();

    // Derive hoursPerDay from totalHours (not the reverse)
    if (allocation.startDate && allocation.endDate) {
      const start = new Date(allocation.startDate);
      const end = new Date(allocation.endDate);
      const days = Math.max(1, countWorkingDays(start, end, settings.workDays));
      const derivedHoursPerDay = allocation.totalHours / days;
      if (settings.hoursPerDayColumnId) values[settings.hoursPerDayColumnId] = roundTo1(derivedHoursPerDay).toString();
    } else if (allocation.hoursPerDay !== undefined) {
      if (settings.hoursPerDayColumnId) values[settings.hoursPerDayColumnId] = roundTo1(allocation.hoursPerDay).toString();
    }
  } else if (allocation.hoursPerDay !== undefined) {
    // Fallback: if only hoursPerDay provided, use it and calculate totalHours
    if (settings.hoursPerDayColumnId) values[settings.hoursPerDayColumnId] = roundTo1(allocation.hoursPerDay).toString();
    if (allocation.startDate && allocation.endDate) {
      const start = new Date(allocation.startDate);
      const end = new Date(allocation.endDate);
      const days = Math.max(1, countWorkingDays(start, end, settings.workDays));
      const calculatedTotalHours = days * allocation.hoursPerDay;
      if (settings.totalHoursColumnId) values[settings.totalHoursColumnId] = roundTo1(calculatedTotalHours).toString();
    }
  }

  if (allocation.role && settings.roleColumnId) values[settings.roleColumnId] = allocation.role;

  // Save capability to dropdown column if configured
  if (allocation.capability && settings.allocationCapabilityColumnId) {
    // For dropdown columns, we set by label text using the labels array format
    values[settings.allocationCapabilityColumnId] = { labels: [allocation.capability] };
  }

  // Calculate and save FTE percentage if column is configured
  if (settings.ftePercentageColumnId && allocation.hoursPerDay !== undefined) {
    const ftePercentage = Math.round((allocation.hoursPerDay / settings.maxHoursPerDay) * 100);
    values[settings.ftePercentageColumnId] = ftePercentage.toString();
  }

  // Handle Project ID (Board Relation)
  let projectId = allocation.projectId;
  if (!projectId && viewMode === 'projects' && groupId) {
    projectId = groupId;
  }
  
  if (projectId && projectId !== 'Unassigned') {
    const pId = typeof projectId === 'string' ? parseInt(projectId) : projectId;
    if (!isNaN(pId)) {
      values[settings.projectColumnId] = { item_ids: [pId] };
    }
  }

  // Handle Employee ID (People)
  let employeeId = allocation.employeeId;
  if (employeeId === undefined && viewMode === 'employees' && groupId) {
    employeeId = groupId.toString();
  }

  if (employeeId === '') {
    values[settings.employeeColumnId] = { personsAndTeams: [] };
  } else if (employeeId && employeeId !== 'Unassigned') {
    const eId = parseInt(employeeId);
    if (!isNaN(eId)) {
      values[settings.employeeColumnId] = {
        personsAndTeams: [{ id: eId, kind: 'person' }]
      };
    }
  }

  // Handle Manager ID (People) - write to allocation manager column if configured
  if (settings.allocationManagerColumnId && allocation.managerId) {
    const mId = parseInt(allocation.managerId);
    if (!isNaN(mId)) {
      values[settings.allocationManagerColumnId] = {
        personsAndTeams: [{ id: mId, kind: 'person' }]
      };
    }
  }

  // Handle Client ID (Board Relation) - write to allocation client column if configured
  if (settings.allocationClientColumnId && allocation.clientItemId) {
    const cId = parseInt(allocation.clientItemId);
    if (!isNaN(cId)) {
      values[settings.allocationClientColumnId] = { item_ids: [cId] };
    }
  }

  return values;
};

/**
 * Extracts a projectDataMap from raw allocation items by reading the nested
 * linked_items.column_values on the project board-relation column.
 * Produces the same key structure that ActiveProjectsContext used to build:
 *   { id, name, [colId]: text, [colId+'_id']: personId, [colId+'_color']: color }
 */
export const extractProjectDataFromItems = (
  items: any[],
  settings: PlannerSettings
): Map<string, any> => {
  const map = new Map<string, any>();

  for (const item of items) {
    const projectCol = item.column_values?.find((c: any) => c.id === settings.projectColumnId);
    if (!projectCol?.linked_items?.length) continue;

    const linked = projectCol.linked_items[0];
    if (!linked?.id) continue;

    const projectId = linked.id.toString();
    if (map.has(projectId)) continue; // first occurrence wins

    const project: any = { id: projectId, name: linked.name || '' };

    for (const colVal of linked.column_values || []) {
      project[colVal.id] = colVal.text || '';
      if (colVal.label_style?.color) {
        project[colVal.id + '_color'] = colVal.label_style.color;
      }
      // Status label index (string) — stable identifier used by classifyProject.
      // Without this, classification of projects-with-allocations falls back to
      // text matching against label IDs, which fails ⇒ "other".
      if (colVal.index !== undefined && colVal.index !== null) {
        project[colVal.id + '_index'] = colVal.index.toString();
      }
      if (colVal.persons_and_teams?.[0]?.id) {
        project[colVal.id + '_id'] = colVal.persons_and_teams[0].id.toString();
      }
      // board relation inside linked project (e.g. client column on projects board)
      if (colVal.linked_items?.[0]?.id) {
        project[colVal.id + '_id'] = colVal.linked_items[0].id.toString();
      }
    }

    map.set(projectId, project);
  }

  return map;
};

/**
 * #90: build the same projectDataMap shape as `extractProjectDataFromItems`, but
 * from project items fetched directly (mondayService.fetchProjectsByIds) instead
 * of from nested linked_items on each allocation. Each `proj` IS the project item.
 */
export const buildProjectDataMapFromProjects = (
  projectItems: any[],
  _settings: PlannerSettings
): Map<string, any> => {
  const map = new Map<string, any>();

  for (const proj of projectItems) {
    const projectId = proj?.id?.toString();
    if (!projectId || map.has(projectId)) continue;

    const project: any = { id: projectId, name: proj.name || '' };

    for (const colVal of proj.column_values || []) {
      project[colVal.id] = colVal.text || '';
      if (colVal.label_style?.color) {
        project[colVal.id + '_color'] = colVal.label_style.color;
      }
      if (colVal.index !== undefined && colVal.index !== null) {
        project[colVal.id + '_index'] = colVal.index.toString();
      }
      if (colVal.persons_and_teams?.[0]?.id) {
        project[colVal.id + '_id'] = colVal.persons_and_teams[0].id.toString();
      }
      // board relation on the projects board (e.g. client) — lean ids
      if (colVal.linked_item_ids?.[0]) {
        project[colVal.id + '_id'] = colVal.linked_item_ids[0].toString();
      } else if (colVal.linked_items?.[0]?.id) {
        project[colVal.id + '_id'] = colVal.linked_items[0].id.toString();
      }
    }

    map.set(projectId, project);
  }

  return map;
};
