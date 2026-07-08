# תוכנית התאמה מלאה לנייד — אפליקציית ניהול דיונים

> מסמך תכנון. נכתב 2026-06-28. מבוסס על סריקת קוד מלאה (4 סוכנים) + מחקר רשת (4 סוכנים) ו־4 הכרעות מוצר של בעל האפליקציה.

---

## 0. הקשר וסטטוס פלטפורמה

האפליקציה רצה כיום גם כ־`board view` וגם כ־`object`, **ושתיהן כבר עובדות בנייד** (אומת ידנית). לכן שער הפלטפורמה פתוח, והעבודה כולה היא **UX וויזואלי** — לא הפעלה.

שתי עובדות שאומתו בקוד ומסירות סיכון:

1. **ביקורת ה־SDK נקייה.** כל קריאות ה־SDK באפליקציה הן ברשימת ההיתר לנייד של מאנדיי:
   ```
   monday.api · monday.get · monday.listen · monday.set · monday.setToken · monday.setApiVersion
   monday.execute('notice')        ×1   ✓ נתמך בנייד
   monday.execute('openItemCard')  ×3   ✓ נתמך בנייד
   ```
   אין אף קריאה לא־נתמכת (אין `notifyLoading` / `closeAppFeatureModal` / `valueCreatedForUser`). שכבת הנתונים, האחסון, וכרטיס הפריט עובדים בנייד ללא fallback.

2. **זיהוי נייד בזמן ריצה זמין.** ה־`context` כולל `mode === 'mobile'` (נקרא דרך `monday.get('context')` / `monday.listen('context')`). זו נקודת הסתעפות נוספת מעבר ל־breakpoint של רוחב.

### ההכרעות שהתקבלו

| # | נושא | ההכרעה |
|---|------|--------|
| 1 | היקף v1 | **תאימות מלאה** — כל האפליקציה ערוכה בנייד |
| 2 | טבלאות | **גלילה אופקית + עמודה קפואה, כמו לוח מאנדיי מקורי** (לא המרה לכרטיסים) |
| 3 | אינטראקציות מגע | **פישוט (degrade)** — כפתורי מעלה/מטה, טאפ יחיד, חשיפת תפריטים בטאפ |
| 4 | ניווט | **היברידי** — פעולה ראשית בתחתית + טאבים נגללים למעלה |

### ארבע הכרעות הנדסיות שאומצו כברירת מחדל

- **מנגנון רספונסיביות:** hook יחיד `useIsMobile()` מעל `useVibeMediaQuery` + קריאת `context.mode`. איחוד ה־breakpoints לקו 767/1023.
- **רפקטור RTL:** מעבר ל־logical properties כ־PR ייעודי מוקדם.
- **פרטי משימה מלאים:** נפתחים דרך `openItemCard` (כבר מחווט).
- **הגדרות:** ⚠️ *שונה מההמלצה המקורית* — מכיוון שנבחרה **תאימות מלאה**, ה־`SettingsModal` יהפוך רספונסיבי (`size="full-view"`) ולא ייחסם לדסקטופ.

---

## 1. עקרונות מנחים

1. **שכבה אחת, שני מצבי תצוגה.** מכיוון שנבחרה גלילה אופקית (לא כרטיסים), אותם רכיבי טבלה משרתים דסקטופ ונייד. אין שכבת UI כפולה לתחזק — ההבדל הוא CSS + מעט החלפות התנהגות.
2. **`style` ב־CSS, `behavior` ב־React.** רפלו ויזואלי טהור (padding, font, הסתרת פקדים) נשאר ב־`@media`. רק החלפות מבניות/התנהגותיות (גודל מודאל, hover→tap, drag→buttons) עוברות דרך ה־hook.
3. **Mobile-first בתוך iframe.** ה־viewport הוא הפאנל של מאנדיי, צר ומשתנה — אין חוזה פיקסלים. הכל נוזלי, ונבדק על מכשיר אמיתי דרך `npm run tunnel`.
4. **מגע נכון לפני יופי.** פעולות `hover` הן באג נגישות במגע, לא ליטוש — מטופלות ראשונות.
5. **RTL נכון מהבסיס.** עברית-ראשית עם נתוני מאנדיי שמערבים אנגלית/מספרים — דורש logical properties + bidi isolation.

