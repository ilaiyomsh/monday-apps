# אינדקס קבצי מקור — לפי תיקון

מסמך זה מחליף את `src-snapshot/`. במקום עותקים (שמסתכנים ב-drift), הוא **מצביע על הקבצים החיים** ב-`src/`, מקובץ לפי שלב בתוכנית, כך שלכל תיקון יש הפניה מדויקת לקובץ המקור ולשורות.

> **כל הנתיבים יחסיים לשורש הפרויקט** (`/Users/ilaish/monday_app/apps/tracker/tracker/`) ואומתו כקיימים.
> **מקור:** `A` = `error-handling-audit.md`, `S` = `sink-readiness.md`.
> **התוכנית המלאה:** `error-handling-implementation-plan.md` (באותה תיקייה).
> **עדכון drift-check (§9 בתוכנית):** מתוך שורות ה-Medium/Low — 7 הופרכו ו-5 drifted. **קוד מת (test-only, descoped — אין לאינסטרמנט):** שלוש הפונקציות ב-`columnValueBuilders.js`. **כבר מטופלות/מוגנות (אין פעולה):** `SettingsDialog.jsx:79–96` ו-`:392–399`, `DashboardFilterPanel.jsx:88–99`, `AdditionalTab.jsx:74–85`. מספרי שורות drifted עודכנו במקומם.

---

## Phase 0 — הבאג החי

| # | תיקון | קובץ מקור (חי) | שורות | חומרה | מקור |
|---|---|---|---|---|---|
| C1 | `writeCache`/`cacheKey` אינם מוגדרים → `ReferenceError` בכל טעינה מוצלחת; להחליף ב-`saveToStorage(...)` כמו ב-`:145` | `src/hooks/useAllBoardProjects.js` | 215 | קריטי | A |

---

## Phase 1 — תשתית הלוגר (Workstream A)

| # | תיקון | קובץ מקור (חי) | שורות | חומרה | מקור |
|---|---|---|---|---|---|
| A1 | נקודת איגוד אחת `emit(record)`; כל המתודות עוברות דרכה | `src/utils/logger.js` | 103–307 | ארכיטקטורה | S |
| A2 | לנתב את העוקפים דרך `emit`: ה-`console.error` של הסטאק | `src/utils/logger.js` | 169 | ארכיטקטורה | S |
| A3 | לנתב את `api`/`apiResponse`/`apiError` (console.group) דרך `emit` | `src/utils/logger.js` | 177–236 | ארכיטקטורה | S |
| A4 | לנתב את `initDone`/`initSummary` (console.log גולמי) דרך `emit` | `src/utils/logger.js` | 276–306 | ארכיטקטורה | S |
| A5 | רישום sinks `addSink`/`removeSink` + ring buffer + `flush()` | `src/utils/logger.js` | 103–307 | ארכיטקטורה | S |
| A6 | נורמליזציית רשומה אחידה (+ timestamp ל-epoch/ISO) | `src/utils/errorHandler.js` | createFullErrorObject | ארכיטקטורה | S |

---

## Phase 2 — קריטיים במסלולי כתיבה + שורש `safeApi`

| # | תיקון | קובץ מקור (חי) | שורות | חומרה | מקור |
|---|---|---|---|---|---|
| C2 | `createEvent`: `createItem` falsy נבלע ומחזיר `null` → `logger.error` + לזרוק `MondayApiError` | `src/hooks/useMondayEvents.js` | 642–673 | קריטי | A |
| C3 | `handleCreateEvent`: טוסט הצלחה כוזב על `null` → לשמור על ערך החזרה, `showErrorWithDetails` | `src/MondayCalendar.jsx` | 915–919 | קריטי | A |
| R1 | שורש: `safeApi` רושם אך **לא זורק** על GraphQL רך → עוזר משותף `assertNoGraphQLErrors(res)` במסלולי כתיבה | `src/utils/mondayApi/client.js` | ~256 (234–293) | קריטי/גבוה | A·S |

---

## Phase 3 — שני משטחי ה-dark המבניים

