# i18n / Locale / Direction — סקירת ממצאים

**תאריך יצירה:** 2026-05-11
**Implementation state of truth:** [`docs/i18n-implementation-state.md`](./i18n-implementation-state.md) — קרא אותו ראשון אחרי כל `/compact`.
**Wave plans:** [`tech-debt/wave-i18n-A.md`](../tech-debt/wave-i18n-A.md) · [`B`](../tech-debt/wave-i18n-B.md) · [`C`](../tech-debt/wave-i18n-C.md).
**Scope:** כל קבצי ה-UI ב-`src/` (JSX).

## החלטות תכן שננעלו (2026-05-12)

1. **Pre-i18n boot screens (`NetworkErrorScreen`, `ErrorBoundary`):** מציגים **באנגלית בלבד** במצב boot/error לפני שה-i18n נטען. זו החלטת מוצר — לא צריך pre-boot locale resolver. הסעיפים האלה בממצאים מסומנים מטה כ-**WONT-FIX** למחרוזות, אבל `dir="ltr"` ב-`NetworkErrorScreen` עדיין נשאר נקודה לדיון (קוראי עברית יראו טקסט אנגלי ב-LTR — סביר).
2. **`"Powered by Twyst"`:** brand literal. נשאר קשיח. **WONT-FIX**.
3. **`calendarConfig.jsx` static exports:** `localizer`, `WorkWeekView`, `ThreeDayView`, `hebrewMessages` — **dead exports** (אומת ב-grep, אין צרכנים חיצוניים). המלצה: למחוק. `locales` להפוך ל-internal (להוריד `export`).

---

## תשתית i18n קיימת (להזכרה)

- `useStableT()` (`src/i18n/useStableT.js`) — מועדף; `t()` עם זהות יציבה ל-deps arrays.
- `useTranslation()` (react-i18next) — מקובל גם, אבל אסור להכניס `t` מכאן ל-deps של `useEffect/useMemo/useCallback` ללא `useStableT`.
- `useLocale()` (`src/hooks/useLocale.js`) — מקור אמת יחיד ל: `language, isRtl, isLtr, dir, dateLocale ('he-IL'|'en-US'), dateFnsLocale (he|enUS), culture`.
- שפות נתמכות: `he` (RTL, ברירת מחדל) ו-`en` (LTR).
- קבצי תרגום: `src/i18n/locales/{he,en}/translation.json`.

---

## סיכום חומרה (לפי דחיפות לתיקון)

> **מעקב התקדמות.** כל שורה צריכה לעבור 3 שלבים:
> - **תוכנן** — שיוך ל-Wave: `W6.A` / `W6.B` / `W6.C` (או `N/A` ל-WONT-FIX).
> - **בוצע** — מספר PR שמרג ל-main, או `#PR-XX`.
> - **נבדק** — תאריך + ראשי תיבות (`YYYY-MM-DD IY`) אחרי שעברו 4 ה-checks האוטומטיים (ראה למטה).
>
> `☐` = פתוח · ערך מלא = הושלם · `N/A` = לא רלוונטי.
>
> **קריטריונים ל-"נבדק" (אוטומטיים בלבד):**
> 1. `pnpm test:run` עובר (Vitest, 3 timezones ב-CI).
> 2. `pnpm run build` מצליח.
> 3. ESLint warnings ≤ baseline שנעוץ ב-`.github/workflows/test.yml`.
> 4. `src/i18n/__tests__/keySymmetry.test.js` עובר (שתי השפות סימטריות במפתחות).
>
> QA ידני אמיתי (עיניים על המסך) נשאר באחריות אדם, אבל שורה לא מסומנת `נבדק` עד שכל ה-4 עוברים.

### 🔴 P0 — אזורים בלי i18n כלל (טקסטים אנגלית או עברית בקוד)

