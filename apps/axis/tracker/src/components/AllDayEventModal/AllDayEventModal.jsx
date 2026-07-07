import React, { useEffect, useState, useRef, useCallback } from 'react';
import { FileText, Plus, Minus, X, Clock, Calendar, ChevronDown, ExternalLink } from 'lucide-react';
import { differenceInDays } from 'date-fns';
import { useStableT } from '../../i18n/useStableT';
import { useSettings, FIELD_MODES, TOGGLE_MODES, DEFAULT_FIELD_CONFIG } from '../../contexts/SettingsContext';
import { useLocale } from '../../hooks/useLocale';
import { useMobile } from '../../contexts/MondayContext';
import { useDragToDismiss } from '../../hooks/useDragToDismiss';
import { useTasksMultiple } from '../../hooks/useTasksMultiple';
import { useStageOptions } from '../../hooks/useStageOptions';
import { useNonBillableOptions } from '../../hooks/useNonBillableOptions';
import { useColumnOptions } from '../../hooks/useColumnOptions';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { getEffectiveBoardId } from '../../utils/boardIdResolver';
import { getNonBillableIndexes, getLabelText } from '../../utils/eventTypeMapping';
import { getXorExemptFields, getXorErrorMessage } from '../../utils/xorValidation';
import TaskSelect from '../TaskSelect';
import TimeSelect from '../TimeSelect';
import ConfirmDialog from '../ConfirmDialog';
import CustomDatePicker from '../CustomDatePicker';
import { generateTimeOptions15Minutes } from '../../constants/calendarConfig';
import logger from '../../utils/logger';
import styles from './AllDayEventModal.module.css';

