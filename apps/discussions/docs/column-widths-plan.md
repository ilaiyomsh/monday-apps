# תוכנית: רוחב עמודות דינמי + שמירה לכל הטבלאות

> מסמך תכנון. נכתב 2026-06-28. מבוסס על מחקר מנגנון `CEO_Display` + מיפוי הטבלאות והאחסון של אפליקציית הדיונים.

---

## 0. מה למדנו מ-`CEO_Display`

`CEO_Display` מממשת רוחב-עמודות נגרר ונשמר בעזרת שני פרימיטיבים:

**`ColumnWidthContext`** (Context + `useState` + `ref`):
- `state`: אובייקט `{ [columnKey]: numberPx }` — רוחב לכל עמודה בפיקסלים.
- `constants`: `DEFAULT_COLUMN_WIDTHS_PX` + `COLUMN_WIDTH_CONSTRAINTS` עם `{ min, default, max }` לכל עמודה.
- API: `{ columnWidths, updateColumnWidth, resetColumnWidth, resetAllWidths, isLoading }`.
- **שמירה:** `monday.storage.instance` (per-user, per-instance), מפתח `'ceo_display_column_widths'`, ערך `JSON.stringify`. טעינה ב-mount; שמירה **debounced 500ms** אחרי הגרירה האחרונה. קריאה דרך `ref` (כדי לעקוף stale-closure). כשל בטעינה → defaults; כשל בשמירה → `logger.warn` בלבד, לא זורק.
- **ולידציה:** `mergeWithDefaults()` מהדק כל ערך ל-`[min,max]` וממזג מעל ה-defaults, כך ש-blob פגום מתדרדר בחן.

**`ResizeHandle`** (ידית 6px בקצה הימני של כל תא כותרת):
- `onMouseDown` תופס `startX` + `offsetWidth`; מאזיני `mousemove`/`mouseup` ברמת `document`.
- `onMouseMove` מחשב `delta`, מהדק ל-`Math.max(min, startWidth+delta)`, וקורא `updateColumnWidth` **חי בכל תזוזה**.
- `onDoubleClick` → `resetColumnWidth` (חזרה ל-`default`).
- `isLocked` → הרכיב מחזיר `null` (השבתה מלאה).
- **מגע:** לא נתמך — עכבר בלבד.

**מה שלא נאמץ:** ב-`CEO_Display` הרוחב מוחל כ-`width`/`minWidth` inline על שורת **flexbox**, עם פריצות `left:-30px`/`+30px` ספציפיות לפריסה שלה. הטבלאות שלנו הן **CSS Grid** — לכן נאמץ את הרעיון (context + handle + שמירה), אבל נחיל את הרוחב דרך **`grid-template-columns` מחושב**, מבלי לגעת ב-CSS של העמודה הקפואה ופס הצבע.

---

## 1. הטבלאות שלנו (מיפוי)

| טבלה | קובץ | מודל העמודות |
|------|------|--------------|
| **TaskTable** (משותף ל-TasksTab + PreviousTasksTab) | `src/components/TaskTable/*`, `TaskTableRow/*` | `grid-template-columns` **סטטי ב-CSS**: `minmax(180px,1.6fr) 140px 150px 170px` (שם, אחראי, דד-ליין, סטטוס). וריאנט `.selectable` מוסיף 36px צ'קבוקס בהתחלה; `.withSource` מוסיף `minmax(160px,1fr)` בסוף (דיון מקור). |
| **MyTasksTable** | `src/components/MyTasksView/*` | `gridTemplate` **דינמי inline ב-JSX** (כבר!): `name | deadline | priority | status | notes | discussion`, עמודות לא-ממופות מוסתרות. |

מאפיינים משותפים: `dir="ltr"` (סגנון לוח מאנדיי), עמודת **שם קפואה** (`.taskFirst` `position:sticky; left:0`) עם פס צבע קבוצה כ-`inset 6px box-shadow`, וכותרת+שורות שמתיישרות דרך אותו `grid-template-columns`.

מוסכמת האחסון שלנו (למראה): `SettingsContext` / `templates.js` / `topicOrder.js` משתמשים ב-**`monday.storage` רגיל** (לא `.instance`), ערך JSON, timeout 5s, מפתח עם fallback `instanceId → boardId → 'default'`, ו**לא חוסמים render**.

---

## 2. גישה מומלצת

**לא** להעתיק את רכיב הטבלה של `CEO_Display` כמו-שהוא. לחלץ שני פרימיטיבים בלבד ולהתאים ל-Grid הקיים:

1. **hook יחיד `useColumnWidths(tableId, columnDefs)`** (במקום שני Context נפרדים כמו ב-CEO) — מאחד load/save/debounce/clamp/reset פעם אחת, ומקבל **רשימת תיאורי-עמודות** לכל טבלה (alias/key + `{min,default,max}` + resizable/fixed). זה מכסה את שלוש הטבלאות הלוגיות (TasksTab+PreviousTasks חולקות `TaskTable`; MyTasks נפרדת) בלי שכפול.
2. **`<ResizeHandle>`** אחד, מורכב בכל תא כותרת *resizable*.
3. כל טבלה מחשבת `gridTemplateColumns` מהרוחבים השמורים. ב-MyTasksTable זה כמעט ללא שינוי (הוא כבר בונה מחרוזת). ב-TaskTable מחליפים את ה-`grid-template-columns` הסטטי + הוריאנטים במחושב. הצ'קבוקס (36px) ופס הצבע נשארים tracks **קבועים** (לא resizable).

---

## 3. עיצוב השמירה (Persistence)

ממראה את מוסכמת האפליקציה **בדיוק**:
- שכבה: **`monday.storage`** (רגיל, לא `.instance` — כמו שאר האפליקציה).
- מפתח: `discussions_column_widths_${instanceId}` (fallback `instanceId → boardId → 'default'`).
- ערך: JSON, **namespaced לפי טבלה** כדי שלא יתנגשו: `{ tasks: { [key]: px }, myTasks: { [key]: px } }`. (`tasks` משרת גם TasksTab וגם PreviousTasksTab, כי הן חולקות `TaskTable`.)
- מפתחות עמודה = ה-**aliases** של מאנדיי (`responsibilityID`, `deadlineID`, `statusID`, `priorityID`, `taskNotesID`) + מפתחות סינתטיים לעמודות ללא alias: `__name`, `__source`.
- **אינטראקציה עם מיפוי ההגדרות:** מפתוח לפי alias נכון — אם בעלים ממפה alias לעמודת מאנדיי אחרת, הרוחב נשמר (הוא על *מיקום* בטבלה, לא על id); אם עמודה **מוסתרת** (alias לא ממופה, כמו ש-MyTasksTable כבר עושה) — הרוחב פשוט מתעלם בבניית ה-template ומוחל מחדש אם העמודה חוזרת. אף פעם לא נמחק (כמו ההגנתיות של `topicOrder`).
- טעינה: ב-mount של ה-provider (**לא חוסם render** כמו `TemplatesProvider`), ולידציה + clamp + מיזוג מעל defaults.
- שמירה: **debounced ~500ms** אחרי הגרירה האחרונה, כתיבת האובייקט המלא (read-merge-write כדי לא לדרוס את הטבלה האחות), best-effort עם `logger.warn`, ללא זריקה/toast. State חי בכל `mousemove`; רק הכתיבה ל-storage debounced.

---

## 4. נקודות הכרעה (הוכרעו)

| # | שאלה | ההכרעה |
|---|------|--------|
| **DP1** | היקף השמירה | **Per-instance (משותף)** — נשמר למופע הלוח, משותף לכל המשתמשים; תואם Settings/Templates/topicOrder. |
| **DP2** | מי יכול לגרור | **בעלים בלבד** (`canManageSettings`). למשתמשים אחרים הטבלה מציגה את הרוחבים השמורים ללא ידיות גרירה. |
| **DP3** | עמודת השם הקפואה | **ניתנת לשינוי, עם `min` ~200px** — שומר על כפתורי השם/מחיקה ועל מקור הגלילה הקפואה. |
| **DP4** | איפוס/autosize | **ללא איפוס** — גרירה בלבד. אין dblclick-reset ואין "איפוס הכל". |

**הערה על הצירוף DP2+DP4:** מכיוון שרק בעלים גוררים (DP2) ל-storage **משותף** (DP1), הסיכון ש"רוחב קיצוני נתקע לכולם" קטן, ולכן escape-hatch של איפוס מיותר (DP4=ללא). שחזור, אם בעלים קבע רוחב לא טוב = גרירה חזרה.

**הכרעות הנדסיות שאומצו אוטומטית (לא user-facing):**
- **hook יחיד** `useColumnWidths(tableId, columnDefs)` + `ResizeHandle` יחיד (לא שני Context נפרדים, לא רכיב `<ResizableTable>` גנרי — over-engineering ל-2 רכיבי שורה). ה-hook חוזר `{ widths, gridTemplate, updateWidth, isLoading }` — **ללא** `resetColumn`/`resetAll` (DP4).
- **מובייל:** הרוחבים השמורים **מוחלים** גם במובייל (הגלילה האופקית סופגת), אבל ידיות הגרירה **מוסתרות** במגע/מסך-קטן (`useViewport`) — ב-CEO הן עכבר-בלבד, וממילא רק בעלים רואים אותן.

---

## 5. תוכנית מדורגת