| # | תיקון | קובץ מקור (חי) | שורות | חומרה | מקור |
|---|---|---|---|---|---|
| D1 | `showErrorWithDetails` — מסלול ההצגה הראשי, **אין `logger`** → לקרוא `logger.error`/`apiError` עם ה-`fullErrorObject` | `src/hooks/useToast.js` | 69–134 | גבוה | S |
| D2 | 4× `console.error` עירום (אין import של `logger`) → `logger.error`; וגם `handleGlobalError` עצמו | `src/utils/globalErrorHandler.js` | 21, 34, 97, 139 | קריטי/גבוה | S |

---

## Phase 4 — פערי High (audit H1–H10)

| # | תיקון | קובץ מקור (חי) | שורות | חומרה | מקור |
|---|---|---|---|---|---|
| H1 | `createEventTypeStatusColumn`: id חסר נבלע → לזרוק `MondayApiError` | `src/utils/mondayApi/columns.js` | 59–62 | גבוה | A |
| H2 | `createColumn`: `null` נבלע → לזרוק `MondayApiError` | `src/utils/mondayApi/columns.js` | 90–93 | גבוה | A |
| H3 | `findProjectLinkColumn`: `catch { continue }` ריק סביב `JSON.parse` → `logger.warn` | `src/utils/mondayApi/items.js` | 196, 202 | גבוה | A |
| H4 | `fetchActiveAssignments`: catch הערה-בלבד סביב `JSON.parse` → `logger.warn` | `src/utils/mondayApi/items.js` | 525, 527 | גבוה | A |
| H5 | `handleUpdateAllDayEvent`: soft-error = "עודכן בהצלחה" כוזב → לבדוק `res.errors` | `src/hooks/useAllDayEvents.js` | 136–168 | גבוה | A |
| H6 | שכפול קבוצתי: כשל-מלא ללא הצגה → `failureCount` + `showErrorWithDetails` | `src/hooks/useCalendarSelection.js` | 50–72 | גבוה | A |
| H7 | `JSON.parse` של הגדרות ללא catch → מקפיא ספינר; לעטוף + `setIsLoading(false)` | `src/contexts/SettingsContext.jsx` | 248–318 | גבוה | A |
| H8 | `useEffect` קורא `loadSettings()` בלי await/catch → `.catch(...)` | `src/contexts/SettingsContext.jsx` | 337–340 | גבוה | A |
| H9 | `FileReader.onerror`: מציג טוסט אך לא רושם → `logger.error` | `src/components/SettingsDialog/SettingsDialog.jsx` | 230–232 | גבוה | A |
| H10 | `handleInstall` ענף `ok===false`: שמירה כושלת ללא רישום → `logger.error` + הודעה ספציפית | `src/components/SettingsWizard/SettingsWizard.jsx` | 60–68 | גבוה | A |

---

## Phase 5 — בינוני + זנב ארוך + הקשחת ErrorBoundary

### 5א — פענוח תאריך/מספר לא-מוגן (חומרה בינונית)

| תיקון | קובץ מקור (חי) | שורות | מקור |
|---|---|---|---|
| `JSON.parse` bare-catch (project/task link) | `src/components/SettingsDialog/MappingTab.jsx` | 306–331 (drift; היה 309–315, 323–329) | A |
| render: `options.filter/.find` ללא null-guard | `src/components/SettingsDialog/SearchableSelect.jsx` | 59–65 | A |
| ⚠️ **descoped — קוד מת (test-only):** ה-builders אינם נקראים בפרודקשן (§9); הוולידציה החיה היא `payloadGuard.js`. אין לאינסטרמנט. | `src/utils/columnValueBuilders.js` | 22–29, 41–68, 78–105 | A |
| `aggregateAll`/`consolidateBarData`: `format()` על Invalid Date | `src/utils/dashboardAggregation.js` | 183–377, 385–407 | A |
| `buildDateFilterRule`/`getEffectiveDateRange`/`formatPeriodLabel`: Invalid Date | `src/utils/dateFilterUtils.js` | 37–83, 92–116, 146–170 | A |
| `toMonday*`/`toLocal*`: getters ללא guard → `NaN` לכתיבה | `src/utils/dateFormatters.js` | 11–16, 23–28, 45–50, 57–61 | A |
| `toMondayDate/DateTimeString`: ערך ריק נכתב בשקט | `src/utils/dateTimeHelpers.js` | 109–126 | S |

### 5ב — זנב ארוך (חומרה נמוכה)

