import React, { useState, useEffect, useMemo } from 'react';
import { Briefcase, ListTodo, Table, ChevronDown, ChevronUp, AlertTriangle, CalendarCheck, CalendarOff } from 'lucide-react';
import { useStableT } from '../../i18n/useStableT';
import SearchableSelect from './SearchableSelect';
import MultiSelect from './MultiSelect';
import { FIELD_MODES, TOGGLE_MODES, DEFAULT_FIELD_CONFIG } from '../../contexts/SettingsContext';
import { fetchStatusColumnsFromBoard, parseStatusLabels, createEventTypeStatusColumn, safeApi } from '../../utils/mondayApi';
import { parseStatusColumnLabels } from '../../utils/eventTypeValidation';
import { UNMAPPED, UNMAPPED_LABEL, createLegacyMapping, getCategoryLabels, smartValidateMapping, isSingleUseCategory } from '../../utils/eventTypeMapping';
import { getEffectiveBoardId } from '../../utils/boardIdResolver';
import { columnSelectLabel } from '../../utils/mondayColumns';
import { mondayColorToHex } from '../../utils/colorUtils';
import logger from '../../utils/logger';
import { countMappingSectionErrors } from './settingsErrorMeta';
import styles from './MappingTab.module.css';

/**
 * חילוץ אפשרויות תוויות (label IDs יציבים) מעמודת סטטוס ברשימת עמודות.
 * ההתאמה נשמרת לפי label ID — לעולם לא לפי טקסט (ראה Day-off/CONTRACT.md).
 */
const extractStatusLabelOptions = (columns, columnId) => {
  if (!columnId) return [];
  const col = columns.find(c => c.id === columnId);
  if (!col?.settings) return [];
  return parseStatusColumnLabels(col.settings)
    .map(l => ({ id: String(l.id), name: l.label, color: l.color || '' }));
};

/**
 * טאב מיפוי נתונים
 * מציג אקורדיונים דינמיים לפי fieldConfig
 */
