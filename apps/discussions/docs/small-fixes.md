# תיקונים קטנים — לניתוח ויישום

> מסמך ריכוז. נכון ל-2026-06-29.
> **סטטוס יישום: נקודות 1–10 יושמו (220/220 טסטים עוברים, ללא commit/deploy).**
> תוכנית היישום המלאה: `docs/IMPLEMENTATION-PLAN.md`.
> כל נקודה: מה מבוקש · איפה בקוד · ניתוח/סיכון · הצעת יישום.

---

## נקודה 1 — כפתור "Group by" בכל טאבי תצוגת הדיון בעיצוב של טאב "המשימות שלי" + קיבוץ לפי אחראי

**מה מבוקש**
בכל הטאבים של תצוגת דיון, כפתור ה-Group by צריך להיות בעיצוב ובשיטה זהים לכפתור שבטאב
"המשימות שלי", בתוספת אפשרות לקבץ לפי אחראי.

**מצב קיים בקוד**

טאב "המשימות שלי" (היעד לחיקוי) — רכיב `MenuPill` מותאם אישית:
- `src/components/MyTasksView/MyTasksView.jsx:65-118` — רכיב `MenuPill` (לא קיים כרכיב משותף, מוגדר מקומית בקובץ).
- בנוי על `@vibe/core` `Dialog` + `DialogContentContainer` + תפריט כפתורים מותאם.
- אייקון
  `Group`
  מ-
  `@vibe/icons`
- סגנון: `.pill` / `.pillActive` / `.menu` / `.menuItem` ב-`MyTasksView.module.css:31-146`.
- אפשרויות (`MyTasksView.jsx:287-291`): `discussion` / `status` / `priority` — **אין `person`/אחראי**.
- הבחירה נשמרת ב-`localStorage` (מפתח `my_tasks_group_by`).

טאבי הדיון (המצב שצריך להחליף):
- `TasksTab` — `src/components/TasksTab/TasksTab.jsx:190-199` — משתמש ב-`@vibe/core` `Dropdown`
  (לא ב-`MenuPill`). אפשרויות `TasksTab.jsx:9-13`: `none` / `status` / **`person` (לפי אחראי — כבר קיים!)**.
- `PreviousTasksTab` — `src/components/PreviousTasksTab/PreviousTasksTab.jsx:656-666` — שוב `Dropdown`
  של @vibe. אפשרויות `:15-22` + `:588`: `none` / `status` / `person` ובמצב "לפי סוג דיון" מוסיף גם `discussion`.
- `EffectivenessTab` (אפקטיביות) — `src/components/EffectivenessTab/EffectivenessTab.jsx:189-209` — **לא** dropdown
  אלא segmented control (שני כפתורים: לפי סטטוס / לפי אחראי).
- `TopicsTab` (נושאים) ו-`SummaryTab` (סיכום) — **אין** כלל בקרת קיבוץ.

**✅ הוכרע**
- **טווח**: רק `TasksTab` + `PreviousTasksTab`. `EffectivenessTab` נשאר segmented control. נושאים/סיכום אין קיבוץ.
- **הבקשה היא עיצוב בלבד** — "לפי אחראי" כבר עובד בשני הטאבים. רק להחליף את ה-`Dropdown` של @vibe ב-`MenuPill`
  בסגנון "משימות שלי".

> ⚠️ **עדכון מקריאת הקוד העדכני (workflow):** הניתוח המקורי התיישן — ב"המשימות שלי" **כבר אין** `MenuPill`
> מקומי (`MyTasksView.jsx:65-118` לא קיים יותר). הפקד שצריך לחקות הוא `BuilderControl` / `.bPill`
> ב-`src/components/MyTasksView/controls/builder.module.css` (Dialog בדסקטופ + bottom-sheet במובייל).
> לכן: לבנות רכיב משותף **חדש** `src/components/MenuPill/` שמשחזר את מראה ה-pill לרשימת אופציות בודדת.
> פירוט מלא ב-`docs/IMPLEMENTATION-PLAN.md`.