| קובץ | פרטים | תוכנן | בוצע | נבדק |
|---|---|---|---|---|
| `components/SettingsWizard/steps/WelcomeStep.jsx` | כל הטקסטים ב-Hard-coded English. אין `useTranslation` כלל. שורות 23–41. | W6.A | #30 | 2026-05-12 ✓ |
| `components/SettingsWizard/steps/QuestionsStep.jsx` | כל הטקסטים ב-Hard-coded English (Yes/No, headings, descriptions). אין `useTranslation` כלל. שורות 16–47. | W6.A | #30 | 2026-05-12 ✓ |
| `components/SettingsWizard/steps/InstallStep.jsx` | כל הטקסטים ב-Hard-coded English (Tasks/Stages/Yes/No, סטטוסי התקנה, כפתורים). אין `useTranslation` כלל. שורות 33–107. | W6.A | #30 | 2026-05-12 ✓ |
| `components/SettingsWizard/SettingsWizard.jsx` | Hardcoded EN: `Get started`, `Next`, `Setup wizard`, `Time Tracker`, `Close`, `Back`, `Close wizard`, `Wizard steps`. שורות 99, 102–127, 157. בנוסף `dir="ltr"` קשיח (שורה 103). | W6.A | #30 | 2026-05-12 ✓ |
| `components/NetworkErrorScreen.jsx` | WONT-FIX (החלטת תכן: מסך boot באנגלית בלבד). | N/A | N/A | N/A |
| `components/ApprovalActionBar/ApprovalActionBar.jsx` | כל הטקסטים עברית קשיחה (`דיווח אחד נבחר לאישור`, `דיווחים נבחרו לאישור`, `אשר נבחרים`, `אשר`, `מאשר...`, `בטל בחירה`). אין `useTranslation`. שורות 22–42. | W6.A | #30 | 2026-05-12 ✓ |
| `components/ErrorToast/ErrorToast.jsx` | כל `aria-label`+`title` בעברית קשיחה (`העתק פרטים`, `נסה שוב`, `פרטים`, `סגור`), והטקסט הגלוי `הועתק!`. אין `useTranslation`. שורות 44–79. | W6.A | #30 | 2026-05-12 ✓ |

### 🟠 P1 — טקסטים בודדים בעברית/אנגלית קשיחה בתוך קומפוננטות שכן משתמשות ב-i18n

| קובץ | שורה | תוכן | תוכנן | בוצע | נבדק |
|---|---|---|---|---|---|
| `components/AllDayEventModal/AllDayEventModal.jsx` | 1205 | `צור אירוע` בכפתור — לא דרך `t()` (כל יתר הכפתורים כן). | W6.C | #32 | 2026-05-12 ✓ |
| `components/SettingsDialog/SearchableSelect.jsx` | 93 | `"טוען..."` קשיח. | W6.B | #31 | 2026-05-12 ✓ |
| `components/SettingsDialog/SearchableSelect.jsx` | 120 | `placeholder="חפש ברשימה..."` קשיח. | W6.B | #31 | 2026-05-12 ✓ |
| `components/SettingsDialog/SearchableSelect.jsx` | 151–153 | `לא נמצאו תוצאות עבור "${term}"` + `אין אפשרויות זמינות` — קשיח, כולל interpolation ב-template literal במקום `t(key,{term})`. | W6.B | #31 | 2026-05-12 ✓ |
| `components/SettingsDialog/MultiSelect.jsx` | 87 | `"טוען..."` קשיח. | W6.B | #31 | 2026-05-12 ✓ |
| `components/SettingsDialog/MultiSelect.jsx` | 91 | `` `${selectedOptions.length} נבחרו` `` — Hebrew + JS interpolation; צריך `t(key,{count})`. | W6.B | #31 | 2026-05-12 ✓ |
| `components/SettingsDialog/MultiSelect.jsx` | 128 | `placeholder="חפש ברשימה..."` קשיח. | W6.B | #31 | 2026-05-12 ✓ |
| `components/SettingsDialog/MultiSelect.jsx` | 166 | `לא נמצאו תוצאות עבור "{searchTerm}"` קשיח. | W6.B | #31 | 2026-05-12 ✓ |
| `components/DatePickerInput/DatePickerInput.jsx` | 145 | `בחר תאריך` קשיח. | W6.B | #31 | 2026-05-12 ✓ |
| `components/DatePickerInput/DatePickerInput.jsx` | 168 | כפתור `היום` קשיח. | W6.B | #31 | 2026-05-12 ✓ |
| `components/TimeSelect/TimeSelect.jsx` | 13 | default prop `placeholder = "בחר שעה ..."` קשיח. | W6.B | #31 | 2026-05-12 ✓ |
| `components/TimeSelect/TimeSelect.jsx` | 217 | `"טוען..."` קשיח. | W6.B | #31 | 2026-05-12 ✓ |
| `components/TimeSelect/TimeSelect.jsx` | 261 | `אין זמנים זמינים` קשיח. | W6.B | #31 | 2026-05-12 ✓ |
| `components/TaskSelect/TaskSelect.jsx` | 15, 156, 159, 185, 214, 218, 226, 233 | 8 מחרוזות עברית קשיחות: defaults, `טוען...`, `מוסיף משימה חדשה...`, `חפש משימה...`, `צור משימה חדשה: "..."`, `אין משימות זמינות`, `+ הוסף משימה חדשה`, `שם המשימה`. | W6.B | #31 | 2026-05-12 ✓ |
| `components/StopwatchLoader/StopwatchLoader.jsx` | 5 | `aria-label="טוען..."` קשיח (קוראי מסך באנגלית יקבלו עברית). | W6.A | #30 | 2026-05-12 ✓ |
| `components/ConfirmDialog/ConfirmDialog.jsx` | 11–14 | default props בעברית: `אישור`, `האם אתה בטוח?`, `אישור`, `ביטול` — אם הקורא לא מעביר ערכים מתורגמים יוצג עברית קשיחה. | W6.A | #30 | 2026-05-12 ✓ |
| `components/ErrorBoundary/ErrorBoundary.jsx` | 40–43 | `אירעה שגיאה`, `אנא רענן את הדף או פנה לתמיכה.`, `פרטי שגיאה` — קשיח. הערה: זו class component שלא יכולה להשתמש ב-hooks; שווה לפחות לחשוב על גישה דרך `i18next.t` ישירות + fallback. | W6.A | #30 | 2026-05-12 ✓ |
| `components/ErrorDetailsModal/ErrorDetailsModal.jsx` | 122, 134, 160 | תוויות EN קשיחות: `Request ID:`, `Stack Trace:`, `Variables:`. | W6.A | #30 | 2026-05-12 ✓ |
| `MondayCalendar.jsx` | 1267 | `'הדיווח נעול - אושר ע"י מנהל'` קשיח בתוך `useMemo` (lockReason שמוצג ב-UI). | W6.C | #32 | 2026-05-12 ✓ |
| `MondayCalendar.jsx` | 110–113 | `HEBREW_WEEKDAYS_GUTTER = ['א׳', 'ב׳', ...]` ו-`יום ${...}` ב-`TimeGutterHeaderFactory` — לא תומך באנגלית. | W6.C | #32 | 2026-05-12 ✓ |
| `App.jsx` + `MondayCalendar.jsx` | 98, 1408, 1414 | `"Powered by Twyst"` — WONT-FIX (brand literal לפי החלטת תכן). | N/A | N/A | N/A |