const MappingTab = ({ 
  settings, 
  onChange, 
  monday, 
  context,
  boards,
  loadingBoards,
  showErrorWithDetails,
  fieldErrors = {}
}) => {
  const t = useStableT();
  const fieldConfig = settings.fieldConfig || DEFAULT_FIELD_CONFIG;

  // State - סקשנים פתוחים
  const [openSection, setOpenSection] = useState(''); // כל הסעיפים סגורים בברירת מחדל
  
  // State - עמודות לוח פרויקטים
  const [peopleColumns, setPeopleColumns] = useState([]);
  const [tasksProjectColumns, setTasksProjectColumns] = useState([]);
  const [projectStatusColumns, setProjectStatusColumns] = useState([]);
  const [projectStatusLabels, setProjectStatusLabels] = useState([]);
  const [loadingPeopleColumns, setLoadingPeopleColumns] = useState(false);
  const [loadingTasksColumns, setLoadingTasksColumns] = useState(false);
  const [loadingProjectStatusColumns, setLoadingProjectStatusColumns] = useState(false);
  
  // State - לוחות ועמודות משימות
  const [taskBoards, setTaskBoards] = useState([]);
  const [taskStatusColumns, setTaskStatusColumns] = useState([]);
  const [taskStatusLabels, setTaskStatusLabels] = useState([]);
  const [loadingTaskStatusColumns, setLoadingTaskStatusColumns] = useState(false);

  // State - עמודות לוח הקצאות (Assignments)
  const [assignmentPersonColumns, setAssignmentPersonColumns] = useState([]);
  const [assignmentDateColumns, setAssignmentDateColumns] = useState([]);
  const [assignmentBoardRelationColumns, setAssignmentBoardRelationColumns] = useState([]);
  const [loadingAssignmentColumns, setLoadingAssignmentColumns] = useState(false);
  
  // State - עמודות לוח דיווחים נוכחי
  const [dateColumns, setDateColumns] = useState([]);
  const [durationColumns, setDurationColumns] = useState([]);
  const [projectColumns, setProjectColumns] = useState([]);
  const [taskColumns, setTaskColumns] = useState([]);
  const [assignmentColumns, setAssignmentColumns] = useState([]);
  const [reporterColumns, setReporterColumns] = useState([]);
  const [statusColumns, setStatusColumns] = useState([]);
  const [statusColumnsWithSettings, setStatusColumnsWithSettings] = useState([]);
  const [stageColumns, setStageColumns] = useState([]);
  const [textColumns, setTextColumns] = useState([]);
  const [checkboxColumns, setCheckboxColumns] = useState([]);
  const [loadingCurrentBoardColumns, setLoadingCurrentBoardColumns] = useState(false);
  
  // State - ולידציה של עמודת סוג דיווח
  const [eventTypeValidation, setEventTypeValidation] = useState({ isValid: true, missingLabels: [] });
  const [isCreatingEventTypeColumn, setIsCreatingEventTypeColumn] = useState(false);

  // State - לייבלים של עמודת סוג דיווח (לשימוש ב-Planned vs Actual)
  const [eventTypeStatusLabels, setEventTypeStatusLabels] = useState([]);

  // State - הבחנה פנימי/חיצוני: עמודות mirror ולייבלים
  // eslint-disable-next-line no-unused-vars -- פיצ'ר רדום: הקריאה מתבצעת רק ב-fetchAssignmentMirrorColumns שעדיין לא נצרך ב-UI
  const [assignmentMirrorColumns, setAssignmentMirrorColumns] = useState([]);
  // eslint-disable-next-line no-unused-vars -- פיצ'ר רדום: ראה הערה לעיל
  const [loadingMirrorColumns, setLoadingMirrorColumns] = useState(false);
  const [projectTypeLabels, setProjectTypeLabels] = useState([]);
  const [loadingProjectTypeLabels, setLoadingProjectTypeLabels] = useState(false);

  // State - עמודות לקוח בלוח דיווחים
  const [customerReportColumns, setCustomerReportColumns] = useState([]);

  // State - עמודות לוח החופשות (Day-off, W4.5)
  const [dayOffPeopleColumns, setDayOffPeopleColumns] = useState([]);
  const [dayOffDateColumns, setDayOffDateColumns] = useState([]);
  const [dayOffStatusColumns, setDayOffStatusColumns] = useState([]); // עם settings לחילוץ תוויות
  const [loadingDayOffColumns, setLoadingDayOffColumns] = useState(false);

  // בדיקה אם שדות פעילים לפי fieldConfig
  const hasTasks = fieldConfig.task !== FIELD_MODES.HIDDEN;
  const hasStage = fieldConfig.stage !== FIELD_MODES.HIDDEN;
  const hasNotes = fieldConfig.notes !== FIELD_MODES.HIDDEN;
  const hasBillableToggle = fieldConfig.billableToggle === TOGGLE_MODES.VISIBLE;
  const hasNonBillableType = hasBillableToggle && fieldConfig.nonBillableType !== FIELD_MODES.HIDDEN;

  // חישוב לוח דיווחים אפקטיבי
  const effectiveBoardId = useMemo(() =>
    getEffectiveBoardId(settings, context),
    [settings, context]
  );

  // האם יש context.boardId זמין
  const hasContextBoard = !!context?.boardId;

  // אזהרה אם עמודות לקוח מוגדרות חלקית
  const customerConfigWarning = useMemo(() => {
    const hasSource = !!settings.customerColumnId;
    const hasTarget = !!settings.customerReportColumnId;
    if (hasSource && !hasTarget) return t('settings.mapping.validation.customerSourceMissing');
    if (!hasSource && hasTarget) return t('settings.mapping.validation.customerTargetMissing');
    return null;
  }, [settings.customerColumnId, settings.customerReportColumnId, t]);

  // תוויות (label IDs) של עמודות הסטטוס בלוח החופשות — לבחירת מיפוי אישי/כללי ואישור
  const dayOffKindLabels = useMemo(
    () => extractStatusLabelOptions(dayOffStatusColumns, settings.dayOffKindColumnId),
    [dayOffStatusColumns, settings.dayOffKindColumnId]
  );
  const dayOffApprovalLabels = useMemo(
    () => extractStatusLabelOptions(dayOffStatusColumns, settings.dayOffApprovalColumnId),
    [dayOffStatusColumns, settings.dayOffApprovalColumnId]
  );

  // טעינה ראשונית כשה-component נטען
  useEffect(() => {
    // טעינת עמודות לוח פרויקטים
    if (settings.connectedBoardId) {
      fetchPeopleColumns(settings.connectedBoardId);
      fetchProjectTasksColumns(settings.connectedBoardId);
      if (settings.projectStatusFilterEnabled || settings.enableProjectTypeDistinction) {
        fetchProjectStatusColumns(settings.connectedBoardId, settings.projectStatusColumnId);
      }
    }

    // טעינת עמודות לוח דיווחים
    if (effectiveBoardId) {
      fetchCurrentBoardColumns(effectiveBoardId, settings.connectedBoardId, settings.tasksBoardId);
    }

    // טעינת עמודות לוח הקצאות
    if (settings.assignmentsBoardId) {
      fetchAssignmentBoardColumns(settings.assignmentsBoardId);
    }
  }, []); // ריק - מופעל רק פעם אחת בטעינה

  // טעינת עמודות לוח פרויקטים בעת שינוי
  useEffect(() => {
    if (settings.connectedBoardId) {
      fetchPeopleColumns(settings.connectedBoardId);
      fetchProjectTasksColumns(settings.connectedBoardId);
      if (settings.projectStatusFilterEnabled || settings.enableProjectTypeDistinction) {
        fetchProjectStatusColumns(settings.connectedBoardId, settings.projectStatusColumnId);
      }
    }
  }, [settings.connectedBoardId]);

  // טעינת עמודות לוח דיווחים (הלוח האפקטיבי)
  useEffect(() => {
    if (effectiveBoardId) {
      fetchCurrentBoardColumns(effectiveBoardId, settings.connectedBoardId, settings.tasksBoardId);
    }
  }, [effectiveBoardId, settings.connectedBoardId, settings.tasksBoardId]);

  // טעינת לוחות משימות מעמודת Connect Boards
  useEffect(() => {
    if (settings.tasksProjectColumnId && settings.connectedBoardId) {
      extractTaskBoardsFromColumn(settings.tasksProjectColumnId, settings.connectedBoardId);
    }
  }, [settings.tasksProjectColumnId, settings.connectedBoardId]);

  // טעינת עמודות סטטוס משימות
  useEffect(() => {
    if (settings.tasksBoardId && settings.taskStatusFilterEnabled) {
      fetchTaskStatusColumns(settings.tasksBoardId, settings.taskStatusColumnId);
    }
  }, [settings.tasksBoardId, settings.taskStatusFilterEnabled]);

  // טעינת עמודות לוח הקצאות
  useEffect(() => {
    if (settings.assignmentsBoardId) {
      fetchAssignmentBoardColumns(settings.assignmentsBoardId);
    }
  }, [settings.assignmentsBoardId]);

  // טעינת עמודות לוח החופשות (Day-off)
  useEffect(() => {
    if (settings.dayOffBoardId) {
      fetchDayOffBoardColumns(settings.dayOffBoardId);
    }
  }, [settings.dayOffBoardId]);

  // טעינת עמודות סטטוס פרויקטים כשהבחנה פנימי/חיצוני נדלקת
  useEffect(() => {
    if (!settings.enableProjectTypeDistinction || projectStatusColumns.length > 0) return;

    if (!settings.useAssignmentsMode && settings.connectedBoardId) {
      // מצב ישיר — לוח פרויקטים ידוע
      fetchProjectStatusColumns(settings.connectedBoardId);
    } else if (settings.useAssignmentsMode && settings.assignmentsBoardId && settings.assignmentProjectLinkColumnId) {
      // מצב הקצאות — מחלצים את ה-boardId מעמודת קישור הפרויקטים
      safeApi(monday, 'MappingTab.getProjectBoardId',
        `query { boards(ids:[${settings.assignmentsBoardId}]) { columns(ids:["${settings.assignmentProjectLinkColumnId}"]) { settings } } }`
      ).then(res => {
        const raw = res.data?.boards?.[0]?.columns?.[0]?.settings;
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const boardId = parsed?.boardIds?.[0];
        if (boardId) fetchProjectStatusColumns(String(boardId));
      }).catch(err => {
        logger.error('MappingTab', 'Failed to extract project board ID from assignments column settings', err);
      });
    }
  }, [settings.enableProjectTypeDistinction, settings.connectedBoardId, settings.useAssignmentsMode, settings.assignmentsBoardId, settings.assignmentProjectLinkColumnId]);

  // טעינה ראשונית של לייבלים של סוג פרויקט (אם כבר יש עמודה שמורה)
  useEffect(() => {
    if (settings.enableProjectTypeDistinction && settings.projectTypeColumnId) {
      // תמיד מחכים לעמודות הסטטוס מלוח הפרויקטים
      if (projectStatusColumns.length === 0) return;
      if (projectTypeLabels.length === 0) {
        loadProjectTypeLabels(settings.projectTypeColumnId, !!settings.useAssignmentsMode);
      }
    }
  }, [settings.enableProjectTypeDistinction, settings.projectTypeColumnId, projectStatusColumns]);

  // --- API Functions ---
  
  const fetchPeopleColumns = async (boardId) => {
    if (!boardId) return;
    setLoadingPeopleColumns(true);
    try {
      const query = `query { boards(ids: [${boardId}]) { columns { id title type } } }`;
      const res = await safeApi(monday, 'MappingTab.fetchPeopleColumns', query);
      if (res.data?.boards?.[0]) {
        const cols = res.data.boards[0].columns
          .filter(col => col.type === 'people')
          .map(col => ({ id: col.id, name: columnSelectLabel(col) }));
        setPeopleColumns(cols);
      }
    } catch (err) {
      showErrorWithDetails(err, { functionName: 'fetchPeopleColumns' });
    } finally {
      setLoadingPeopleColumns(false);
    }
  };

  const fetchProjectTasksColumns = async (boardId) => {
    if (!boardId) {
      setTasksProjectColumns([]);
      return;
    }
    setLoadingTasksColumns(true);
    try {
      const query = `query { boards(ids: [${boardId}]) { columns { id title type settings } } }`;
      const res = await safeApi(monday, 'MappingTab.fetchProjectTasksColumns', query);
      if (res.data?.boards?.[0]) {
        const cols = res.data.boards[0].columns
          .filter(col => col.type === 'board_relation')
          .map(col => ({ id: col.id, name: columnSelectLabel(col), settings: col.settings }));
        setTasksProjectColumns(cols);
      }
    } catch (err) {
      showErrorWithDetails(err, { functionName: 'fetchProjectTasksColumns' });
      setTasksProjectColumns([]);
    } finally {
      setLoadingTasksColumns(false);
    }
  };

  const extractTaskBoardsFromColumn = async (columnId, boardId) => {
    if (!columnId || !boardId) return;
    try {
      const query = `query { boards(ids: [${boardId}]) { columns(ids: ["${columnId}"]) { settings } } }`;
      const res = await safeApi(monday, 'MappingTab.extractTaskBoardsFromColumn', query);
      if (res.data?.boards?.[0]?.columns?.[0]) {
        const raw = res.data.boards[0].columns[0].settings;
        const colSettings = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {});
        const boardIds = colSettings.boardIds || [];
        if (boardIds.length > 0) {
          const boardsQuery = `query { boards(ids: [${boardIds.join(',')}]) { id name } }`;
          const boardsRes = await safeApi(monday, 'MappingTab.extractTaskBoardsFromColumn:boards', boardsQuery);
          if (boardsRes.data?.boards) {
            setTaskBoards(boardsRes.data.boards.map(b => ({ id: b.id, name: b.name })));
          }
        } else {
          setTaskBoards([]);
        }
      }
    } catch (err) {
      showErrorWithDetails(err, { functionName: 'extractTaskBoardsFromColumn' });
      setTaskBoards([]);
    }
  };

  const fetchCurrentBoardColumns = async (boardId, filterByConnectedBoard = null, filterByTaskBoard = null) => {
    if (!boardId) return;
    setLoadingCurrentBoardColumns(true);
    try {
      const query = `query { boards(ids: [${boardId}]) { columns { id title type settings } } }`;
      const res = await safeApi(monday, 'MappingTab.fetchCurrentBoardColumns', query);
      if (res.data?.boards?.[0]) {
        const columns = res.data.boards[0].columns;

        setDateColumns(columns.filter(col => col.type === 'date').map(col => ({ id: col.id, name: columnSelectLabel(col) })));
        setDurationColumns(columns.filter(col => col.type === 'numbers').map(col => ({ id: col.id, name: columnSelectLabel(col) })));
        setReporterColumns(columns.filter(col => col.type === 'people').map(col => ({ id: col.id, name: columnSelectLabel(col) })));
        setStatusColumns(columns.filter(col => col.type === 'status').map(col => ({ id: col.id, name: columnSelectLabel(col) })));
        // שמירת עמודות סטטוס עם ה-settings לצורך ולידציה
        setStatusColumnsWithSettings(columns.filter(col => col.type === 'status').map(col => ({ 
          id: col.id, 
          name: columnSelectLabel(col),
          settings: col.settings 
        })));
        setStageColumns(columns.filter(col => col.type === 'status' || col.type === 'dropdown').map(col => ({ id: col.id, name: columnSelectLabel(col) })));
        setTextColumns(columns.filter(col => col.type === 'text' || col.type === 'long_text').map(col => ({ id: col.id, name: columnSelectLabel(col) })));
        setCheckboxColumns(columns.filter(col => col.type === 'checkbox').map(col => ({ id: col.id, name: columnSelectLabel(col) })));
        
        // עמודות קישור לפרויקט - מסוננות לפי לוח פרויקטים
        setProjectColumns(columns.filter(col => {
          if (col.type !== 'board_relation') return false;
          if (filterByConnectedBoard) {
            try {
              const raw = col.settings;
              const columnSettings = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {});
              const boardIds = (columnSettings.boardIds || []).map(String);
              return boardIds.includes(String(filterByConnectedBoard));
            } catch (e) {
              logger.warn('MappingTab', 'Failed to parse project column settings', { columnId: col.id, error: e?.message });
              return false;
            }
          }
          return true;
        }).map(col => ({ id: col.id, name: columnSelectLabel(col) })));

        // עמודות קישור למשימה - מסוננות לפי לוח משימות
        setTaskColumns(columns.filter(col => {
          if (col.type !== 'board_relation') return false;
          if (filterByTaskBoard) {
            try {
              const raw = col.settings;
              const columnSettings = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {});
              const boardIds = (columnSettings.boardIds || []).map(String);
              return boardIds.includes(String(filterByTaskBoard));
            } catch (e) {
              logger.warn('MappingTab', 'Failed to parse task column settings', { columnId: col.id, error: e?.message });
              return false;
            }
          }
          return true;
        }).map(col => ({ id: col.id, name: columnSelectLabel(col) })));
        
        // עמודות קישור להקצאה - כל עמודות board_relation (ללא סינון)
        const allBoardRelationCols = columns.filter(col => col.type === 'board_relation').map(col => ({ id: col.id, name: columnSelectLabel(col) }));
        setAssignmentColumns(allBoardRelationCols);
        // עמודות לקוח בלוח דיווחים - כל board_relation (ללא סינון)
        setCustomerReportColumns(allBoardRelationCols);
        
        // טעינת לייבלים של עמודת סוג דיווח אם כבר נבחרה
        if (settings.eventTypeStatusColumnId) {
          const selectedCol = columns.find(col => col.id === settings.eventTypeStatusColumnId);
          if (selectedCol?.settings) {
            const labels = parseStatusColumnLabels(selectedCol.settings);
            setEventTypeStatusLabels(labels.map(l => ({ id: String(l.id), name: l.label, color: l.color || '' })));
            // ולידציה של המיפוי הנוכחי
            if (settings.eventTypeMapping) {
              const validation = smartValidateMapping(settings.eventTypeMapping, !!settings.enableProjectTypeDistinction);
              setEventTypeValidation({ isValid: validation.isValid, missingLabels: validation.errors });
            }
          }
        }
      }
    } catch (err) {
      showErrorWithDetails(err, { functionName: 'fetchCurrentBoardColumns' });
    } finally {
      setLoadingCurrentBoardColumns(false);
    }
  };

  const fetchProjectStatusColumns = async (boardId, selectedColumnId = null) => {
    if (!boardId) {
      setProjectStatusColumns([]);
      setProjectStatusLabels([]);
      return;
    }
    setLoadingProjectStatusColumns(true);
    try {
      const statusCols = await fetchStatusColumnsFromBoard(monday, boardId);
      setProjectStatusColumns(statusCols.map(col => ({ id: col.id, name: columnSelectLabel(col), settings: col.settings })));
      
      if (selectedColumnId) {
        const selectedCol = statusCols.find(col => col.id === selectedColumnId);
        if (selectedCol) {
          const labels = parseStatusLabels(selectedCol.settings);
          setProjectStatusLabels(labels.map(l => ({ id: l.label, name: l.label })));
        }
      }
    } catch (err) {
      showErrorWithDetails(err, { functionName: 'fetchProjectStatusColumns' });
      setProjectStatusColumns([]);
    } finally {
      setLoadingProjectStatusColumns(false);
    }
  };

  const fetchTaskStatusColumns = async (boardId, selectedColumnId = null) => {
    if (!boardId) {
      setTaskStatusColumns([]);
      setTaskStatusLabels([]);
      return;
    }
    setLoadingTaskStatusColumns(true);
    try {
      const statusCols = await fetchStatusColumnsFromBoard(monday, boardId);
      setTaskStatusColumns(statusCols.map(col => ({ id: col.id, name: columnSelectLabel(col), settings: col.settings })));
      
      if (selectedColumnId) {
        const selectedCol = statusCols.find(col => col.id === selectedColumnId);
        if (selectedCol) {
          const labels = parseStatusLabels(selectedCol.settings);
          setTaskStatusLabels(labels.map(l => ({ id: l.label, name: l.label })));
        }
      }
    } catch (err) {
      showErrorWithDetails(err, { functionName: 'fetchTaskStatusColumns' });
      setTaskStatusColumns([]);
    } finally {
      setLoadingTaskStatusColumns(false);
    }
  };

  const fetchProjectStatusLabels = (columnId) => {
    if (!columnId) {
      setProjectStatusLabels([]);
      return;
    }
    const selectedCol = projectStatusColumns.find(col => col.id === columnId);
    if (selectedCol?.settings) {
      const labels = parseStatusLabels(selectedCol.settings);
      setProjectStatusLabels(labels.map(l => ({ id: l.label, name: l.label })));
    } else {
      setProjectStatusLabels([]);
    }
  };

  const fetchTaskStatusLabels = (columnId) => {
    if (!columnId) {
      setTaskStatusLabels([]);
      return;
    }
    const selectedCol = taskStatusColumns.find(col => col.id === columnId);
    if (selectedCol?.settings) {
      const labels = parseStatusLabels(selectedCol.settings);
      setTaskStatusLabels(labels.map(l => ({ id: l.label, name: l.label })));
    } else {
      setTaskStatusLabels([]);
    }
  };

  // טעינת עמודות לוח הקצאות
  const fetchAssignmentBoardColumns = async (boardId) => {
    if (!boardId) {
      setAssignmentPersonColumns([]);
      setAssignmentDateColumns([]);
      setAssignmentBoardRelationColumns([]);
      return;
    }
    setLoadingAssignmentColumns(true);
    try {
      const query = `query { boards(ids: [${boardId}]) { columns { id title type settings } } }`;
      const res = await safeApi(monday, 'MappingTab.fetchAssignmentBoardColumns', query);
      if (res.data?.boards?.[0]) {
        const columns = res.data.boards[0].columns;
        setAssignmentPersonColumns(columns.filter(col => col.type === 'people').map(col => ({ id: col.id, name: columnSelectLabel(col) })));
        setAssignmentDateColumns(columns.filter(col => col.type === 'date').map(col => ({ id: col.id, name: columnSelectLabel(col) })));
        setAssignmentBoardRelationColumns(columns.filter(col => col.type === 'board_relation').map(col => ({ id: col.id, name: columnSelectLabel(col) })));
      }
    } catch (err) {
      showErrorWithDetails(err, { functionName: 'fetchAssignmentBoardColumns' });
      setAssignmentPersonColumns([]);
      setAssignmentDateColumns([]);
      setAssignmentBoardRelationColumns([]);
    } finally {
      setLoadingAssignmentColumns(false);
    }
  };

  // טעינת עמודות לוח החופשות (Day-off) — people/date/status (סטטוס כולל settings לחילוץ תוויות)
  const fetchDayOffBoardColumns = async (boardId) => {
    if (!boardId) {
      setDayOffPeopleColumns([]);
      setDayOffDateColumns([]);
      setDayOffStatusColumns([]);
      return;
    }
    setLoadingDayOffColumns(true);
    try {
      const query = `query { boards(ids: [${boardId}]) { columns { id title type settings } } }`;
      const res = await safeApi(monday, 'MappingTab.fetchDayOffBoardColumns', query);
      if (res.data?.boards?.[0]) {
        const columns = res.data.boards[0].columns;
        setDayOffPeopleColumns(columns.filter(col => col.type === 'people').map(col => ({ id: col.id, name: columnSelectLabel(col) })));
        setDayOffDateColumns(columns.filter(col => col.type === 'date').map(col => ({ id: col.id, name: columnSelectLabel(col) })));
        setDayOffStatusColumns(columns.filter(col => col.type === 'status').map(col => ({
          id: col.id,
          name: columnSelectLabel(col),
          settings: col.settings
        })));
      }
    } catch (err) {
      showErrorWithDetails(err, { functionName: 'fetchDayOffBoardColumns' });
      setDayOffPeopleColumns([]);
      setDayOffDateColumns([]);
      setDayOffStatusColumns([]);
    } finally {
      setLoadingDayOffColumns(false);
    }
  };

  // טעינת עמודות mirror מלוח הקצאות
  // eslint-disable-next-line no-unused-vars -- פיצ'ר רדום: לא מחובר ל-UI כרגע
  const fetchAssignmentMirrorColumns = async (boardId) => {
    if (!boardId) {
      setAssignmentMirrorColumns([]);
      return;
    }
    setLoadingMirrorColumns(true);
    try {
      const query = `query { boards(ids: [${boardId}]) { columns { id title type settings } } }`;
      const res = await safeApi(monday, 'MappingTab.fetchAssignmentMirrorColumns', query);
      if (res.data?.boards?.[0]) {
        const cols = res.data.boards[0].columns
          .filter(col => col.type === 'mirror')
          .map(col => ({ id: col.id, name: columnSelectLabel(col) }));
        setAssignmentMirrorColumns(cols);
      }
    } catch (err) {
      showErrorWithDetails(err, { functionName: 'fetchAssignmentMirrorColumns' });
      setAssignmentMirrorColumns([]);
    } finally {
      setLoadingMirrorColumns(false);
    }
  };

  // טעינת לייבלים של עמודת סוג פרויקט
  const loadProjectTypeLabels = async (columnId, isAssignments) => {
    if (!columnId) {
      setProjectTypeLabels([]);
      return;
    }
    setLoadingProjectTypeLabels(true);
    try {
      // בשני המצבים (ישיר והקצאות) — עמודת סוג הפרויקט תמיד בלוח הפרויקטים
      const selectedCol = projectStatusColumns.find(col => col.id === columnId);
      if (selectedCol?.settings) {
        const labels = parseStatusLabels(selectedCol.settings);
        setProjectTypeLabels(labels.map(l => ({
          id: String(l.id ?? l.index ?? l.label), // id קבוע — עמיד לסידור/מחיקה
          label: l.label,
          color: mondayColorToHex(l.color) || ''
        })));
      } else {
        setProjectTypeLabels([]);
      }
    } catch (err) {
      showErrorWithDetails(err, { functionName: 'loadProjectTypeLabels' });
      setProjectTypeLabels([]);
    } finally {
      setLoadingProjectTypeLabels(false);
    }
  };

  // שינוי עמודת סוג פרויקט
  const handleProjectTypeColumnChange = (newColumnId) => {
    const isAssignments = !!settings.useAssignmentsMode;
    onChange({
      projectTypeColumnId: newColumnId,
      projectTypeMapping: null,
      projectTypeSourceBoardId: null,
      projectTypeSourceColumnId: null
    });
    if (newColumnId) {
      loadProjectTypeLabels(newColumnId, isAssignments);
    } else {
      setProjectTypeLabels([]);
    }
  };

  // שינוי מיפוי לייבל סוג פרויקט
  const handleProjectTypeLabelMappingChange = (labelText, role) => {
    const currentMapping = { ...(settings.projectTypeMapping || {}) };

    if (role === 'unmapped') {
      delete currentMapping[labelText];
    } else {
      // הסרת role קודם אם קיים (כל role חד-פעמי)
      for (const [key, val] of Object.entries(currentMapping)) {
        if (val === role) delete currentMapping[key];
      }
      currentMapping[labelText] = role;
    }

    onChange({ projectTypeMapping: Object.keys(currentMapping).length > 0 ? currentMapping : null });
  };

  // --- Handlers ---

  const handleConnectedBoardChange = (newBoardId) => {
    onChange({
      connectedBoardId: newBoardId,
      peopleColumnIds: [],
      tasksProjectColumnId: '',
      tasksBoardId: '',
      projectStatusColumnId: '',
      projectActiveStatusValues: [],
      customerColumnId: null
    });
    setPeopleColumns([]);
    setTasksProjectColumns([]);
    setTaskBoards([]);
    setProjectStatusColumns([]);
    setProjectStatusLabels([]);
    
    if (newBoardId) {
      fetchPeopleColumns(newBoardId);
      fetchProjectTasksColumns(newBoardId);
    }
  };

  const handleTasksProjectColumnChange = (newColumnId) => {
    onChange({
      tasksProjectColumnId: newColumnId,
      tasksBoardId: '',
      taskColumnId: ''
    });
    setTaskBoards([]);
    if (newColumnId) {
      extractTaskBoardsFromColumn(newColumnId, settings.connectedBoardId);
    }
  };

  const handleTasksBoardChange = (newBoardId) => {
    onChange({
      tasksBoardId: newBoardId,
      taskColumnId: '',
      taskStatusColumnId: '',
      taskActiveStatusValues: []
    });
    if (newBoardId && effectiveBoardId) {
      fetchCurrentBoardColumns(effectiveBoardId, settings.connectedBoardId, newBoardId);
    }
  };

  const handleProjectStatusFilterToggle = () => {
    const enabled = !settings.projectStatusFilterEnabled;
    onChange({
      projectStatusFilterEnabled: enabled,
      projectStatusColumnId: enabled ? settings.projectStatusColumnId : '',
      projectActiveStatusValues: enabled ? settings.projectActiveStatusValues : []
    });
    if (enabled && settings.connectedBoardId) {
      fetchProjectStatusColumns(settings.connectedBoardId);
    }
  };

  const handleProjectStatusColumnChange = (newColumnId) => {
    onChange({
      projectStatusColumnId: newColumnId,
      projectActiveStatusValues: []
    });
    fetchProjectStatusLabels(newColumnId);
  };

  const handleTaskStatusFilterToggle = () => {
    const enabled = !settings.taskStatusFilterEnabled;
    onChange({
      taskStatusFilterEnabled: enabled,
      taskStatusColumnId: enabled ? settings.taskStatusColumnId : '',
      taskActiveStatusValues: enabled ? settings.taskActiveStatusValues : []
    });
    if (enabled && settings.tasksBoardId) {
      fetchTaskStatusColumns(settings.tasksBoardId);
    }
  };

  const handleTaskStatusColumnChange = (newColumnId) => {
    onChange({
      taskStatusColumnId: newColumnId,
      taskActiveStatusValues: []
    });
    fetchTaskStatusLabels(newColumnId);
  };

  // שינוי לוח הקצאות - איפוס כל העמודות
  const handleAssignmentsBoardChange = (newBoardId) => {
    onChange({
      assignmentsBoardId: newBoardId,
      assignmentPersonColumnId: '',
      assignmentStartDateColumnId: '',
      assignmentEndDateColumnId: '',
      assignmentProjectLinkColumnId: ''
    });
    setAssignmentPersonColumns([]);
    setAssignmentDateColumns([]);
    setAssignmentBoardRelationColumns([]);

    if (newBoardId) {
      fetchAssignmentBoardColumns(newBoardId);
    }
  };

  // שינוי לוח חופשות (Day-off) - איפוס כל מיפוי העמודות והתוויות
  const handleDayOffBoardChange = (newBoardId) => {
    onChange({
      dayOffBoardId: newBoardId || null,
      dayOffPersonColumnId: null,
      dayOffStartDateColumnId: null,
      dayOffEndDateColumnId: null,
      dayOffKindColumnId: null,
      dayOffKindGeneralLabelId: null,
      dayOffKindPersonalLabelId: null,
      dayOffTypeColumnId: null,
      dayOffApprovalColumnId: null,
      dayOffApprovedLabelIds: [],
      dayOffPendingLabelIds: [],
      dayOffRejectedLabelIds: []
    });
    setDayOffPeopleColumns([]);
    setDayOffDateColumns([]);
    setDayOffStatusColumns([]);

    if (newBoardId) {
      fetchDayOffBoardColumns(newBoardId);
    }
  };

  // שינוי עמודת סוג רשומה (אישי/כללי) בלוח החופשות - איפוס בחירת התוויות
  const handleDayOffKindColumnChange = (newColumnId) => {
    onChange({
      dayOffKindColumnId: newColumnId || null,
      dayOffKindGeneralLabelId: null,
      dayOffKindPersonalLabelId: null
    });
  };

  // שינוי עמודת סטטוס אישור בלוח החופשות - איפוס בחירת התוויות
  const handleDayOffApprovalColumnChange = (newColumnId) => {
    onChange({
      dayOffApprovalColumnId: newColumnId || null,
      dayOffApprovedLabelIds: [],
      dayOffPendingLabelIds: [],
      dayOffRejectedLabelIds: []
    });
  };

  // ולידציה של עמודת סוג דיווח + חילוץ לייבלים + ניסיון מיגרציה אוטומטית
  const handleEventTypeColumnChange = (newColumnId) => {
    // החלפת עמודה (כולל ניקוי לבחירה ריקה) — מנקים את המיפוי וה-meta הישנים כדי
    // שלא יישארו רשומות יתומות שמצביעות על לייבלים שכבר לא קיימים בעמודה החדשה.
    const columnChanged = newColumnId !== settings.eventTypeStatusColumnId;
    const enableDistinction = !!settings.enableProjectTypeDistinction;

    if (!newColumnId) {
      onChange({ eventTypeStatusColumnId: null, eventTypeMapping: null, eventTypeLabelMeta: null });
      setEventTypeValidation({ isValid: true, missingLabels: [] });
      setEventTypeStatusLabels([]);
      return;
    }

    const selectedCol = statusColumnsWithSettings.find(col => col.id === newColumnId);
    const baseUpdate = columnChanged
      ? { eventTypeStatusColumnId: newColumnId, eventTypeMapping: null, eventTypeLabelMeta: null }
      : { eventTypeStatusColumnId: newColumnId };

    if (!selectedCol?.settings) {
      onChange(baseUpdate);
      setEventTypeValidation({ isValid: true, missingLabels: [] });
      setEventTypeStatusLabels([]);
      return;
    }

    const labels = parseStatusColumnLabels(selectedCol.settings);
    setEventTypeStatusLabels(labels.map(l => ({ id: String(l.id), name: l.label, color: l.color || '' })));

    // אחרי ניקוי (או אם אין מיפוי) — ניסיון מיגרציה אוטומטית, רק כשהבחנה כבויה.
    // במצב הבחנה אין מיגרציה אוטומטית; המשתמש ימפה ידנית.
    const hasExistingMapping = !columnChanged && !!settings.eventTypeMapping;
    if (!hasExistingMapping && !enableDistinction) {
      const result = createLegacyMapping(labels);
      if (result) {
        onChange({
          ...baseUpdate,
          eventTypeMapping: result.mapping,
          eventTypeLabelMeta: result.labelMeta
        });
        const validation = smartValidateMapping(result.mapping, enableDistinction);
        setEventTypeValidation({ isValid: validation.isValid, missingLabels: validation.errors });
        return;
      }
    }

    onChange(baseUpdate);

    // ולידציה של המיפוי הנוכחי (אם נשמר; אחרת — דורש מיפוי)
    if (hasExistingMapping) {
      const validation = smartValidateMapping(settings.eventTypeMapping, enableDistinction);
      setEventTypeValidation({ isValid: validation.isValid, missingLabels: validation.errors });
    } else {
      setEventTypeValidation({ isValid: false, missingLabels: [t('settings.mapping.validation.eventTypeMappingRequired')] });
    }
  };

  // טעינת לייבלים של עמודת סוג דיווח בעת טעינה ראשונית
  useEffect(() => {
    if (settings.eventTypeStatusColumnId && statusColumnsWithSettings.length > 0) {
      const selectedCol = statusColumnsWithSettings.find(col => col.id === settings.eventTypeStatusColumnId);
      if (selectedCol?.settings) {
        const labels = parseStatusColumnLabels(selectedCol.settings);
        setEventTypeStatusLabels(labels.map(l => ({ id: String(l.id), name: l.label, color: l.color || '' })));
      }
    }
  }, [settings.eventTypeStatusColumnId, statusColumnsWithSettings]);

  // יצירת עמודת סוג דיווח חדשה
  const handleCreateEventTypeColumn = async () => {
    if (!effectiveBoardId) return;

    setIsCreatingEventTypeColumn(true);
    try {
      const newColumnId = await createEventTypeStatusColumn(monday, effectiveBoardId);
      if (newColumnId) {
        // רענון רשימת העמודות
        await fetchCurrentBoardColumns(effectiveBoardId, settings.connectedBoardId, settings.tasksBoardId);
        // בחירת העמודה החדשה + ניקוי מיפוי/meta ישנים (העמודה החדשה מתחילה ריקה)
        onChange({ eventTypeStatusColumnId: newColumnId, eventTypeMapping: null, eventTypeLabelMeta: null });
        setEventTypeValidation({ isValid: true, missingLabels: [] });
        logger.info('MappingTab', 'Created new event type column', { newColumnId });
      }
    } catch (err) {
      showErrorWithDetails(err, { functionName: 'handleCreateEventTypeColumn' });
    } finally {
      setIsCreatingEventTypeColumn(false);
    }
  };

  // טיפול בשינוי מיפוי של לייבל בודד
  const handleMappingLabelChange = (labelIndex, category) => {
    const currentMapping = { ...(settings.eventTypeMapping || {}) };
    const currentMeta = { ...(settings.eventTypeLabelMeta || {}) };

    if (category === UNMAPPED) {
      delete currentMapping[labelIndex];
      delete currentMeta[labelIndex];
    } else {
      currentMapping[labelIndex] = category;
      // עדכון מטא-דאטה
      const labelObj = eventTypeStatusLabels.find(l => l.id === labelIndex);
      if (labelObj) {
        currentMeta[labelIndex] = { label: labelObj.name, color: labelObj.color || '' };
      }
    }

    onChange({ eventTypeMapping: currentMapping, eventTypeLabelMeta: currentMeta });

    // ולידציה
    const enableDistinction = !!settings.enableProjectTypeDistinction;
    const validation = smartValidateMapping(currentMapping, enableDistinction);
    setEventTypeValidation({ isValid: validation.isValid, missingLabels: validation.errors });
  };

  // בדיקה אם קטגוריה חד-פעמית כבר תפוסה
  const isCategoryTaken = (category) => {
    if (!settings.eventTypeMapping) return false;
    const enableDistinction = !!settings.enableProjectTypeDistinction;
    if (!isSingleUseCategory(category, enableDistinction)) return false;
    return Object.values(settings.eventTypeMapping).filter(c => c === category).length >= 1;
  };

  // רנדור בלוק הבחנה פנימי/חיצוני — משותף לשני האקורדיונים
  const renderDistinctionBlock = () => {
    const isAssignments = !!settings.useAssignmentsMode;
    const isPortfolio = settings.projectsSourceMode === 'portfolio';
    // בשני המצבים — עמודת סוג הפרויקט היא תמיד בלוח הפרויקטים
    const columnOptions = projectStatusColumns;
    const columnLabel = t('settings.mapping.projectType.columnLabel');
    // במצב פורטפוליו — העמודה תמיד על לוח הפורטפוליו (connectedBoardId), ללא mirror,
    // גם אם אנחנו במצב הקצאות. רק במצב הקצאות-non-portfolio צריך mirror דרך עמודת קישור.
    const hasBoardId = isPortfolio
      ? !!settings.connectedBoardId
      : isAssignments
        ? (!!settings.assignmentsBoardId && !!settings.assignmentProjectLinkColumnId)
        : !!settings.connectedBoardId;
    const loading = loadingProjectStatusColumns;

    // roles לדרופדאון מיפוי
    const PROJECT_TYPE_ROLES = [
      { value: 'unmapped', label: t('settings.mapping.projectType.rolesUnmapped') },
      { value: 'internal', label: t('settings.mapping.projectType.rolesInternal') },
      { value: 'external', label: t('settings.mapping.projectType.rolesExternal') }
    ];

    return (
      <>
        <ToggleRow
          label={t('settings.mapping.projectType.toggleTitle')}
          description={t('settings.mapping.projectType.toggleDescription')}
          checked={!!settings.enableProjectTypeDistinction}
          onChange={() => {
            const newValue = !settings.enableProjectTypeDistinction;
            onChange({
              enableProjectTypeDistinction: newValue,
              eventTypeMapping: null,
              eventTypeLabelMeta: null,
              projectTypeColumnId: newValue ? settings.projectTypeColumnId : null,
              projectTypeMapping: null,
              projectTypeSourceBoardId: null,
              projectTypeSourceColumnId: null
            });
            setEventTypeValidation({ isValid: false, missingLabels: [t('settings.mapping.validation.eventTypeMappingRequired')] });
            setProjectTypeLabels([]);
          }}
        />

        {settings.enableProjectTypeDistinction && hasBoardId && (
          <FieldWrapper label={columnLabel} required>
            <SearchableSelect
              options={columnOptions}
              value={settings.projectTypeColumnId}
              onChange={handleProjectTypeColumnChange}
              placeholder={(isAssignments && !isPortfolio) ? t('settings.mapping.projectType.selectMirrorPlaceholder') : t('settings.mapping.projectType.selectStatusPlaceholder')}
              isLoading={loading}
              showSearch={false}
            />
          </FieldWrapper>
        )}

        {settings.enableProjectTypeDistinction && !hasBoardId && (
          <div className={styles.fieldDescription} style={{ color: 'var(--color-danger)' }}>
            {t('settings.mapping.projectType.needBoardFirst')}
          </div>
        )}

        {/* מיפוי לייבלים */}
        {settings.enableProjectTypeDistinction && settings.projectTypeColumnId && projectTypeLabels.length > 0 && (
          <FieldWrapper label={t('settings.mapping.projectType.mappingLabel')} required>
            {loadingProjectTypeLabels ? (
              <div className={styles.fieldDescription}>{t('settings.mapping.projectType.loadingLabels')}</div>
            ) : (
              <div className={styles.mappingSection}>
                <div className={styles.projectTypeMapGrid}>
                  {projectTypeLabels.map(labelObj => {
                    // מפתח לפי id (index מספרי) — עמיד לשינוי טקסט
                    const currentRole = settings.projectTypeMapping?.[labelObj.id] || 'unmapped';
                    return (
                      <div key={labelObj.id} className={styles.projectTypeMapItem}>
                        <div className={styles.mappingRowLabelCell}>
                          {labelObj.color && (
                            <span
                              className={styles.mappingColorDot}
                              style={{ backgroundColor: labelObj.color }}
                              aria-hidden="true"
                            />
                          )}
                          <span className={styles.mappingLabelText}>{labelObj.label}</span>
                        </div>
                        <SearchableSelect
                          showSearch={false}
                          value={currentRole}
                          onChange={(val) => handleProjectTypeLabelMappingChange(labelObj.id, val)}
                          options={PROJECT_TYPE_ROLES.map(role => {
                            const isTaken = role.value !== 'unmapped' && role.value !== currentRole &&
                              settings.projectTypeMapping && Object.values(settings.projectTypeMapping).includes(role.value);
                            return {
                              id: role.value,
                              name: `${role.label}${isTaken ? t('settings.mapping.projectType.takenSuffix') : ''}`,
                              disabled: isTaken
                            };
                          })}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </FieldWrapper>
        )}
      </>
    );
  };

  // שינוי טוגל שימוש בלוח נוכחי
  const handleUseCurrentBoardToggle = () => {
    const newValue = !settings.useCurrentBoardForReporting;
    onChange({
      useCurrentBoardForReporting: newValue,
      // אם עוברים ללוח נוכחי, מאפסים את לוח הדיווחים
      timeReportingBoardId: newValue ? null : settings.timeReportingBoardId
    });
  };

  // שינוי לוח דיווחים
  const handleTimeReportingBoardChange = (newBoardId) => {
    onChange({
      timeReportingBoardId: newBoardId,
      // איפוס כל העמודות של לוח הדיווחים
      dateColumnId: '',
      endTimeColumnId: '',
      durationColumnId: '',
      projectColumnId: '',
      taskColumnId: '',
      assignmentColumnId: '',
      reporterColumnId: '',
      eventTypeStatusColumnId: '',
      nonBillableStatusColumnId: '',
      stageColumnId: '',
      notesColumnId: '',
      customerReportColumnId: null
    });

    // טעינת עמודות הלוח החדש
    if (newBoardId) {
      fetchCurrentBoardColumns(newBoardId, settings.connectedBoardId, settings.tasksBoardId);
    }
  };

  // --- Accordion Component ---
  const AccordionSection = ({ id, title, icon: Icon, children, isVisible = true, sectionId }) => {
    if (!isVisible) return null;
    const isOpen = openSection === id;
    const errorCount = sectionId ? countMappingSectionErrors(fieldErrors, sectionId) : 0;

    return (
      <div className={`${styles.accordion} ${isOpen ? styles.accordionOpen : ''}`}>
        <button 
          className={styles.accordionHeader}
          onClick={() => setOpenSection(isOpen ? null : id)}
          type="button"
        >
          <div className={styles.accordionTitle}>
            <div className={`${styles.accordionIcon} ${isOpen ? styles.accordionIconActive : ''}`}>
              <Icon size={20} />
            </div>
            <span className={styles.accordionTitleText}>{title}</span>
            {errorCount > 0 && (
              <span className={styles.accordionErrorDot} title={t('settings.mapping.validation.sectionHasErrors')} />
            )}
          </div>
          {isOpen ? <ChevronUp size={20} className={styles.chevron} /> : <ChevronDown size={20} className={styles.chevron} />}
        </button>
        
        {isOpen && (
          <div className={styles.accordionContent}>
            {children}
          </div>
        )}
      </div>
    );
  };

  // --- Field Wrapper Component ---
  const FieldWrapper = ({ label, required, description, error, children }) => (
    <div className={styles.fieldWrapper}>
      <label className={styles.fieldLabel}>
        {label} {required && <span className={styles.required}>*</span>}
      </label>
      {description && <p className={styles.fieldDescription}>{description}</p>}
      {children}
      {error && <p className={styles.fieldError}>{error}</p>}
    </div>
  );

  // --- Toggle Component ---
  const ToggleRow = ({ label, description, checked, onChange, disabled }) => (
    <div className={styles.toggleRow}>
      <div className={styles.toggleInfo}>
        <label className={styles.fieldLabel}>{label}</label>
        {description && <p className={styles.fieldDescription}>{description}</p>}
      </div>
      <button 
        className={`${styles.toggle} ${checked ? styles.toggleOn : ''} ${disabled ? styles.toggleDisabled : ''}`}
        onClick={() => !disabled && onChange()}
        disabled={disabled}
      >
        <span className={styles.toggleKnob} />
      </button>
    </div>
  );

  // טוגל מקור פרויקטים — לוח רגיל / פורטפוליו. מוצב בתוך הסקשן הפעיל
  // (פרויקטים או הקצאות) לפי useAssignmentsMode.
  const portfolioToggleBlock = (
    <div style={{ marginBottom: '16px' }}>
      <ToggleRow
        label={t('settings.mapping.portfolioToggle.title')}
        description={t('settings.mapping.portfolioToggle.description')}
        checked={settings.projectsSourceMode === 'portfolio'}
        onChange={() => {
          const next = settings.projectsSourceMode === 'portfolio' ? 'board' : 'portfolio';
          onChange({
            projectsSourceMode: next,
            connectedBoardId: null,
            tasksBoardId: null,
            tasksProjectColumnId: null,
          });
        }}
      />
      <p className={styles.fieldDescription} style={{ marginTop: '4px' }}>
        {settings.projectsSourceMode === 'portfolio'
          ? t('settings.mapping.portfolioToggle.infoPortfolioMode')
          : t('settings.mapping.portfolioToggle.infoBoardMode')}
      </p>
    </div>
  );

  return (
    <div className={styles.container}>
      {/* טוגל בחירה בין לוח פרויקטים ללוח הקצאות */}
      <div style={{ marginBottom: '24px' }}>
        <ToggleRow
          label={t('settings.mapping.assignmentsToggle.title')}
          description={t('settings.mapping.assignmentsToggle.description')}
          checked={settings.useAssignmentsMode}
          onChange={() => onChange({ useAssignmentsMode: !settings.useAssignmentsMode })}
        />
      </div>

      {/* סקשן 1: לוח פרויקטים — מוסתר במצב הקצאות (המקור מוגדר בסקשן ההקצאות) */}
      <AccordionSection id="projects" sectionId="projects" title={t('settings.mapping.projects.sectionTitle')} icon={Briefcase} isVisible={!settings.useAssignmentsMode}>
        {portfolioToggleBlock}
        <div className={settings.useAssignmentsMode ? styles.disabled : ''}>
          <FieldWrapper label={t('settings.mapping.projects.boardLabel')} required={!settings.useAssignmentsMode}>
            <SearchableSelect
              options={boards}
              value={settings.connectedBoardId}
              onChange={handleConnectedBoardChange}
              placeholder={t('settings.mapping.projects.boardPlaceholder')}
              isLoading={loadingBoards}
              disabled={settings.useAssignmentsMode}
            />
          </FieldWrapper>

          <FieldWrapper label={t('settings.mapping.projects.peopleColumnsLabel')} required={!settings.useAssignmentsMode}>
            <div className={(!settings.connectedBoardId || settings.useAssignmentsMode) ? styles.disabled : ''}>
              <MultiSelect
                options={peopleColumns}
                value={settings.peopleColumnIds}
                onChange={(ids) => onChange({ peopleColumnIds: ids })}
                placeholder={t('settings.mapping.projects.peopleColumnsPlaceholder')}
                isLoading={loadingPeopleColumns} 
                disabled={!settings.connectedBoardId || settings.useAssignmentsMode} 
              />
            </div>
          </FieldWrapper>
        </div>

        <ToggleRow
          label={t('settings.mapping.projects.statusFilterTitle')}
          checked={settings.projectStatusFilterEnabled}
          onChange={handleProjectStatusFilterToggle}
          disabled={!settings.connectedBoardId}
        />

        {settings.projectStatusFilterEnabled && (
          <>
            <FieldWrapper label={t('settings.mapping.projects.statusColumnLabel')} required>
              <SearchableSelect
                options={projectStatusColumns}
                value={settings.projectStatusColumnId}
                onChange={handleProjectStatusColumnChange}
                placeholder={t('settings.mapping.projects.statusColumnPlaceholder')}
                isLoading={loadingProjectStatusColumns}
                showSearch={false}
              />
            </FieldWrapper>

            {settings.projectStatusColumnId && (
              <FieldWrapper label={t('settings.mapping.projects.statusValuesLabel')} required>
                <MultiSelect
                  options={projectStatusLabels}
                  value={settings.projectActiveStatusValues}
                  onChange={(values) => onChange({ projectActiveStatusValues: values })}
                  placeholder={t('settings.mapping.projects.statusValuesPlaceholder')}
                />
              </FieldWrapper>
            )}
          </>
        )}

        {/* הבחנה פנימי/חיצוני */}
        {!settings.useAssignmentsMode && renderDistinctionBlock()}

        {/* עמודת לקוח - מצב ישיר (משתמש באותן עמודות board_relation מלוח פרויקטים) */}
        {!settings.useAssignmentsMode && settings.connectedBoardId && (
          <FieldWrapper label={t('settings.mapping.projects.customerColumnLabel')}>
            <SearchableSelect
              options={tasksProjectColumns}
              value={settings.customerColumnId}
              onChange={(id) => onChange({ customerColumnId: id || null })}
              placeholder={t('settings.mapping.projects.customerColumnPlaceholder')}
              isLoading={loadingTasksColumns}
              showSearch={false}
            />
          </FieldWrapper>
        )}
      </AccordionSection>

      {/* סקשן 2: לוח הקצאות */}
      <AccordionSection id="assignments" sectionId="assignments" title={t('settings.mapping.assignments.sectionTitle')} icon={CalendarCheck} isVisible={settings.useAssignmentsMode}>
        <div className={!settings.useAssignmentsMode ? styles.disabled : ''}>
          <p className={styles.fieldDescription} style={{ marginBottom: '16px' }}>
            {t('settings.mapping.assignments.description')}
          </p>

          <FieldWrapper label={t('settings.mapping.assignments.boardLabel')} required={settings.useAssignmentsMode}>
            <SearchableSelect
              options={boards}
              value={settings.assignmentsBoardId}
              onChange={handleAssignmentsBoardChange}
              placeholder={t('settings.mapping.assignments.boardPlaceholder')}
              isLoading={loadingBoards}
              disabled={!settings.useAssignmentsMode}
            />
          </FieldWrapper>

          {settings.assignmentsBoardId && (
            <>
              <FieldWrapper label={t('settings.mapping.assignments.peopleColumnLabel')} required={settings.useAssignmentsMode}>
                <SearchableSelect
                  options={assignmentPersonColumns}
                  value={settings.assignmentPersonColumnId}
                  onChange={(id) => onChange({ assignmentPersonColumnId: id })}
                  placeholder={t('settings.mapping.assignments.peopleColumnPlaceholder')}
                  isLoading={loadingAssignmentColumns}
                  showSearch={false}
                  disabled={!settings.useAssignmentsMode}
                />
              </FieldWrapper>

              <FieldWrapper label={t('settings.mapping.assignments.startDateColumnLabel')} required={settings.useAssignmentsMode}>
                <SearchableSelect
                  options={assignmentDateColumns}
                  value={settings.assignmentStartDateColumnId}
                  onChange={(id) => onChange({ assignmentStartDateColumnId: id })}
                  placeholder={t('settings.mapping.assignments.startDateColumnPlaceholder')}
                  isLoading={loadingAssignmentColumns}
                  showSearch={false}
                  disabled={!settings.useAssignmentsMode}
                />
              </FieldWrapper>

              <FieldWrapper label={t('settings.mapping.assignments.endDateColumnLabel')} required={settings.useAssignmentsMode}>
                <SearchableSelect
                  options={assignmentDateColumns}
                  value={settings.assignmentEndDateColumnId}
                  onChange={(id) => onChange({ assignmentEndDateColumnId: id })}
                  placeholder={t('settings.mapping.assignments.endDateColumnPlaceholder')}
                  isLoading={loadingAssignmentColumns}
                  showSearch={false}
                  disabled={!settings.useAssignmentsMode}
                />
              </FieldWrapper>

              <FieldWrapper label={t('settings.mapping.assignments.projectLinkColumnLabel')} required={settings.useAssignmentsMode}>
                <SearchableSelect
                  options={assignmentBoardRelationColumns}
                  value={settings.assignmentProjectLinkColumnId}
                  onChange={(id) => onChange({ assignmentProjectLinkColumnId: id })}
                  placeholder={t('settings.mapping.assignments.projectLinkColumnPlaceholder')}
                  isLoading={loadingAssignmentColumns}
                  showSearch={false}
                  disabled={!settings.useAssignmentsMode}
                />
              </FieldWrapper>
            </>
          )}
        </div>

        {/* תת-בלוק "פרויקטים" — כל הגדרות הפרויקטים בתוך מצב הקצאות */}
        {settings.useAssignmentsMode && (
          <div className={styles.subSection}>
            <div className={styles.subSectionTitle}>
              <Briefcase size={16} />
              {t('settings.mapping.assignments.projectsSubSectionTitle')}
            </div>

            {portfolioToggleBlock}

            <FieldWrapper label={t('settings.mapping.projects.boardLabel')}>
              <SearchableSelect
                options={boards}
                value={settings.connectedBoardId}
                onChange={handleConnectedBoardChange}
                placeholder={t('settings.mapping.projects.boardPlaceholder')}
                isLoading={loadingBoards}
              />
            </FieldWrapper>

            <ToggleRow
              label={t('settings.mapping.projects.statusFilterTitle')}
              checked={settings.projectStatusFilterEnabled}
              onChange={handleProjectStatusFilterToggle}
              disabled={!settings.connectedBoardId}
            />

            {settings.projectStatusFilterEnabled && (
              <>
                <FieldWrapper label={t('settings.mapping.projects.statusColumnLabel')} required>
                  <SearchableSelect
                    options={projectStatusColumns}
                    value={settings.projectStatusColumnId}
                    onChange={handleProjectStatusColumnChange}
                    placeholder={t('settings.mapping.projects.statusColumnPlaceholder')}
                    isLoading={loadingProjectStatusColumns}
                    showSearch={false}
                  />
                </FieldWrapper>

                {settings.projectStatusColumnId && (
                  <FieldWrapper label={t('settings.mapping.projects.statusValuesLabel')} required>
                    <MultiSelect
                      options={projectStatusLabels}
                      value={settings.projectActiveStatusValues}
                      onChange={(values) => onChange({ projectActiveStatusValues: values })}
                      placeholder={t('settings.mapping.projects.statusValuesPlaceholder')}
                    />
                  </FieldWrapper>
                )}
              </>
            )}

            {renderDistinctionBlock()}

            {/* עמודת לקוח — מלוח הפרויקטים (גם במצב הקצאות) */}
            {settings.connectedBoardId && (
              <FieldWrapper label={t('settings.mapping.projects.customerColumnLabel')}>
                <SearchableSelect
                  options={tasksProjectColumns}
                  value={settings.customerColumnId}
                  onChange={(id) => onChange({ customerColumnId: id || null })}
                  placeholder={t('settings.mapping.projects.customerColumnPlaceholder')}
                  isLoading={loadingTasksColumns}
                  showSearch={false}
                />
              </FieldWrapper>
            )}
          </div>
        )}
      </AccordionSection>

      {/* סקשן 3: לוח משימות (מותנה) */}
      <AccordionSection
        id="tasks"
        sectionId="tasks"
        title={t('settings.mapping.tasks.sectionTitle')}
        icon={ListTodo}
        isVisible={hasTasks}
      >
        {/* במצב Portfolio: לוח-המשימות + עמודת קישור מזוהים אוטומטית, אין צורך לבחור. */}
        {settings.projectsSourceMode === 'portfolio' ? (
          <p className={styles.fieldDescription} style={{ marginBottom: '12px' }}>
            {t('settings.mapping.portfolioToggle.infoPortfolioMode')}
          </p>
        ) : (
          <>
            <FieldWrapper label={t('settings.mapping.tasks.projectTasksColumnLabel')} required>
              <div className={!settings.connectedBoardId ? styles.disabled : ''}>
                <SearchableSelect
                  options={tasksProjectColumns}
                  value={settings.tasksProjectColumnId}
                  onChange={handleTasksProjectColumnChange}
                  placeholder={t('settings.mapping.tasks.projectTasksColumnPlaceholder')}
                  isLoading={loadingTasksColumns}
                  disabled={!settings.connectedBoardId}
                  showSearch={false}
                />
              </div>
            </FieldWrapper>

            {settings.tasksProjectColumnId && (
              <FieldWrapper label={t('settings.mapping.tasks.boardLabel')} required>
                <SearchableSelect
                  options={taskBoards}
                  value={settings.tasksBoardId}
                  onChange={handleTasksBoardChange}
                  placeholder={t('settings.mapping.tasks.boardPlaceholder')}
                  showSearch={false}
                />
              </FieldWrapper>
            )}
          </>
        )}

        {(settings.tasksBoardId || settings.projectsSourceMode === 'portfolio') && (
          <>
            <ToggleRow
              label={t('settings.mapping.tasks.statusFilterTitle')}
              checked={settings.taskStatusFilterEnabled}
              onChange={handleTaskStatusFilterToggle}
            />

            {settings.taskStatusFilterEnabled && (
              <>
                <FieldWrapper
                  label={t('settings.mapping.tasks.statusColumnLabel')}
                  required
                >
                  <SearchableSelect
                    options={taskStatusColumns}
                    value={settings.taskStatusColumnId}
                    onChange={handleTaskStatusColumnChange}
                    placeholder={t('settings.mapping.tasks.statusColumnPlaceholder')}
                    isLoading={loadingTaskStatusColumns}
                    showSearch={false}
                  />
                </FieldWrapper>

                {settings.taskStatusColumnId && (
                  <FieldWrapper label={t('settings.mapping.tasks.statusValuesLabel')} required>
                    <MultiSelect
                      options={taskStatusLabels}
                      value={settings.taskActiveStatusValues}
                      onChange={(values) => onChange({ taskActiveStatusValues: values })}
                      placeholder={t('settings.mapping.tasks.statusValuesPlaceholder')}
                    />
                  </FieldWrapper>
                )}
              </>
            )}
          </>
        )}
      </AccordionSection>

      {/* סקשן 4: לוח דיווחי שעות */}
      <AccordionSection id="timesheet" sectionId="timesheet" title={t('settings.mapping.timesheet.sectionTitle')} icon={Table}>
        <ToggleRow
          label={t('settings.mapping.timesheet.useCurrentBoardTitle')}
          description={t('settings.mapping.timesheet.useCurrentBoardDescription')}
          checked={settings.useCurrentBoardForReporting}
          onChange={handleUseCurrentBoardToggle}
          disabled={!hasContextBoard}
        />

        {(!settings.useCurrentBoardForReporting || !hasContextBoard) && (
          <FieldWrapper
            label={t('settings.mapping.timesheet.boardLabel')}
            required
            description={!hasContextBoard ? t('settings.mapping.timesheet.boardCustomObjectDescription') : undefined}
          >
            <SearchableSelect
              options={boards}
              value={settings.timeReportingBoardId}
              onChange={handleTimeReportingBoardChange}
              placeholder={t('settings.mapping.timesheet.boardPlaceholder')}
              isLoading={loadingBoards}
            />
          </FieldWrapper>
        )}

        {!effectiveBoardId && (
          <p className={styles.warning}>{t('settings.mapping.timesheet.noBoardWarning')}</p>
        )}

        <FieldWrapper label={t('settings.mapping.timesheet.projectLinkColumnLabel')} required>
          <div className={!effectiveBoardId ? styles.disabled : ''}>
            <SearchableSelect
              options={projectColumns}
              value={settings.projectColumnId}
              onChange={(id) => onChange({ projectColumnId: id })}
              placeholder={t('settings.mapping.timesheet.projectLinkColumnPlaceholder')}
              isLoading={loadingCurrentBoardColumns}
              showSearch={false}
            />
          </div>
        </FieldWrapper>

        {hasTasks && (settings.tasksBoardId || settings.projectsSourceMode === 'portfolio') && (
          <FieldWrapper label={t('settings.mapping.timesheet.taskLinkColumnLabel')} required>
            <div className={!effectiveBoardId ? styles.disabled : ''}>
              <SearchableSelect
                options={taskColumns}
                value={settings.taskColumnId}
                onChange={(id) => onChange({ taskColumnId: id })}
                placeholder={t('settings.mapping.timesheet.taskLinkColumnPlaceholder')}
                isLoading={loadingCurrentBoardColumns}
                showSearch={false}
              />
            </div>
          </FieldWrapper>
        )}

        {settings.useAssignmentsMode && settings.assignmentsBoardId && (
          <FieldWrapper label={t('settings.mapping.timesheet.assignmentLinkColumnLabel')} required>
            <div className={!effectiveBoardId ? styles.disabled : ''}>
              <SearchableSelect
                options={assignmentColumns}
                value={settings.assignmentColumnId}
                onChange={(id) => onChange({ assignmentColumnId: id })}
                placeholder={t('settings.mapping.timesheet.assignmentLinkColumnPlaceholder')}
                isLoading={loadingCurrentBoardColumns}
                showSearch={false}
              />
            </div>
          </FieldWrapper>
        )}

        <FieldWrapper label={t('settings.mapping.timesheet.startDateColumnLabel')} required>
          <div className={!effectiveBoardId ? styles.disabled : ''}>
            <SearchableSelect
              options={dateColumns}
              value={settings.dateColumnId}
              onChange={(id) => onChange({ dateColumnId: id })}
              placeholder={t('settings.mapping.timesheet.startDateColumnPlaceholder')}
              isLoading={loadingCurrentBoardColumns}
              showSearch={false}
            />
          </div>
        </FieldWrapper>

        <FieldWrapper label={t('settings.mapping.timesheet.endDateColumnLabel')} required>
          <div className={!effectiveBoardId ? styles.disabled : ''}>
            <SearchableSelect
              options={dateColumns}
              value={settings.endTimeColumnId}
              onChange={(id) => onChange({ endTimeColumnId: id })}
              placeholder={t('settings.mapping.timesheet.endDateColumnPlaceholder')}
              isLoading={loadingCurrentBoardColumns}
              showSearch={false}
            />
          </div>
          <p className={styles.fieldDescription}>{t('settings.mapping.timesheet.endDateColumnDescription')}</p>
        </FieldWrapper>

        <FieldWrapper label={t('settings.mapping.timesheet.durationColumnLabel')} required>
          <div className={!effectiveBoardId ? styles.disabled : ''}>
            <SearchableSelect
              options={durationColumns}
              value={settings.durationColumnId}
              onChange={(id) => onChange({ durationColumnId: id })}
              placeholder={t('settings.mapping.timesheet.durationColumnPlaceholder')}
              isLoading={loadingCurrentBoardColumns}
              showSearch={false}
            />
          </div>
        </FieldWrapper>

        <FieldWrapper label={t('settings.mapping.timesheet.reporterColumnLabel')} required>
          <div className={!effectiveBoardId ? styles.disabled : ''}>
            <SearchableSelect
              options={reporterColumns}
              value={settings.reporterColumnId}
              onChange={(id) => onChange({ reporterColumnId: id })}
              placeholder={t('settings.mapping.timesheet.reporterColumnPlaceholder')}
              isLoading={loadingCurrentBoardColumns}
              showSearch={false}
            />
          </div>
        </FieldWrapper>

        <FieldWrapper label={t('settings.mapping.timesheet.eventTypeColumnLabel')} required>
          <div className={!effectiveBoardId ? styles.disabled : ''}>
            <SearchableSelect
              options={statusColumns}
              value={settings.eventTypeStatusColumnId}
              onChange={handleEventTypeColumnChange}
              placeholder={t('settings.mapping.timesheet.eventTypeColumnPlaceholder')}
              isLoading={loadingCurrentBoardColumns}
              showSearch={false}
            />
          </div>
          {/* מיפוי סוגי דיווח */}
          {settings.eventTypeStatusColumnId && eventTypeStatusLabels.length > 0 && (
            <div className={styles.mappingSection}>
              <div className={styles.mappingSectionTitle}>{t('settings.mapping.timesheet.mappingSectionTitle')}</div>
              <small className={styles.mappingSectionDesc}>{t('settings.mapping.timesheet.mappingSectionDesc')}</small>
              <div className={styles.eventTypeMapGrid}>
                {eventTypeStatusLabels.map(labelObj => {
                  const currentCategory = (settings.eventTypeMapping || {})[labelObj.id] || UNMAPPED;
                  return (
                    <div key={labelObj.id} className={styles.eventTypeMapItem}>
                      <div className={styles.mappingRowLabelCell}>
                        <span
                          className={styles.mappingColorDot}
                          style={{ backgroundColor: labelObj.color || 'var(--color-border-medium)' }}
                          aria-hidden="true"
                        />
                        <span className={styles.mappingLabelText}>{labelObj.name}</span>
                      </div>
                      <SearchableSelect
                        showSearch={false}
                        value={currentCategory}
                        onChange={(val) => handleMappingLabelChange(labelObj.id, val)}
                        options={[
                          { id: UNMAPPED, name: t('settings.mapping.eventTypeCategories.unmapped') },
                          ...Object.keys(getCategoryLabels(!!settings.enableProjectTypeDistinction)).map(cat => ({
                            id: cat,
                            name: t(`settings.mapping.eventTypeCategories.${cat}`),
                            disabled: isCategoryTaken(cat) && currentCategory !== cat
                          }))
                        ]}
                      />
                    </div>
                  );
                })}
              </div>
              {/* ולידציה */}
              {eventTypeValidation.isValid ? (
                <div className={styles.mappingValid}>{t('settings.mapping.timesheet.mappingValid')}</div>
              ) : (
                <div className={styles.mappingErrors}>
                  <AlertTriangle size={14} />
                  <div>
                    {eventTypeValidation.missingLabels.map((err, i) => (
                      <div key={i}>{err}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {!settings.eventTypeStatusColumnId && effectiveBoardId && (
            <button
              className={styles.createColumnButtonAlt}
              onClick={handleCreateEventTypeColumn}
              disabled={isCreatingEventTypeColumn}
            >
              {isCreatingEventTypeColumn ? t('settings.mapping.timesheet.creatingColumn') : t('settings.mapping.timesheet.createColumnButton')}
            </button>
          )}
        </FieldWrapper>

        <FieldWrapper label={t('settings.mapping.timesheet.temporaryCheckboxColumnLabel')} required>
          <div className={!effectiveBoardId ? styles.disabled : ''}>
            <SearchableSelect
              options={checkboxColumns}
              value={settings.temporaryCheckboxColumnId}
              onChange={(id) => onChange({ temporaryCheckboxColumnId: id || null })}
              placeholder={t('settings.mapping.timesheet.temporaryCheckboxColumnPlaceholder')}
              isLoading={loadingCurrentBoardColumns}
              showSearch={false}
            />
          </div>
          <p className={styles.fieldDescription}>{t('settings.mapping.timesheet.temporaryCheckboxColumnDescription')}</p>
        </FieldWrapper>

        {/* עמודת תת-סוג אירוע יומי — חובה רק כשמקור ההיעדרויות הוא ה-tracker (W4.5);
            במקור 'dayoff' סוגי החופשה מגיעים מלוח החופשות */}
        <FieldWrapper label={t('settings.mapping.timesheet.allDayTypeColumnLabel')} required={settings.absenceSource !== 'dayoff'}>
          <div className={!effectiveBoardId ? styles.disabled : ''}>
            <SearchableSelect
              options={statusColumns}
              value={settings.allDayTypeStatusColumnId}
              onChange={(id) => onChange({ allDayTypeStatusColumnId: id || null })}
              placeholder={t('settings.mapping.timesheet.allDayTypeColumnPlaceholder')}
              isLoading={loadingCurrentBoardColumns}
              showSearch={false}
            />
          </div>
          <p className={styles.fieldDescription}>{t('settings.mapping.timesheet.allDayTypeColumnDescription')}</p>
        </FieldWrapper>

        {hasNonBillableType && (
          <FieldWrapper label={t('settings.mapping.timesheet.nonBillableColumnLabel')} required>
            <div className={!effectiveBoardId ? styles.disabled : ''}>
              <SearchableSelect
                options={statusColumns}
                value={settings.nonBillableStatusColumnId}
                onChange={(id) => onChange({ nonBillableStatusColumnId: id })}
                placeholder={t('settings.mapping.timesheet.nonBillableColumnPlaceholder')}
                isLoading={loadingCurrentBoardColumns}
                showSearch={false}
              />
            </div>
          </FieldWrapper>
        )}

        {hasStage && (
          <FieldWrapper label={t('settings.mapping.timesheet.stageColumnLabel')} required>
            <div className={!effectiveBoardId ? styles.disabled : ''}>
              <SearchableSelect
                options={stageColumns}
                value={settings.stageColumnId}
                onChange={(id) => onChange({ stageColumnId: id })}
                placeholder={t('settings.mapping.timesheet.stageColumnPlaceholder')}
                isLoading={loadingCurrentBoardColumns}
                showSearch={false}
              />
            </div>
          </FieldWrapper>
        )}

        {hasNotes && (
          <FieldWrapper label={t('settings.mapping.timesheet.notesColumnLabel')}>
            <div className={!effectiveBoardId ? styles.disabled : ''}>
              <SearchableSelect
                options={textColumns}
                value={settings.notesColumnId}
                onChange={(id) => onChange({ notesColumnId: id })}
                placeholder={t('settings.mapping.timesheet.notesColumnPlaceholder')}
                isLoading={loadingCurrentBoardColumns}
                showSearch={false}
              />
            </div>
          </FieldWrapper>
        )}

        <FieldWrapper
          label={t('settings.mapping.timesheet.customerColumnLabel')}
          error={customerConfigWarning}
        >
          <div className={!effectiveBoardId ? styles.disabled : ''}>
            <SearchableSelect
              options={customerReportColumns}
              value={settings.customerReportColumnId}
              onChange={(id) => onChange({ customerReportColumnId: id || null })}
              placeholder={t('settings.mapping.timesheet.customerColumnPlaceholder')}
              isLoading={loadingCurrentBoardColumns}
              showSearch={false}
            />
          </div>
          <p className={styles.fieldDescription}>{t('settings.mapping.timesheet.customerColumnDescription')}</p>
        </FieldWrapper>
      </AccordionSection>

      {/* סקשן 5: לוח חופשות (Day-off) — משטח המיפוי הידני של מקור ההיעדרויות (D9, W4.5) */}
      <AccordionSection id="absences" sectionId="absences" title={t('settings.mapping.absences.sectionTitle')} icon={CalendarOff}>
        <p className={styles.fieldDescription} style={{ marginBottom: '16px' }}>
          {t('settings.mapping.absences.sectionDescription')}
        </p>

        <ToggleRow
          label={t('settings.mapping.absences.sourceToggleTitle')}
          description={t('settings.mapping.absences.sourceToggleDescription')}
          checked={settings.absenceSource === 'dayoff'}
          onChange={() => onChange({ absenceSource: settings.absenceSource === 'dayoff' ? 'tracker' : 'dayoff' })}
        />

        <ToggleRow
          label={t('settings.mapping.absences.showAbsencesTitle')}
          description={t('settings.mapping.absences.showAbsencesDescription')}
          checked={settings.showAbsences !== false}
          onChange={() => onChange({ showAbsences: !(settings.showAbsences !== false) })}
        />

        {/* קישור עומק לרכיב Day-off (W4.4/D5) — אופציונלי; מוצג בהודעת ההפניה במודל היומי */}
        <FieldWrapper
          label={t('settings.mapping.absences.appUrlLabel')}
          description={t('settings.mapping.absences.appUrlDescription')}
        >
          <input
            type="url"
            className={styles.urlInput}
            value={settings.dayOffAppUrl || ''}
            onChange={(e) => onChange({ dayOffAppUrl: e.target.value })}
            placeholder={t('settings.mapping.absences.appUrlPlaceholder')}
            dir="ltr"
          />
        </FieldWrapper>

        <FieldWrapper
          label={t('settings.mapping.absences.boardLabel')}
          required={settings.absenceSource === 'dayoff'}
          error={fieldErrors.dayOffBoardId}
        >
          <SearchableSelect
            options={boards}
            value={settings.dayOffBoardId}
            onChange={handleDayOffBoardChange}
            placeholder={t('settings.mapping.absences.boardPlaceholder')}
            isLoading={loadingBoards}
          />
        </FieldWrapper>

        {settings.dayOffBoardId && (
          <>
            <FieldWrapper
              label={t('settings.mapping.absences.personColumnLabel')}
              required={settings.absenceSource === 'dayoff'}
              error={fieldErrors.dayOffPersonColumnId}
            >
              <SearchableSelect
                options={dayOffPeopleColumns}
                value={settings.dayOffPersonColumnId}
                onChange={(id) => onChange({ dayOffPersonColumnId: id || null })}
                placeholder={t('settings.mapping.absences.personColumnPlaceholder')}
                isLoading={loadingDayOffColumns}
                showSearch={false}
              />
            </FieldWrapper>

            <FieldWrapper
              label={t('settings.mapping.absences.startDateColumnLabel')}
              required={settings.absenceSource === 'dayoff'}
              error={fieldErrors.dayOffStartDateColumnId}
            >
              <SearchableSelect
                options={dayOffDateColumns}
                value={settings.dayOffStartDateColumnId}
                onChange={(id) => onChange({ dayOffStartDateColumnId: id || null })}
                placeholder={t('settings.mapping.absences.startDateColumnPlaceholder')}
                isLoading={loadingDayOffColumns}
                showSearch={false}
              />
            </FieldWrapper>

            <FieldWrapper
              label={t('settings.mapping.absences.endDateColumnLabel')}
              required={settings.absenceSource === 'dayoff'}
              error={fieldErrors.dayOffEndDateColumnId}
            >
              <SearchableSelect
                options={dayOffDateColumns}
                value={settings.dayOffEndDateColumnId}
                onChange={(id) => onChange({ dayOffEndDateColumnId: id || null })}
                placeholder={t('settings.mapping.absences.endDateColumnPlaceholder')}
                isLoading={loadingDayOffColumns}
                showSearch={false}
              />
            </FieldWrapper>

            <FieldWrapper
              label={t('settings.mapping.absences.kindColumnLabel')}
              required={settings.absenceSource === 'dayoff'}
              error={fieldErrors.dayOffKindColumnId}
            >
              <SearchableSelect
                options={dayOffStatusColumns}
                value={settings.dayOffKindColumnId}
                onChange={handleDayOffKindColumnChange}
                placeholder={t('settings.mapping.absences.kindColumnPlaceholder')}
                isLoading={loadingDayOffColumns}
                showSearch={false}
              />
            </FieldWrapper>

            {/* בחירת תוויות "כללי"/"אישי" — נשמרות לפי label ID יציב, לא טקסט */}
            {settings.dayOffKindColumnId && dayOffKindLabels.length > 0 && (
              <>
                <FieldWrapper
                  label={t('settings.mapping.absences.kindGeneralLabelLabel')}
                  required={settings.absenceSource === 'dayoff'}
                  error={!settings.dayOffKindGeneralLabelId ? fieldErrors.dayOffKindLabels : undefined}
                >
                  <SearchableSelect
                    options={dayOffKindLabels.map(l => ({
                      ...l,
                      disabled: l.id === settings.dayOffKindPersonalLabelId
                    }))}
                    value={settings.dayOffKindGeneralLabelId}
                    onChange={(id) => onChange({ dayOffKindGeneralLabelId: id || null })}
                    placeholder={t('settings.mapping.absences.kindLabelPlaceholder')}
                    showSearch={false}
                  />
                </FieldWrapper>

                <FieldWrapper
                  label={t('settings.mapping.absences.kindPersonalLabelLabel')}
                  required={settings.absenceSource === 'dayoff'}
                  error={!settings.dayOffKindPersonalLabelId ? fieldErrors.dayOffKindLabels : undefined}
                >
                  <SearchableSelect
                    options={dayOffKindLabels.map(l => ({
                      ...l,
                      disabled: l.id === settings.dayOffKindGeneralLabelId
                    }))}
                    value={settings.dayOffKindPersonalLabelId}
                    onChange={(id) => onChange({ dayOffKindPersonalLabelId: id || null })}
                    placeholder={t('settings.mapping.absences.kindLabelPlaceholder')}
                    showSearch={false}
                  />
                </FieldWrapper>
              </>
            )}

            <FieldWrapper
              label={t('settings.mapping.absences.typeColumnLabel')}
              required={settings.absenceSource === 'dayoff'}
              error={fieldErrors.dayOffTypeColumnId}
            >
              <SearchableSelect
                options={dayOffStatusColumns}
                value={settings.dayOffTypeColumnId}
                onChange={(id) => onChange({ dayOffTypeColumnId: id || null })}
                placeholder={t('settings.mapping.absences.typeColumnPlaceholder')}
                isLoading={loadingDayOffColumns}
                showSearch={false}
              />
              <p className={styles.fieldDescription}>{t('settings.mapping.absences.typeColumnDescription')}</p>
            </FieldWrapper>

            <ToggleRow
              label={t('settings.mapping.absences.approvalToggleTitle')}
              description={t('settings.mapping.absences.approvalToggleDescription')}
              checked={!!settings.dayOffApprovalRequired}
              onChange={() => onChange({ dayOffApprovalRequired: !settings.dayOffApprovalRequired })}
            />

            {settings.dayOffApprovalRequired && (
              <>
                <FieldWrapper
                  label={t('settings.mapping.absences.approvalColumnLabel')}
                  required={settings.absenceSource === 'dayoff'}
                  error={fieldErrors.dayOffApprovalColumnId}
                >
                  <SearchableSelect
                    options={dayOffStatusColumns}
                    value={settings.dayOffApprovalColumnId}
                    onChange={handleDayOffApprovalColumnChange}
                    placeholder={t('settings.mapping.absences.approvalColumnPlaceholder')}
                    isLoading={loadingDayOffColumns}
                    showSearch={false}
                  />
                </FieldWrapper>

                {settings.dayOffApprovalColumnId && dayOffApprovalLabels.length > 0 && (
                  <>
                    <FieldWrapper
                      label={t('settings.mapping.absences.approvedLabelsLabel')}
                      required={settings.absenceSource === 'dayoff'}
                      error={fieldErrors.dayOffApprovedLabelIds}
                    >
                      <MultiSelect
                        options={dayOffApprovalLabels}
                        value={settings.dayOffApprovedLabelIds || []}
                        onChange={(ids) => onChange({ dayOffApprovedLabelIds: ids })}
                        placeholder={t('settings.mapping.absences.approvalLabelsPlaceholder')}
                      />
                    </FieldWrapper>

                    <FieldWrapper
                      label={t('settings.mapping.absences.pendingLabelsLabel')}
                      required={settings.absenceSource === 'dayoff'}
                      error={fieldErrors.dayOffPendingLabelIds}
                    >
                      <MultiSelect
                        options={dayOffApprovalLabels}
                        value={settings.dayOffPendingLabelIds || []}
                        onChange={(ids) => onChange({ dayOffPendingLabelIds: ids })}
                        placeholder={t('settings.mapping.absences.approvalLabelsPlaceholder')}
                      />
                    </FieldWrapper>

                    <FieldWrapper
                      label={t('settings.mapping.absences.rejectedLabelsLabel')}
                      description={t('settings.mapping.absences.rejectedLabelsDescription')}
                      error={fieldErrors.dayOffRejectedLabelIds}
                    >
                      <MultiSelect
                        options={dayOffApprovalLabels}
                        value={settings.dayOffRejectedLabelIds || []}
                        onChange={(ids) => onChange({ dayOffRejectedLabelIds: ids })}
                        placeholder={t('settings.mapping.absences.approvalLabelsPlaceholder')}
                      />
                    </FieldWrapper>
                  </>
                )}
              </>
            )}
          </>
        )}
      </AccordionSection>

    </div>
  );
};

export default MappingTab;