**ניתוח / החלטות יישום**
1. **חילוץ לרכיב משותף**: לבנות `src/components/MenuPill/` חדש בהשראת `BuilderControl`/`.bPill`. לחלץ ל-`src/components/MenuPill/`
   (Component.jsx + .module.css + index.js, לפי קונבנציית הפרויקט) ולייבא בשלושת המקומות (MyTasks + 2 הטאבים).
2. **שמירת אופציות פר-טאב**: ה-MenuPill מקבל `options` כ-prop, אז כל טאב מעביר את שלו —
   TasksTab/PreviousTasksTab: `none`/`status`/`person` (+`discussion` ב-PreviousTasks במצב byType);
   MyTasks: `discussion`/`status`/`priority`. אין צורך לאחד את הרשימות.
3. **תמיכה ב"ללא קיבוץ"**: ב-MyTasks הקיבוץ תמיד פעיל (count=1). בטאבי הדיון יש `none`. ה-MenuPill המשותף
   צריך לתמוך ב-`value` ריק/none (להציג count=0 או בלי count כשאין קיבוץ) — להוסיף תמיכה.
4. **התנהגות זהה**: לשמר את ההתנהגות של MyTasks (Dialog + clickoutside/esc, מיקום צף, אייקון `Group`, סגנון `.pill`).
   הבחירה בטאבי הדיון יכולה להישאר state נדיף כמו היום (אין דרישה לשמירה).

---

## נקודה 2 — Tooltip של כפתור הכיווץ (chevron) נחתך למעלה

**מה מבוקש**
ה-tooltip של כפתור הכיווץ/הרחבה (ה-double-chevron, "קפל הכל"/"פתח הכל") נחתך בקצה העליון.
שלא ייחתך עם קצה המסגרת.

**מצב קיים בקוד**

הכפתורים (כולם `@vibe/core` `IconButton` עם `tooltipContent` כמחרוזת):
- `TasksTab` — `src/components/TasksTab/TasksTab.jsx:201-208`
- `PreviousTasksTab` — `src/components/PreviousTasksTab/PreviousTasksTab.jsx:668-675`
- `TopicsTab` — `src/components/TopicsTab/TopicsTab.jsx:407-416`

**שורש הבעיה**
המכל ש"חותך": `.body` ב-`DiscussionCard.module.css:296-303` עם `overflow-y: auto`.
ה-tooltip מצויר מעל ה-toolbar ונחתך בגבול ה-overflow של ה-`.body` הגוללת.
(ה-toolbar עצמם — TasksTab/PreviousTasksTab/TopicsTab — **אין** להם `overflow:hidden`, אז הם לא האשמים.)

**הצעת יישום**
`@vibe/core` `IconButton` מקבל `tooltipProps` שמועבר ל-Tooltip הפנימי, ול-Tooltip יש `getContainer`:
- `node_modules/@vibe/icon-button/.../IconButton.d.ts:65-71` — `tooltipProps?: Partial<TooltipProps>`
- `node_modules/@vibe/tooltip/.../Tooltip.d.ts:46-47` — `getContainer?: () => HTMLElement`

פתרון: להעביר `tooltipProps={{ getContainer: () => document.body }}` (או `document.documentElement`)
לכל שלושת ה-IconButtons, כך שה-tooltip יצויר מחוץ למכל הגולל ולא ייחתך.
(לחלופין/בנוסף: לבדוק שאין `position` שדוחף את ה-tooltip מעל — אבל getContainer הוא התיקון הנקי.)

**הערה**: לשקול לחלץ wrapper משותף ל-IconButton הזה כדי לא לשכפל את `tooltipProps` בשלושה מקומות.

---

## נקודה 3 — Tooltip נחתך גם בטאב "נושאים" + כפתור "סגור הכל" צריך להיות צמוד לשמאל

**מה מבוקש**
1. אותו tooltip נחתך גם בטאב "נושאים" (זהה לנקודה 2).
2. כפתור "סגור הכל" (ה-chevron) צריך להיות **צמוד לקצה השמאלי** של ה-toolbar.