### 🟠 P1 — Direction / RTL קשיח

| קובץ | שורה | בעיה | תוכנן | בוצע | נבדק |
|---|---|---|---|---|---|
| `components/SettingsWizard/SettingsWizard.jsx` | 103 | `<div dir="ltr">` — נכפה LTR ללא קשר ל-locale. | W6.A | #30 | 2026-05-12 ✓ |
| `components/NetworkErrorScreen.jsx` | 51 | `dir="ltr" lang="en"` — WONT-FIX (מסך boot באנגלית). | N/A | N/A | N/A |
| `components/ErrorBoundary/ErrorBoundary.jsx` | 43 | inline `direction: 'rtl'` + `textAlign: 'right'` קשיח. צריך `direction: 'inherit'` ו-`textAlign: 'start'`. | W6.A | #30 | 2026-05-12 ✓ |
| `components/SettingsDialog/SearchableSelect.jsx` | 107 | dropdown מקובע `left: rect.left` — שגוי ב-RTL (צריך לבחור inset לפי `useLocale().dir` או להשתמש ב-`insetInlineStart`). | W6.B | #31 | 2026-05-12 ✓ |
| `components/SettingsDialog/MultiSelect.jsx` | 117, 155 | זהה ל-SearchableSelect + inline `marginLeft/marginRight` (`marginInline` עדיף). | W6.B | #31 | 2026-05-12 ✓ |
| `components/DatePickerInput/DatePickerInput.jsx` | 24–25, 152 | popup תמיד מעוגן ל-`right` — שגוי ב-LTR. אין שימוש ב-`useLocale()`. | W6.B | #31 | 2026-05-12 ✓ |
| `components/TimeSelect/TimeSelect.jsx` | 34, 46, 49, 237–239 | dropdown תמיד מעוגן ל-`left`. אין `useLocale()`. | W6.B | #31 | 2026-05-12 ✓ |
| `components/TaskSelect/TaskSelect.jsx` | 45, 55, 59, 172–174 | זהה ל-TimeSelect — `left` קשיח. | W6.B | #31 | 2026-05-12 ✓ |
| `components/AllDayEventModal/AllDayEventModal.jsx` | 797, 824, 1090 | inline `marginRight: '12px'/'10px'` — physical property; להעדיף `marginInlineEnd` או class ב-CSS Module. | W6.C | #32 | 2026-05-12 ✓ |
| `components/Dashboard/DashboardBarChart.jsx` | 31 | `style={{ direction: 'ltr' }}` קשיח (workaround ל-Recharts — לגיטימי אך עדיף לעטוף עם הערה / קבוע). | W6.C | #32 | 2026-05-12 ✓ |
| `components/Dashboard/DashboardEmployeeChart.jsx` | 53 | זהה. | W6.C | #32 | 2026-05-12 ✓ |
| `components/Dashboard/DashboardPieCharts.jsx` | 147, 182 | זהה. | W6.C | #32 | 2026-05-12 ✓ |
| `components/Dashboard/DashboardToolbar.jsx` | 3, 18–21 | `<ArrowRight />` כאייקון "חזרה" — ב-RTL החץ צריך להיות `ArrowLeft`. אין שימוש ב-`useLocale().isRtl`. **באג ויזואלי אמיתי בעברית.** | W6.C | #32 | 2026-05-12 ✓ |