---

## 2. ארכיטקטורת היסוד

### 2.1 ה־hook המרכזי `useIsMobile()`

קובץ חדש: `src/hooks/useViewport.js`

```js
// עוטף את useVibeMediaQuery של Vibe (phone ≤ 767, tablet 768–1023)
// + קורא context.mode === 'mobile' מ-MondayProvider.
// מחזיר { isMobile, isTablet, isPhone, mode }.
// isMobile = isPhone || context.mode === 'mobile'
```

- רכיבי מיכל (`App`, `DiscussionCard`, `MyTasksView`, `TasksTab`...) קוראים ל־hook ומעבירים `isMobile` כ־**prop** לרכיבי תצוגה. כך ה־swap נבדק ב־`vitest` בלי למוק `matchMedia`.
- מקור הברירה: `useVibeMediaQuery()` עם `useVibeMediaQuery.sizes.SMALL1` (=phone) / `SMALL2` (=tablet).

### 2.2 קו breakpoints אחיד

טוקן יחיד ב־`src/styles/theme-tokens.css`, ואיחוד הפאצ'וורק הקיים:

```
היום: 480 / 560 / 640 / 768 / 900 / 1024  (8 קבצי CSS)
יעד:  --bp-phone: 767px ;  --bp-tablet: 1023px   (קו Vibe)
```

(הערה: `@media` לא קורא `var()`. הטוקן הוא לתיעוד ולשימוש ב־JS; ב־CSS נשתמש בערכים `767px`/`1023px` עקבית.)

### 2.3 תיקוני יסוד גלובליים

| תיקון | קובץ | פעולה |
|-------|------|-------|
| safe-area | `index.html` | `viewport-fit=cover` נוסף ל־meta. **כיוון המסמך נשאר `dir="ltr"`** — ה־RTL נקבע ב־`appShellBody` (App.jsx); היפוך השורש ישבור את האיים ה־LTR המכוונים |
| גובה viewport | `App.module.css`, `NetworkErrorScreen`, `ErrorBoundary`, `SetupWizard` | `height:100vh` → fallback ואז `100svh`; מודאלים `calc(100vh-…)` → `dvh` |
| safe-area insets | סרגל בחירה צף, FAB, כפתור גלגל קבוע | `padding: env(safe-area-inset-*)` |
| hover gating | כל פקדי `opacity:0 → :hover` | לעטוף ב־`@media (hover:hover) and (pointer:fine)` + מסלול טאפ חלופי |
| מגע מהיר | אלמנטים נגיעים | `touch-action: manipulation` (מבטל השהיית 300ms) |

### 2.4 סריקת logical-properties (PR ייעודי מוקדם)

13 קבצי CSS משתמשים ב־`left/right` פיזיים. המרה גורפת:

```
margin-left/right   → margin-inline-start/end
padding-left/right  → padding-inline-start/end
left: / right:      → inset-inline-start/end
text-align:left/right → text-align:start/end
```

**קריטי — תיקון הבנה (מבעל האפליקציה):** הכיוון מכוון ומעורב. המסמך LTR, גוף האפליקציה עטוף `dir="rtl"` (`App.jsx` `appShellBody`), ואיים ספציפיים מוחזרים במכוון ל־`dir="ltr"` — הטבלאות (`TaskTable`, `MyTasksTable`), הטולברים (`TopicsTab`, `MyTasksView`), סרגל הטאבים ולוח השנה. לכן:

- ההמרה **אינה גורפת** — רק במשטחי ה־RTL. האיים ה־LTR שומרים על `left/right` פיזיים, ושם הם **נכונים**.
- העמודה הקפואה ב־`MyTasksTable`/`TaskTable` יושבת בטבלה `dir="ltr"`, עמודת השם **משמאל**, קפואה עם `left:0` — **זה הנכון, לא לשנות.** הגלילה חושפת עמודות ימינה.

---

## 3. שלבי הביצוע

> רצף מומלץ: שלב 0 (תשתית, סיכון נמוך, אפקט רוחבי) → שלבים 1–6 (לפי משטח) → שלב 7 (QA). כל שלב נבדק על מכשיר אמיתי לפני המעבר הלאה.

---

### שלב 0 — תשתית רוחבית (סיכון נמוך)

**מטרה:** להניח את היסוד לפני נגיעה במשטחים בודדים.

- [x] `index.html`: הוספת `viewport-fit=cover` (כיוון המסמך נשאר `ltr`).
- [x] קובץ `src/hooks/useViewport.js` + `useViewport()`/`useIsMobile()` (+ בדיקת יחידה, 4 בדיקות). `MondayContext` יוצא לקריאה רכה.
- [~] הקו 767/1023 מעוגן ב־`useViewport`. *טוקן CSS נדחה* — `@media` לא קורא `var()`; יעוגן בעת איחוד ה־`@media` בשלב 1.
- [x] `100vh → 100svh` (עם fallback) — `App.module.css`, `ErrorBoundary`, `NetworkErrorScreen`, `SetupWizard`, loader ב־`index.jsx`.
- [~] עזר `@media (hover:hover)` — *נדחה לשלב 3* (שם יושבים הפקדים מבוססי־hover; אין צרכן כרגע).
- [x] `touch-action: manipulation` על `button`/`a`/`[role=button]` ב־`index.css`.

**קבצים:** `index.html`, `src/index.css`, `src/App.module.css`, `src/styles/theme-tokens.css`, `src/hooks/useViewport.js`, `src/components/NetworkErrorScreen/*`, `src/components/ErrorBoundary/*`, `src/components/SetupWizard/*`.

**קריטריון קבלה:** האפליקציה נטענת RTL נכון בנייד; השלד לא נחתך מתחת לסרגל הכתובת; אין רגרסיה בדסקטופ.

---

### שלב 1 — שלד וניווט היברידי (הכרעה 4)

**מצב נוכחי:** מתג `appView` (`דיונים`/`המשימות שלי`) בסרגל עליון 44px; 5 טאבים בכרטיס בשורה עליונה; מעבר list↔card הוא flip בינארי (`display:none`); גלגל הגדרות `position:fixed` בלי safe-area; ידית divider מוסתרת בנייד.

- [ ] **פעולה ראשית בתחתית:** בנייד, להוריד את הפעולה התכופה ביותר (מתג תצוגה / FAB משימה חדשה) לסרגל מעוגן בתחתית באזור האגודל, עם `env(safe-area-inset-bottom)`. פעולות נדירות/הרסניות (מחיקת דיון) נשארות בפינה העליונה.
- [ ] **טאבים נגללים אופקית:** סרגל הטאבים בכרטיס (`previous/topics/tasks/summary/effectiveness`) → `overflow-x:auto` עם רמז גלילה; לא לעטוף לשורה שנייה.
- [ ] **מעבר list↔card:** מעבר חלק (slide) במקום flip; כפתור "חזרה" מוגדל ל־44px בראש הכרטיס.
- [ ] **גלגל הגדרות:** מיקום מחדש בנייד עם safe-area; כפתור collapse 22px → ≥44px hit-area.
- [ ] סרגל `appViewBar`: padding מצומצם בנייד, ולא להציג כשרק תצוגה אחת פעילה.

**קבצים:** `src/App.jsx`, `src/App.module.css`, `src/components/DiscussionCard/DiscussionCard.jsx` + `.module.css`, `src/components/CreateTaskFab/*`.