**מצב קיים בקוד**
- חיתוך ה-tooltip — מכוסה ע"י נקודה 2 (TopicsTab כבר ברשימת התיקון, `TopicsTab.jsx:407-416`).
- מיקום הכפתור: `TopicsTab.jsx:407-416` — ל-IconButton יש `style={{ marginInlineStart: 'auto' }}`
  וה-toolbar הוא `dir="ltr"` (לפי הערה בקוד), כך שכרגע הכפתור נדחף לקצה (ימין במונחי ltr).
  ה-toolbar עצמו: `TopicsTab.module.css:14-18` — `display:flex; align-items:center; gap:8px` (ללא justify-content).

**ניתוח**
בצילום הכפתור צמוד לקבוצת "נושא חדש"/"מתבנית" ולא לקצה השמאלי הריאלי. בניגוד ל-TasksTab/PreviousTasksTab
שמשתמשים ב-`justify-content: space-between` (קבוצת ימין מול קבוצת שמאל), TopicsTab משתמש ב-`marginInlineStart:auto`
על הכפתור בלבד בתוך toolbar `dir="ltr"`. צריך לוודא שבפועל הכפתור יושב בקצה השמאלי **הוויזואלי** (RTL של הדף).

**הצעת יישום**
ליישר התנהגות עם TasksTab/PreviousTasksTab: או `justify-content: space-between` על `.toolbar`,
או לוודא שכיוון ה-toolbar וה-`marginInlineStart:auto` נותנים את הכפתור בקצה השמאלי הנכון.
לבדוק חזותית אחרי שינוי (RTL מבלבל כאן).

---

## נקודה 4 — מודאל "דיון חדש": כפתורי X לניקוי, הסרת אופציות "ללא...", ופתיחת date picker בלחיצה על כל התא

**מה מבוקש**
1. ניקוי של כל שדה יהיה עם כפתור X בצד **השמאלי** של השדה.
2. להסיר מרשימות האפשרויות: "ללא תבנית", "ללא סוג", "ללא דיון קודם".
3. לחיצה על **כל מקום** בתא התאריך תפתח את ה-date picker — לא רק לחיצה על אייקון לוח השנה.

**מצב קיים בקוד** — `src/components/CreateDiscussionModal/CreateDiscussionModal.jsx`

הקובץ בנוי כמעט כולו מרכיבים **מותאמים אישית** (לא @vibe Dropdown), אז ל-X צריך מימוש ידני בכל שדה:
| שדה | רכיב | מיקום | X קיים? |
|-----|------|-------|---------|
| כותרת (שם הדיון) | `<input type="text">` native | `:413-420` | אין |
| מוביל דיון | `PersonPicker` מותאם | `:429-430` | רק בתוך ה-popover (chip remove) |
| תאריך | `<input type="date">` native | `:436-441` | אין |
| שעה | dropdown מותאם | `:447-489` | אין |
| משתתפים | `PersonPicker` מותאם | `:538` | רק ב-popover |
| נושאים מתבנית | dropdown מותאם | `:543-584` | אין |
| סוג דיון | dropdown מותאם | `:592-656` | אין |
| דיון קודם | dropdown מותאם | `:660-718` | אין |

**4.1 — כפתורי X (ניקוי) בצד שמאל**
כל השדות חסרים X. כיוון שהרכיבים מותאמים (לא @vibe `Dropdown` עם `clearable` מובנה), צריך:
- להוסיף כפתור X ממוקם absolute בצד השמאלי של כל שדה (הדף RTL — "שמאל" = קצה הסיום הוויזואלי).
- לוגיקת ניקוי לכל שדה: title→`setName('')`, lead→`setLead(null)`, date→`setDate('')`,
  time→reset, participants→`setParticipants([])`, template/type/previous→reset הערך.
- הצעה: רכיב עזר משותף `FieldClearButton` כדי לא לשכפל 8 פעמים.
- שיקול: להציג X רק כשיש ערך (לא ריק).