| תיקון | קובץ מקור (חי) | שורות | מקור |
|---|---|---|---|
| `calculateDaysDiff`/`calculateEndDateFromDays`/`formatDurationForSave` ללא guard | `src/utils/durationUtils.js` | 29–33, 43–48, 83–91 | A |
| `isEventLocked`: `NaN` diff → עקיפת נעילה | `src/utils/editLockUtils.js` | 43–75 | A |
| `getContrastColor`/`ensureDarkEnough`: hex לא תקין → `NaN` | `src/utils/colorUtils.js` | 13–21, 43–58 | A |
| `buildColumnValues` throw / `mapItemToEvent` drop בשקט | `src/utils/mondayColumns.js` | 124–218 | S |
| `assertNoForbiddenStrings` throw ללא `logger` | `src/utils/payloadGuard.js` | 44–73 | S |
| גישה לשדה label ללא guard | `src/utils/approvalMapping.js` | 129–159 | A |
| `triggerRect` חסר → `NaN` px | `src/utils/dropdownAnchor.js` | 50–76 | S |
| `fieldValues[...]` ללא guard | `src/utils/xorValidation.js` | 31–32 | A |

### 5ג — `console.*` → `logger.*` (dark-console)

| תיקון | קובץ מקור (חי) | שורות | מקור |
|---|---|---|---|
| `console.log` ב-`setProjectColor` | `src/contexts/ProjectColorsContext.jsx` | 59 | A |
| `console.log` ב-effect / `handleColorSelect` | `src/components/SettingsDialog/ProjectColorsTab.jsx` | 25–30, 51–60 | A |
| תת-מערכת אחסון: `console.warn`/`console.log` בלבד | `src/hooks/useAllBoardProjects.js` | 32–33, 75, 100–104, 162 | S |
| clipboard `catch → console.error` | `src/components/ErrorDetailsModal/ErrorDetailsModal.jsx` | 34–43 | S |
| clipboard `catch → console.error` | `src/components/ErrorToast/ErrorToast.jsx` | 19–31 | S |

### 5ד — נתיבי listener/timer/observer (ErrorBoundary לא תופס)

| תיקון | קובץ מקור (חי) | שורות | מקור |
|---|---|---|---|
| native touch listeners (persist-on-resize) | `src/components/MobileResizeOverlay/MobileResizeOverlay.jsx` | 63–81, 162–182 | S |
| `MutationObserver` / scroll/resize listeners | `src/components/DatePickerInput/DatePickerInput.jsx` | 28–46, 76–111 | S |
| timer/keydown/cleanup `.focus()` | `src/hooks/useFocusTrap.js` | 28–77 | S |
| `getComputedStyle` / observer callback | `src/hooks/useTokens.js` | 54–77 | S |
| global keydown/keyup/blur listeners | `src/hooks/useMultiSelect.js` | 19–51 | S |
| divide-by-zero `NaN` ברוחב סגמנט | `src/components/MonthlyBattery/MonthlyBattery.jsx` | 17, 36–50 | A·S |
| timer יציאה לא נוקה | `src/components/Toast/Toast.jsx` | 15–21 | A |
| `setTimeout(onUndo)` לא נוקה/נעטף | `src/components/UndoBanner/UndoBanner.jsx` | 22–28 | A |
| no-op שקט במקרים חסרי-קונפיג | `src/hooks/useApproval.js` | 61–64, 106–108 | S |
| empty cache catches / `JSON.parse` דילוג | `src/hooks/useProjects.js` | 28–40, 239–243, 310–314 | S |
| `JSON.parse` משך שקט → `parseFloat||0` | `src/hooks/useMonthlyHours.js` | 198–205 | S |
| item drop בשקט / parse fallback | `src/hooks/useDashboardData.js` | 233–255 | S |

### 5ה — הרחבת ErrorBoundary

| תיקון | קובץ מקור (חי) | שורות | מקור |
|---|---|---|---|
| גבול שורש מעל ה-providers (ולא מתחתם) + גבולות פר-רכיב | `src/App.jsx` | 107–146, 233–239 | A·S |
| הרכיב עצמו (תקין; לשכפל לעטיפות נוספות) | `src/components/ErrorBoundary/ErrorBoundary.jsx` | 37–47 | A |
| מסך כשל טעינה חוסמת (נלווה) | `src/components/NetworkErrorScreen.jsx` | 49–68 | A |
| `useMondayContext` throws מחוץ ל-provider / `monday.listen` ללא טיפול | `src/contexts/MondayContext.jsx` | 56–61, 151–153 | S |
| `lazyRetry` (chunk-load — תקין; הקשר ל-boundary) | `src/utils/lazyRetry.js` | — | S |

