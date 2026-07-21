import { format, parseISO } from 'date-fns';
import { mondayService } from './mondayService';
import { transformMondayItemToAllocation, transformMondayItemToEmployee, prepareAllocationMutationValues, extractProjectDataFromItems, buildProjectDataMapFromProjects } from '../utils/mondayTransformers';
import type { Employee } from '../types/entities/employee.types';
import type { PlannerSettings } from '../types/settings.types';
import { Allocation } from '../types/entities/allocation.types';
import { ViewMode, GroupId } from '../types/gantt.types';
import { logger } from '../utils/Logger';

function buildAllocationName(allocation: Partial<Allocation>): string {
  const parts: string[] = [];
  parts.push(allocation.projectName || 'Unknown Project');
  if (allocation.capability) parts.push(allocation.capability);
  if (allocation.userName) parts.push(allocation.userName);
  if (allocation.startDate) parts.push(format(parseISO(allocation.startDate), 'dd/MM/yy'));
  if (allocation.endDate) parts.push(format(parseISO(allocation.endDate), 'dd/MM/yy'));
  return parts.join(' - ');
}

export const allocationsApi = {
  async getAll(settings: PlannerSettings) {
    if (!settings.allocationsBoardId) return [];

    const items = await mondayService.fetchItems(settings.allocationsBoardId);
    const allocations = items.map((item: any) => transformMondayItemToAllocation(item, settings));

    return allocations;
  },

  /**
   * Fetch only allocations crossing today (start ≤ today ≤ end) with nested project metadata.
   * Falls back to full unfiltered fetch if the date-filter query fails.
   */
  async getAllWithProjectData(settings: PlannerSettings): Promise<{
    allocations: Allocation[];
    projectDataMap: Map<string, any>;
  }> {
    if (!settings.allocationsBoardId) return { allocations: [], projectDataMap: new Map() };

    let items: any[];
    try {
      items = await mondayService.fetchCurrentAllocations(settings);
    } catch (err) {
      // Operator names or query structure not supported — fall back to full fetch. Ship
      // through the Axiom-wired logger (was console.warn, invisible to remote monitoring) so
      // the signal that the fast filtered path is broken actually reaches Axiom.
      logger.warn('[allocationsApi] fetchCurrentAllocations failed, falling back to full fetch:', err);
      items = await mondayService.fetchItems(settings.allocationsBoardId);
    }

    const allocations = items.map((item: any) => transformMondayItemToAllocation(item, settings));
    const projectDataMap = extractProjectDataFromItems(items, settings);

    return { allocations, projectDataMap };
  },

  /**
   * Unified critical-path load (#90): allocations + employees + columns + reported
   * hours (aggregate) + project metadata, in two round-trips. Reported hours come
   * from the aggregate (joined by id); project name/metadata from items(ids).
   */
  async getCriticalBundle(settings: PlannerSettings): Promise<{
    allocations: Allocation[];
    employees: Employee[];
    columns: any[];
    projectDataMap: Map<string, any>;
    reportedByAllocId: Map<string, number>;
  }> {
    if (!settings.allocationsBoardId) {
      return { allocations: [], employees: [], columns: [], projectDataMap: new Map(), reportedByAllocId: new Map() };
    }
    const bundle = await mondayService.fetchCriticalBundle(settings);
    const projectDataMap = buildProjectDataMapFromProjects(bundle.projectItems, settings);
    const allocations = bundle.allocItems.map((item: any) =>
      transformMondayItemToAllocation(item, settings, {
        reportedByAllocId: bundle.reportedByAllocId,
        projectDataMap,
      })
    );
    let employees = bundle.empItems.map((item: any) => transformMondayItemToEmployee(item, settings));
    if (settings.filterInactiveEmployees) {
      employees = employees.filter((e) => e.isActive);
    }
    return { allocations, employees, columns: bundle.columns, projectDataMap, reportedByAllocId: bundle.reportedByAllocId };
  },

  /**
   * Windowed past-allocations fetch-more (Rule 1): a single backward [wStart..wEnd]
   * window (keyed on endDate), transformed into the same Allocation shape as the
   * critical bundle. Returns the allocations plus a project-metadata DELTA for the
   * (possibly finished) projects they reference, so the hook can merge metadata for
   * inactive-with-allocations projects (existing-wins). Bar color is preserved by
   * passing the window-agnostic reportedByAllocId aggregate to the transformer.
   */
  async getPastAllocations(
    settings: PlannerSettings,
    wStart: string,
    wEnd: string,
    reportedByAllocId: Map<string, number>,
    projectsBoardId: string | undefined,
    metaColIds: string[]
  ): Promise<{ allocations: Allocation[]; projectDataMapDelta: Map<string, any> }> {
    if (!settings.allocationsBoardId) return { allocations: [], projectDataMapDelta: new Map() };

    const items = await mondayService.fetchPastAllocationsWindow(settings, wStart, wEnd);

    // Distinct project ids referenced by this window (mirror getCriticalBundle).
    const projectIds = Array.from(new Set(
      items
        .map((it: any) => it.column_values?.find((c: any) => c.id === settings.projectColumnId)?.linked_item_ids?.[0])
        .filter(Boolean)
        .map((id: any) => id.toString())
    ));

    const projItems = projectsBoardId
      ? await mondayService.fetchProjectsByIds(projectsBoardId, projectIds, metaColIds)
      : [];
    const projectDataMapDelta = buildProjectDataMapFromProjects(projItems, settings);

    const allocations = items.map((it: any) =>
      transformMondayItemToAllocation(it, settings, { reportedByAllocId, projectDataMap: projectDataMapDelta })
    );

    return { allocations, projectDataMapDelta };
  },

  async getEmployees(settings: PlannerSettings) {
    if (!settings.employeesBoardId) return [];

    const items = await mondayService.fetchItems(settings.employeesBoardId);
    const employees = items.map((item: any) => transformMondayItemToEmployee(item, settings));

    if (settings.filterInactiveEmployees) {
      return employees.filter(e => e.isActive);
    }
    return employees;
  },

  async create(allocation: Omit<Allocation, 'id'>, settings: PlannerSettings, viewMode: ViewMode, groupId?: GroupId) {
    if (!settings.allocationsBoardId) throw new Error('Allocations board not configured');

    // Validation: Project is required in employee view
    if (viewMode === 'employees' && (!allocation.projectId || allocation.projectId === 'Unassigned')) {
      throw new Error('Project is required for new allocations in employee view');
    }

    const columnValues = prepareAllocationMutationValues(allocation, settings, viewMode, groupId);
    const itemName = buildAllocationName(allocation);
    return await mondayService.createItem(settings.allocationsBoardId, itemName, columnValues);
  },

  async update(id: string, allocation: Partial<Allocation>, settings: PlannerSettings, viewMode: ViewMode) {
    if (!settings.allocationsBoardId) throw new Error('Allocations board not configured');

    const columnValues = prepareAllocationMutationValues(allocation, settings, viewMode);

    // Always update item name with all available fields
    columnValues.name = buildAllocationName(allocation);

    return await mondayService.updateItem(settings.allocationsBoardId, id, columnValues);
  },

  async delete(id: string) {
    return await mondayService.deleteItem(id);
  }
};