**קריטריון קבלה:** ניווט ראשי נגיש לאגודל ביד אחת; 5 הטאבים נגישים בגלילה; חזרה מהדיון לרשימה ברורה.

---

### שלב 2 — טבלאות: גלילה אופקית + עמודה קפואה כמו מאנדיי (הכרעה 2) ⭐ הליבה

**מצב נוכחי:** `TaskTable` min-width 640–820px; `MyTasksTable` min-width 930px עם עמודה קפואה `left:0` (שגוי RTL); אין רמז גלילה; פותחני סטטוס/עדיפות/אחראי/תאריך נפתחים בפופאוברים ברוחב דסקטופ.

> נבחרה במכוון התנהגות **לוח מאנדיי מקורי**: שמירת הטבלה, גלילה אופקית, עמודת שם קפואה — לא המרה לכרטיסים. לכן העבודה היא להפוך את הגלילה־האופקית לנכונה למגע ול־RTL, ולתקן את הפותחנים.

- [ ] **עמודה קפואה (LTR, שם משמאל):** הטבלה `dir="ltr"` — עמודת השם נשארת `position:sticky; left:0` (לא להמיר ל־logical). כל אלמנט sticky מקבל הקשר sticky משלו (multi-directional sticky לא נורש).
- [ ] **רמז גלילה (edge cue):** fade/חיתוך נראה בקצה **הימני** (שם מסתתרות העמודות ב־LTR) כדי לאותת "יש עוד עמודות" (NN/G — חובה, לא נקודות).
- [ ] **גלילת מגע נכונה:** `-webkit-overflow-scrolling:touch` + `overscroll-behavior-x:contain` (מונע מ־iframe של מאנדיי לחטוף את ה־swipe האופקי) + `tabindex` + `aria-label` על מיכל הגלילה.
- [ ] **יעדי מגע בתוך השורה:** גובה שורה 36px → ≥44px; ריווח ≥8px בין יעדים גדולים.
- [ ] **פותחנים כ־sheet מלא בנייד:** סטטוס/עדיפות/אחראי/תאריך → גיליון תחתון מלא־רוחב (`full-view`) במקום פופאובר 168–280px שנשפך מהמסך. גילוי גבולות viewport לכל פופאובר portaled.
- [ ] להחיל על שלושת המשטחים, אחד־אחד: `MyTasksTable` (ראשון — המשטח הכי נייד) → `TaskTable`/`TaskTableRow` → `PreviousTasksTab`.
- [ ] **טולבר `MyTasksView`:** 5 ה־pills + שדה חיפוש 180px עולים על 375px — מצב icon-only / קיבוץ ל"more" בנייד; שדה חיפוש כ־overlay במקום הרחבה inline.

**קבצים:** `src/components/MyTasksView/{MyTasksView,MyTasksTable,MyTasksRow}.jsx` + `.module.css`, `src/hooks/useMyTasks.js`, `src/components/TaskTable/*`, `src/components/TaskTableRow/*`, `src/components/TasksTab/*`, `src/components/PreviousTasksTab/*`.

**קריטריון קבלה:** הטבלה נגללת אופקית חלק במגע בלי לחטוף את גלילת ה־iframe; עמודת השם קפואה משמאל (LTR); רמז גלילה נראה בימין; פותחני סטטוס/עדיפות נפתחים כגיליון נוח לאגודל.

**סיכון:** sticky+scroll במגע שביר (lag/flicker ב־iOS); `inset box-shadow` לא תמיד מתרנדר ב־Safari ישן → לבדוק על מכשיר אמיתי, לשקול border במקום inset-shadow.

---

### שלב 3 — פישוט אינטראקציות מגע (הכרעה 3)

**מצב נוכחי:** תפריטי `hover` (kebab/eye/delete בכל מקום) ב־`opacity:0`; גרירת `@dnd-kit` עם ידיות מוסתרות; עריכה ב־double-click; סרגל בחירה צף + FAB עלולים להתנגש.