### 🟡 P2 — Hardcoded locale / locale-less formatting

| קובץ | שורה | בעיה | תוכנן | בוצע | נבדק |
|---|---|---|---|---|---|
| `components/EventModal/EventModal.jsx` | 726 | `a.name.localeCompare(b.name, 'he')` — locale קשיח. צריך `useLocale().language`. | W6.C | #32 | 2026-05-12 ✓ |
| `components/AllDayEventModal/AllDayEventModal.jsx` | 305 | אותו דבר: `localeCompare(b.name, 'he')`. | W6.C | #32 | 2026-05-12 ✓ |
| `components/CustomDatePicker.jsx` | 5–6 | `WEEK_DAYS_HE` / `WEEK_DAYS_EN` קשיחים — להפיק מ-`date-fns`/`Intl` עם `useLocale().dateFnsLocale`. | W6.C | #32 | 2026-05-12 ✓ |
| `components/CustomEvent/CustomEvent.jsx` | 55 | `format(start,'HH:mm')` ללא `{ locale }`. שולי כי `HH:mm` אינטרנציונלי, אבל לא עקבי. | W6.C | #32 | 2026-05-12 ✓ |
| `components/MobileResizeOverlay/MobileResizeOverlay.jsx` | 220, 228 | `format(date,'HH:mm')` ללא `{ locale: dateFnsLocale }`. | W6.C | #32 | 2026-05-12 ✓ |
| `components/Dashboard/DashboardStats.jsx` | 45, 84 | `{percent}%` ללא `Intl.NumberFormat(dateLocale, { style: 'percent' })`. אין `useLocale` בקובץ. | W6.C | #32 | 2026-05-12 ✓ |
| `components/Dashboard/DashboardBarChart.jsx` | 47 | טריק reverse-translation: `t('dashboard.granularity.day') !== 'Day' ? 'שעות' : 'hours'`. שביר ולא דרך `t()`. צריך key ייעודי. | W6.C | #32 | 2026-05-12 ✓ |
| `components/MonthlyBattery/MonthlyBattery.jsx` | 65, 70–71 | `שעות` (×2) ו-`סה״כ` קשיחים בעברית בתוך tooltip + מספרים בלי `toLocaleString`. אין `useTranslation` בקובץ. | W6.C | #32 | 2026-05-12 ✓ |
| `constants/calendarConfig.jsx` | 17, 69–70, 102 | static exports `locales`, `localizer`, `WorkWeekView`, `ThreeDayView` — **dead exports** (לפי החלטת תכן: למחוק). | W6.A | #30 | 2026-05-12 ✓ |
| `constants/calendarConfig.jsx` | 105–121 | `hebrewMessages` object — **dead export** (לפי החלטת תכן: למחוק). | W6.A | #30 | 2026-05-12 ✓ |
| `contexts/MondayContext.jsx` | 8–12 | default value של createContext עם `language:'he', dir:'rtl', locale:'he-IL'` — מסתיר חוסר provider. | W6.C | #32 | 2026-05-12 ✓ |
| `contexts/MondayContext.jsx` | 33 | `LANGUAGE_TO_LOCALE[language] || LANGUAGE_TO_LOCALE.he` — fallback לעברית בשקט; אם זה כוונה ב-design — להוסיף הערת why. | W6.C | #32 | 2026-05-12 ✓ |
| `contexts/MondayContext.jsx` | 133–134 | `weekStartDay = 0` ו-`timeFormat = '24h'` קשיחים. אפשר לגזור מ-`context.user.timeFormat`/locale. | W6.C | #32 | 2026-05-12 ✓ |