### Phase 0 — קונפיג ותיאורי-עמודות *(סיכון נמוך)*
- ב-`boards.config.js`: `DEFAULT_COLUMN_WIDTHS` + `COLUMN_WIDTH_CONSTRAINTS` (`{min,default,max}`) ממופתחים לפי aliases של `COLUMN_SCHEMA.tasks` + סינתטיים (`__name`, `__source`, `__select`).
- רשימות column-def לכל טבלה (סדר + resizable/fixed). צ'קבוקס(36px) ופס-צבע = קבועים.
- `STORAGE_KEY_BASE = 'discussions_column_widths'`.

### Phase 1 — Context + hook (provider לא-חוסם) *(סיכון בינוני)*
- `ColumnWidthsContext.jsx` בתבנית `TemplatesContext`: state מגובה-ref, מפתח `instanceId|boardId|'default'`, load עם `withTimeout` 5s, validate+clamp+merge, save debounced ~500ms best-effort, `logger.warn` בכשל, **ללא render gate**.
- `useColumnWidths(tableId, columnDefs)` → `{ widths, gridTemplate, updateWidth, resetColumn, resetAll, isLoading }`.
- להרכיב `<ColumnWidthsProvider>` ליד `TemplatesProvider` ב-`index.jsx` (בתוך ה-gate, לא חוסם).
- *סיכון:* stale-closure ב-save (ref trick); namespacing לפי טבלה חייב read-merge-write כדי לא לדרוס את הטבלה האחות.

### Phase 2 — ResizeHandle + חיווט הגריד *(סיכון גבוה — עבודת ה-UI)*
- רכיב `ResizeHandle` (6px, קצה נגרר של תא כותרת; `mousedown`→`startX+startWidth`, `mousemove`→clamp+`updateWidth` חי, `mouseup`→ניתוק, `dblclick`→`resetColumn`).
- `TaskTable`: להחליף את ה-`grid-template-columns` הסטטי + וריאנטי `.selectable`/`.withSource` ב-`gridTemplate` מחושב; להרכיב `ResizeHandle` בכל תא כותרת resizable; צ'קבוקס/מקור = tracks קבועים.
- `MyTasksTable`: להחליף את ה-`gridTemplate` הידני במחושב מה-hook (השינוי הקטן ביותר); לחווט ידיות בכותרת.
- `TaskTableRow`/`MyTasksRow` לא משתנים (קוראים את אותו grid).
- *סיכון:* כותרת ושורות חייבות לצרוך template **זהה**; רוחב עמודת השם הקפואה מזין את מקור ה-sticky שלה; `dir=ltr` → הידית בקצה הימני הויזואלי — לוודא שלא חופפת לפס-הצבע inset או לגבול התא הבא; מקרה עמודה מוסתרת (MyTasks) חייב להפיל גם את ה-track וגם את הידית.

### Phase 3 — הרשאות ומובייל *(סיכון נמוך)*
- **גרירה לבעלים בלבד** (DP2): ה-`ResizeHandle` מרונדר/פעיל רק כש-`canManageSettings`. למשתמשים אחרים הרוחבים השמורים מוחלים, אך אין ידיות. (לטבלת "המשימות שלי" אין `canEdit` per-discussion — הגייט הוא `canManageSettings` של הלוח.)
- **ללא איפוס** (DP4): אין `dblclick`-reset ואין כפתור "איפוס הכל". ה-`ResizeHandle` ללא `onDoubleClick`; ה-hook ללא `resetColumn`/`resetAll`.
- **מובייל:** הסתרת הידיות במגע/מסך-קטן דרך `useViewport`, תוך החלת הרוחבים השמורים.

### Phase 4 — בדיקות ואימות *(סיכון נמוך)*
- בדיקות יחידה ל-clamp/merge/validate ולחישוב `gridTemplate` (עמודות מוסתרות, blob פגום).
- Smoke: שתי הטבלאות מתרנדרות עם defaults כשה-storage ריק/לא-זמין (מסלול dev מקומי).
- אימות ידני ב-iframe: גרירה נשמרת אחרי reload, העמודה הקפואה נשארת, מיקום ידית ב-RTL/ltr, וריאנטי `selectable`+`withSource` ב-PreviousTasksTab עדיין מיושרים.

---

## 6. סיכונים עיקריים
- **יישור כותרת↔שורות** (Phase 2) — חייבים אותו `grid-template-columns` מחושב בדיוק.
- **העמודה הקפואה** — הרוחב מזין את מקור ה-sticky; min שפוי (DP3) שומר על ההתנהגות.
- **אחסון משותף per-instance ללא איפוס** — אם בעלים קובע רוחב גרוע הוא נתקע לכולם; השחזור היחיד הוא גרירה חזרה (אין escape-hatch לפי DP4). הסיכון מצומצם כי רק בעלים גוררים (DP2).
- **read-merge-write** — לא לדרוס את הטבלה האחות ב-blob.