- [ ] **hover → tap:** ידיות drag/eye/delete שמוסתרות היום ב־`opacity:0` → תמיד גלויות בנייד (או תפריט "..." בטאפ). לעטוף את התלות ב־hover ב־`@media (hover:hover)`.
- [ ] **drag → כפתורי מעלה/מטה:** סידור נושאים/נקודות (`TopicsTab`, `TopicPointRow`) — בנייד להחליף גרירה בכפתורי ↑/↓ (אמין יותר ממגע; לא נלחם בגלילה). אם בכל זאת שומרים גרירה כלשהי: `touch-action:none` רק על **הידית**, לא על השורה.
- [ ] **double-click → tap יחיד:** עריכת שם/כותרת inline בטאפ יחיד; כפתור ✓ סגירה גלוי (לא רק blur/Esc).
- [ ] **בחירה מרובה → מצב "בחירה" מפורש:** במקום checkbox קבוע שגוזל רוחב ב־375px — כניסה למצב בחירה מטולבר ("בחר") או long-press; הדגשת שורה נבחרת ברורה. שמירת סרגל הבחירה הצף (כבר תואם לתפריט התחתון של מאנדיי) עם safe-area.
- [ ] **FAB + סרגל בחירה:** `env(safe-area-inset-bottom)`; הסתרה/הזזה כשמקלדת פתוחה; למנוע חפיפה (FAB 24px / סרגל 16px).
- [ ] **checkbox נקודות:** 18px → ≥24px עם hit-area ≥44px.

**קבצים:** `src/components/TopicsTab/*`, `src/components/TopicPointRow/*`, `src/components/TasksTab/*` + `PreviousTasksTab/*` (לשמור מיושר בין השניים — כלל CLAUDE.md), `src/components/CreateTaskFab/*`, `src/utils/topicOrder.js`.

**קריטריון קבלה:** כל פעולה שהייתה `hover` נגישה במגע; סידור נושאים עובד בלי גרירה; בחירה מרובה ברורה ולא גוזלת רוחב.

---

### שלב 4 — מודאלים וטפסים

**מצב נוכחי:** מודאלים מותאמים (לא Vibe `Modal`) עם `min(760/620/480px,…)`, רוחב 95vw, scroll מקונן ב־`SettingsModal`; פותחנים portaled (`PersonPicker` 280px, `SearchablePicker`) בלי גילוי גבולות viewport; שדה זמן קבוע 140px ב־`CreateDiscussionModal`.

- [ ] **מודאלים מלאי־מסך בנייד:** מעבר ל־Vibe `size="full-view"` (או שווה־ערך) דרך ה־hook במקום מאבק ב־`calc(100vh-…)`. חל על `SettingsModal`, `NewTaskModal`, `CreateDiscussionModal`, `TemplateManagerModal`.
- [ ] **`SettingsModal` (תאימות מלאה):** פתרון ה־scroll הכפול (`.content` + `.body max-height:60vh`); grid 2-עמודות → ערימה בנייד; שורות label+control → ערימה.
- [ ] **`CreateDiscussionModal`:** grid lead+date → ערימה בנייד; שדה זמן 140px קבוע → גמיש; תוויות מעל שדות; תפריטי `position:absolute` → גילוי גבולות.
- [ ] **`PersonPicker`:** רוחב 280px קבוע → `min(280px, 100vw-32px)` + גילוי גבולות; חיפוש במקום גלילה ארוכה; ריווח שורות ≥8px/12px; chips נכרכים יפה.
- [ ] **בורר תאריך:** לוודא שפקד התאריך של Vibe נגלל לטאצ' (לוח גדול / native fallback) ולא פופאובר זעיר; חודשים בעברית; ניווט חודש/שנה ב־swipe; קלט מוקלד כ־fallback; RTL נכון.
- [ ] **כל פופאובר portaled:** גילוי גבולות viewport + מיקום מחדש אם נשפך; `max-height` יחסי ל־`dvh`.