### 🟡 P2 — `t` ב-deps ללא `useStableT`

| קובץ | שורה | פרטים | תוכנן | בוצע | נבדק |
|---|---|---|---|---|---|
| `components/SettingsDialog/MappingTab.jsx` | 108–114 | `useMemo` שקורא ל-`t()` עם deps `[settings.customerColumnId, settings.customerReportColumnId]` — חסר `t`. אם השפה משתנה ב-runtime, ההודעה לא מתעדכנת. עדיף `useStableT` ולהוסיף `t` ל-deps. | W6.C | #32 | 2026-05-12 ✓ |
| `components/EventModal/EventModal.jsx` | 286–435 | `useCallback`-ים רבים שמשתמשים ב-`t(...)` בפנים בלי לכלול `t` ב-deps. שימוש ב-`useStableT` יפתור בנקייה. | W6.C | #32 | 2026-05-12 ✓ |
| `components/AllDayEventModal/AllDayEventModal.jsx` | 47, 739 | `useTranslation()` + שימוש ב-`t` בתוך `useEffect` ללא `t` ב-deps. | W6.C | #32 | 2026-05-12 ✓ |
| `components/Dashboard/DashboardFilterPanel.jsx` | 53–72 | שלוש `useMemo`-ים עם `t` ב-deps אבל מתוך `useTranslation` (זהות לא יציבה) — שווה לעבור ל-`useStableT`. | W6.C | #32 | 2026-05-12 ✓ |
| `components/Dashboard/DashboardPieCharts.jsx` | 20–48 | זהה — `useMemo` עם `t` ב-deps על בסיס `useTranslation`. | W6.C | #32 | 2026-05-12 ✓ |
| כל קומפוננטות Dashboard.* | — | משתמשות ב-`useTranslation` במקום ב-`useStableT` (אי-עקביות עם שאר הפרויקט). | W6.C | #32 | 2026-05-12 ✓ |

### 🟢 ✅ Clean

הקבצים הבאים נקיים מ-i18n/RTL hardcoding משמעותי:

- `App.jsx` (למעט `Powered by Twyst`)
- `components/FilterBar/FilterBar.jsx`
- `components/CalendarToolbar.jsx`
- `components/CustomEvent/CustomEvent.jsx` (למעט הערת `HH:mm`)
- `components/SettingsDialog/SettingsDialog.jsx`
- `components/SettingsDialog/StructureTab.jsx`
- `components/SettingsDialog/CalendarTab.jsx`
- `components/SettingsDialog/AdditionalTab.jsx`
- `components/SettingsValidationDialog/SettingsValidationDialog.jsx`
- `components/ContextMenu/ContextMenu.jsx`
- `components/Toast/Toast.jsx`
- `components/UndoBanner/UndoBanner.jsx`
- `components/SelectionActionBar/SelectionActionBar.jsx`
- `components/Dashboard/Dashboard.jsx`
- `components/Dashboard/SegmentedToggle.jsx`
- `contexts/SettingsContext.jsx`

---

## טבלת חתימה לפי קובץ