---

## Phase 6 — סינק מרוחק + תחזוקה ומניעת רגרסיה

| # | תיקון | קובץ מקור (חי) | הערה | מקור |
|---|---|---|---|---|
| P6.1 | מימוש `remoteSink` (Sentry / `POST /logs`) דרך `addSink` + redaction + AbortError filter | `src/utils/logger.js` | בונה על Phase 1 | S |
| P6.2 | ✅ **בוצע** — הסרת `wrapMondayApiCall`, סימון `safeApi` כ-funnel היחיד | `CLAUDE.md` | סעיף "API Wrapper" + שורת SDK Error Handling | S |
| P6.3 | כללי ESLint למניעת רגרסיה: `no-console` (היתר רק ב-`logger.js`) + `no-empty` על `catch` | `package.json` → `eslintConfig` (`eslint-config-react-app`) | אין קובץ `.eslintrc` נפרד — הקונפיג inline | — |

---

## אינדקס הפוך — קובץ → שלבים שנוגעים בו

| קובץ מקור (חי) | שלבים |
|---|---|
| `src/utils/logger.js` | 1, 6 |
| `src/utils/errorHandler.js` | 1 |
| `src/utils/globalErrorHandler.js` | 3 |
| `src/utils/lazyRetry.js` | 5ה |
| `src/hooks/useToast.js` | 3 |
| `src/hooks/useMondayEvents.js` | 2 |
| `src/hooks/useAllBoardProjects.js` | 0, 5ג |
| `src/hooks/useAllDayEvents.js` | 4 |
| `src/hooks/useCalendarSelection.js` | 4 |
| `src/hooks/useApproval.js` · `useProjects.js` · `useMonthlyHours.js` · `useDashboardData.js` | 5ד |
| `src/hooks/useFocusTrap.js` · `useTokens.js` · `useMultiSelect.js` | 5ד |
| `src/MondayCalendar.jsx` | 2 |
| `src/App.jsx` · `src/index.jsx` · `src/init.js` | 5ה (ErrorBoundary), 1 (סדר התקנה) |
| `src/contexts/SettingsContext.jsx` | 4 |
| `src/contexts/MondayContext.jsx` | 5ה |
| `src/contexts/ProjectColorsContext.jsx` | 5ג |
| `src/utils/mondayApi/client.js` | 2 |
| `src/utils/mondayApi/items.js` | 4 |
| `src/utils/mondayApi/columns.js` | 4 |
| `src/components/SettingsDialog/SettingsDialog.jsx` | 4 |
| `src/components/SettingsDialog/MappingTab.jsx` | 5א |
| `src/components/SettingsDialog/SearchableSelect.jsx` | 5א |
| `src/components/SettingsDialog/ProjectColorsTab.jsx` | 5ג |
| `src/components/SettingsWizard/SettingsWizard.jsx` | 4 |
| `src/components/ErrorBoundary/ErrorBoundary.jsx` · `NetworkErrorScreen.jsx` | 5ה |
| `src/components/MobileResizeOverlay/MobileResizeOverlay.jsx` | 5ד |
| `src/components/DatePickerInput/DatePickerInput.jsx` | 5ד |
| `src/components/MonthlyBattery/MonthlyBattery.jsx` · `Toast/Toast.jsx` · `UndoBanner/UndoBanner.jsx` | 5ד |
| `src/components/ErrorDetailsModal/ErrorDetailsModal.jsx` · `ErrorToast/ErrorToast.jsx` | 5ג |
| `src/utils/columnValueBuilders.js` · `dashboardAggregation.js` · `dateFilterUtils.js` · `dateFormatters.js` · `dateTimeHelpers.js` | 5א |
| `src/utils/durationUtils.js` · `editLockUtils.js` · `colorUtils.js` · `mondayColumns.js` · `payloadGuard.js` · `approvalMapping.js` · `dropdownAnchor.js` · `xorValidation.js` | 5ב |
| `package.json` (eslintConfig) | 6 |
| `CLAUDE.md` | 6 ✅ |
