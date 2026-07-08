# Code Structure Index - Planner App

## תיאור האפליקציה

**Planner** היא אפליקציית תכנון משאבים המיועדת לחברות שירותים שבהן עלות כוח האדם מהווה את עיקר ההוצאות, והחיוב ללקוח מבוסס על שעות עבודה.

### הבעיה שהאפליקציה פותרת
- **חוסר שקיפות** בהקצאת עובדים לפרויקטים.
- **קושי לזהות** עומס יתר או תת-ניצול של עובדים.
- **היעדר תמונת מצב מדויקת** של כוח האדם אל מול הפרויקטים הפעילים.

### הערך המוסף
- **תצוגת עומס לפי תפקיד** - ראיית הזמינות ברמת התפקיד ולא רק ברמת העובד הבודד.
- **מידע בזמן הקצאה** - בעת שיוך עובד לפרויקט, המערכת מציגה את העומס הנוכחי שלו.
- **יצוא נתונים לבקרה** - היכולת לייצא את נתוני התכנון לצורך השוואה מול הביצוע בפועל.

### קהל היעד
מנהלי פרויקטים בחברות שירותים (סוכנויות, חברות ייעוץ, משרדי פיתוח).

### אופן ההפצה
המוצר נמכר כ-**Monday Solution** - פתרון מלא המשלב לוחות מוכנים, אוטומציות והאפליקציה הזו.

---

מטרה: קובץ זה משמש כאינדקס מרכזי לבסיס הקוד של אפליקציית ה-Planner, ומתעד את הקבצים, הפונקציות והקשרים ביניהם.