| קובץ | P0 | P1 strings | P1 RTL | P2 locale | P2 t-deps |
|---|---|---|---|---|---|
| App.jsx | — | 1 (brand) | — | — | — |
| MondayCalendar.jsx | — | 2 (lockReason, gutter) | — | — | — |
| constants/calendarConfig.jsx | — | — | — | static he | — |
| contexts/MondayContext.jsx | — | — | — | default he | — |
| SettingsWizard.jsx | ✅ | — | dir=ltr | — | — |
| SettingsWizard/steps/WelcomeStep.jsx | ✅ | — | — | — | — |
| SettingsWizard/steps/QuestionsStep.jsx | ✅ | — | — | — | — |
| SettingsWizard/steps/InstallStep.jsx | ✅ | — | — | — | — |
| NetworkErrorScreen.jsx | ✅ | — | dir=ltr | — | — |
| ApprovalActionBar.jsx | ✅ | — | — | — | — |
| ErrorToast.jsx | ✅ | — | — | — | — |
| EventModal.jsx | — | — | — | localeCompare | useCallback deps |
| AllDayEventModal.jsx | — | 1 (`צור אירוע`) | marginRight ×3 | localeCompare | useEffect dep |
| SearchableSelect.jsx | — | 3 | left anchor | — | — |
| MultiSelect.jsx | — | 4 | left+marginRL | — | — |
| MappingTab.jsx | — | — | — | — | useMemo dep |
| DatePickerInput.jsx | — | 2 | right anchor | — | — |
| TimeSelect.jsx | — | 3 | left anchor | — | — |
| TaskSelect.jsx | — | 8 | left anchor | — | — |
| StopwatchLoader.jsx | — | 1 (aria) | — | — | — |
| ConfirmDialog.jsx | — | 4 (defaults) | — | — | — |
| ErrorBoundary.jsx | — | 3 | rtl+textAlign | — | — |
| ErrorDetailsModal.jsx | — | 3 (EN) | — | — | — |
| CustomDatePicker.jsx | — | — | inline dir | weekday arrays | — |
| CustomEvent.jsx | — | — | — | HH:mm no locale | — |
| MobileResizeOverlay.jsx | — | — | — | HH:mm no locale | — |
| DashboardBarChart.jsx | — | 1 (reverse-t) | direction:ltr | — | useTranslation |
| DashboardEmployeeChart.jsx | — | — | direction:ltr | — | useTranslation |
| DashboardPieCharts.jsx | — | — | direction:ltr | — | useMemo deps |
| DashboardFilterPanel.jsx | — | — | — | — | useMemo deps |
| DashboardStats.jsx | — | — | — | %, no useLocale | useTranslation |
| DashboardToolbar.jsx | — | — | ArrowRight RTL bug | — | useTranslation |
| MonthlyBattery.jsx | — | 2 | — | no toLocaleString | — |

---

## המלצות סדר טיפול

1. **באג ויזואלי בעברית:** `DashboardToolbar.jsx` — להפוך את ה-`ArrowRight` ב-RTL.
2. **WizardSteps + NetworkErrorScreen:** להוסיף i18n keys ל-Welcome/Questions/Install/NetworkError ולחבר `useStableT` + `useLocale().dir`.
3. **ErrorToast / ApprovalActionBar / StopwatchLoader:** טקסטים עברית קשיחים — להוסיף keys ולעבור ל-`t()`.
4. **SearchableSelect / MultiSelect / DatePickerInput / TimeSelect / TaskSelect:** כל החמישה חולקים אותה תבנית של "טקסטים קשיחים + dropdown anchor קשיח". טיפול קיבוצי: לעבור ל-`useStableT` + לחשב anchor לפי `useLocale().dir` (`insetInlineStart`).
5. **EventModal + AllDayEventModal:** מעבר ל-`useStableT`, החלפת `localeCompare('he')` ב-`useLocale().language`, ושינוי inline `marginRight` ל-logical properties.
6. **Dashboard family:** מעבר עקבי ל-`useStableT`, החלפת ה-reverse-translation hack ב-`DashboardBarChart`, הוספת `Intl.NumberFormat` ב-`DashboardStats` ו-`MonthlyBattery`.
7. **MondayCalendar TimeGutter + lockReason:** locale-aware weekday formatting + `t()` ל-lockReason.
8. **calendarConfig.jsx:** למחוק static exports נעולים על `he` (אם לא בשימוש) או להפוך ל-private.
9. **ErrorBoundary:** קשה (class component) — לפחות `direction:'inherit'` + `textAlign:'start'` + שימוש ב-`i18next.t` ישירות לטקסטים.
10. **MondayContext defaults:** לבחון אם ה-default context value צריך להיות `null` כדי לחשוף שימוש מחוץ ל-provider במקום fallback שקט ל-Hebrew.

---

*המסמך הופק מסקירה מקבילה של 5 sub-agents (Sonnet) שכל אחד סרק תת-ספריית UI נפרדת. לא בוצעו שינויי קוד.*