**קבצים:** `src/components/SettingsModal/*` (כולל `SearchablePicker`), `src/components/CreateDiscussionModal/*`, `src/components/NewTaskModal/*`, `src/components/TemplateManagerModal/*`, `src/components/PersonPicker/*`, `src/components/ApplyTemplateMenu/*`.

**קריטריון קבלה:** כל מודאל ממלא מסך נוח בנייד; אין scroll כפול; אף פותחן לא נשפך מהמסך; טפסים נוחים למילוי עם מקלדת פתוחה.

---

### שלב 5 — עורך טקסט עשיר (Summary / TipTap)

**מצב נוכחי:** `SummaryTab` עם `RichTextEditor` (TipTap), טולבר אופקי קבוע בעיצוב דסקטופ; `dir='rtl'` על המיכל.

- [ ] **טולבר דביק מעל המקלדת:** הטולבר נשאר נגיש כשהמקלדת הווירטואלית פתוחה (sticky, לא נגלל מתחת למקלדת).
- [ ] **scroll-caret-into-view:** הסמן תמיד מעל המקלדת; `padding ≥20px` בתוך אזור העריכה.
- [ ] **overflow menu:** כפתורי עיצוב נדירים → תפריט "+"/"עוד" בנייד.
- [ ] **a11y + RTL:** `role="textbox"` + `aria-label` לכפתורי אייקון; `dir="auto"` per-paragraph כדי שאנגלית/קוד מודבק יבודד; סימני רשימה/checklist ב־inline-start (ימין).
- [ ] *הכרעת משנה פתוחה:* האם עריכת TipTap מלאה נדרשת בטלפון, או חוויית סיכום מפושטת (סט עיצוב מינימלי / קריאה-בעיקר)? — `contenteditable`/`Selection` שבריריים במגע. **המלצה:** סט מינימלי בנייד.

**קבצים:** `src/components/SummaryTab/*`, רכיב ה־`RichTextEditor`.

**קריטריון קבלה:** ניתן לקרוא ולערוך סיכום בטלפון בלי שהמקלדת מסתירה את הסמן או הטולבר.

---

### שלב 6 — נכונות RTL ו־bidi

**מצב נוכחי:** מערבב עברית עם אנגלית/מספרים בנתוני מאנדיי (שמות פריטים, תאריכים כמו `2026-06-28`, סטטוסים, אנשים) — בלי בידוד הם מתהפכים ויזואלית.

- [ ] **רכיב `<Bidi>` / `dir="auto"`:** עזר משותף קטן (או `className` עם `unicode-bidi:isolate`) שעוטף כל שדה מונע־נתונים שעלול להכיל אנגלית/מספרים — בשורות רשימה, chips, תאי טבלה. **לא** להשתמש ב־`RLE/LRE/override`.
- [ ] **מראת אייקונים:** אייקונים כיווניים (back/forward, next/prev, disclosure chevrons) → `transform:scaleX(-1)` תחת `dir=rtl`; אייקונים נייטרליים (חיפוש, גלגל, שעון, ✓, פח) → **לא** למראה. לבדוק את ה־pills של `@vibe/icons` ב־`MyTasksView`.
- [ ] השלמת המרת logical-properties **במשטחי ה־RTL** שטרם הומרו (לא באיים ה־LTR — שם `left/right` נכונים).

**קבצים:** רכיב `<Bidi>` חדש (`src/components/Bidi/` או util), והחלתו ב־`DiscussionList`, `MyTasksRow`, `TaskTableRow`, chips.

**קריטריון קבלה:** שם משימה כמו "תיקון `API v2`" ותאריכים מוצגים בסדר ויזואלי נכון; אייקונים כיווניים פונים נכון ב־RTL.

---

### שלב 7 — בדיקות ו־QA