export default function AllDayEventModal({
    isOpen,
    onClose,
    pendingDate,
    onCreate,
    eventToEdit = null,
    isEditMode = false,
    onUpdate = null,
    onDelete = null,
    monday,
    context = null,
    // Approval props
    isManager = false,
    isApprovalEnabled = false,
    onApprove = null,
    onReject = null,
    // Lock props
    isLocked = false,
    lockReason = '',
    projects = [],
    loadingProjects = false,
}) {
    const t = useStableT();
    const { dateLocale, language } = useLocale();
    const { customSettings } = useSettings();
    const isMobile = useMobile();

    // Body scroll lock on mobile
    useEffect(() => {
        if (isOpen && isMobile) {
            document.body.style.overflow = 'hidden';
            return () => { document.body.style.overflow = ''; };
        }
    }, [isOpen, isMobile]);
    const { createTask, fetchForProject, tasks: tasksByProject } = useTasksMultiple();
    
    // יצירת רשימת זמנים לפי טווח שעות העבודה
    const timeOptions = React.useMemo(() => {
        const minTime = customSettings.workDayStart || "00:00";
        const maxTime = customSettings.workDayEnd || "23:45";
        return generateTimeOptions15Minutes(minTime, maxTime);
    }, [customSettings.workDayStart, customSettings.workDayEnd]);
    
    // State - בחירת סוג אירוע
    const [selectedType, setSelectedType] = useState(null); // 'sick' | 'vacation' | 'reserves' | 'reports'
    
    // State - תאריך סיום לאירוע יומי (ברירת מחדל: אותו יום כמו תאריך ההתחלה)
    const [endDate, setEndDate] = useState(null);
    
    // State - האם לוח השנה פתוח
    const [showDatePicker, setShowDatePicker] = useState(false);
    const datePickerRef = useRef(null);
    
    // State - ניהול תצוגה
    const [viewMode, setViewMode] = useState('menu'); // 'menu' | 'days-selection' | 'form'
    const [searchTerm, setSearchTerm] = useState('');

    // State - האם הקבוצות בסיידבר פרושות (חיצוניים פתוח כברירת מחדל)
    const [externalGroupOpen, setExternalGroupOpen] = useState(true);
    const [internalGroupOpen, setInternalGroupOpen] = useState(false);

    // State - דיווחים שנוספו
    const [addedReports, setAddedReports] = useState([]);
    
    // State - משימות נבחרות
    const [selectedTasks, setSelectedTasks] = useState({});
    // State - שלבים נבחרים
    const [selectedStages, setSelectedStages] = useState({});
    // State - יצירת משימה לכל פרויקט
    const [isCreatingTask, setIsCreatingTask] = useState({});
    
    // State - תיבות אישור
    const [showCloseConfirm, setShowCloseConfirm] = useState(false);
    // eslint-disable-next-line no-unused-vars -- ה-state נשמר רק כדי להפעיל re-render דרך הסטר; הקריאה אינה בשימוש
    const [editingDuration, setEditingDuration] = useState({});

    // State - שגיאות ולידציה
    const [fieldErrors, setFieldErrors] = useState({});
    const formRef = useRef(null);

    // חישוב לוח דיווחים אפקטיבי - העמודות נמצאות בלוח הזה
    const boardId = getEffectiveBoardId(customSettings, context);

    // טעינת ערכי שלב
    const { stageOptions, loading: loadingStages } = useStageOptions(
        monday,
        customSettings.stageColumnId && boardId ? boardId : null,
        customSettings.stageColumnId
    );

    // תווית תצוגה ל"לא לחיוב" - חישוב פעם אחת
    const nonBillableDisplayLabel = React.useMemo(() => {
        const nbIndexes = getNonBillableIndexes(customSettings.eventTypeMapping);
        return (nbIndexes.length > 0 && getLabelText(nbIndexes[0], customSettings.eventTypeLabelMeta)) || t('allDayModal.states.nonBillableDefault');
    }, [customSettings.eventTypeMapping, customSettings.eventTypeLabelMeta]);

    const { nonBillableOptions, loading: loadingNonBillable } = useNonBillableOptions(
        monday,
        customSettings.nonBillableStatusColumnId && boardId ? boardId : null,
        customSettings.nonBillableStatusColumnId
    );

    // אינטגרציית Day-off (W4.4, החלטה D5): כשמקור ההיעדרויות הוא לוח החופשות,
    // תפריט סוגי החופשה מוחלף בהפניה לרכיב Day-off (המודל שורד — דיווחים מרובים נשארים).
    const isDayoffSource = customSettings.absenceSource === 'dayoff';

    // טעינת התת-סוגים של אירוע יומי מהעמודה החדשה (allDayTypeStatusColumnId)
    // במצב dayoff התפריט מוסתר — אין טעם לטעון את התוויות (והעמודה אף עשויה לא להיות ממופה, W4.5)
    const { options: allDayTypeOptions } = useColumnOptions(
        monday,
        customSettings.allDayTypeStatusColumnId && boardId && !isDayoffSource ? boardId : null,
        customSettings.allDayTypeStatusColumnId,
        'useAllDayTypeOptions'
    );
    
    // --- פונקציות עזר לחישובי זמן ---
    const parseTime = (timeStr) => {
        if (!timeStr) return 0;
        const [h, m] = timeStr.split(':').map(Number);
        return h * 60 + m;
    };

    const formatTime = (minutes) => {
        // modulo 1440 (24 שעות) לטיפול בחציית חצות
        const totalMins = ((minutes % 1440) + 1440) % 1440;
        const h = Math.floor(totalMins / 60);
        const m = totalMins % 60;
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
    };

    const addTime = (start, durationStr) => {
        if (!start) return '';
        const totalMinutes = parseTime(start) + parseTime(durationStr || '01:00');
        return formatTime(totalMinutes);
    };
    
    // איפוס state כאשר התיבה נפתחת או נסגרת
    useEffect(() => {
        if (isOpen) {
            logger.debug('AllDayEventModal', 'Modal opened - resetting state');
            setFieldErrors({});

            if (isEditMode && eventToEdit) {
                // זיהוי תת-סוג אירוע יומי מתוך allDayTypeIndex (העמודה החדשה)
                if (eventToEdit.allDayTypeIndex != null) {
                    setSelectedType(String(eventToEdit.allDayTypeIndex));
                    logger.debug('AllDayEventModal', `Edit mode - detected all-day sub-type index: ${eventToEdit.allDayTypeIndex}`);
                }
            } else {
                setSelectedType(null);
                setViewMode('menu');
                setAddedReports([]);
                setSearchTerm('');
                setSelectedTasks({});
                setSelectedStages({});
                setIsCreatingTask({});
                setEditingDuration({});
                setEndDate(null);
                setShowDatePicker(false);
                
            }
        } else {
            logger.debug('AllDayEventModal', 'Modal closed - resetting all state');
            setSelectedType(null);
            setViewMode('menu');
            setAddedReports([]);
            setSearchTerm('');
            setSelectedTasks({});
            setSelectedStages({});
            setIsCreatingTask({});
            setEditingDuration({});
            setEndDate(null);
            setShowDatePicker(false);
        }
    }, [isOpen, isEditMode, eventToEdit]);
    
    // עדכון משימות ב-addedReports כשהמשימות נטענות
    useEffect(() => {
        setAddedReports(prev => prev.map(report => ({
            ...report,
            tasks: tasksByProject[report.projectId] || []
        })));
    }, [tasksByProject]);
    
    // חישוב שעת התחלה לדיווח חדש
    const getNextStartTime = () => {
        let startTime = '08:00';
        if (addedReports.length > 0) {
            const lastReport = addedReports[addedReports.length - 1];
            if (lastReport.endTime) {
                startTime = lastReport.endTime;
            } else if (lastReport.startTime && lastReport.hours) {
                const hoursInMinutes = parseFloat(lastReport.hours) * 60;
                const startTotalMins = parseTime(lastReport.startTime);
                const endTotalMins = startTotalMins + hoursInMinutes;
                startTime = formatTime(endTotalMins);
            }
        }
        return startTime;
    };

    // הוספת שורת דיווח מפרויקט
    const addReportRow = (project) => {
        if (!project) return;
        setFieldErrors(prev => {
            if (!prev.reports) return prev;
            const { reports, ...rest } = prev;
            return rest;
        });
        
        // טעינת משימות של הפרויקט
        if (customSettings.tasksProjectColumnId) {
            fetchForProject(project.id);
        }
        
        const startTime = getNextStartTime();
        const defaultDuration = '01:00';
        const endTime = addTime(startTime, defaultDuration);
        const hours = '1.00';
        
        setAddedReports(prev => [...prev, {
            id: Date.now(),
            project: project,  // אובייקט פרויקט מלא (כולל projectType)
            projectId: project.id,
            projectName: project.name,
            assignmentId: project.assignmentId || null,
            tasks: [],
            hours: hours,
            startTime: startTime,
            endTime: endTime,
            notes: '',
            taskId: '',
            stageId: '',
            isBillable: true,
            nonBillableType: ''
        }]);
    };

    // הוספת שורת דיווח לא לחיוב (ללא פרויקט)
    const addNonBillableReportRow = () => {
        const startTime = getNextStartTime();
        const defaultDuration = '01:00';
        const endTime = addTime(startTime, defaultDuration);
        const hours = '1.00';
        
        setAddedReports(prev => [...prev, {
            id: Date.now(),
            projectId: null,
            projectName: nonBillableDisplayLabel,
            tasks: [],
            hours: hours,
            startTime: startTime,
            endTime: endTime,
            notes: '',
            taskId: '',
            stageId: '',
            isBillable: false,
            nonBillableType: ''
        }]);
    };
    
    // הסרת שורת דיווח
    const removeReportRow = (id) => {
        const report = addedReports.find(r => r.id === id);
        if (report) {
            setSelectedTasks(prev => {
                const newSelected = { ...prev };
                delete newSelected[id];
                return newSelected;
            });
            setSelectedStages(prev => {
                const newSelected = { ...prev };
                delete newSelected[id];
                return newSelected;
            });
        }
        setAddedReports(prev => prev.filter(r => r.id !== id));
    };
    
    // סינון פרויקטים לפי חיפוש ומיון לפי הא"ב
    const filteredProjects = projects
        .filter(p =>
            p.name.toLowerCase().includes(searchTerm.toLowerCase())
        )
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, language));

    // מצב הבחנה — חלוקה לקבוצות חיצוניים/פנימיים
    const enableDistinction = !!customSettings.enableProjectTypeDistinction;
    const externalProjects = enableDistinction
        ? filteredProjects.filter(p => p.projectType !== 'internal')
        : [];
    const internalProjects = enableDistinction
        ? filteredProjects.filter(p => p.projectType === 'internal')
        : [];
    
    // פונקציה לחישוב משך זמן משעות התחלה וסיום
    const calculateHoursFromTimeRange = (startTime, endTime) => {
        if (!startTime || !endTime) return null;
        const startTotalMinutes = parseTime(startTime);
        const endTotalMinutes = parseTime(endTime);
        if (endTotalMinutes <= startTotalMinutes) return null;
        const diffMinutes = endTotalMinutes - startTotalMinutes;
        const diffHours = diffMinutes / 60;
        const minHours = 0.5;
        const finalHours = Math.max(diffHours, minHours);
        return finalHours.toFixed(2);
    };
    
    // פונקציה לחישוב משך זמן בפורמט HH:mm
    const calculateDurationStr = (start, end) => {
        if (!start || !end) return '01:00';
        let diff = parseTime(end) - parseTime(start);
        if (diff < 0) diff += 24 * 60;
        return formatTime(diff);
    };
    
    // --- לוגיקת Smart Cascade ---
    const resolveOverlaps = (currentEntries, startIndex) => {
        const updated = [...currentEntries];
        for (let i = startIndex; i < updated.length - 1; i++) {
            const current = updated[i];
            const next = updated[i + 1];
            if (!current.startTime || !current.endTime || !next.startTime) break;
            const currentEndMins = parseTime(current.endTime);
            const nextStartMins = parseTime(next.startTime);
            if (currentEndMins > nextStartMins) {
                let originalDuration = '01:00';
                if (next.endTime && next.startTime) {
                    originalDuration = calculateDurationStr(next.startTime, next.endTime);
                } else if (next.hours) {
                    originalDuration = formatTime(parseFloat(next.hours) * 60);
                }
                next.startTime = current.endTime;
                next.endTime = addTime(next.startTime, originalDuration);
                if (next.startTime && next.endTime) {
                    const calculatedHours = calculateHoursFromTimeRange(next.startTime, next.endTime);
                    if (calculatedHours) next.hours = calculatedHours;
                }
            } else break;
        }
        return updated;
    };
    
    // פונקציה לבדיקה אם יש דיווחים תקפים
    const hasValidReports = () => {
        if (selectedType !== 'reports' || viewMode !== 'form') return false;
        const fieldConfig = customSettings.fieldConfig || DEFAULT_FIELD_CONFIG;

        const validReports = addedReports.filter(r => {
            const hasDirectHours = r.hours && parseFloat(r.hours) > 0;
            const hasTimeRange = r.startTime && r.endTime;
            const calculatedHours = hasTimeRange ? calculateHoursFromTimeRange(r.startTime, r.endTime) : null;
            const hasHours = hasDirectHours || (calculatedHours && parseFloat(calculatedHours) > 0);

            // חישוב פטורי XOR לשורה זו
            const fieldValues = {
                task: r.taskId,
                stage: r.stageId,
                nonBillableType: r.nonBillableType,
                notes: r.notes?.trim()
            };
            const xorExempt = getXorExemptFields(customSettings.advancedValidation, fieldValues);

            // משימה חובה רק אם required
            const needsTask = fieldConfig.task === FIELD_MODES.REQUIRED &&
                             customSettings.taskColumnId;
            const hasTask = !needsTask || !r.isBillable || r.taskId || xorExempt.has('task');

            // סיווג חובה רק אם required
            const needsStage = fieldConfig.stage === FIELD_MODES.REQUIRED &&
                customSettings.stageColumnId;
            const hasStage = !needsStage || !r.isBillable || r.stageId || xorExempt.has('stage');

            // ולידציה ללא לחיוב
            const needsNonBillable = fieldConfig.nonBillableType === FIELD_MODES.REQUIRED;
            const hasNonBillableType = r.isBillable || !needsNonBillable || r.nonBillableType || xorExempt.has('nonBillableType');
            return hasHours && hasTask && hasStage && hasNonBillableType;
        });
        return validReports.length > 0;
    };
    
    // זמן פתיחת המודל — למניעת סגירה מיידית מקליק חיצוני (למשל קונפטי של אירוע קודם)
    const openedAtRef = useRef(0);
    useEffect(() => {
        if (isOpen) openedAtRef.current = Date.now();
    }, [isOpen]);

    // פונקציה לטיפול בסגירה עם אישור
    const handleCloseAttempt = useCallback(() => {
        // חסום סגירה תוך 500ms מפתיחה — מונע קונפטי/קליק מהיר לסגור מודל חדש
        if (Date.now() - openedAtRef.current < 500) return;
        if (hasValidReports()) setShowCloseConfirm(true);
        else onClose();
    }, [onClose]);

    const modalRef = useFocusTrap(isOpen && !showCloseConfirm, handleCloseAttempt);
    
    // --- Smart Time Picker ---
    // לוגיקה חכמה שמונעת מצבים לא תקינים (start >= end) בלי לחסום את המשתמש.
    // במקום שגיאה, המערכת מתאימה אוטומטית: Resize (עיגון) או Shift (הזזה).
    const updateReport = (id, field, value) => {
        setAddedReports(prev => {
            let newEntries = [...prev];
            const index = newEntries.findIndex(e => e.id === id);
            if (index === -1) return prev;
            const entry = { ...newEntries[index] };

            // שמירת ערכים ישנים לפני העדכון (נדרש ללוגיקת shift)
            const oldStartTime = entry.startTime;
            const oldEndTime = entry.endTime;
            const oldHours = entry.hours;

            if (field === 'startTime') {
                // --- שינוי שעת התחלה ---
                const newStartMins = parseTime(value);
                const oldEndMins = parseTime(oldEndTime);
                entry.startTime = value;

                if (oldEndTime && newStartMins < oldEndMins) {
                    // Standard: Resize — שעת סיום עוגנת, משך מחושב מחדש
                    const newDuration = oldEndMins - newStartMins;
                    entry.hours = (newDuration / 60).toFixed(2);
                    // endTime לא משתנה
                } else {
                    // Overlap: Shift — משך נשמר, שעת סיום נדחפת קדימה
                    let durationMins = 60;
                    if (oldStartTime && oldEndTime) {
                        durationMins = parseTime(oldEndTime) - parseTime(oldStartTime);
                        if (durationMins <= 0) durationMins = 60;
                    } else if (oldHours) {
                        durationMins = parseFloat(oldHours) * 60;
                    }
                    durationMins = Math.max(durationMins, 30);
                    entry.endTime = formatTime(newStartMins + durationMins);
                    entry.hours = (durationMins / 60).toFixed(2);
                }

            } else if (field === 'endTime') {
                // --- שינוי שעת סיום ---
                const oldStartMins = parseTime(oldStartTime);
                const newEndMins = parseTime(value);
                entry.endTime = value;

                if (oldStartTime && newEndMins > oldStartMins) {
                    // Standard: Resize — שעת התחלה עוגנת, משך מחושב מחדש
                    const newDuration = newEndMins - oldStartMins;
                    entry.hours = (newDuration / 60).toFixed(2);
                    // startTime לא משתנה
                } else {
                    // Overlap: Shift — משך נשמר, שעת התחלה נדחפת אחורה
                    let durationMins = 60;
                    if (oldStartTime && oldEndTime) {
                        durationMins = parseTime(oldEndTime) - parseTime(oldStartTime);
                        if (durationMins <= 0) durationMins = 60;
                    } else if (oldHours) {
                        durationMins = parseFloat(oldHours) * 60;
                    }
                    durationMins = Math.max(durationMins, 30);
                    entry.startTime = formatTime(newEndMins - durationMins);
                    entry.hours = (durationMins / 60).toFixed(2);
                }

            } else if (field === 'hours') {
                // --- שינוי משך ---
                // Forward Resize: שעת התחלה תמיד עוגנת, שעת סיום מתעדכנת
                const finalHours = Math.max(parseFloat(value) || 0, 0.5);
                entry.hours = finalHours.toFixed(2);
                if (entry.startTime) {
                    const endMins = parseTime(entry.startTime) + finalHours * 60;
                    entry.endTime = formatTime(endMins);
                }

            } else {
                // שדות אחרים (notes, taskId, stageId וכו')
                entry[field] = value;
            }

            newEntries[index] = entry;
            if (field === 'startTime' || field === 'endTime' || field === 'hours') {
                newEntries = resolveOverlaps(newEntries, index);
            }
            return newEntries;
        });
    };
    
    // ניקוי שגיאת ולידציה בשורה
    const clearRowError = (reportId) => {
        setFieldErrors(prev => {
            if (!prev.rowErrors || !prev.rowErrors[reportId]) return prev;
            const newRowErrors = { ...prev.rowErrors };
            delete newRowErrors[reportId];
            const newErrors = { ...prev, rowErrors: newRowErrors };
            if (Object.keys(newRowErrors).length === 0) delete newErrors.rowErrors;
            return newErrors;
        });
    };

    // עדכון משימה שנבחרה
    const updateSelectedTask = (reportId, taskId) => {
        const report = addedReports.find(r => r.id === reportId);
        if (report) {
            clearRowError(reportId);
            setSelectedTasks(prev => ({ ...prev, [reportId]: taskId }));
            updateReport(reportId, 'taskId', taskId);
            if (!taskId) {
                setSelectedStages(prev => {
                    const newSelected = { ...prev };
                    delete newSelected[reportId];
                    return newSelected;
                });
                updateReport(reportId, 'stageId', '');
            }
        }
    };
    
    const updateSelectedStage = (reportId, stageId) => {
        const report = addedReports.find(r => r.id === reportId);
        if (report) {
            clearRowError(reportId);
            setSelectedStages(prev => ({ ...prev, [reportId]: stageId }));
            updateReport(reportId, 'stageId', stageId);
        }
    };
    
    const handleCreateTask = async (reportId, taskName) => {
        const report = addedReports.find(r => r.id === reportId);
        if (!report) return;
        
        setIsCreatingTask(prev => ({ ...prev, [report.projectId]: true }));
        try {
            const newTask = await createTask(report.projectId, taskName);
            if (newTask) {
                setAddedReports(prev =>
                    prev.map(r =>
                        r.id === reportId
                            ? { 
                                ...r, 
                                tasks: [...(tasksByProject[r.projectId] || []), newTask]
                            }
                            : r
                    )
                );
                updateSelectedTask(reportId, newTask.id);
            }
        } finally {
            setIsCreatingTask(prev => ({ ...prev, [report.projectId]: false }));
        }
    };
    
    // selected type details (for label / color used in titles & colors)
    const selectedTypeDetails = React.useMemo(() => {
        if (selectedType == null) return null;
        return allDayTypeOptions.find(o => String(o.id) === String(selectedType)) || null;
    }, [selectedType, allDayTypeOptions]);

    const handleSingleTypeSelect = (typeInfo) => {
        // typeInfo: { index, label, color }
        if (isEditMode) {
            if (String(selectedType) === String(typeInfo.index)) return;
            if (onUpdate) onUpdate(typeInfo);
            return;
        }
        // מעבר לשלב בחירת תאריך סיום
        setSelectedType(typeInfo.index);
        setEndDate(pendingDate); // ברירת מחדל: אותו יום (יום אחד)
        setShowDatePicker(false);
        setViewMode('days-selection');
    };

    // יצירת אירוע יומי עם תאריך הסיום שנבחר
    const handleCreateAllDayWithDuration = () => {
        if (!selectedType || !endDate) return;
        // חישוב מספר הימים מתאריך ההתחלה עד תאריך הסיום (כולל)
        const durationDays = differenceInDays(endDate, pendingDate) + 1;
        onCreate({
            type: selectedType,
            typeLabel: selectedTypeDetails?.label || '',
            typeColor: selectedTypeDetails?.color || '',
            date: pendingDate,
            durationDays: durationDays
        });
        onClose();
    };
    
    const handleCancelOrBack = async () => {
        if (viewMode === 'form') {
            if (hasValidReports()) await handleCloseAttempt();
            else {
                setViewMode('menu');
                setSelectedType(null);
                setAddedReports([]);
                setSearchTerm('');
            }
        } else if (viewMode === 'days-selection') {
            // חזרה לתפריט הראשי
            setViewMode('menu');
            setSelectedType(null);
            setEndDate(null);
            setShowDatePicker(false);
        } else {
            onClose();
        }
    };
    
    const handleCreate = () => {
        if (!selectedType) return;
        const fieldConfig = customSettings.fieldConfig || DEFAULT_FIELD_CONFIG;

        if (selectedType === 'reports') {
            const validReports = addedReports.filter(r => r.hours && parseFloat(r.hours) > 0);
            const errors = {};
            const rowErrors = {};

            if (validReports.length === 0) {
                errors.reports = t('allDayModal.validation.noReports');
            } else {
                validReports.forEach(r => {
                    // חישוב פטורי XOR לכל שורה
                    const fieldValues = {
                        task: r.taskId,
                        stage: r.stageId,
                        nonBillableType: r.nonBillableType,
                        notes: r.notes?.trim()
                    };
                    const xorExempt = getXorExemptFields(customSettings.advancedValidation, fieldValues);
                    const xorMsg = xorExempt.size === 0 ? getXorErrorMessage(customSettings.advancedValidation) : null;

                    // בדיקת משימות - רק אם required
                    if (fieldConfig.task === FIELD_MODES.REQUIRED &&
                        customSettings.taskColumnId &&
                        r.isBillable && !r.taskId && !xorExempt.has('task')) {
                        rowErrors[r.id] = rowErrors[r.id] || [];
                        rowErrors[r.id].push(xorMsg || t('allDayModal.validation.task'));
                    }

                    // בדיקת סוגי לא לחיוב - רק אם required
                    if (fieldConfig.nonBillableType === FIELD_MODES.REQUIRED &&
                        !r.isBillable && !r.nonBillableType && !xorExempt.has('nonBillableType')) {
                        rowErrors[r.id] = rowErrors[r.id] || [];
                        rowErrors[r.id].push(xorMsg || t('allDayModal.validation.nonBillableType'));
                    }

                    // בדיקת סיווג - רק אם required
                    if (fieldConfig.stage === FIELD_MODES.REQUIRED &&
                        customSettings.stageColumnId &&
                        r.isBillable && !r.stageId && !xorExempt.has('stage')) {
                        rowErrors[r.id] = rowErrors[r.id] || [];
                        rowErrors[r.id].push(xorMsg || t('allDayModal.validation.stage'));
                    }
                });
            }

            if (Object.keys(rowErrors).length > 0) {
                errors.rowErrors = rowErrors;
            }

            if (Object.keys(errors).length > 0) {
                setFieldErrors(errors);
                // גלילה לשגיאה הראשונה
                const firstErrorRow = formRef.current?.querySelector(`.${styles.reportRowError}`);
                if (firstErrorRow) firstErrorRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
                return;
            }
            
            const formattedReports = validReports.map(r => {
                let hours = r.hours;
                if (r.startTime && r.endTime) {
                    const calculatedHours = calculateHoursFromTimeRange(r.startTime, r.endTime);
                    if (calculatedHours) hours = calculatedHours;
                }
                const tasks = tasksByProject[r.projectId] || [];
                const task = tasks.find(t => t.id === r.taskId);
                const taskName = task?.name || t('allDayModal.states.noTask');
                return {
                    project: r.project || null,  // אובייקט פרויקט מלא (כולל projectType)
                    projectId: r.projectId,
                    projectName: r.projectName,
                    assignmentId: r.assignmentId || null,
                    hours: hours,
                    notes: r.notes,
                    taskId: r.taskId,
                    taskName: taskName,
                    stageId: r.stageId || null,
                    startTime: r.startTime || null,
                    endTime: r.endTime || null,
                    isBillable: r.isBillable,
                    nonBillableType: r.nonBillableType || null
                };
            });
            onCreate({ type: 'reports', date: pendingDate, reports: formattedReports });
        } else {
            onCreate({
                type: selectedType,
                typeLabel: selectedTypeDetails?.label || '',
                typeColor: selectedTypeDetails?.color || '',
                date: pendingDate
            });
        }
        setSelectedType(null);
        setViewMode('menu');
        setAddedReports([]);
        setSearchTerm('');
        setSelectedTasks({});
        setSelectedStages({});
        onClose();
    };
    
    const calculateTotalHours = () => {
        let totalMinutes = 0;
        addedReports.forEach(report => {
            if (report.startTime && report.endTime) {
                const duration = calculateDurationStr(report.startTime, report.endTime);
                totalMinutes += parseTime(duration);
            } else if (report.hours) totalMinutes += parseFloat(report.hours) * 60;
        });
        return formatTime(totalMinutes);
    };
    
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Enter' && selectedType && isOpen) {
                if (selectedType !== 'reports') handleCreate();
                else if (viewMode === 'form') {
                    const validReports = addedReports.filter(r => {
                        const hasDirectHours = r.hours && parseFloat(r.hours) > 0;
                        const hasTimeRange = r.startTime && r.endTime;
                        const calculatedHours = hasTimeRange ? calculateHoursFromTimeRange(r.startTime, r.endTime) : null;
                        return hasDirectHours || (calculatedHours && parseFloat(calculatedHours) > 0);
                    });
                    if (validReports.length > 0) handleCreate();
                }
            }
        };
        if (isOpen) {
            document.addEventListener('keydown', handleKeyDown);
            return () => document.removeEventListener('keydown', handleKeyDown);
        }
    }, [selectedType, isOpen, addedReports, viewMode]);
    
    // סגירת לוח השנה בלחיצה מחוץ לאזור
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (datePickerRef.current && !datePickerRef.current.contains(event.target)) {
                setShowDatePicker(false);
            }
        };
        
        if (showDatePicker) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [showDatePicker]);
    
    // גרירה כלפי מטה לסגירה במובייל (סגנון bottom-sheet)
    const dragDismissEnabled = isMobile && !showCloseConfirm;
    const { handleProps: dragHandleProps, modalStyle: dragModalStyle } = useDragToDismiss({
        enabled: dragDismissEnabled,
        onDismiss: handleCloseAttempt,
    });

    if (!isOpen || !pendingDate) return null;

    // דיווח היעדרות במצב dayoff (W4.4, החלטה D5) — כפתור שפותח את רכיב Day-off בטאב חדש.
    // קישור עומק: URL שמוגדר ידנית בהגדרות (dayOffAppUrl); ללא URL תקין הכפתור מושבת עם הסבר.
    const renderDayoffButton = () => {
        const rawUrl = typeof customSettings.dayOffAppUrl === 'string' ? customSettings.dayOffAppUrl.trim() : '';
        const deepLinkUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : '';
        return (
            <button
                className={`${styles.menuButton} ${styles.btnDayoff}`}
                disabled={!deepLinkUrl}
                onClick={() => window.open(deepLinkUrl, '_blank', 'noopener,noreferrer')}
            >
                <span className={styles.icon}><ExternalLink size={20} color="var(--color-event-vacation)" /></span>
                <span style={{ marginInlineEnd: '12px' }}>{t('allDayModal.dayoffButton')}</span>
                {!deepLinkUrl && <span className={styles.dayoffNoUrl}>{t('allDayModal.dayoffButtonNoUrl')}</span>}
            </button>
        );
    };

    const renderMenu = () => (
        <div className={styles.menuContainer}>
            {!isDayoffSource && (
            <div className={styles.menuTopRow}>
                {allDayTypeOptions.map(item => {
                    const color = item.color || 'var(--color-event-reserves)';
                    const isSelected = String(selectedType) === String(item.id);
                    return (
                        <button
                            key={item.id}
                            className={`${styles.menuButton} ${styles.btnAllDay} ${isSelected ? styles.selected : ''}`}
                            onClick={() => handleSingleTypeSelect({ index: item.id, label: item.label, color })}
                        >
                            <span className={styles.colorDot} style={{ backgroundColor: color }} />
                            <span>{item.label}</span>
                            {isEditMode && isSelected && <span style={{ marginInlineEnd: 'auto', color, fontWeight: 600 }}>{t('allDayModal.selectedMark')}</span>}
                        </button>
                    );
                })}
            </div>
            )}
            {!isEditMode && !isMobile && (() => {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const selectedDate = new Date(pendingDate);
                selectedDate.setHours(0, 0, 0, 0);
                const isFuture = selectedDate > today;
                if (isFuture) {
                    // תאריך עתידי — דיווחים מרובים אסור. מציגים הודעה
                    // במקום הכפתור (אותה תווית כמו בטוסט שמופיע בלחיצה
                    // על תא יומן בעתיד).
                    return (
                        <div className={styles.futureNotice}>
                            {t('toasts.futureTimeBlocked')}
                        </div>
                    );
                }
                return (
                    <button className={`${styles.menuButton} ${styles.btnMultiple}`} onClick={() => {
                        setSelectedType('reports');
                        setViewMode('form');
                    }}>
                        <span className={styles.icon}><FileText size={20} color="var(--color-event-multiple)" /></span>
                        <span style={{ marginInlineEnd: '12px' }}>{t('allDayModal.multipleReports')}</span>
                    </button>
                );
            })()}
            {isDayoffSource && renderDayoffButton()}
        </div>
    );
    
    const renderSplitForm = () => {
        const rowErrors = fieldErrors.rowErrors || {};
        return (
            <div className={styles.splitView} ref={formRef}>
                <div className={styles.mainForm}>
                    {fieldErrors.reports && (
                        <div className={styles.formError}>{fieldErrors.reports}</div>
                    )}
                    {addedReports.length === 0 && !fieldErrors.reports && (
                        <div className={styles.emptyState}>
                            <FileText size={48} color="var(--color-border-medium)" />
                            <div>{t('allDayModal.emptyState')}</div>
                        </div>
                    )}
                    {addedReports.map((report) => (
                            <div key={report.id} className={`${styles.reportRow} ${rowErrors[report.id] ? styles.reportRowError : ''}`}>
                                <button onClick={() => removeReportRow(report.id)} className={styles.deleteButtonTop} title={t('allDayModal.tooltips.deleteRow')}><X size={18} strokeWidth={2} /></button>
                                <div className={styles.rowMainContent}>
                                    <div className={styles.selectorsGroup}>
                                        <div className={styles.projectName}>{report.projectName}</div>
                                        {report.isBillable ? (
                                        <>
                                            {/* משימה - רק אם לא מוסתר */}
                                            {customSettings.taskColumnId &&
                                             (customSettings.fieldConfig || DEFAULT_FIELD_CONFIG).task !== FIELD_MODES.HIDDEN && (
                                                <div className={styles.taskField}>
                                                    <TaskSelect 
                                                        products={tasksByProject[report.projectId] || []}
                                                        selectedProduct={selectedTasks[report.id] || ''}
                                                        onSelectProduct={(taskId) => updateSelectedTask(report.id, taskId)}
                                                        onCreateNew={async (taskName) => await handleCreateTask(report.id, taskName)}
                                                        isLoading={false}
                                                        disabled={false}
                                                        isCreatingProduct={isCreatingTask[report.projectId] || false}
                                                        placeholder={t('allDayModal.placeholders.task')}
                                                    />
                                                </div>
                                            )}
                                            {/* סיווג - כפתורים אם לא מוסתר */}
                                            {customSettings.stageColumnId &&
                                             (customSettings.fieldConfig || DEFAULT_FIELD_CONFIG).stage !== FIELD_MODES.HIDDEN && (
                                                    <div className={styles.stageButtons}>
                                                        {loadingStages ? (
                                                            <span className={styles.loadingSmall}>{t('allDayModal.states.loading')}</span>
                                                        ) : (
                                                            stageOptions.map(option => (
                                                                <button
                                                                    key={option.id}
                                                                    onClick={() => updateSelectedStage(report.id, option.label === selectedStages[report.id] ? '' : option.label)}
                                                                    className={`${styles.stageButton} ${selectedStages[report.id] === option.label ? styles.stageButtonSelected : ''}`}
                                                                >
                                                                    {option.label}
                                                                </button>
                                                            ))
                                                        )}
                                                    </div>
                                            )}
                                        </>
                                    ) : (
                                        customSettings.nonBillableStatusColumnId && (
                                            <div className={styles.stageButtons}>
                                                {loadingNonBillable ? (
                                                    <span className={styles.loadingSmall}>{t('allDayModal.states.loading')}</span>
                                                ) : (
                                                    nonBillableOptions.map(option => (
                                                        <button
                                                            key={option.id}
                                                            onClick={() => { clearRowError(report.id); updateReport(report.id, 'nonBillableType', option.label === report.nonBillableType ? '' : option.label); }}
                                                            className={`${styles.stageButton} ${report.nonBillableType === option.label ? styles.stageButtonSelected : ''}`}
                                                        >
                                                            {option.label}
                                                        </button>
                                                    ))
                                                )}
                                            </div>
                                        )
                                    )}
                                </div>
                                <div className={styles.visualSeparator}></div>
                                <div className={styles.timeGridContainer}>
                                    <div className={styles.timeFieldWrapper}>
                                        <span className={styles.timeLabelSmall}>{t('allDayModal.labels.startTime')}</span>
                                        <TimeSelect
                                            times={timeOptions}
                                            selectedTime={report.startTime || ''}
                                            onSelectTime={(time) => updateReport(report.id, 'startTime', time)}
                                            isLoading={false}
                                            disabled={false}
                                            placeholder={t('allDayModal.labels.timePlaceholder')}
                                        />
                                    </div>
                                    <div className={styles.timeFieldWrapper}>
                                        <span className={styles.timeLabelSmall}>{t('allDayModal.labels.endTime')}</span>
                                        <TimeSelect
                                            times={timeOptions}
                                            selectedTime={report.endTime || ''}
                                            onSelectTime={(time) => updateReport(report.id, 'endTime', time)}
                                            isLoading={false}
                                            disabled={false}
                                            placeholder={t('allDayModal.labels.timePlaceholder')}
                                        />
                                    </div>
                                    <div className={styles.durationWrapper}>
                                        <div className={styles.durationControl}>
                                            <button
                                                className={styles.durationBtn}
                                                onClick={() => {
                                                    const currentDuration = report.startTime && report.endTime 
                                                        ? calculateDurationStr(report.startTime, report.endTime)
                                                        : (report.hours ? formatTime(parseFloat(report.hours) * 60) : '01:00');
                                                    const currentMinutes = parseTime(currentDuration);
                                                    const newMinutes = Math.max(15, currentMinutes - 15);
                                                    const hours = (newMinutes / 60).toFixed(2);
                                                    updateReport(report.id, 'hours', hours);
                                                }}
                                                title={t('allDayModal.tooltips.decrement15')}
                                            >
                                                <Minus size={16} />
                                            </button>
                                            <span className={styles.durationValue}>
                                                {report.startTime && report.endTime 
                                                    ? calculateDurationStr(report.startTime, report.endTime)
                                                    : (report.hours ? formatTime(parseFloat(report.hours) * 60) : '01:00')}
                                            </span>
                                            <button
                                                className={styles.durationBtn}
                                                onClick={() => {
                                                    const currentDuration = report.startTime && report.endTime 
                                                        ? calculateDurationStr(report.startTime, report.endTime)
                                                        : (report.hours ? formatTime(parseFloat(report.hours) * 60) : '01:00');
                                                    const currentMinutes = parseTime(currentDuration);
                                                    const newMinutes = currentMinutes + 15;
                                                    const hours = (newMinutes / 60).toFixed(2);
                                                    updateReport(report.id, 'hours', hours);
                                                }}
                                                title={t('allDayModal.tooltips.increment15')}
                                            >
                                                <Plus size={16} />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                                <div className={styles.visualSeparator}></div>
                                
                                {(customSettings.fieldConfig || DEFAULT_FIELD_CONFIG).notes !== FIELD_MODES.HIDDEN && (
                                    <div className={styles.notesWrapper}>
                                        <span className={styles.timeLabelSmall}>{t('allDayModal.labels.notes')}</span>
                                        <textarea
                                            className={styles.notesInput}
                                            placeholder={t('allDayModal.labels.notesPlaceholder')}
                                            value={report.notes || ''}
                                            onChange={(e) => updateReport(report.id, 'notes', e.target.value)}
                                        />
                                    </div>
                                )}
                                {rowErrors[report.id] && (
                                    <div className={styles.rowErrorMessages}>
                                        {rowErrors[report.id].map((msg, i) => (
                                            <span key={i} className={styles.fieldError}>{msg}</span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
                <div className={styles.sidebar}>
                    {/* כפתור לא לחיוב - מוצג רק כשהטוגל פעיל */}
                    {(customSettings.fieldConfig || DEFAULT_FIELD_CONFIG).billableToggle !== TOGGLE_MODES.HIDDEN && (
                    <div
                        className={styles.projectItem}
                        onClick={addNonBillableReportRow}
                        title={t('allDayModal.tooltips.addNonBillable')}
                    >
                        <span>{nonBillableDisplayLabel}</span>
                        <Plus size={14} color="var(--color-primary)" />
                    </div>
                    )}
                    <input type="text" placeholder={t('allDayModal.search.projectPlaceholder')} className={styles.searchBox} value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} autoFocus />
                    <div className={styles.projectList}>
                        {loadingProjects ? (
                            <div style={{ padding: '10px', color: 'var(--color-text-placeholder)', fontSize: '0.8rem', textAlign: 'center' }}>{t('allDayModal.search.loadingProjects')}</div>
                        ) : filteredProjects.length === 0 ? (
                            <div style={{ padding: '10px', color: 'var(--color-text-placeholder)', fontSize: '0.8rem', textAlign: 'center' }}>{searchTerm ? t('allDayModal.search.noResults') : t('allDayModal.search.noProjectsAvailable')}</div>
                        ) : enableDistinction ? (
                            <>
                                {externalProjects.length > 0 && (
                                    <>
                                        <button
                                            type="button"
                                            className={styles.projectSectionHeader}
                                            onClick={() => setExternalGroupOpen(v => !v)}
                                            aria-expanded={externalGroupOpen}
                                        >
                                            <ChevronDown
                                                size={14}
                                                className={`${styles.sectionChevron} ${externalGroupOpen ? styles.sectionChevronOpen : ''}`}
                                            />
                                            <span>{t('allDayModal.search.externalGroup')} ({externalProjects.length})</span>
                                        </button>
                                        {externalGroupOpen && externalProjects.map(project => (
                                            <div key={project.id} className={styles.projectItem} onClick={() => addReportRow(project)} title={t('allDayModal.tooltips.clickToAdd')}>
                                                <span>{project.name}</span>
                                                <Plus size={14} color="var(--color-primary)" />
                                            </div>
                                        ))}
                                    </>
                                )}
                                {internalProjects.length > 0 && (
                                    <>
                                        <button
                                            type="button"
                                            className={styles.projectSectionHeader}
                                            onClick={() => setInternalGroupOpen(v => !v)}
                                            aria-expanded={internalGroupOpen}
                                        >
                                            <ChevronDown
                                                size={14}
                                                className={`${styles.sectionChevron} ${internalGroupOpen ? styles.sectionChevronOpen : ''}`}
                                            />
                                            <span>{t('allDayModal.search.internalGroup')} ({internalProjects.length})</span>
                                        </button>
                                        {internalGroupOpen && internalProjects.map(project => (
                                            <div key={project.id} className={styles.projectItem} onClick={() => addReportRow(project)} title={t('allDayModal.tooltips.clickToAdd')}>
                                                <span>{project.name}</span>
                                                <Plus size={14} color="var(--color-primary)" />
                                            </div>
                                        ))}
                                    </>
                                )}
                            </>
                        ) : (
                            filteredProjects.map(project => (
                                <div key={project.id} className={styles.projectItem} onClick={() => addReportRow(project)} title={t('allDayModal.tooltips.clickToAdd')}>
                                    <span>{project.name}</span>
                                    <Plus size={14} color="var(--color-primary)" />
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        );
    };
    
    // תצוגת בחירת תאריך סיום
    const renderDaysSelection = () => {
        const typeColor = selectedTypeDetails?.color || 'var(--color-event-reserves)';
        const typeLabel = selectedTypeDetails?.label || '';

        // חישוב מספר הימים לתצוגה
        const calculatedDays = endDate && pendingDate
            ? differenceInDays(endDate, pendingDate) + 1
            : 1;

        return (
            <div className={styles.daysSelectionContainer}>
                <div className={styles.daysSelectionHeader}>
                    <span className={styles.colorDotLarge} style={{ backgroundColor: typeColor }} />
                    <span style={{ marginInlineEnd: '10px', fontSize: '18px', fontWeight: 600 }}>
                        {typeLabel}
                    </span>
                </div>
                
                {/* תאריך התחלה - לקריאה בלבד */}
                <div className={styles.dateRow}>
                    <label className={styles.daysLabel}>{t('allDayModal.labels.fromDate')}</label>
                    <div className={styles.dateDisplay}>
                        {pendingDate?.toLocaleDateString(dateLocale)}
                    </div>
                </div>
                
                {/* תאריך סיום - עם בורר תאריך */}
                <div className={styles.dateRow}>
                    <label className={styles.daysLabel}>{t('allDayModal.labels.toDate')}</label>
                    <div className={styles.datePickerWrapper} ref={datePickerRef}>
                        <button 
                            className={styles.datePickerButton}
                            onClick={() => setShowDatePicker(!showDatePicker)}
                        >
                            <span>{endDate?.toLocaleDateString(dateLocale) || t('allDayModal.labels.pickDate')}</span>
                            <Calendar size={18} color="var(--color-text-secondary)" />
                        </button>
                        {showDatePicker && (
                            <div className={styles.datePickerDropdown}>
                                <CustomDatePicker
                                    selectedDate={endDate}
                                    onDateSelect={(date) => {
                                        // וידוא שתאריך הסיום לא לפני תאריך ההתחלה
                                        if (date >= pendingDate) {
                                            setEndDate(date);
                                        } else {
                                            setEndDate(pendingDate);
                                        }
                                        setShowDatePicker(false);
                                    }}
                                    onClose={() => setShowDatePicker(false)}
                                />
                            </div>
                        )}
                    </div>
                </div>
                
                {/* תצוגת סיכום */}
                <div className={styles.daysSelectionPreview}>
                    <Clock size={16} color="var(--color-text-secondary)" />
                    <span>
                        {calculatedDays === 1
                            ? t('allDayModal.labels.oneDay')
                            : t('allDayModal.labels.manyDays', { count: calculatedDays })}
                    </span>
                </div>
            </div>
        );
    };
    
    // חישוב כותרת לפי מצב התצוגה
    const getModalTitle = () => {
        if (viewMode === 'menu') return t('allDayModal.menuTitle');
        if (viewMode === 'days-selection') {
            return t('allDayModal.daysSelectionTitle', { type: selectedTypeDetails?.label || '' });
        }
        return t('allDayModal.splitTitle');
    };
    
    // חישוב תוכן לפי מצב התצוגה
    const getModalContent = () => {
        if (viewMode === 'menu') return renderMenu();
        if (viewMode === 'days-selection') return renderDaysSelection();
        return renderSplitForm();
    };
    
    return (
        <div className={styles.overlay} onClick={(e) => {
            if (showCloseConfirm) return;
            if (e.target === e.currentTarget) handleCloseAttempt();
        }}>
            <div
                className={`${styles.modal} ${viewMode === 'form' ? styles.modalWide : ''} ${viewMode === 'days-selection' ? styles.modalVisible : ''}`}
                ref={modalRef}
                role="dialog"
                aria-modal="true"
                onClick={e => e.stopPropagation()}
                style={dragModalStyle}
            >
                {isMobile && <div className={styles.dragGrabber} {...dragHandleProps} aria-hidden="true" />}
                <div className={styles.header} {...(isMobile ? dragHandleProps : {})}>
                    <h2>{getModalTitle()}{pendingDate && ` - ${pendingDate.toLocaleDateString(dateLocale)}`}</h2>
                    <button className={styles.closeButton} onClick={handleCloseAttempt}><X size={24} /></button>
                </div>
                {isEditMode && isLocked && (
                    <div className={styles.lockBanner}>{lockReason}</div>
                )}
                <div className={`${styles.content} ${viewMode === 'days-selection' ? styles.contentVisible : ''} ${viewMode === 'form' ? styles.contentForm : ''}`}>{getModalContent()}</div>
                <div className={styles.footer}>
                    {isEditMode && !isLocked && onDelete && <button className={`${styles.button} ${styles.deleteBtn}`} onClick={onDelete}>{t('allDayModal.actions.delete')}</button>}
                    {isEditMode && isManager && isApprovalEnabled && eventToEdit?.isPending && (
                        <>
                            <button className={`${styles.button} ${styles.approveBtn}`} onClick={() => { if (onApprove) onApprove(eventToEdit); onClose(); }}>{t('allDayModal.actions.approve')}</button>
                            <button className={`${styles.button} ${styles.rejectBtn}`} onClick={() => { if (onReject) onReject(eventToEdit); onClose(); }}>{t('allDayModal.actions.reject')}</button>
                        </>
                    )}
                    {viewMode === 'form' && addedReports.length > 0 && (
                        <div className={styles.totalHours}>
                            <span className={styles.totalHoursLabel}>{t('allDayModal.labels.totalHours')}</span>
                            <span className={styles.totalHoursValue}>{calculateTotalHours()}</span>
                        </div>
                    )}
                    <button className={`${styles.button} ${styles.cancelBtn}`} onClick={handleCancelOrBack}>
                        {isEditMode && isLocked ? t('allDayModal.actions.close') : viewMode === 'menu' ? t('allDayModal.actions.cancel') : t('allDayModal.actions.back')}
                    </button>
                    {!(isEditMode && isLocked) && viewMode === 'form' && <button className={`${styles.button} ${styles.saveBtn}`} onClick={handleCreate}>{t('allDayModal.actions.save')}</button>}
                    {!(isEditMode && isLocked) && viewMode === 'days-selection' && (
                        <button className={`${styles.button} ${styles.saveBtn}`} onClick={handleCreateAllDayWithDuration}>
                            {t('allDayModal.actions.create')}
                        </button>
                    )}
                </div>
            </div>
            <ConfirmDialog isOpen={showCloseConfirm} onClose={() => setShowCloseConfirm(false)} onConfirm={() => { setShowCloseConfirm(false); handleCreate(); }} onCancel={() => { setShowCloseConfirm(false); onClose(); }} title={t('allDayModal.unsaved.title')} message={t('allDayModal.unsaved.message')} confirmText={t('allDayModal.unsaved.confirm')} cancelText={t('allDayModal.unsaved.cancel')} confirmButtonStyle="primary" />
        </div>
    );
}
