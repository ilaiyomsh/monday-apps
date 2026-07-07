import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useStableT } from '../../i18n/useStableT';
import { useSettings, FIELD_MODES, TOGGLE_MODES, DEFAULT_FIELD_CONFIG } from '../../contexts/SettingsContext';
import { useLocale } from '../../hooks/useLocale';
import { useMobile } from '../../contexts/MondayContext';
import { useDragToDismiss } from '../../hooks/useDragToDismiss';
import { useTasks } from '../../hooks/useTasks';
import { useStageOptions } from '../../hooks/useStageOptions';
import { useNonBillableOptions } from '../../hooks/useNonBillableOptions';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { getEffectiveBoardId } from '../../utils/boardIdResolver';
import { getNonBillableIndexes, getLabelText } from '../../utils/eventTypeMapping';
import { getXorExemptFields, getXorErrorMessage } from '../../utils/xorValidation';
import TaskSelect from '../TaskSelect';
import styles from './EventModal.module.css';

export default function EventModal({
    isOpen,
    onClose,
    pendingSlot,
    onCreate,
    eventToEdit = null,
    isEditMode = false,
    isConvertMode = false,
    isLoadingEventData = false,
    onUpdate = null,
    onDelete = null,
    onConvert = null,
    selectedItem: propSelectedItem = null,
    setSelectedItem: setPropSelectedItem = null,
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
    projectsError = null,
}) {
    const t = useStableT();
    const { dateLocale, language } = useLocale();
    const { customSettings } = useSettings();
    const isMobile = useMobile();
    const { createTask, fetchForProject, tasks } = useTasks();

    // Body scroll lock on mobile
    useEffect(() => {
        if (isOpen && isMobile) {
            document.body.style.overflow = 'hidden';
            return () => { document.body.style.overflow = ''; };
        }
    }, [isOpen, isMobile]);

    // State - משתמש ב-prop אם קיים, אחרת state פנימי
    const [internalSelectedItem, setInternalSelectedItem] = useState(null);

    // מציאת selectedItem מה-projects
    const selectedItem = propSelectedItem !== null
        ? (projects.find(p => p.id === propSelectedItem.id) || propSelectedItem)
        : internalSelectedItem;
    const setSelectedItem = setPropSelectedItem || setInternalSelectedItem;

    const [notes, setNotes] = useState("");
    const [selectedTask, setSelectedTask] = useState(null);
    const [selectedStage, setSelectedStage] = useState(null);
    const [isBillable, setIsBillable] = useState(true);
    const [selectedNonBillableType, setSelectedNonBillableType] = useState(null);
    // מצב הבחנה פנימי/חיצוני — מסנן את רשימת הפרויקטים בלבד; השמירה ממשיכה דרך project.projectType
    const enableDistinction = !!customSettings.enableProjectTypeDistinction;
    const [projectTypeFilter, setProjectTypeFilter] = useState('external'); // 'external' | 'internal'

    // האם להציג טוגל לחיוב/לא לחיוב
    const fieldConfig = customSettings.fieldConfig || DEFAULT_FIELD_CONFIG;
    const showBillableToggle = fieldConfig.billableToggle !== TOGGLE_MODES.HIDDEN;
    const [isCreatingTask, setIsCreatingTask] = useState(false);
    // State נפרד למשימות של הפרויקט הנבחר
    const [selectedItemTasks, setSelectedItemTasks] = useState([]);

    // חיפוש פרויקטים במובייל — מצמצם את רשת הכפתורים לפי המחרוזת
    const [projectSearch, setProjectSearch] = useState('');
    // מובייל — שדות שהמשתמש פתח מחדש אחרי בחירה. ברירת מחדל: שדה עם ערך מוצג מכווץ
    // (שורה אחת עם השם + חץ הרחבה) כדי לחסוך גובה ולחשוף את השדות הבאים.
    const [expandedFields, setExpandedFields] = useState(() => new Set());
    const isFieldCollapsed = (field, hasValue) => isMobile && hasValue && !expandedFields.has(field);
    const toggleFieldExpanded = (field) => setExpandedFields(prev => {
        const next = new Set(prev);
        if (next.has(field)) next.delete(field); else next.add(field);
        return next;
    });
    const collapseField = (field) => setExpandedFields(prev => {
        if (!prev.has(field)) return prev;
        const next = new Set(prev);
        next.delete(field);
        return next;
    });

    // State - שגיאות ולידציה
    const [fieldErrors, setFieldErrors] = useState({});
    const formRef = useRef(null);

    const reporterName = context?.user?.name || '';

    // חישוב לוח דיווחים אפקטיבי - העמודות נמצאות בלוח הזה
    const boardId = getEffectiveBoardId(customSettings, context);

    const { stageOptions, loading: loadingStages } = useStageOptions(
        monday,
        customSettings.stageColumnId && boardId ? boardId : null,
        customSettings.stageColumnId
    );

    const { nonBillableOptions, loading: loadingNonBillable } = useNonBillableOptions(
        monday,
        customSettings.nonBillableStatusColumnId && boardId ? boardId : null,
        customSettings.nonBillableStatusColumnId
    );

    // כשהטוגל מוסתר - כל הדיווחים לחיוב אוטומטית
    useEffect(() => {
        if (!showBillableToggle) {
            setIsBillable(true);
            setSelectedNonBillableType(null);
        }
    }, [showBillableToggle]);

    // ref למעקב אם המודל כבר אותחל בפתיחה הנוכחית
    const initializedRef = useRef(false);
    // ref למעקב אם מצב עריכה/המרה כבר אותחל (מונע דריסה כש-projects משתנה)
    const editInitializedRef = useRef(false);
    // ref למעקב אם פרויקט מלא כבר נמצא מ-projects (מונע דריסת בחירת משתמש כשה-API מגיע מאוחר)
    const projectResolvedRef = useRef(false);

    // איפוס הדגלים כשמודל נסגר
    useEffect(() => {
        if (!isOpen) {
            initializedRef.current = false;
            editInitializedRef.current = false;
            projectResolvedRef.current = false;
        }
    }, [isOpen]);

    // אפקט 1: איפוס state במצב יצירה — רק בפתיחה ראשונה
    // לא תלוי ב-projects כדי למנוע דריסת בחירת המשתמש כשפרויקטים נטענים
    useEffect(() => {
        if (isOpen && !isEditMode && !isConvertMode) {
            if (!initializedRef.current) {
                initializedRef.current = true;
                setFieldErrors({});
                setSelectedItem(null);
                setSelectedItemTasks([]);
                setNotes("");
                setSelectedTask(null);
                setSelectedStage(null);
                setIsBillable(true);
                setSelectedNonBillableType(null);
                setIsCreatingTask(false);
                setProjectTypeFilter('external');
            }
        }
    }, [isOpen, isEditMode, isConvertMode, setSelectedItem]);

    // אפקט 2: טעינת state במצב עריכה/המרה
    // editInitializedRef מונע דריסת ערכים כש-projects משתנה אחרי אתחול ראשון
    useEffect(() => {
        if (isOpen && (isEditMode || isConvertMode)) {
            if (isConvertMode && eventToEdit && !editInitializedRef.current) {
                editInitializedRef.current = true;
                setFieldErrors({});
                // מצב המרה - איפוס שדות מלבד הערות
                // המשתמש חייב לבחור פרויקט/משימה/סיווג מחדש
                setSelectedItem(null);
                setSelectedItemTasks([]);
                setSelectedTask(null);
                setSelectedStage(null);
                setIsBillable(true);
                setSelectedNonBillableType(null);
                setIsCreatingTask(false);
                setProjectTypeFilter('external');
                // ההערות כוללות את הכותרת המקורית
                setNotes(eventToEdit.notes || "");
            } else if (isEditMode && !isConvertMode && eventToEdit && !editInitializedRef.current) {
                editInitializedRef.current = true;
                setFieldErrors({});
                // מצב עריכה רגיל - טעינת נתונים קיימים
                setNotes(eventToEdit.notes || "");
                setSelectedTask(eventToEdit.taskId || null);
                setSelectedStage(eventToEdit.stageId || null);
                setIsBillable(eventToEdit.isBillable !== false);
                setSelectedNonBillableType(eventToEdit.nonBillableType || null);

                // שימוש בנתונים ראשוניים אם קיימים באירוע
                if (eventToEdit.selectedProjectData) {
                    setSelectedItem(eventToEdit.selectedProjectData);
                    if (enableDistinction) {
                        setProjectTypeFilter(
                            eventToEdit.selectedProjectData.projectType === 'internal' ? 'internal' : 'external'
                        );
                    }
                }
                if (eventToEdit.selectedTaskData) {
                    setSelectedItemTasks([eventToEdit.selectedTaskData]);
                    setSelectedTask(eventToEdit.selectedTaskData.id);
                }

                if (eventToEdit.projectId) {
                    if (customSettings.tasksProjectColumnId) {
                        fetchForProject(eventToEdit.projectId);
                    }
                }
            }

            // מציאת פרויקט מלא מהרשימה — רץ פעם אחת בלבד (projectResolvedRef מונע דריסה כשה-API מגיע מאוחר)
            // כך בחירת משתמש ידנית לא תידרס אם projects מתעדכן שוב
            if (isEditMode && !isConvertMode && eventToEdit?.projectId && projects.length > 0 && !projectResolvedRef.current) {
                const project = projects.find(p => p.id === eventToEdit.projectId);
                if (project) {
                    projectResolvedRef.current = true;
                    setSelectedItem(project);
                    if (enableDistinction) {
                        setProjectTypeFilter(project.projectType === 'internal' ? 'internal' : 'external');
                    }
                }
            }
        }
    }, [isOpen, isEditMode, isConvertMode, eventToEdit, projects, setSelectedItem, customSettings.tasksProjectColumnId, fetchForProject, enableDistinction]);

    // טעינת משימות כשמשתמש בוחר פרויקט
    // שלב 2: איפוס task/stage בעת החלפת פרויקט במצב עריכה
    useEffect(() => {
        if (selectedItem && !isCreatingTask && customSettings.tasksProjectColumnId) {
            // טעינת משימות במצב יצירה או במצב המרה (שבו המשתמש בוחר פרויקט מחדש)
            if (!isEditMode || isConvertMode) {
                setSelectedItemTasks([]);
                setSelectedTask(null);
                setSelectedStage(null);
                fetchForProject(selectedItem.id);
            }
            // שלב 2 (T-002): במצב עריכה — אם המשתמש מחליף פרויקט, מאפסים task/stage
            else if (isEditMode && !isConvertMode && eventToEdit && eventToEdit.projectId !== selectedItem?.id) {
                setSelectedItemTasks([]);
                setSelectedTask(null);
                setSelectedStage(null);
                fetchForProject(selectedItem.id);
            }
        } else if (!selectedItem) {
            setSelectedItemTasks([]);
        }
    }, [selectedItem, isCreatingTask, customSettings.tasksProjectColumnId, fetchForProject, isEditMode, isConvertMode, eventToEdit]);

    // באירוע חדש — סיווג מתאפס כשאין משימה (progressive disclosure)
    // במצב עריכה/המרה — לא מאפסים, האירוע יכול להכיל סיווג ללא משימה
    useEffect(() => {
        if (!selectedTask && customSettings.stageColumnId && !isEditMode && !isConvertMode) {
            setSelectedStage(null);
        }
    }, [selectedTask, customSettings.stageColumnId, isEditMode, isConvertMode]);

    useEffect(() => {
        if (tasks && tasks.length > 0 && selectedItem) {
            setSelectedItemTasks(tasks);
            // במצב עריכה רגיל (לא המרה) - בחירת המשימה הקיימת
            if (isEditMode && !isConvertMode && eventToEdit?.taskId) {
                const taskExists = tasks.some(t => t.id === eventToEdit.taskId);
                if (taskExists) {
                    setSelectedTask(eventToEdit.taskId);
                }
            }
        } else if (tasks && tasks.length === 0 && selectedItem) {
            if (!isEditMode || isConvertMode || !eventToEdit?.selectedTaskData) {
                setSelectedItemTasks([]);
            }
        }
    }, [tasks, selectedItem, isEditMode, isConvertMode, eventToEdit]);

    const handleCreateTask = async (taskName) => {
        if (!selectedItem) return;
        setIsCreatingTask(true);
        try {
            const newTask = await createTask(selectedItem.id, taskName);
            if (newTask) {
                setSelectedItemTasks(prev => [...prev, newTask]);
                setSelectedTask(newTask.id);
            }
        } finally {
            setIsCreatingTask(false);
        }
    };

    // ניקוי שגיאה כשהמשתמש מתקן שדה
    const clearFieldError = useCallback((field) => {
        setFieldErrors(prev => {
            if (!prev[field]) return prev;
            const next = { ...prev };
            delete next[field];
            return next;
        });
    }, []);

    // אירוע עתידי במצב המרה — הטופס מוסתר לחלוטין, אין שדות לעריכה
    const isFutureEvent = isConvertMode && pendingSlot?.end && pendingSlot.end > new Date();

    // זמן פתיחת המודל — למניעת סגירה מיידית מקליק חיצוני (למשל קונפטי של אירוע קודם)
    const openedAtRef = useRef(0);
    useEffect(() => {
        if (isOpen) openedAtRef.current = Date.now();
    }, [isOpen]);

    const handleCloseAttempt = useCallback(() => {
        // חסום סגירה תוך 500ms מפתיחה — מונע קונפטי/קליק מהיר לסגור מודל חדש
        if (Date.now() - openedAtRef.current < 500) return;
        onClose();
    }, [onClose]);

    const modalRef = useFocusTrap(isOpen, handleCloseAttempt);

    const handleCreate = async () => {
        const fieldConfig = customSettings.fieldConfig || DEFAULT_FIELD_CONFIG;
        const errors = {};

        // חישוב פטורי XOR
        const fieldValues = {
            task: selectedTask,
            stage: selectedStage,
            nonBillableType: selectedNonBillableType,
            notes: notes?.trim()
        };
        const xorExempt = getXorExemptFields(customSettings.advancedValidation, fieldValues);

        // לא לחיוב - נדרש רק סוג דיווח (אם הטוגל פעיל)
        if (!isBillable) {
            if (fieldConfig.nonBillableType === FIELD_MODES.REQUIRED &&
                !selectedNonBillableType && !xorExempt.has('nonBillableType')) {
                errors.nonBillableType = t('eventModal.validation.nonBillableType');
            }
        }

        // לחיוב — פרויקט תמיד חובה
        if (isBillable) {
            if (!selectedItem) {
                errors.project = t('eventModal.validation.project');
            }

            if (fieldConfig.task === FIELD_MODES.REQUIRED &&
                customSettings.taskColumnId && !selectedTask && !xorExempt.has('task')) {
                errors.task = t('eventModal.validation.task');
            }

            if (fieldConfig.stage === FIELD_MODES.REQUIRED &&
                customSettings.stageColumnId && !selectedStage && !xorExempt.has('stage')) {
                errors.stage = t('eventModal.validation.stage');
            }
        }

        // הודעת שגיאה ייחודית כש-2 שדות XOR ריקים
        if (xorExempt.size === 0 && Object.keys(errors).length > 0) {
            const xorMsg = getXorErrorMessage(customSettings.advancedValidation);
            if (xorMsg) {
                const [fieldA, fieldB] = customSettings.advancedValidation.xorFields;
                if (errors[fieldA] || errors[fieldB]) {
                    // החלפת הודעות השגיאה הרגילות בהודעת XOR
                    if (errors[fieldA]) errors[fieldA] = xorMsg;
                    if (errors[fieldB]) errors[fieldB] = xorMsg;
                }
            }
        }

        if (Object.keys(errors).length > 0) {
            setFieldErrors(errors);
            // גלילה לשגיאה הראשונה
            const firstErrorKey = Object.keys(errors)[0];
            const el = formRef.current?.querySelector(`[data-field="${firstErrorKey}"]`);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }

        const task = selectedItemTasks.find(t => t.id === selectedTask);
        const taskName = task?.name || t('eventModal.states.noTask');
        const projectName = selectedItem?.name;

        // קביעת כותרת האירוע לפי fieldConfig
        let eventTitle;
        if (isBillable) {
            // לחיוב - לפי שדות פעילים:
            // task פעיל: "שם הפרויקט - שם המשימה"
            // stage פעיל: "שם הפרויקט - סיווג"
            // שניהם מוסתרים: "שם הפרויקט"
            if (fieldConfig.task !== FIELD_MODES.HIDDEN && selectedTask) {
                eventTitle = projectName ? `${projectName} - ${taskName}` : taskName;
            } else if (fieldConfig.stage !== FIELD_MODES.HIDDEN && selectedStage) {
                eventTitle = selectedStage ? `${projectName} - ${selectedStage}` : projectName;
            } else {
                eventTitle = projectName || t('eventModal.states.noProject');
            }
        } else {
            // לא לחיוב: "סוג לא לחיוב - שם המדווח"
            const nbIndexes = getNonBillableIndexes(customSettings.eventTypeMapping);
            const defaultNbLabel = nbIndexes.length > 0 ? getLabelText(nbIndexes[0], customSettings.eventTypeLabelMeta) : t('eventModal.states.nonBillableDefault');
            const nonBillableLabel = nonBillableOptions.find(opt => opt.label === selectedNonBillableType)?.label || selectedNonBillableType || defaultNbLabel;
            eventTitle = reporterName ? `${nonBillableLabel} - ${reporterName}` : nonBillableLabel;
        }

        const eventData = {
            title: eventTitle,
            itemId: selectedItem?.id,
            project: selectedItem,  // אובייקט פרויקט מלא (כולל projectType)
            assignmentId: selectedItem?.assignmentId,  // מזהה ההקצאה (אם קיים)
            notes: notes,
            taskId: selectedTask,
            stageId: selectedStage,
            isBillable: isBillable,
            nonBillableType: isBillable ? null : selectedNonBillableType
        };

        if (isConvertMode && onConvert) {
            // מצב המרה - המרת אירוע מתוכנן לאירוע רגיל
            onConvert(eventData);
        } else if (isEditMode && onUpdate) {
            onUpdate(eventData);
        } else {
            onCreate(eventData);
        }
        onClose();
    };

    // גרירה כלפי מטה לסגירה במובייל (סגנון bottom-sheet)
    // מושבת אם המודל נעול / יש שינויים שלא נשמרו (כדי לא להפעיל אישור-סגירה בטעות)
    const dragDismissEnabled = isMobile;
    const { handleProps: dragHandleProps, modalStyle: dragModalStyle } = useDragToDismiss({
        enabled: dragDismissEnabled,
        onDismiss: handleCloseAttempt,
    });

    if (!pendingSlot || !isOpen) return null;

    const dateStr = pendingSlot?.start
        ? pendingSlot.start.toLocaleDateString(dateLocale, { weekday: 'long', day: 'numeric', month: 'long' })
        : '';

    const isFormValid = () => {
        const fieldConfig = customSettings.fieldConfig || DEFAULT_FIELD_CONFIG;

        // במצב המרה - אירוע עתידי חוסם שמירה
        if (isFutureEvent) {
            return false;
        }

        // חישוב פטורי XOR
        const fieldValues = {
            task: selectedTask,
            stage: selectedStage,
            nonBillableType: selectedNonBillableType,
            notes: notes?.trim()
        };
        const xorExempt = getXorExemptFields(customSettings.advancedValidation, fieldValues);

        // לא לחיוב - נדרש סוג אירוע רק אם חובה
        if (!isBillable) {
            if (fieldConfig.nonBillableType === FIELD_MODES.REQUIRED) {
                return !!selectedNonBillableType || xorExempt.has('nonBillableType');
            }
            return true;
        }
        // לחיוב - פרויקט חובה תמיד
        if (!selectedItem) return false;

        // משימה חובה — רק אם required
        if (fieldConfig.task === FIELD_MODES.REQUIRED &&
            customSettings.taskColumnId && !selectedTask && !xorExempt.has('task')) {
            return false;
        }

        // סיווג חובה — רק אם required
        if (fieldConfig.stage === FIELD_MODES.REQUIRED &&
            customSettings.stageColumnId && !selectedStage && !xorExempt.has('stage')) {
            return false;
        }

        return true;
    };

    const formIsValid = isFormValid();

    // האם להציג את שדה המלל החופשי (Notes)
    const fcNotes = (customSettings.fieldConfig || DEFAULT_FIELD_CONFIG);
    const notesInXor = customSettings.advancedValidation?.enabled &&
        (customSettings.advancedValidation.xorFields || []).includes('notes');
    // שלב 3: הצגת הערות מיד אם קיימות במצב עריכה
    const showNotesField = fcNotes.notes !== FIELD_MODES.HIDDEN && (
        !isBillable ? !!selectedNonBillableType : (
            selectedItem && (
                notesInXor ||
                (fcNotes.task === FIELD_MODES.HIDDEN && fcNotes.stage === FIELD_MODES.HIDDEN) ||
                (fcNotes.task !== FIELD_MODES.HIDDEN && selectedTask) ||
                (fcNotes.stage !== FIELD_MODES.HIDDEN && selectedStage) ||
                (isEditMode && eventToEdit?.notes) // Show notes immediately in edit mode if present
            )
        )
    );

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && formIsValid && !e.shiftKey && !e.ctrlKey && !e.metaKey && e.target.tagName !== 'TEXTAREA') {
            e.preventDefault();
            handleCreate();
        }
    };

    return (
        <div className={styles.overlay} onClick={(e) => {
            if (e.target === e.currentTarget) handleCloseAttempt();
        }}>
            <div
                className={styles.modal}
                ref={modalRef}
                role="dialog"
                aria-modal="true"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={handleKeyDown}
                tabIndex={-1}
                style={dragModalStyle}
            >
                {isMobile && <div className={styles.dragGrabber} {...dragHandleProps} aria-hidden="true" />}
                <div className={styles.header} {...(isMobile ? dragHandleProps : {})}>
                    <div className={styles.titleGroup}>
                        <h2 className={styles.title}>
                            {isConvertMode ? t('eventModal.convertTitle') : t('eventModal.title')}
                        </h2>
                        <span className={styles.subtitle}>{dateStr}</span>
                    </div>
                    <button className={styles.closeBtn} onClick={handleCloseAttempt} aria-label={t('eventModal.closeAria')}>✕</button>
                </div>

                {/* הודעת נעילה בראש המודל */}
                {isEditMode && !isConvertMode && isLocked && (
                    <div className={styles.lockBanner}>{lockReason}</div>
                )}

                <div className={styles.content} ref={formRef} style={{ position: 'relative' }}>
                    {isLoadingEventData && (
                        <div className={styles.loadingOverlay}>
                            <div className={styles.spinner}></div>
                        </div>
                    )}

                    {/* הודעות מצב המרה */}
                    {isConvertMode && (
                        <div className={styles.convertModeInfo}>
                            {eventToEdit?.originalTitle && (
                                <div className={styles.originalEventInfo}>
                                    <span className={styles.originalEventLabel}>{t('eventModal.originalEvent')}</span>
                                    <span className={styles.originalEventTitle}>{eventToEdit.originalTitle}</span>
                                </div>
                            )}
                            {isFutureEvent && (
                                <div className={styles.futureEventWarning}>
                                    {t('eventModal.futureEventWarning')}
                                </div>
                            )}
                            {!isFutureEvent && (
                                <div className={styles.convertModeHint}>
                                    {t('eventModal.convertHint')}
                                </div>
                            )}
                        </div>
                    )}

                    {/* כל שדות הטופס מוסתרים באירוע עתידי */}
                    {!isFutureEvent && (<>
                    {/* בחירת מצב דיווח - לחיוב / לא לחיוב */}
                    {showBillableToggle && enableDistinction && (
                    <div className={`${styles.modeSelector} ${styles.fixedSection}`}>
                        <button
                            className={`${styles.modeButton} ${isBillable && projectTypeFilter === 'external' ? styles.modeButtonActive : ''}`}
                            onClick={() => {
                                if (isBillable && projectTypeFilter === 'external') return;
                                if (selectedItem && (selectedItem.projectType === 'internal')) {
                                    setSelectedItem(null);
                                    setSelectedTask(null);
                                    setSelectedStage(null);
                                }
                                setIsBillable(true);
                                setProjectTypeFilter('external');
                            }}
                            disabled={isEditMode && isLocked}
                        >
                            {t('eventModal.modes.external')}
                        </button>
                        <button
                            className={`${styles.modeButton} ${isBillable && projectTypeFilter === 'internal' ? styles.modeButtonActive : ''}`}
                            onClick={() => {
                                if (isBillable && projectTypeFilter === 'internal') return;
                                if (selectedItem && selectedItem.projectType !== 'internal') {
                                    setSelectedItem(null);
                                    setSelectedTask(null);
                                    setSelectedStage(null);
                                }
                                setIsBillable(true);
                                setProjectTypeFilter('internal');
                            }}
                            disabled={isEditMode && isLocked}
                        >
                            {t('eventModal.modes.internal')}
                        </button>
                        <button
                            className={`${styles.modeButton} ${!isBillable ? styles.modeButtonActive : ''}`}
                            onClick={() => setIsBillable(false)}
                            disabled={isEditMode && isLocked}
                        >
                            {t('eventModal.modes.routine')}
                        </button>
                    </div>
                    )}
                    {showBillableToggle && !enableDistinction && (
                    <div className={`${styles.modeSelector} ${styles.fixedSection}`}>
                        <button
                            className={`${styles.modeButton} ${isBillable ? styles.modeButtonActive : ''}`}
                            onClick={() => setIsBillable(true)}
                            disabled={isEditMode && isLocked}
                        >
                            {t('eventModal.modes.projects')}
                        </button>
                        <button
                            className={`${styles.modeButton} ${!isBillable ? styles.modeButtonActive : ''}`}
                            onClick={() => setIsBillable(false)}
                            disabled={isEditMode && isLocked}
                        >
                            {t('eventModal.modes.routine')}
                        </button>
                    </div>
                    )}

                    {showBillableToggle && !isBillable && customSettings.nonBillableStatusColumnId && (
                        <div className={`${styles.formGroup} ${styles.fixedSection} ${fieldErrors.nonBillableType ? styles.formGroupError : ''}`} data-field="nonBillableType">
                            <label className={styles.label}>{t('eventModal.fields.nonBillableType')} <span className={styles.required}>*</span></label>
                            {loadingNonBillable ? (
                                <div className={styles.loading}>{t('eventModal.states.loading')}</div>
                            ) : isFieldCollapsed('nonBillableType', !!selectedNonBillableType) && !(isEditMode && isLocked) ? (
                                <button
                                    type="button"
                                    className={styles.collapsedSummary}
                                    onClick={() => toggleFieldExpanded('nonBillableType')}
                                    aria-expanded="false"
                                >
                                    <span className={styles.collapsedSummaryText}>{selectedNonBillableType}</span>
                                    <span className={styles.collapsedSummaryChevron} aria-hidden="true">▾</span>
                                </button>
                            ) : (
                                <div className={styles.grid}>
                                    {nonBillableOptions.map(option => (
                                        <button
                                            key={option.id}
                                            onClick={() => {
                                                const next = option.label === selectedNonBillableType ? null : option.label;
                                                setSelectedNonBillableType(next);
                                                clearFieldError('nonBillableType');
                                                if (next) collapseField('nonBillableType');
                                            }}
                                            className={`${styles.itemButton} ${selectedNonBillableType === option.label ? styles.selected : ''}`}
                                            disabled={isEditMode && isLocked}
                                        >
                                            {option.label}
                                        </button>
                                    ))}
                                </div>
                            )}
                            {fieldErrors.nonBillableType && <span className={styles.fieldError}>{fieldErrors.nonBillableType}</span>}
                        </div>
                    )}

                    {/* פרויקט - רק לדיווח לחיוב */}
                    {isBillable && (
                        <div className={styles.scrollableSection}>
                            <div className={`${styles.formGroup} ${fieldErrors.project ? styles.formGroupError : ''}`} data-field="project">
                                <label className={styles.label}>
                                    {t('eventModal.fields.project')} <span className={styles.required}>*</span>
                                </label>
                                {/* באירוע נעול — מציגים רק את שם הפרויקט הנבחר, ללא רשת */}
                                {isEditMode && isLocked ? (
                                    <div className={styles.readOnlyField}>
                                        {selectedItem ? selectedItem.name : (isLoadingEventData ? t('eventModal.states.loading') : t('eventModal.states.noProjectSelected'))}
                                    </div>
                                ) : isFieldCollapsed('project', !!selectedItem) ? (
                                    <button
                                        type="button"
                                        className={styles.collapsedSummary}
                                        onClick={() => toggleFieldExpanded('project')}
                                        aria-expanded="false"
                                    >
                                        <span className={styles.collapsedSummaryText}>{selectedItem.name}</span>
                                        <span className={styles.collapsedSummaryChevron} aria-hidden="true">▾</span>
                                    </button>
                                ) : (
                                    <>
                                        {/* שדה חיפוש פרויקטים במובייל בלבד — מצמצם את הרשת */}
                                        {isMobile && projects.length >= 6 && (
                                            <input
                                                type="text"
                                                className={styles.projectSearch}
                                                placeholder={t('eventModal.placeholders.projectSearch')}
                                                value={projectSearch}
                                                onChange={(e) => setProjectSearch(e.target.value)}
                                            />
                                        )}
                                        <div className={styles.grid}>
                                            {loadingProjects ? (
                                                <div className={styles.loading}>{t('eventModal.states.loading')}</div>
                                            ) : projectsError ? (
                                                <div className={styles.loading}>{projectsError}</div>
                                            ) : (() => {
                                                const byType = enableDistinction
                                                    ? projects.filter(p => (p.projectType === 'internal' ? 'internal' : 'external') === projectTypeFilter)
                                                    : projects;
                                                const sorted = byType.slice().sort((a, b) => a.name.localeCompare(b.name, language));
                                                const q = projectSearch.trim().toLowerCase();
                                                const filtered = q
                                                    ? sorted.filter(p => p.name.toLowerCase().includes(q))
                                                    : sorted;
                                                if (filtered.length === 0) {
                                                    return <div className={styles.loading}>{t('eventModal.states.noProjectsFound')}</div>;
                                                }
                                                return filtered.map(item => (
                                                    <button
                                                        key={item.id}
                                                        onClick={() => {
                                                            const next = item.id === selectedItem?.id ? null : item;
                                                            setSelectedItem(next);
                                                            clearFieldError('project');
                                                            if (next) collapseField('project');
                                                        }}
                                                        className={`${styles.itemButton} ${selectedItem?.id === item.id ? styles.selected : ''}`}
                                                    >
                                                        {item.name}
                                                    </button>
                                                ));
                                            })()}
                                        </div>
                                    </>
                                )}
                                {fieldErrors.project && <span className={styles.fieldError}>{fieldErrors.project}</span>}
                            </div>
                        </div>
                    )}

                    {/* משימה - מוצג רק אם לא מוסתר */}
                    {isBillable && customSettings.taskColumnId && selectedItem &&
                     (customSettings.fieldConfig || DEFAULT_FIELD_CONFIG).task !== FIELD_MODES.HIDDEN && (
                        <div className={`${styles.formGroup} ${styles.fixedSection} ${fieldErrors.task ? styles.formGroupError : ''}`} data-field="task">
                            <label className={styles.label}>{t('eventModal.fields.task')} {(customSettings.fieldConfig || DEFAULT_FIELD_CONFIG).task === FIELD_MODES.REQUIRED && <span className={styles.required}>*</span>}</label>
                            <div className={styles.productSection}>
                                <TaskSelect
                                    products={selectedItemTasks}
                                    selectedProduct={selectedTask}
                                    onSelectProduct={(id) => { setSelectedTask(id); clearFieldError('task'); }}
                                    onCreateNew={async (taskName) => await handleCreateTask(taskName)}
                                    isLoading={false}
                                    disabled={isEditMode && isLocked}
                                    isCreatingProduct={isCreatingTask}
                                    placeholder={t('eventModal.placeholders.task')}
                                />
                            </div>
                            {fieldErrors.task && <span className={styles.fieldError}>{fieldErrors.task}</span>}
                        </div>
                    )}

                    {/* סיווג - מוצג רק אם לא מוסתר */}
                    {isBillable && customSettings.stageColumnId && selectedItem &&
                     (customSettings.fieldConfig || DEFAULT_FIELD_CONFIG).stage !== FIELD_MODES.HIDDEN && (
                        <div className={`${styles.formGroup} ${styles.fixedSection} ${fieldErrors.stage ? styles.formGroupError : ''}`} data-field="stage">
                            <label className={styles.label}>{t('eventModal.fields.stage')} {(customSettings.fieldConfig || DEFAULT_FIELD_CONFIG).stage === FIELD_MODES.REQUIRED && <span className={styles.required}>*</span>}</label>
                            {isEditMode && isLocked ? (
                                <div className={styles.readOnlyField}>
                                    {selectedStage || t('eventModal.states.noStageSelected')}
                                </div>
                            ) : loadingStages && !selectedStage ? (
                                <div className={styles.loading}>{t('eventModal.states.loading')}</div>
                            ) : loadingStages && selectedStage ? (
                                <div className={styles.readOnlyField}>
                                    {selectedStage}
                                </div>
                            ) : isFieldCollapsed('stage', !!selectedStage) && !(isEditMode && isLocked) ? (
                                <button
                                    type="button"
                                    className={styles.collapsedSummary}
                                    onClick={() => toggleFieldExpanded('stage')}
                                    aria-expanded="false"
                                >
                                    <span className={styles.collapsedSummaryText}>{selectedStage}</span>
                                    <span className={styles.collapsedSummaryChevron} aria-hidden="true">▾</span>
                                </button>
                            ) : (
                                <div className={styles.grid}>
                                    {stageOptions.map(option => (
                                        <button
                                            key={option.id}
                                            onClick={() => {
                                                const next = option.label === selectedStage ? null : option.label;
                                                setSelectedStage(next);
                                                clearFieldError('stage');
                                                if (next) collapseField('stage');
                                            }}
                                            className={`${styles.itemButton} ${selectedStage === option.label ? styles.selected : ''}`}
                                            disabled={isEditMode && isLocked}
                                        >
                                            {option.label}
                                        </button>
                                    ))}
                                </div>
                            )}
                            {fieldErrors.stage && <span className={styles.fieldError}>{fieldErrors.stage}</span>}
                        </div>
                    )}

                    {/* הערות/מלל חופשי - מוצג רק אם מופעל בהגדרות ורק אחרי בחירות רלוונטיות */}
                    {showNotesField && (
                        <div className={`${styles.formGroup} ${styles.fixedSection}`}>
                            <label className={styles.label}>{t('eventModal.fields.notes')} {(customSettings.fieldConfig || DEFAULT_FIELD_CONFIG).notes === FIELD_MODES.REQUIRED && <span className={styles.required}>*</span>}</label>
                            <input
                                type="text"
                                className={styles.input}
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                placeholder={t('eventModal.placeholders.notes')}
                                autoComplete="off"
                                disabled={isEditMode && isLocked}
                            />
                        </div>
                    )}
                    </>)}
                </div>

                <div className={styles.footer}>
                    {(((isEditMode && !isConvertMode && !isLocked) || isFutureEvent)) && onDelete && (
                        <button className={`${styles.btn} ${styles.btnDanger}`} onClick={onDelete}>{t('eventModal.actions.delete')}</button>
                    )}
                    {/* כפתורי אישור/דחייה מנהל */}
                    {isEditMode && !isConvertMode && isManager && isApprovalEnabled && eventToEdit?.isPending && (
                        <>
                            <button
                                className={`${styles.btn} ${styles.btnApprove}`}
                                onClick={() => { if (onApprove) onApprove(eventToEdit); onClose(); }}
                            >
                                {t('eventModal.actions.approve')}
                            </button>
                            <button
                                className={`${styles.btn} ${styles.btnReject}`}
                                onClick={() => { if (onReject) onReject(eventToEdit); onClose(); }}
                            >
                                {t('eventModal.actions.reject')}
                            </button>
                        </>
                    )}
                    <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={handleCloseAttempt}>{(isEditMode && isLocked) || isFutureEvent ? t('eventModal.actions.close') : t('eventModal.actions.cancel')}</button>
                    {!(isEditMode && isLocked) && !isFutureEvent && (
                    <button
                        className={`${styles.btn} ${formIsValid && !isLoadingEventData ? styles.btnPrimaryActive : styles.btnPrimary}`}
                        onClick={handleCreate}
                        disabled={!formIsValid || isLoadingEventData}
                    >
                        {isConvertMode
                            ? t('eventModal.actions.convert')
                            : isEditMode
                                ? (isLoadingEventData ? t('eventModal.states.loading') : t('eventModal.actions.update'))
                                : t('eventModal.actions.save')
                        }
                    </button>
                    )}
                </div>
            </div>
        </div>
    );
}
