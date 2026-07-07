/**
 * מיפוי שגיאות ולידציה לטאבים ולסעיפי מיפוי
 */

/** @type {Record<string, 'structure' | 'mapping' | 'additional' | 'calendar'>} */
export const ERROR_KEY_TO_TAB = {
  xorConfiguration: 'structure',

  // מיפוי — לוחות/עמודות
  connectedBoardId: 'mapping',
  peopleColumnIds: 'mapping',
  currentBoard: 'mapping',
  timeReportingBoardId: 'mapping',
  tasksBoardId: 'mapping',
  tasksProjectColumnId: 'mapping',
  projectStatusColumnId: 'mapping',
  projectActiveStatusValues: 'mapping',
  taskStatusColumnId: 'mapping',
  taskActiveStatusValues: 'mapping',
  assignmentsBoardId: 'mapping',
  assignmentPersonColumnId: 'mapping',
  assignmentStartDateColumnId: 'mapping',
  assignmentEndDateColumnId: 'mapping',
  assignmentProjectLinkColumnId: 'mapping',
  dateColumnId: 'mapping',
  endTimeColumnId: 'mapping',
  durationColumnId: 'mapping',
  projectColumnId: 'mapping',
  taskColumnId: 'mapping',
  reporterColumnId: 'mapping',
  eventTypeStatusColumnId: 'mapping',
  nonBillableStatusColumnId: 'mapping',
  stageColumnId: 'mapping',
  eventTypeMapping: 'mapping',
  assignmentColumnId: 'mapping',
  projectTypeColumnId: 'mapping',
  projectTypeMapping: 'mapping',

  // מיפוי — לוח חופשות (Day-off, W4.5)
  dayOffBoardId: 'mapping',
  dayOffPersonColumnId: 'mapping',
  dayOffStartDateColumnId: 'mapping',
  dayOffEndDateColumnId: 'mapping',
  dayOffKindColumnId: 'mapping',
  dayOffKindLabels: 'mapping',
  dayOffTypeColumnId: 'mapping',
  dayOffApprovalColumnId: 'mapping',
  dayOffApprovedLabelIds: 'mapping',
  dayOffPendingLabelIds: 'mapping',

  // הגדרות נוספות — אישור
  approvalStatusColumnId: 'additional',
  approvalStatusMapping: 'additional',
};

/**
 * @param {string} key
 * @returns {'structure' | 'mapping' | 'additional' | 'calendar'}
 */
export function getErrorTabForKey(key) {
  if (Object.prototype.hasOwnProperty.call(ERROR_KEY_TO_TAB, key)) {
    return ERROR_KEY_TO_TAB[key];
  }
  return 'mapping';
}

/**
 * @param {Record<string, string | undefined>} errors
 */
export function countTabErrors(errors) {
  const counts = { structure: 0, mapping: 0, additional: 0, calendar: 0 };
  for (const key of Object.keys(errors)) {
    const tab = getErrorTabForKey(key);
    if (Object.prototype.hasOwnProperty.call(counts, tab)) {
      counts[tab] += 1;
    }
  }
  return counts;
}

/**
 * מפתחות שגיאה לפי אקורדיון בטאב מיפוי
 * @type {Record<'projects' | 'assignments' | 'tasks' | 'timesheet' | 'absences', string[]>}
 */
export const MAPPING_SECTION_ERROR_KEYS = {
  projects: [
    'connectedBoardId',
    'peopleColumnIds',
    'projectStatusColumnId',
    'projectActiveStatusValues',
  ],
  assignments: [
    'assignmentsBoardId',
    'assignmentPersonColumnId',
    'assignmentStartDateColumnId',
    'assignmentEndDateColumnId',
    'assignmentProjectLinkColumnId',
  ],
  tasks: [
    'tasksProjectColumnId',
    'tasksBoardId',
    'taskStatusColumnId',
    'taskActiveStatusValues',
  ],
  timesheet: [
    'currentBoard',
    'timeReportingBoardId',
    'projectColumnId',
    'dateColumnId',
    'endTimeColumnId',
    'durationColumnId',
    'reporterColumnId',
    'eventTypeStatusColumnId',
    'nonBillableStatusColumnId',
    'eventTypeMapping',
    'projectTypeColumnId',
    'projectTypeMapping',
    'taskColumnId',
    'stageColumnId',
    'assignmentColumnId',
  ],
  absences: [
    'dayOffBoardId',
    'dayOffPersonColumnId',
    'dayOffStartDateColumnId',
    'dayOffEndDateColumnId',
    'dayOffKindColumnId',
    'dayOffKindLabels',
    'dayOffTypeColumnId',
    'dayOffApprovalColumnId',
    'dayOffApprovedLabelIds',
    'dayOffPendingLabelIds',
  ],
};

/**
 * @param {Record<string, string | undefined>} errors
 * @param {string[]} keys
 */
export function countErrorsForKeys(errors, keys) {
  return keys.filter((k) => errors[k]).length;
}

/**
 * @param {Record<string, string | undefined>} errors
 * @param {'projects' | 'assignments' | 'tasks' | 'timesheet' | 'absences'} sectionId
 */
export function countMappingSectionErrors(errors, sectionId) {
  const keys = MAPPING_SECTION_ERROR_KEYS[sectionId];
  if (!keys) return 0;
  return countErrorsForKeys(errors, keys);
}