**4.2 — הסרת אופציות "ללא..."** (כל אלה אופציות אמיתיות במערך, לא placeholder):
- **"ללא תבנית"** — `:390-396`, האובייקט `{ value: 'none', label: 'ללא תבנית' }` ראשון ב-`templateOptions`. להסיר אותו.
- **"ללא סוג"** — `:629-636`, `<li>` מפורש שקורא `selectType(null)`. למחוק את ה-`<li>`. ה-placeholder "בחר סוג דיון" (`:613`) נשאר.
- **"ללא דיון קודם"** — `:134` וגם `:137`, מתווסף בראש `setDiscussionOptions([{value:'none',...}, ...opts])`. להסיר מ**שני** הענפים.
  - ⚠️ label "ללא דיון קודם" מופיע גם כ-fallback תצוגה ב-`:383` (כשאין בחירה). אם מסירים את האופציה,
    כדאי להחליף את ה-fallback ל-placeholder כמו "בחר דיון קודם" (להחליט).
- ⚠️ **השלכה**: לאחר ההסרה צריך לוודא שמצב "ללא בחירה" עדיין תקין — שדות אלה כנראה אופציונליים,
  אז צריך placeholder תקין במקום אופציית ה-none, ושהערך ההתחלתי לא נופל על 'none' שכבר לא קיים.

**4.3 — date picker בלחיצה על כל התא**
- `<input type="date">` native ב-`:436-441`. כיום רק אייקון לוח השנה פותח את הבורר.
- **פתרון נקי**: להוסיף `onClick={(e) => e.currentTarget.showPicker?.()}` ל-input (ה-API `HTMLInputElement.showPicker()`
  נתמך בכל הדפדפנים המודרניים), כך שכל לחיצה על השדה פותחת את הבורר. לבדוק תאימות + מובייל.
- חלופה כבדה יותר: להחליף ל-`@vibe` DatePicker מותאם (לא נדרש אם showPicker עובד).

---

## נקודה 5 — מודול התבניות (`TemplateManagerModal`): ולידציה, טקסט כפתור, כפתור חזרה, ניקוי+חץ

**קבצים**: `src/components/TemplateManagerModal/TemplateManagerModal.jsx` (+ `.module.css`),
`src/utils/templates.js`, `src/contexts/TemplatesContext.jsx`.
מבנה: מודאל עם שתי תצוגות — `list` (`:356-434`) ו-`edit` (`:435-511`); שני סוגי תבניות —
`topics` (נושאים) ו-`participants` (משתתפים), נשמרים במפתחות storage נפרדים.

**5.1 — לא לאפשר שתי תבניות מאותו סוג לאותו סוג דיון**
- סוג הדיון נשמר בשדה **`discussionType`** (מזהה תווית סטטוס, nullable) — `templates.js:36` (נושאים) ו-`:79` (משתתפים).
- ה-dropdown לשיוך: רכיב מותאם `TypeDropdown` (`TemplateManagerModal.jsx:16-79`), נקרא ב-`:442-448` (נושאים) ו-`:483-489` (משתתפים).
- **אין כיום שום ולידציה** שמונעת שיוך כפול. ב-`CreateDiscussionModal:236-239` ההתאמה היא `templates.find(t => t.discussionType === id)`
  — מחזיר את **הראשון** בלבד, ולכן שתי תבניות מאותו סוג עם אותו `discussionType` יוצרות אי-ודאות. זה הבאג.
- **הצעת יישום (שתי שכבות, מומלץ לעשות את הראשונה לפחות):**
  1. **מניעה ב-UI**: ב-`TypeDropdown` להציג סוגי דיון שכבר תפוסים ע"י תבנית אחרת **מאותו kind** כ-disabled
     (או להסתיר אותם), פרט לתבנית הנוכחית בעריכה. זו החוויה הכי ברורה.
  2. **ולידציה בשמירה**: ב-`TemplatesContext` `createTemplate`/`updateTemplate` (`:131-147`) או בשלב השמירה במודאל —
     לבדוק אם קיימת תבנית אחרת מאותו kind עם אותו `discussionType` (פרט ל-id הנוכחי), ואם כן לחסום + toast שגיאה בעברית.
- ⚠️ אילוץ: ההגבלה היא **פר-kind** — מותר תבנית נושאים אחת **וגם** תבנית משתתפים אחת לאותו סוג דיון.