## תוכן עניינים
1. [קבצי כניסה](#קבצי-כניסה)
2. [קומפוננטות Gantt](#קומפוננטות-gantt)
3. [קומפוננטות שורות](#קומפוננטות-שורות)
4. [קומפוננטות הגדרות](#קומפוננטות-הגדרות)
5. [Contexts](#contexts)
6. [Hooks](#hooks)
7. [Services](#services)
8. [Utils](#utils)
9. [Types](#types)
10. [Configuration](#configuration)

---

## קבצי כניסה

### main.tsx
- **קובץ**: `src/main.tsx`
- **תיאור**: נקודת הכניסה הראשית של האפליקציה. מאתחלת את ה-DOM ומרנדרת את קומפוננטת App.
- **קלט**: אין
- **פלט**: void
- **קוראת ל**: `App`
- **נקראת מ**: `index.html` (דרך Vite)

### App.tsx
- **קובץ**: `src/App.tsx`
- **תיאור**: קומפוננטת השורש. עוטפת את האפליקציה ב-Providers ומנהלת את התצוגה הראשית.
- **פונקציות פנימיות**:
    - `AppContent`: מנהלת את מצב התצוגה (טעינה, הגדרות, גאנט) על בסיס ה-context.
    - `App`: עוטפת ב-`SettingsProvider` ו-`ActiveProjectsProvider`.
- **קלט**: Props (אין)
- **פלט**: JSX element
- **קוראת ל**: `useMondayContext`, `useSettings`, `GanttProvider`, `GanttChart`, `SettingsDialog`
- **נקראת מ**: `main.tsx`

---

## קומפוננטות Gantt

### GanttProvider.tsx
- **קובץ**: `src/components/Gantt/GanttProvider.tsx`
- **תיאור**: ה-Provider המרכזי של הגאנט. מנהל את כל ה-state, הלוגיקה והנתונים של התצוגה.
- **פונקציות מרכזיות**:
    - `setSidebarWidth`: עדכון רוחב סרגל הצד ב-state.
    - `saveSidebarWidth`: שמירת רוחב סרגל הצד ב-Monday storage.
    - `setViewMode`: שינוי מצב תצוגה (פרויקטים/עובדים) תוך שימוש ב-Transition.
    - `openModal`: פתיחת מודל ההקצאות עם נתונים אופציונליים.
    - `toggleGroup`: פתיחה/סגירה של קבוצה בתצוגה.
    - `updateTask`: עדכון משימה בודדת דרך `updateAllocation`.
- **קלט**: `children: ReactNode`
- **פלט**: JSX Provider עם ערכי Context מקיפים.
- **קוראת ל**: `useAllocations`, `useDataFlattener`, `useInfiniteTimeline`, `useHorizontalVirtualization`, `useCompanyLoad`, `mondayService`
- **נקראת מ**: `App.tsx`

### GanttContext.tsx
- **קובץ**: `src/components/Gantt/GanttContext.tsx`
- **תיאור**: הגדרת ה-Interface וה-Context עבור נתוני הגאנט.
- **קלט**: הגדרות טיפוסים (Interface)
- **פלט**: `GanttContext` object
- **קוראת ל**: אין
- **נקראת מ**: `GanttProvider.tsx`, `useGantt.ts`

### GanttChart.tsx
- **קובץ**: `src/components/Gantt/GanttChart.tsx`
- **תיאור**: קומפוננטת המעטפת הוויזואלית של הגאנט. מנהלת Drag & Drop, סרגל כלים וניווט.
- **פונקציות מרכזיות**:
    - `scrollToToday`: גלילה אוטומטית לתאריך של היום במרכז המסך.
    - `handleDragEnd`: טיפול בסיום גרירה ועדכון תאריכי המשימה.
    - `handleDragStart`: אתחול נתוני המשימה הנגררת עבור ה-Overlay.
- **קלט**: Props (אין)
- **פלט**: JSX element (DndContext wrapper)
- **קוראת ל**: `useGantt`, `useSettings`, `VirtualRowList`, `SettingsDialog`, `TaskBarOverlay`, `ResizeHandle`
- **נקראת מ**: `App.tsx`

### AllocationModal.tsx
- **קובץ**: `src/components/Gantt/AllocationModal.tsx`
- **תיאור**: מודל ליצירה ועריכה של הקצאות. מנהל את טופס ההקצאה וסנכרון בין שעות ליום לסה"כ שעות.
- **פונקציות מרכזיות**:
    - `syncValues`: מסנכרנת בין `hoursPerDay` ל-`totalHours` על בסיס מספר הימים.
    - `handleDateChange`: עדכון תאריכים וסנכרון ערכים מחדש.
    - `handleSubmit`: ולידציה ושליחת הנתונים ל-`onSave`.
- **קלט**: Props כולל `initialData`, `viewMode`, `allProjects`, `employees`.
- **פלט**: JSX Modal.
- **קוראת ל**: `mondayService`, `DatePicker` (Vibe)
- **נקראת מ**: `GanttProvider.tsx`

### TaskBar.tsx
- **קובץ**: `src/components/Gantt/TaskBar.tsx`
- **תיאור**: בר המשימה הניתן לגרירה ושינוי גודל. מציג נתוני מאמץ ואוואטר של העובד.
- **פונקציות מרכזיות**:
    - `handleResizeStart`: ניהול שינוי גודל (Resize) ידני של הבר מהצדדים.
    - `handleAvatarClick`: פתיחת תפריט לבחירת עובד ישירות מהבר.
    - `handleEmployeeSelect`: עדכון העובד המוקצה למשימה.
- **קלט**: `task: Task`
- **פלט**: JSX element (memoized)
- **קוראת ל**: `useGantt`, `useSettings`, `useEmployeeAvailability`, `formatEffort`, `updateTask`
- **נקראת מ**: `TrackRow.tsx`

### TaskBarOverlay.tsx
- **קובץ**: `src/components/Gantt/TaskBarOverlay.tsx`
- **תיאור**: גרסה קלת משקל של בר המשימה המוצגת בזמן גרירה (Drag Overlay).
- **קלט**: `task: Task`
- **פלט**: JSX element
- **קוראת ל**: `useGantt`, `formatDateRange`
- **נקראת מ**: `GanttChart.tsx`

### TimelineHeader.tsx
- **קובץ**: `src/components/Gantt/TimelineHeader.tsx`
- **תיאור**: כותרת ציר הזמן הכוללת שתי רמות (למשל: רבעון וחודש, או שבוע ויום).
- **פונקציות מרכזיות**:
    - `getGroups`: מקבצת ימים ליחידות זמן גדולות לצורך הצגת כותרות.
- **קלט**: Props (אין)
- **פלט**: JSX header
- **קוראת ל**: `useGantt`, `isWorkingDay`
- **נקראת מ**: `VirtualRowList.tsx`

### VirtualRowList.tsx
- **קובץ**: `src/components/Gantt/VirtualRowList.tsx`
- **תיאור**: רשימה וירטואלית של שורות הגאנט. מנהלת גלילה, קווי רשת (Grid) וסנכרון בין הצירים.
- **פונקציות מרכזיות**:
    - `handleScroll`: מסנכרנת גלילה אנכית ואופקית ומפעילה אירועי טעינה אינסופית.
- **קלט**: Props (אין)
- **פלט**: JSX Scroll Container
- **קוראת ל**: `useVirtualizer`, `useGantt`, `useRightClickPan`, `RowRenderer`, `TimelineHeader`
- **נקראת מ**: `GanttChart.tsx`

### GanttContent.tsx
- **קובץ**: `src/components/Gantt/GanttContent.tsx`
- **תיאור**: קומפוננטת עטיפה המציגה ספינר טעינה ממותג עד שנתוני הגאנט מוכנים. מבטיחה זמן אנימציה מינימלי (1.5 שניות) לחוויית משתמש חלקה.
- **קלט**: Props (אין)
- **פלט**: JSX element (GanttChart או FreeFallLoader)
- **קוראת ל**: `useGantt`, `GanttChart`, `FreeFallLoader`, `useMinimumLoadingTime`
- **נקראת מ**: `App.tsx`

### FilterDropdown.tsx
- **קובץ**: `src/components/Gantt/FilterDropdown.tsx`
- **תיאור**: דרופדאון לסינון נתוני הגאנט לפי טווח זמן (מסתיים השבוע/החודש/הכל) וסטטוס ניצולת (אדום/צהוב/ירוק). מציג מספר פילטרים פעילים וכולל כפתור ניקוי.
- **קלט**: Props (אין)
- **פלט**: JSX Dropdown
- **קוראת ל**: `useGantt` (timeframeFilter, utilizationFilter)
- **נקראת מ**: `GanttChart.tsx`

### AddProjectDropdown.tsx
- **קובץ**: `src/components/Gantt/AddProjectDropdown.tsx`
- **תיאור**: כפתור "+" דרופדאון המציג פרויקטים פעילים שאינם מוצגים כרגע בגאנט (פרויקטים ללא הקצאות). כולל חיפוש לסינון פרויקטים.
- **קלט**: `activeProjects`, `allProjects`, `visibleGroupIds`, `onSelect`, `loading?`
- **פלט**: JSX Dropdown עם חיפוש
- **קוראת ל**: אין תלויות חיצוניות
- **נקראת מ**: `GanttChart.tsx`

### PMSelector.tsx
- **קובץ**: `src/components/Gantt/PMSelector.tsx`
- **תיאור**: דרופדאון לבחירת/שינוי מנהל פרויקט מרשימת עובדים בעלי תפקיד PM. מעדכן את עמודת מנהל הפרויקט ב-Monday.
- **פונקציות מרכזיות**:
    - `handleSelectPM`: עדכון מנהל הפרויקט דרך `mondayService.updateItem()`.
- **קלט**: `projectId`, `currentManagerName`, `currentManagerPhotoUrl`, `employees`, `onUpdate`
- **פלט**: JSX Dropdown עם אוואטרים
- **קוראת ל**: `useSettings`, `mondayService.updateItem`, `logger`
- **נקראת מ**: `ProjectSummaryCard.tsx`

### ProjectSummaryCard.tsx
- **קובץ**: `src/components/Gantt/ProjectSummaryCard.tsx`
- **תיאור**: כרטיס סיכום פרויקט המציג מטריקות ברשת 2x2 (עלות כוללת, שעות מתוכננות, שעות מדווחות, עלות לשעה). כולל בורר מנהל פרויקט ואוואטר עם נפילה לאותיות ראשונות.
- **ייצוא**: `ProjectSummaryCard` (memoized), `Avatar` (memoized)
- **פונקציות מרכזיות**:
    - `formatCurrency`: פורמט סכומים בשקלים (ILS).
- **קלט**: `summary: ProjectSummary`, `projectId`, `employees`, `onPMUpdate`
- **פלט**: JSX Card
- **קוראת ל**: `PMSelector`
- **נקראת מ**: `GroupHeaderRow.tsx`

### DatePickerInput.tsx
- **קובץ**: `src/components/Gantt/DatePickerInput.tsx`
- **תיאור**: עטיפת קלט תאריך מותאמת המשתמשת בקומפוננטת DatePicker של Vibe. מטפלת במיקום חכם (נפתחת למעלה/למטה בהתאם למרחב) וסגירה אוטומטית בלחיצה מחוץ.
- **קלט**: `label`, `date`, `onDateChange`
- **פלט**: JSX DatePicker עם פורמט עברי
- **קוראת ל**: `@vibe/core/next` (DatePicker), `date-fns`
- **נקראת מ**: `AllocationModal.tsx`

### ContextMenu.tsx
- **קובץ**: `src/components/Gantt/ContextMenu.tsx`
- **תיאור**: תפריט הקשר קליל המרונדר כ-Portal. מזהה גבולות viewport, תומך ב-Escape לסגירה וזיהוי לחיצה מחוץ.
- **קלט**: `position: {x, y} | null`, `onClose`, `options: Array<{label, onClick, icon?, danger?}>`
- **פלט**: JSX Portal Menu
- **קוראת ל**: `createPortal`
- **נקראת מ**: `TaskBar.tsx`

### ResizeHandle.tsx
- **קובץ**: `src/components/Gantt/ResizeHandle.tsx`
- **תיאור**: ידית גרירה לשינוי רוחב סרגל הצד (Sidebar).
- **פונקציות מרכזיות**:
    - `handleMouseDown`: הפעלת מצב שינוי גודל.
- **קלט**: Props (אין)
- **פלט**: JSX Divider
- **קוראת ל**: `useGantt`
- **נקראת מ**: `GanttChart.tsx`

---

## קומפוננטות שורות

### RowRenderer.tsx
- **קובץ**: `src/components/Gantt/rows/RowRenderer.tsx`
- **תיאור**: רכיב בורר המקבל שורה מהרשימה המושטחת ומחליט איזו קומפוננטה לרנדר.
- **קלט**: `row: FlatRow`
- **פלט**: `GroupHeaderRow` | `TrackRow` | `CompanyLoadRow` | `TaskTrackRow`
- **קוראת ל**: הקומפוננטות הספציפיות לשורות
- **נקראת מ**: `VirtualRowList.tsx`

### GroupHeaderRow.tsx
- **קובץ**: `src/components/Gantt/rows/GroupHeaderRow.tsx`
- **תיאור**: שורת כותרת לקבוצה (פרויקט או עובד). מציגה שם, כמות משימות וויזואליזציה של עומס עבודה.
- **פונקציות מרכזיות**:
    - `handleClick`: פתיחה/סגירה של הקבוצה או פתיחת מודל במידה וזו שורת פלייסהולדר.
- **קלט**: `group: Group`, `isExpanded?: boolean`
- **פלט**: JSX row (עם sticky sidebar)
- **קוראת ל**: `useGantt`, `useWorkloadCalculator`
- **נקראת מ**: `RowRenderer.tsx`

### TrackRow.tsx
- **קובץ**: `src/components/Gantt/rows/TrackRow.tsx`
- **תיאור**: שורה המכילה מספר משימות שאינן חופפות (tracks). מאפשרת יצירת משימה חדשה בגרירה על שטח ריק.
- **פונקציות מרכזיות**:
    - `handleMouseDown`: התחלת בחירת טווח תאריכים ליצירת משימה חדשה.
- **קלט**: `items: Task[]`, `groupId: GroupId`, `trackIndex: number`
- **פלט**: JSX row עם `TaskBar` לכל משימה.
- **קוראת ל**: `TaskBar`, `useGantt`
- **נקראת מ**: `RowRenderer.tsx`

### TaskTrackRow.tsx
- **קובץ**: `src/components/Gantt/rows/TaskTrackRow.tsx`
- **תיאור**: קומפוננטת מורשת (Legacy) המציגה משימה בודדת בשורה משלה.
- **קלט**: `task: Task`
- **פלט**: JSX row.
- **קוראת ל**: `TaskBar`, `useGantt`
- **נקראת מ**: `RowRenderer.tsx`

### CompanyLoadRow.tsx
- **קובץ**: `src/components/Gantt/rows/CompanyLoadRow.tsx`
- **תיאור**: שורה המציגה את עומס החברה לפי תפקיד. מחשבת אגרגציה של שעות לפי ZoomLevel.
- **פונקציות מרכזיות**:
    - `aggregateLoad`: מחשבת ניצולת וזמינות עבור טווח תאריכים ספציפי.
- **קלט**: `loadData: LoadRowType`
- **פלט**: JSX row המכיל `LoadCell` לכל יחידת זמן.
- **קוראת ל**: `LoadCell`, `useGantt`
- **נקראת מ**: `RowRenderer.tsx`

### LoadCell.tsx
- **קובץ**: `src/components/Gantt/rows/LoadCell.tsx`
- **תיאור**: תא בודד בשורת עומס חברה המציג "מפת חום" (Heatmap) של זמינות או עומס יתר.
- **פונקציות מרכזיות**:
    - `getCircleStyle`: קובעת צבע וגודל לעיגול הוויזואלי על פי אחוז הניצולת.
- **קלט**: `load: DailyLoad`, `totalCapacity: number`
- **פלט**: JSX cell עם עיגול צבעוני.
- **קוראת ל**: `formatNum`
- **נקראת מ**: `CompanyLoadRow.tsx`

---

## קומפוננטות הגדרות

### SettingsDialog.tsx
- **קובץ**: `src/components/Settings/SettingsDialog.tsx`
- **תיאור**: הדיאלוג המרכזי לניהול הגדרות האפליקציה. מאפשר מיפוי לוחות ועמודות מ-Monday.
- **פונקציות מרכזיות**:
    - `handleSyncHours`: סנכרון אוטומטי בין שעות ליום/שבוע/חודש.
    - `handleSave`: שמירת ההגדרות (commit) ל-Context.
    - `loadBoards` / `loadAllocationsColumns`: טעינת נתונים בזמן אמת מ-Monday API.
- **קלט**: `isOpen: boolean`, `onClose: () => void`, `boardId?: number`
- **פלט**: JSX Modal עם טאבים וסקשנים.
- **קוראת ל**: `useSettings`, `useSettingsValidation`, `mondayService`, `SearchableSelect`, `MultiSelect`
- **נקראת מ**: `App.tsx`, `GanttChart.tsx`

### SettingsTabs.tsx
- **קובץ**: `src/components/Settings/SettingsTabs.tsx`
- **תיאור**: ניהול המעבר בין הטאבים השונים בהגדרות (הקצאות, עובדים, כללי).
- **קלט**: `children: ReactNode`
- **פלט**: JSX Tabs container
- **קוראת ל**: אין
- **נקראת מ**: `SettingsDialog.tsx`

### SettingsSection.tsx
- **קובץ**: `src/components/Settings/SettingsSection.tsx`
- **תיאור**: רכיב אקורדיון לקיבוץ הגדרות תחת כותרת עם חיווי על השלמה.
- **קלט**: `title`, `isOpen`, `onToggle`, `isComplete`
- **פלט**: JSX Accordion
- **קוראת ל**: אין
- **נקראת מ**: `SettingsDialog.tsx`

### SearchableSelect.tsx
- **קובץ**: `src/components/Settings/SearchableSelect.tsx`
- **תיאור**: רכיב בחירה (Dropdown) הכולל חיפוש ומיקום דינמי (Portal).
- **קלט**: `options`, `value`, `onChange`, `isLoading`
- **פלט**: JSX Select component
- **קוראת ל**: אין
- **נקראת מ**: `SettingsDialog.tsx`

### MultiSelect.tsx
- **קובץ**: `src/components/Settings/MultiSelect.tsx`
- **תיאור**: רכיב בחירה מרובה המציג את הערכים הנבחרים כ"תגיות".
- **קלט**: `options`, `value: string[]`, `onChange`
- **פלט**: JSX Multi-select component
- **קוראת ל**: אין
- **נקראת מ**: `SettingsDialog.tsx`

### index.ts
- **קובץ**: `src/components/Settings/index.ts`
- **תיאור**: Barrel file המייצא את כל קומפוננטות ההגדרות לשימוש חיצוני נוח.

---

## קומפוננטות UI

### FreeFallLoader.tsx
- **קובץ**: `src/components/ui/FreeFallLoader.tsx`
- **תיאור**: ספינר טעינה ממותג בסגנון Monday.com עם שלושה פסים צבעוניים (ירוק, צהוב, אדום) הנופלים בתזמון מדורג. מייצא גם Hook להבטחת זמן טעינה מינימלי.
- **ייצוא**:
    - `FreeFallLoader`: קומפוננטת אנימציית SVG.
    - `useMinimumLoadingTime`: Hook לעיכוב תצוגת תוכן עד שגם הנתונים מוכנים וגם עבר זמן מינימלי.
    - `ANIMATION_CYCLE_MS`: קבוע (1500ms).
- **קלט (FreeFallLoader)**: `size` (ברירת מחדל 80), `className?`
- **קלט (useMinimumLoadingTime)**: `isDataReady: boolean`, `minTimeMs?: number`
- **פלט**: JSX SVG Animation / boolean
- **קוראת ל**: אין תלויות חיצוניות
- **נקראת מ**: `GanttContent.tsx`

### index.ts
- **קובץ**: `src/components/ui/index.ts`
- **תיאור**: Barrel file המייצא את כל קומפוננטות ה-UI לשימוש חיצוני נוח.

---

## Contexts

### SettingsContext.tsx
- **קובץ**: `src/contexts/SettingsContext.tsx`
- **תיאור**: ניהול גלובלי של הגדרות האפליקציה. משמש כגשר בין ה-UI לבין ה-Storage של Monday.
- **פונקציות מרכזיות**:
    - `updateSettings`: עדכון הגדרות קיים ושמירתן ב-Monday.
- **קלט**: `children: ReactNode`
- **פלט**: `SettingsProvider` ו-Hook `useSettings`.
- **קוראת ל**: `useMondaySettings`
- **נקראת מ**: `App.tsx`, `SettingsDialog.tsx`, `GanttProvider.tsx`, ועוד.

### ActiveProjectsContext.tsx
- **קובץ**: `src/contexts/ActiveProjectsContext.tsx`
- **תיאור**: ניהול רשימת הפרויקטים הפעילים לצורך סינון משימות בתצוגה.
- **פונקציות מרכזיות**:
    - `fetchActiveProjects`: שליפת מזהי פרויקטים מלוח הפרויקטים על פי הסטטוסים שהוגדרו.
- **קלט**: `children: ReactNode`
- **פלט**: `ActiveProjectsProvider` ו-Hook `useActiveProjects`.
- **קוראת ל**: `useSettings`, `mondayService.fetchActiveProjectIds`
- **נקראת מ**: `App.tsx`, `useAllocations.ts`

---

## Hooks

### useAllocations
- **קובץ**: `src/hooks/useAllocations.ts`
- **תיאור**: Hook מרכזי לניהול נתוני הקצאות, עובדים ותפקידים. מטפל ב-CRUD אופטימי וסנכרון מול ה-API.
- **קלט**: `viewMode: ViewMode`
- **פלט**: `groups`, `employees`, `roles`, `addAllocation`, `updateAllocation`, `deleteAllocation`, `allocationsVersion`
- **קוראת ל**: `allocationsApi`, `mondayService`, `groupAllocations` (utils)
- **נקראת מ**: `GanttProvider.tsx`

### useCompanyLoad
- **קובץ**: `src/hooks/useCompanyLoad.ts`
- **תיאור**: חישוב עומס עבודה מצטבר ברמת החברה עבור כל תפקיד.
- **קלט**: `allocations`, `employees`, `timelineStart`, `timelineEnd`, `settings`
- **פלט**: `CompanyLoadData` (מפות של עומס לפי תפקיד ותאריך)
- **קוראת ל**: `isWorkingDay` (utils)
- **נקראת מ**: `GanttProvider.tsx`

### useCoordinateSystem
- **קובץ**: `src/hooks/useCoordinateSystem.ts`
- **תיאור**: המרות בין עולם התאריכים לעולם הפיקסלים (X position, width).
- **פונקציות**: `getXByDate`, `getDateByX`, `getWidthByDates`
- **קלט**: `zoomLevel`, `timelineStart`
- **פלט**: פונקציות עזר לחישוב מיקומים.
- **קוראת ל**: אין
- **נקראת מ**: `useInfiniteTimeline.ts`

### useDataFlattener
- **קובץ**: `src/hooks/useDataFlattener.ts`
- **תיאור**: השטחת מבנה הנתונים היררכי (קבוצות -> משימות) לרשימה שטוחה של שורות עבור הרשימה הוירטואלית. כולל אלגוריתם Track Packing.
- **קלט**: `groups`, `expandedGroups`, `viewMode`, `companyLoadData`
- **פלט**: `flattenedData` (מערך שורות), `totalHeight`
- **קוראת ל**: `packTasksIntoTracks`
- **נקראת מ**: `GanttProvider.tsx`

### useEmployeeAvailability
- **קובץ**: `src/hooks/useEmployeeAvailability.ts`
- **תיאור**: חישוב זמינות ועומס לכל עובד בטווח תאריכים ספציפי (עבור בחירת עובד ב-TaskBar).
- **קלט**: `employees`, `allTasks`, `startDate`, `endDate`, `settings`
- **פלט**: `Map<string, AvailabilityData>`
- **קוראת ל**: `countWorkingDays`
- **נקראת מ**: `TaskBar.tsx`

### useGantt
- **קובץ**: `src/hooks/useGantt.ts`
- **תיאור**: Hook פשוט לגישה ל-GanttContext.
- **פלט**: `GanttContextType`
- **נקראת מ**: רוב קומפוננטות הגאנט.

### useHorizontalVirtualization
- **קובץ**: `src/hooks/useHorizontalVirtualization.ts`
- **תיאור**: חישוב טווח הימים הנראה לעין לצורך רינדור אופטימלי של ציר הזמן והרשת.
- **קלט**: `scrollLeft`, `containerWidth`, `itemWidth`, `totalItems`
- **פלט**: `startIndex`, `endIndex`, `offsetLeft`
- **נקראת מ**: `GanttProvider.tsx`, `TimelineHeader.tsx`

### useInfiniteTimeline
- **קובץ**: `src/hooks/useInfiniteTimeline.ts`
- **תיאור**: ניהול ציר זמן "אינסופי" שגדל דינמית כשגוללים לקצוות.
- **פונקציות**: `handleScroll` (מעדכנת גבולות), `getXByDate`, `getDateByX`
- **קלט**: `zoomLevel`
- **פלט**: תאריכי התחלה/סיום, רשימת ימים, ופונקציות המרה.
- **קוראת ל**: `useCoordinateSystem`
- **נקראת מ**: `GanttProvider.tsx`

### useMondayContext
- **קובץ**: `src/hooks/useMondayContext.ts`
- **תיאור**: קבלת ה-Context מה-SDK של Monday (משתמש, לוח, ערכת נושא) וחישוב הרשאות.
- **פלט**: `context`, `permissions`, `isBoardOwner`
- **קוראת ל**: `monday.get('context')`, `mondayService.getBoardOwners`
- **נקראת מ**: `App.tsx`

### useMondaySettings
- **קובץ**: `src/hooks/useMondaySettings.ts`
- **תיאור**: ניהול שמירה וטעינה של הגדרות האפליקציה מול ה-Instance Storage של Monday.
- **פונקציות**: `loadSettings`, `saveSettings`
- **פלט**: הגדרות, מצב טעינה/שמירה, האם האפליקציה מוגדרת.
- **קוראת ל**: `monday.storage.instance`
- **נקראת מ**: `SettingsContext.tsx`

### useRightClickPan
- **קובץ**: `src/hooks/useRightClickPan.ts`
- **תיאור**: מימוש יכולת גרירה (Panning) של הגאנט באמצעות המקש הימני של העכבר.
- **קלט**: `containerRef`
- **פלט**: `isPanning`, `handlers` (onMouseDown, onContextMenu)
- **נקראת מ**: `VirtualRowList.tsx`

### useSettingsValidation
- **קובץ**: `src/hooks/useSettingsValidation.ts`
- **תיאור**: ולידציה של הגדרות האפליקציה (בדיקת קיום עמודות ולוחות נדרשים).
- **קלט**: `settings`, `context`
- **פלט**: `isValid`, `errors`, `getFieldError`
- **נקראת מ**: `SettingsDialog.tsx`

### useAutoScroll
- **קובץ**: `src/hooks/useAutoScroll.ts`
- **תיאור**: Hook המאפשר גלילה אוטומטית של קונטיינר כאשר העכבר קרוב לקצוות. בשימוש בזמן גרירה ושינוי גודל.
- **קלט**: `containerRef`, `isActive`, `edgeThreshold?` (ברירת מחדל 100), `scrollSpeed?` (ברירת מחדל 15)
- **פלט**: `{ updateFromMouse }` - פונקציה לעדכון כיוון הגלילה ממיקום העכבר.
- **קוראת ל**: `requestAnimationFrame`
- **נקראת מ**: `TaskBar.tsx`

### useOverlapValidation
- **קובץ**: `src/hooks/useOverlapValidation.ts`
- **תיאור**: Hook לולידציית חפיפות הקצאות בזמן אמת. בודק אם הקצאה חדשה/נערכת מתנגשת עם הקצאות קיימות לאותו עובד+פרויקט. מדלג אוטומטית על עובדים לא משויכים.
- **קלט**: `employeeId`, `projectId`, `startDate`, `endDate`, `allAllocations`, `currentId?`
- **פלט**: `OverlapResult` - `{ hasOverlap, overlappingAllocations }`
- **קוראת ל**: `findOverlappingAllocations` (overlapUtils)
- **נקראת מ**: `AllocationModal.tsx`

### useUserPhotos
- **קובץ**: `src/hooks/useUserPhotos.ts`
- **תיאור**: Hook לניהול מטמון תמונות משתמשים עם Monday Instance Storage. טוען תמונות מהמטמון ומרענן מה-API אם המשתמש הוא אדמין.
- **קלט**: `isAdmin: boolean`, `userIds: string[]`
- **פלט**: `{ photoMap, loading, getPhotoUrl, refreshPhotos }`
- **קוראת ל**: `mondaySdk` (Instance Storage), `mondayService.fetchUserPhotos`, `logger`
- **נקראת מ**: קומפוננטות המציגות אוואטרים של עובדים

### useProjectCosts
- **קובץ**: `src/hooks/useProjectCosts.ts`
- **תיאור**: Hook לחישוב מטריקות עלות לפרויקט על בסיס הקצאות ותעריפי עובדים. מחשב עלות כוללת, שעות מתוכננות, עלות שעתית ממוצעת.
- **ייצוא**: `useProjectCosts`, `formatCost`, `formatHours`
- **קלט**: `projectId`, `allocations`, `employees`, `workDays?`
- **פלט**: `ProjectCostMetrics` - `{ totalPlannedHours, averageHourlyCost, totalPlannedCost, employeesWithCost }`
- **קוראת ל**: `countWorkingDays` (workDaysUtils)
- **נקראת מ**: `ProjectSummaryCard.tsx`

### useWorkloadCalculator
- **קובץ**: `src/hooks/useWorkloadCalculator.ts`
- **תיאור**: חישוב עומס עבודה (Workload) עבור קבוצה או עובד ספציפי בטווח זמן.
- **קלט**: `tasks`, `displayDays`, `zoomLevel`, `employeeId`, `settings`
- **פלט**: `WorkloadMap` (סטטוס עומס לפי יחידת זמן)
- **קוראת ל**: `isWorkingDay` (utils)
- **נקראת מ**: `GroupHeaderRow.tsx`

---

## Services

### mondayService.ts
- **קובץ**: `src/services/mondayService.ts`
- **תיאור**: שכבת התקשורת הגנרית מול Monday API. מנהלת קריאות GraphQL, פגינציה (Cursors) ואימות שגיאות.
- **פונקציות מרכזיות**:
    - `fetchItems` / `_fetchPaginatedItems`: שליפת פריטים מלוח עם תמיכה בדפים מרובים.
    - `createItem` / `updateItem` / `deleteItem`: פעולות מוטציה בסיסיות.
    - `fetchColumns`: שליפת הגדרות עמודות לצורך קבלת labels וצבעים.
    - `fetchActiveProjectIds`: שאילתה מורכבת עם `ItemsQueryRule` לסינון פרויקטים.
- **קלט**: שאילתות GraphQL ופרמטרים.
- **פלט**: נתונים גולמיים מה-API.
- **קוראת ל**: `monday.api`
- **נקראת מ**: `allocationsApi.ts`, `SettingsDialog.tsx`, `useMondayContext.ts`.

### allocationsApi.ts
- **קובץ**: `src/services/allocationsApi.ts`
- **תיאור**: שכבת ה-API הייעודית עבור ישויות המערכת (הקצאות ועובדים). מבצעת טרנספורמציה בין הפורמט של Monday לפורמט הפנימי של האפליקציה.
- **פונקציות מרכזיות**:
    - `getAll`: שליפת כל ההקצאות והמרתן לאובייקטי `Allocation`.
    - `getEmployees`: שליפת כל העובדים והמרתם לאובייקטי `Employee`.
    - `create` / `update`: הכנת ערכי עמודות (Mutation values) ושליחה ל-`mondayService`.
- **קלט**: אובייקטים עסקיים והגדרות.
- **פלט**: אובייקטים מעובדים (Mapped entities).
- **קוראת ל**: `mondayService`, `mondayTransformers`
- **נקראת מ**: `useAllocations.ts`

---

## Utils

### dateUtils.ts
- **קובץ**: `src/utils/dateUtils.ts`
- **תיאור**: פונקציות עזר לפורמט תאריכים בשימוש הגאנט.
- **פונקציות**:
    - `formatDateRange`: מחזירה מחרוזת עברית תמציתית לטווח תאריכים (למשל "12 - 15 ביוני").
    - `getDynamicDates`: מחשבת תאריכים חדשים על בסיס היסט פיקסלים (בשימוש ב-Resize ו-Drag).
- **נקראת מ**: `TaskBar.tsx`, `TaskBarOverlay.tsx`.

### allocationUtils.ts
- **קובץ**: `src/utils/allocationUtils.ts`
- **תיאור**: לוגיקה עסקית לקיבוץ ועיבוד הקצאות.
- **פונקציות**:
    - `groupAllocations`: הופכת רשימת הקצאות שטוחה למבנה היררכי של קבוצות (פרויקטים/עובדים) ומשימות, כולל חישובי צבעים ואחוז משרה.
- **נקראת מ**: `useAllocations.ts`.

### colorUtils.ts
- **קובץ**: `src/utils/colorUtils.ts`
- **תיאור**: ניהול מערכת הצבעים של הפרויקטים, תואם ל-Vibe Design System.
- **פונקציות**:
    - `getProjectColor`: מייצרת צבע עקבי (Deterministic) על בסיס מזהה הפרויקט.
    - `ensureDarkEnough`: מוודאת שהצבע מתאים לקריאות של טקסט לבן מעליו.
- **נקראת מ**: `allocationUtils.ts`.

### constants.ts
- **קובץ**: `src/utils/constants.ts`
- **תיאור**: ריכוז קבועים למערכת (גודל פיקסלים ליום בכל רמת זום, גבהי שורות, באפרים לוירטואליזציה).
- **משתנה מרכזי**: `CONFIG`.

### effortUtils.ts
- **קובץ**: `src/utils/effortUtils.ts`
- **תיאור**: פונקציות לחישוב והצגת "מאמץ" (Effort) בפורמטים שונים.
- **פונקציות**:
    - `formatEffort`: המרה בין שעות ליום, שעות לשבוע, אחוז משרה וכו'.
    - `isOverCapacity`: בדיקה האם הקצאה חורגת מהתקן המותר.
- **נקראת מ**: `TaskBar.tsx`, `GroupHeaderRow.tsx`, `GanttChart.tsx`.

### mondayTransformers.ts
- **קובץ**: `src/utils/mondayTransformers.ts`
- **תיאור**: המרת המבנה הגולמי של Monday (עמודות וערכים) לישויות האפליקציה ולהפך.
- **פונקציות**:
    - `transformMondayItemToAllocation`: המרה לישות `Allocation`.
    - `transformMondayItemToEmployee`: המרה לישות `Employee`.
    - `prepareAllocationMutationValues`: הכנת אובייקט JSON לשליחה במוטציה ל-Monday.
- **נקראת מ**: `allocationsApi.ts`, `GanttProvider.tsx`.

### workDaysUtils.ts
- **קובץ**: `src/utils/workDaysUtils.ts`
- **תיאור**: פונקציות לחישוב ימי עבודה (דילוג על סופי שבוע מוגדרים).
- **פונקציות**:
    - `countWorkingDays`: סופרת רק ימי עבודה בטווח תאריכים.
    - `isWorkingDay`: בודקת אם יום ספציפי מוגדר כיום עבודה.
- **נקראת מ**: `useCompanyLoad.ts`, `useWorkloadCalculator.ts`, `effortUtils.ts`.

### Logger.ts
- **קובץ**: `src/utils/Logger.ts`
- **תיאור**: שירות Logging סינגלטון צד-לקוח עם ברירות מחדל תלויות סביבה, שליטה בזמן ריצה דרך `window.AppLogger`, ושמירת הגדרות ב-localStorage.
- **ייצוא**: `logger` (singleton), `LogLevel` type
- **פונקציות ציבוריות**:
    - `debug`, `info`, `warn`, `error`: רישום הודעות ברמות שונות.
    - `labeled(label, level, ...args)`: רישום עם תווית מותאמת.
    - `createLabeled(label)`: יצירת אובייקט עם מתודות מתויגות מראש.
    - `setLevel`, `enable`, `disable`, `getConfig`, `reset`: שליטה בהגדרות.
- **שליטה מהקונסול**: `window.AppLogger.setLevel('DEBUG')`, `.enable()`, `.disable()`, `.getConfig()`, `.reset()`
- **נקראת מ**: ברחבי הקוד כולו - `PMSelector.tsx`, `useUserPhotos.ts` ועוד.

### overlapUtils.ts
- **קובץ**: `src/utils/overlapUtils.ts`
- **תיאור**: פונקציות עזר לזיהוי חפיפות בהקצאות. מספקת בדיקת חפיפת טווחי תאריכים וסינון הקצאות מתנגשות.
- **ייצוא**: `datesOverlap`, `findOverlappingAllocations`, `OverlapResult`
- **פונקציות**:
    - `datesOverlap(startA, endA, startB, endB)`: בדיקה בוליאנית לחפיפת טווחים.
    - `findOverlappingAllocations(employeeId, projectId, startDate, endDate, existingAllocations, excludeId?)`: מחזירה רשימת הקצאות מתנגשות לאותו עובד+פרויקט.
- **נקראת מ**: `useOverlapValidation.ts`

---

## Types

### gantt.types.ts
- **קובץ**: `src/types/gantt.types.ts`
- **תיאור**: הגדרות הטיפוסים המרכזיות של הגאנט.
- **טיפוסים מרכזיים**:
    - `Task`: ייצוג UI של הקצאה, כולל צבע, אוואטר ומיקום.
    - `Group`: קבוצה של משימות (פרויקט או עובד).
    - `FlatRow`: Union type של כל סוגי השורות ברשימה הוירטואלית (`GROUP`, `TRACK`, `LOAD`).
    - `ViewMode`: מצבי תצוגה (`projects` / `employees`).
    - `ZoomLevel`: רמות זום (`day`, `week`, `month`, `quarter`).

### settings.types.ts
- **קובץ**: `src/types/settings.types.ts`
- **תיאור**: מבנה אובייקט ההגדרות של האפליקציה.
- **טיפוסים מרכזיים**:
    - `PlannerSettings`: מיפוי כל העמודות והלוחות מ-Monday, כולל הגדרות שעות עבודה ותצוגה.
    - `EffortDisplayMode`: אפשרויות תצוגת המאמץ (שעות ליום, FTE וכו').

### Entities (`src/types/entities/`)
- **allocation.types.ts**: הגדרת ישות ההקצאה הבסיסית כפי שהיא נשמרת ב-DB (Monday).
- **employee.types.ts**: הגדרת ישות העובד, כולל אחוז משרה ועלות.
- **project.types.ts**: הגדרת ישות פרויקט.
- **role.types.ts**: הגדרת תפקיד ומיפוי צבעים דינמי לתפקידים.

---

## Configuration

### vite.config.ts
- **תיאור**: הגדרות ה-Bundler (Vite). כולל הגדרות שרת פיתוח (פורט 8301) ואישור Hosts עבור Monday.com.

### eslint.config.js
- **תיאור**: הגדרות ה-Linter לשמירה על איכות וסגנון הקוד (TypeScript + React).

### package.json
- **תיאור**: ניהול ספריות (Dependencies) וסקריפטים להרצה, בנייה ופריסה (Deploy) ל-Monday.

### tsconfig.json / tsconfig.app.json
- **תיאור**: הגדרות הקומפילציה של TypeScript עבור האפליקציה.