- [ ] **בדיקות יחידה (prop-based):** רכיבי תצוגה מקבלים `isMobile` כ־prop ונבדקים `true`/`false` ב־`vitest` בלי למוק `matchMedia`. הרחבת ה־stub ב־`src/setupTests.js` כך ש־`matches` ניתן לדריסה per-test.
- [ ] **מגבלת jsdom:** אין מנוע layout — `@media`/`@container` לא נבדקים ב־`vitest`. רספונסיביות מבוססת־CSS נבדקת ידנית.
- [ ] **QA מכשיר אמיתי:** דרך `npm run tunnel` בתוך ה־iframe של מאנדיי, על **iOS Safari וגם Android Chrome** (rollout נייד של מאנדיי נטה היסטורית ל־iOS-first — לא להניח זהות), חשבון בתשלום, נתונים אמיתיים מעורבי עברית+אנגלית, ביד אחת.
- [ ] *אופציונלי:* בדיקת Playwright עם viewport נייד לזרימת הטבלה הקריטית.

**קריטריון קבלה:** חבילת הבדיקות עוברת; מעבר ידני על כל המשטחים ב־iOS+Android ללא חיתוך/גלישה/יעדים זעירים.

---

## 4. מטריצת סיכונים

| סיכון | חומרה | מיטיגציה |
|-------|-------|----------|
| sticky+scroll אופקי שביר במגע (iOS) | גבוהה | בדיקת מכשיר מוקדמת בשלב 2; border במקום inset-shadow |
| גלילת iframe חוטפת את ה־swipe האופקי | גבוהה | `overscroll-behavior-x:contain` |
| גרירת נושאים נלחמת בגלילה אנכית | בינונית | החלפה בכפתורי ↑/↓ (הכרעה 3) |
| פותחנים portaled נשפכים מהמסך | גבוהה | `full-view` sheet + גילוי גבולות viewport |
| `100vh` נחתך / safe-area מסתיר FAB | בינונית | `100svh` + `env(safe-area-inset-*)` |
| bidi מהפך שמות/תאריכים | בינונית | רכיב `<Bidi>` / `dir="auto"` |
| רגרסיה בדסקטופ מהסריקה הגורפת | בינונית | PR נפרד ל־logical-properties; diff נסקר בנפרד |

---

## 5. סיכום רצף ותלויות

```
שלב 0 (תשתית)  ──┬─→ שלב 1 (ניווט)
                 ├─→ שלב 2 (טבלאות) ⭐  ──→ שלב 3 (מגע)
                 ├─→ שלב 4 (מודאלים)
                 ├─→ שלב 5 (עורך)
                 └─→ שלב 6 (RTL/bidi)  ──→ שלב 7 (QA)
```

שלב 0 חוסם את כל השאר. שלבים 1/2/4/5/6 עצמאיים זה מזה (אפשר במקביל). שלב 3 תלוי ב־2 (אותם משטחי טבלה). שלב 7 אחרון.

**הערת deploy:** הפריסה ידנית ומגודרת בפרויקט הזה — לא לפרוס אלא אם התבקש מפורשות (`npm run deploy` → app `11457413`, פלט `build/`).

---

## 6. הכרעות משנה שנותרו פתוחות

אלו לא חוסמות התחלה; נכריע תוך כדי או בנקודת ההגעה:

1. **עומק בחירה מרובה בנייד:** long-press מול כפתור "בחר" מפורש בטולבר. (נטייה: כפתור מפורש — גלוי יותר.)
2. **טולבר `MyTasksView`:** icon-only מול קיבוץ ל"more". (נטייה: icon-only + חיפוש כ־overlay.)
3. **עורך Summary בנייד:** TipTap מלא מול סט מינימלי. (נטייה: מינימלי.)
4. **tablet (768–1023px):** יעד מדרגה ראשונה עם layout משלו, או יורש מדסקטופ. (נטייה: יורש מדסקטופ ב־v1.)
5. **בורר מובייל לפריטים:** הרחבה in-place מול `openItemCard` בלבד. (נטייה: `openItemCard` — כבר מחווט ונתמך.)