**5.2 — טקסט הכפתור → "תבנית חדשה"**
- `TemplateManagerModal.jsx:517-518`: `{kind === 'topics' ? 'תבנית חדשה' : 'תבנית משתתפים חדשה'}`.
- ענף ה-topics **כבר** "תבנית חדשה". רק לשנות את ענף ה-participants מ-"תבנית משתתפים חדשה" ל-"תבנית חדשה".
  (מעשית: אפשר להחליף את כל הביטוי ב-`'תבנית חדשה'` קבוע.)

**5.3 — כפתור "חזרה"**
- `TemplateManagerModal.jsx:346-350`: `<ChevronRight size={16} /> חזרה` (אייקון `lucide-react`, מוצג רק ב-view=edit).
- CSS `.backBtn` ב-`TemplateManagerModal.module.css:58-73` — צבע `--primary-color` (כחול).
- **שינויים מבוקשים:**
  - להפוך כיוון החץ: `ChevronRight` → `ChevronLeft` (לעדכן import + שימוש).
  - לצבוע שחור: `color` מ-`--primary-color` ל-`--text-color`/שחור.
  - להגדיל מעט: `size={16}` → ~`18-20`.
  - להסיר את הטקסט "חזרה" (אייקון בלבד). לשמור `aria-label="חזרה"` לנגישות.

**5.4 — ניקוי שדה (X) + הגדלת חץ ב-`TypeDropdown`**
- ה-trigger: `TemplateManagerModal.jsx:52-57`; ה-chevron הוא תו `▾` (לא אייקון) עם `.typeChevron`
  ב-`...module.css:272` ב-`font-size:10px`. placeholder = "ללא סוג".
- **שינויים:**
  - להגדיל את החץ: `font-size` מ-`10px` ל-~`14-16px` (או להחליף לאייקון `lucide` `ChevronDown` בגודל תואם).
  - להוסיף כפתור X לניקוי (בצד הימני לפי הבקשה) שמאפס `discussionType` ל-`null` (חוזר ל"ללא סוג"). להציג רק כשיש ערך.
- הערה: כאן "ללא סוג" הוא ה-placeholder התקין של התבנית (שונה מנקודה 4.2 שמדברת על `CreateDiscussionModal`). לא לערבב.

---

## נקודה 6 — צבע קבוצות "לפי דיון" בטאב "המשימות שלי" לפי צבע תווית הסטטוס

**מה מבוקש**
צבע של הקבוצות בקיבוץ "לפי דיון" יהיה הצבע של התווית בעמודת סטטוס.

**מצב קיים בקוד** — `src/components/MyTasksView/`
- בנייית קבוצות: `grouping.js`. `groupByDiscussion` (`:64-85`) מחזיר לכל קבוצה `color: null` (קשיח, `:73`)
  ו-`status: undefined` (`:74`) → הכותרת אפורה (`var(--secondary-text-color)`).
- לעומת זאת קיבוץ **לפי סטטוס/עדיפות** כן צובע: `groupByStatusColumn` (`:92-118`) לוקח `colorById[statusId]`.
- מקור הצבעים: `useStatusOptions('tasks','statusID')` → `colorById` מתוך ה-hex של תוויות עמודת הסטטוס (`useStatusOptions.js:78-99`).
- רינדור כותרת הקבוצה: `MyTasksView.jsx:375-393` — צ'בון + טקסט מקבלים `style.color = grp.color`.

**✅ הוכרע (עדכון מהמשתמש)**
לא לפי סטטוס. **לכל קבוצת דיון ייבחר צבע רנדומלי מתוך הפלטה של מאנדיי.**

**הצעת יישום**
- ב-`groupByDiscussion` (`grouping.js:64-85`) להציב `group.color` מתוך פלטת צבעים של מאנדיי במקום `null`.
- ⚠️ **חייב להיות דטרמיניסטי ויציב** — לא `Math.random()` שמשתנה בכל render. לבחור צבע לפי **hash של
  `discussionId`** (מודולו אורך הפלטה), כך שאותו דיון מקבל תמיד אותו צבע, וצבעים שונים מתפזרים בין דיונים.
