// קבועים לאשף ההגדרות (SettingsWizard)
// כל הערכים כאן הם נתונים סטטיים: רשימת השלבים, אייקונים, תבניות מובנות,
// תבניות לוחות ליצירה אוטומטית. אין כאן לוגיקה.

/* ---------- Wizard steps (display order) ---------- */
/* Welcome → questions → [portfolio if source==='portfolio'] → install. */
/* `labelKey` נפתר ב-runtime ע"י SettingsWizard.jsx דרך i18next. */
export const buildSteps = (answers) => {
    const steps = [
        { id: 'welcome',   labelKey: 'wizard.steps.welcome.label'   },
        { id: 'questions', labelKey: 'wizard.steps.questions.label' },
    ];
    if (answers?.source === 'portfolio') {
        steps.push({ id: 'portfolio', labelKey: 'wizard.steps.portfolio.label' });
    }
    steps.push({ id: 'install', labelKey: 'wizard.steps.install.label' });
    return steps;
};

// Kept for any importer that still wants a static reference (board mode).
export const STEPS = buildSteps({ source: 'board' });

/* ---------- ימי השבוע (תצוגה בעברית) ---------- */
export const DAYS_HE   = ['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳'];
export const DAYS_FULL = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];

/* ---------- אייקונים (SVG inline strings) ---------- */
/* פורט מהמוקאפ שב־docs/settings-wizard.html (סביב שורות 1709–1732). */
export const ICON = {
    arrowLeft:  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>',
    arrowRight: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>',
    check:      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    check2:     '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    info:       '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
    warn:       '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01"/></svg>',
    sparkles:   '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 14 9 20 11 14 13 12 19 10 13 4 11 10 9 Z"/><path d="M19 3 20 6 23 7 20 8 19 11 18 8 15 7 18 6 Z"/><path d="M5 15 6 17 8 18 6 19 5 21 4 19 2 18 4 17 Z"/></svg>',
    zap:        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z"/></svg>',
    layers:     '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 2 7l10 5 10-5-10-5Z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/></svg>',
    settings:   '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    briefcase:  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',
    listChecks: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 17 2 2 4-4M3 7l2 2 4-4M13 6h8M13 12h8M13 18h8"/></svg>',
    users:      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    fileText:   '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>',
    calendar:   '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
    shield:     '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10ZM9 12l2 2 4-4"/></svg>',
    lock:       '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
    table:      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>',
    target:     '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',
    party:      '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5.8 11.3 2 22l10.7-3.79M4 3h.01M22 8h.01M15 2h.01M22 20h.01M22 2l-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10M22 13.06c-.86 0-1.63.75-1.56 1.62 0 .8-.6 1.55-1.38 1.55-.86 0-1.56.7-1.56 1.58"/></svg>',
    x:          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    refresh:    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
};

/* ---------- תבניות התחלה (presets) לשלב 2 ---------- */
/* כל preset מגדיר fc — ערכי fieldConfig + chips לתצוגה ויזואלית. */
export const TEMPLATES = {
    simple: {
        label:    'פרויקט בלבד',
        tag:      'הפשוט ביותר',
        tagColor: 'var(--muted)',
        desc:     'רק פרויקט ושעות. התחלה מהירה — אפשר להוסיף שדות כשצריך.',
        fc: {
            task:            'hidden',
            stage:           'hidden',
            notes:           'optional',
            billableToggle:  'hidden',
            nonBillableType: 'hidden',
        },
        chips: [
            { d: '',  l: 'פרויקט' },
            { d: '',  l: 'הערות', opt: true },
        ],
    },
    stage: {
        label:    'פרויקט + שלב',
        tag:      'נפוץ',
        tagColor: 'var(--accent)',
        desc:     'דיווח לפי פרויקט עם סיווג שלב (פיתוח, עיצוב, QA...). מבנה שטוח ופשוט.',
        fc: {
            task:            'hidden',
            stage:           'required',
            notes:           'optional',
            billableToggle:  'visible',
            nonBillableType: 'required',
        },
        chips: [
            { d: '',  l: 'פרויקט' },
            { d: 's', l: 'סיווג' },
            { d: '',  l: 'הערות', opt: true },
        ],
    },
    task: {
        label:    'פרויקטים ומשימות',
        tag:      'מומלץ',
        tagColor: 'var(--primary)',
        desc:     'דיווח לפי פרויקט + משימה ספציפית. מתאים לבתי תוכנה, עיצוב, ייעוץ.',
        fc: {
            task:            'required',
            stage:           'optional',
            notes:           'optional',
            billableToggle:  'visible',
            nonBillableType: 'required',
        },
        chips: [
            { d: '',  l: 'פרויקט' },
            { d: 't', l: 'משימה' },
            { d: 'n', l: 'הערות', opt: true },
        ],
    },
};