- צריך להגדיר **מערך פלטת צבעי מאנדיי** (צבעי התוויות הסטנדרטיים של monday). לבדוק אם כבר קיים מקור בקוד
  (`theme-tokens.css` `--status-*`/`--dept-*`, או צבעי תוויות מ-`useStatusOptions`) — אם לא, להגדיר מערך hex
  של פלטת monday (למשל הצבעים הסטנדרטיים: ירוק/כתום/אדום/כחול/סגול/צהוב וכו').
- הצבע מוזרם כבר היום לכותרת ולצ'בון דרך `style.color` (`MyTasksView.jsx:384,388`) — אין צורך בשינוי רינדור,
  רק לדאוג ש-`grp.color` לא `null`.
- שיקול נגישות: אם משתמשים בצבע גם לטקסט הכותרת, לוודא ניגודיות (אולי להשתמש בצבע כ-accent/נקודה ולא כצבע טקסט מלא).

---

## נקודה 7 — תאימות גודל skeleton הטעינה לאלמנטים האמיתיים (בכל מקום)

**מה מבוקש**
גודל ה-skeleton צריך להיות זהה לגודל האלמנטים שיופיעו אחריו. דוגמה: בעמודת רשימת הדיונים שורות
ה-skeleton גבוהות מהשורות האמיתיות. לוודא תאימות בכל מקום.

**מצב קיים בקוד — מיפוי מלא של כל ה-skeletons** (כולם `@vibe/core` `Skeleton type="rectangle"`)

| אזור | skeleton | שורה אמיתית | קובץ | סטטוס |
|------|----------|-------------|------|-------|
| **רשימת דיונים** | `height={56}` | ~34–38px (padding 8px + טקסט 14px) | `DiscussionList.jsx:443-446` / row CSS `DiscussionList.module.css:355,379-400` | ❌ **לא תואם** (skeleton גבוה ב-~18-22px) |
| **TasksTab** | `height={36}` | `min-height:36px` | `TasksTab.jsx:165` / `TaskTable.module.css:37-44,125-135` | ✓ תואם |
| **PreviousTasksTab** | `height={36}` (פעמיים) | `min-height:36px` | `PreviousTasksTab.jsx:597-601, 707-709` | ✓ תואם |
| **MyTasksView** | `height={36}` | `line-height:36px` | `MyTasksView.jsx:361-364` / `MyTasksRow.module.css` | ✓ תואם |
| **TopicsTab** | `height={48}` | דינמי (~50-60px+, header+נקודות) | `TopicsTab.jsx:363-370` / `SortableTopicSection` | ❌ **כנראה לא תואם** |

**הבעיה העיקרית (רשימת דיונים)**
- skeleton: `<Skeleton type="rectangle" fullWidth height={56} />` (`DiscussionList.jsx:445`).
- שורה אמיתית `.item` (`DiscussionList.module.css:355`): `padding: 8px 12px`, ללא height מפורש →
  גובה תוכן בפועל ~34-38px.
- בנוסף: מכל ה-skeleton `.skeletonList` (`:188-193`) הוא `padding:16px; gap:8px` — לבדוק שזה תואם
  ל-padding/gap של רשימת הדיונים האמיתית, אחרת גם המרווחים "קופצים".

**הצעת יישום**
1. **רשימת דיונים**: להוריד את ה-skeleton מ-56px לגובה השורה האמיתי. ⚠️ הערכת ~36px היא **משוערת** —
   צריך **למדוד את הגובה המדויק בדפדפן** ולהתאים (כולל gap/padding של המכל), לא לנחש.
2. **TopicsTab**: למדוד גובה section אמיתי ולהתאים את ה-48px (כנראה להגדיל מעט / להתאים למבנה ה-header).
3. **השאר (Tasks/PreviousTasks/MyTasks)**: כבר תואמים ב-36px — להשאיר.
4. עיקרון כללי: לוודא שגם מספר השורות, ה-gap וה-padding של מכל ה-skeleton תואמים לאלו של הרשימה האמיתית,
   כדי שלא יהיה "קפיצה" במעבר טעינה→תוכן.

**הערה**: שווה לשקול לקבוע קבוע משותף לגובה שורה (למשל `--row-height:36px`) ולהשתמש בו גם ב-skeleton
וגם בשורה האמיתית, כדי שלא ייווצרו פערים עתידיים.

---

## נקודה 8 — מרכוז כותרת עמודת "משימה" (השמות נשארים צמודים לשמאל) ב"המשימות שלי"

**מה מבוקש**
למרכז את כותרת העמודה "משימה" ביחס לעמודה. את שמות המשימות עצמם להשאיר צמודים לשמאל.

**מצב קיים בקוד** — `src/components/MyTasksView/`
- כותרת: `MyTasksTable.jsx:81-112` — תא הכותרת של השם הוא `.taskCell .taskFirst .nameHead` עם הטקסט `colName`.
- CSS כותרת השם: `MyTasksTable.module.css:48-56`:
  ```css
  .nameHead { justify-content: flex-start; }
  .taskHead .nameHead { justify-content: flex-start; text-align: left; }
  ```
  (כיום מיושר שמאל בכוונה כדי להתאים לשמות; שאר הכותרות `.taskCell` מיושרות center, `:61`.)
- העמודה sticky-left (`.taskFirst`, `:76-90`).
- תא השם (גוף): `MyTasksRow.module.css:26-45` — `.name { justify-content: flex-start }` + `.nameText { text-align: start }` (שמאל).

**הצעת יישום (פשוט ובטוח)**
- לשנות רק את `.taskHead .nameHead` ל-`justify-content: center; text-align: center`.
- **לא לגעת** ב-`.name`/`.nameText` — השמות נשארים צמודים לשמאל.
- בטוח: כותרת וגוף משתמשים במחלקות נפרדות (`.nameHead` מול `.name`/`.nameText`), אין דליפה.

**הערה צדדית (לא בהכרח בהיקף)**: בכותרת `MyTasksTable.jsx`, גם תא ה**עדיפות** מקבל `${styles.taskFirst} ${styles.nameHead}`
— נראה כמו העתק-הדבק שגוי (עדיפות לא אמורה להיות sticky/שמאל). שווה לבדוק אם זה תקלה ולתקן בהזדמנות.

---

## נקודה 9 — סרגל הכלים ב"המשימות שלי" שקוף; משימות נראות נגללות מתחתיו ומעליו

**מה מבוקש**
ה-toolbar (Search/Filter/Sort/Group by/Collapse) sticky אבל שקוף — רואים שורות נגללות מאחוריו
(גם מתחתיו וגם מעליו). זה לא אמור לקרות.

**מצב קיים בקוד** — `src/components/MyTasksView/MyTasksView.module.css`
- ה-toolbar (`MyTasksView.jsx:306`, `.toolbar`) **כבר** מוגדר נכון לכאורה (`:13-28`):
  ```css
  .toolbar {
    position: sticky; top: 0; z-index: 20;
    background: var(--primary-background-color, #fff);
    padding-block: 8px;
    flex-wrap: wrap;
  }
  ```
- מכל הגלילה: `.root` (`:1-10`) — `overflow-y: auto; padding: 16px;`.
- כותרות קבוצה `.groupHeader` (`:245-256`) — `background: transparent`, לא sticky.

**אבחנה — למה זה עדיין שקוף (שני חשודים, צריך אימות בדפדפן):**
1. **פער ה-padding העליון מעל ה-toolbar** (מסביר את ה"מעליו"): ל-`.root` יש `padding:16px`, וה-toolbar
   נדבק ב-`top:0` יחסית ל-padding box → נשאר **רצועת 16px מעל ה-toolbar** (אזור ה-padding) שבה שורות
   "מציצות" בזמן גלילה, כי רקע ה-toolbar לא מכסה אותה. ההערה בקוד מתייחסת רק לכיסוי **אופקי**, לא אנכי.
2. **`--primary-background-color` שקוף/לא מוגדר** ב-theme של monday בפועל (מסביר את ה"מתחתיו"): אם המשתנה
   resolves לערך שקוף, הרקע לא באמת אטום. (התא הקפוא משתמש ב-`#ffffff` מילולי — `MyTasksTable.module.css:76-87`.)

**הצעת יישום**
- לסגור את הפער העליון: או להעביר את ה-`padding-top` מ-`.root` לתוכן (ולתת ל-toolbar bleed מלא לרוחב/למעלה),
  או לתת ל-toolbar `margin-top: -16px; padding-top: 16px` (negative-margin bleed) כך שהרקע יכסה את רצועת ה-padding.
- לוודא רקע אטום ודאי: אם `--primary-background-color` לא אמין, להוסיף fallback אטום מפורש (`#ffffff` או טוקן רקע אטום ידוע).
- ⚠️ **לאמת בדפדפן** מי משני החשודים פעיל (או שניהם) לפני התיקון — לבדוק את הערך בפועל של המשתנה ואת רצועת ה-padding.

---

## נקודה 10 — להוסיף כפתור Filter לטאב "הנחיות קודמות" (`PreviousTasksTab`), כמו ב"המשימות שלי"

**מה מבוקש**
כפתור פילטר בטאב "הנחיות קודמות" (= `PreviousTasksTab`), ממש כמו ב"המשימות שלי".

**סטטוס:** ✅ יושם.

**הוכרע:** סינון לפי **סטטוס + דד-ליין + אחראי** (אין עמודת עדיפות במשימות אלה; אחראי נוסף כי רלוונטי כאן).

**מה נעשה**
- שימוש חוזר במנוע ה-Filter המשותף של My Tasks (`BuilderControl` + `Segment` + `controls.js`) — ללא צימוד.
- `controls.js` (משותף): נוספה תמיכת עמודת `person` בתוספת בלבד — `FILTER_COLUMN_PERSON`, `matchPersonCol`,
  והרחבת `filterTasks`/`filterCount`/`emptyFilter`. My Tasks לא הושפע (220/220 עוברים).
- `BuilderIcon.jsx`: נוסף glyph `person`.
- `PreviousTasksTab.jsx`: נוספו state+handlers לסינון, `personOptions` (נגזר מהמשימות הטעונות),
  `filteredTasks` (client-side, לפני הקיבוץ), `renderFilterBody` עם status/deadline/person, ו-pill Filter ב-toolbar.
- **טסטים:** 4 יחידה (סינון אחראי is/isnot/ריק/AND) ב-`controls.test.js` + 3 smoke (pill, עמודות status+deadline+person ללא priority, סינון לפי אחראי) ב-`previousTasksTabFilter.smoke.test.jsx`.

**ווריפקציה ידנית (in-product, דרך tunnel):** לפתוח דיון → "הנחיות קודמות" → ללחוץ Filter → לסנן לפי סטטוס/דד-ליין/אחראי
ולוודא שהרשימה מצטמצמת מיידית ללא טעינה מחדש; לבדוק RTL ומובייל (bottom-sheet).

---

## ריכוז שאלות — סטטוס

**✅ הוכרעו**
- נקודה 1 — טווח: רק TasksTab + PreviousTasksTab (לא EffectivenessTab).
- נקודה 1 — עיצוב בלבד (אחראי כבר עובד), כולל חילוץ MenuPill לרכיב משותף.
- נקודה 6 — צבע קבוצת דיון: רנדומלי-דטרמיניסטי מפלטת מאנדיי (לא לפי סטטוס).

**❓ נותרו פתוחות (מינוריות — אפשר ברירת מחדל)**
- נקודה 4.2 — לאחר הסרת "ללא דיון קודם", מה ה-placeholder של שדה "דיון קודם"? (הצעת ברירת מחדל: "בחר דיון קודם").
- נקודה 7 — הגבהים המדויקים (רשימת דיונים, TopicsTab) — יימדדו בדפדפן בזמן היישום.
- מיקום מסמך: `docs/small-fixes.md` בפרויקט (אם תעדיף scratchpad — תגיד).