/* ---------- תבניות לוחות ליצירה אוטומטית (BoardsStep / TimesheetStep) ---------- */
/* כל תבנית מגדירה:
 *   boardName — שם הלוח שייווצר
 *   boardKind — סוג הלוח (public / private / share)
 *   columns   — מערך עמודות עם key, title, type, ו-settings אופציונלי
 *   settingsPatch — אובייקט שמיזוג ל-customSettings אחרי יצירה.
 *
 * סמנים מיוחדים ב-settingsPatch (פותרים ב-useBoardCreation):
 *   '@boardId'        → המזהה של הלוח שנוצר
 *   '@col:<key>'      → מזהה העמודה שנוצרה תחת המפתח <key>
 *   ['@col:<key>']    → מערך עם מזהה עמודה אחד
 */
export const BOARD_TEMPLATES = {
    projects: {
        boardName: 'פרויקטים — Time Tracker',
        boardKind: 'public',
        columns: [
            { key: 'people',         title: 'משויכים',       type: 'people' },
            { key: 'projectType',    title: 'סוג פרויקט',     type: 'status', settings: { labels: { 0: 'פנימי', 1: 'חיצוני' } } },
            { key: 'projectStatus',  title: 'סטטוס פרויקט',  type: 'status', settings: { labels: { 0: 'פעיל', 1: 'הושלם', 2: 'מוקפא' } } },
        ],
        settingsPatch: {
            // הוויזרד יוצר לוח classic — מצב 'board' תמיד.
            projectsSourceMode:            'board',
            connectedBoardId:              '@boardId',
            peopleColumnIds:               ['@col:people'],
            projectTypeColumnId:           '@col:projectType',
            enableProjectTypeDistinction:  true,
            projectTypeMapping:            { '0': 'internal', '1': 'external' },
            projectStatusColumnId:         '@col:projectStatus',
            projectStatusFilterEnabled:    true,
            projectActiveStatusValues:     ['פעיל'],
        },
    },
    tasks: {
        boardName: 'משימות — Time Tracker',
        boardKind: 'public',
        columns: [
            { key: 'taskStatus', title: 'סטטוס משימה', type: 'status', settings: { labels: { 0: 'פעיל', 1: 'הושלם' } } },
        ],
        settingsPatch: {
            tasksBoardId:              '@boardId',
            taskStatusColumnId:        '@col:taskStatus',
            taskStatusFilterEnabled:   true,
            taskActiveStatusValues:    ['פעיל'],
        },
    },
    reporting: {
        boardName: 'דיווחי שעות',
        boardKind: 'public',
        columns: [
            { key: 'date',       title: 'תאריך התחלה', type: 'date' },
            { key: 'endTime',    title: 'תאריך סיום',  type: 'date' },
            { key: 'duration',   title: 'משך',          type: 'numbers' },
            { key: 'reporter',   title: 'מדווח',        type: 'people' },
            { key: 'eventType',  title: 'סוג דיווח',    type: 'status', settings: { labels: { 0: 'יומי', 1: 'שעתי', 2: 'לא לחיוב' } } },
            { key: 'allDayType', title: 'תת-סוג יומי',  type: 'status', settings: { labels: { 0: 'Vacation', 1: 'Sick' } } },
            { key: 'temporary',  title: 'עתידי',        type: 'checkbox' },
            { key: 'nonBillable', title: 'סיווג שוטף', type: 'status', settings: { labels: { 0: 'ישיבה', 1: 'הדרכה', 2: 'אחר' } } },
            { key: 'stage',      title: 'סיווג פרויקט', type: 'status', settings: { labels: { 0: 'פיתוח', 1: 'עיצוב', 2: 'QA' } } },
            { key: 'notes',      title: 'הערות',        type: 'text' },
            { key: 'project',    title: 'פרויקט',       type: 'board_relation' },
            { key: 'task',       title: 'משימה',        type: 'board_relation' },
        ],
        settingsPatch: {
            timeReportingBoardId:        '@boardId',
            useCurrentBoardForReporting: false,
            dateColumnId:                '@col:date',
            endTimeColumnId:             '@col:endTime',
            durationColumnId:            '@col:duration',
            reporterColumnId:            '@col:reporter',
            eventTypeStatusColumnId:     '@col:eventType',
            allDayTypeStatusColumnId:    '@col:allDayType',
            temporaryCheckboxColumnId:   '@col:temporary',
            nonBillableStatusColumnId:   '@col:nonBillable',
            stageColumnId:               '@col:stage',
            notesColumnId:               '@col:notes',
            projectColumnId:             '@col:project',
            taskColumnId:                '@col:task',
            eventTypeMapping: {
                '0': 'allDay',           // יומי
                '1': 'externalProject',  // שעתי (ברירת מחדל; המשתמש יכול לשנות)
                '2': 'routine',          // לא לחיוב
            },
            eventTypeLabelMeta: {
                '0': { label: 'יומי',     color: '#fdab3d' },
                '1': { label: 'שעתי',     color: '#0086c0' },
                '2': { label: 'לא לחיוב', color: '#ff7575' },
            },
        },
    },
};
