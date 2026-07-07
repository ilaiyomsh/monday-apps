# מפת נקודות השגיאה — Tracker

מסמך זה הוא **אינדקס הרפרנס המאוחד** של כל נקודות השגיאה בקוד: כל פונקציה או פעולה שעלולה לזרוק (`throw`) או להחזיר שגיאה, על כל סוגי השגיאות, ממופה למיקום (`קובץ:שורה`), להתנהגות (זורק / מחזיר / נבלע), ולשאלה האם היא מגיעה ל-`logger` ולכן ל-sink עתידי.

**מטרה (לשימוש עתידי):** כשנחווט יעד sink מרוחק (Sentry / `POST /logs`), המסמך הזה הוא הרשימה שמולה מוודאים שכל מקור שגיאה אכן מגיע ליעד. הוא גם הבסיס לכל ביקורת/רגרסיה עתידית בתחום הטיפול בשגיאות.

> מצב הקוד: ענף `feat/error-handling-rollout`, **אחרי** ה-rollout (change #10). מסמך זה משלים את:
> - `error-handling-standard.md` — הסרגל (מה נחשב "מקור שגיאה" ומתי הוא "מטופל").
> - `error-handling-audit.md` — פסיקת PASS/GAP מול הסטנדרט (משקף את מצב ה-*לפני*).
> - `sink-readiness.md` — ניתוח האם כל מקור מגיע ל-sink (axes ארכיטקטורה + כיסוי).
>
> כל ה-`קובץ:שורה` כאן מדויקים למצב הענף הנוכחי. גדלים זזים — לאימות מספרי שורה עדכניים הריצו `grep -rn`.
>
> **עדכון 2026-06-02 — UI sink מומש (`ui-sink-plan.md` Phase 1, קומיטים `24f1f33`+`e24e831`+`ffeba27`):**
> ה-logger הוא כעת **נתיב ההצגה היחיד** — `useUiErrorSink` (חדש, `hooks/useUiErrorSink.js`) מציג טוסט על כל רשומת ERROR.
> `showErrorWithDetails` הפך ל-facade לוג-בלבד; ה-delegate ב-`globalErrorHandler` הוסר (`setGlobalErrorHandler` נמחק);
> `safeApi`/`assertNoGraphQLErrors` מטביעים ירושת `correlationId` על שגיאות עטופות (רשומה אחת אמיתית לכשל);
> אתרי לוג-צמוד-לתצוגה אוחדו; כל אתרי הרישום מעבירים `Error`. מספרי שורה במסמך עשויים להיות מוסטים מעט.

---

## 1. ארכיטקטורת השגיאות — נקודות החנק

לפני המיפוי הפרטני, שבע נקודות החנק שדרכן זורמת *כל* שגיאה. הן הכתובת היחידה שצריך לגעת בה כדי לחבר sink.

| # | נקודת חנק | קובץ:שורה | תפקיד |
|---|-----------|-----------|-------|
| 1 | `emit(record)` | `utils/logger.js:288` | **chokepoint יחיד** — כל מתודות ה-logger עוברות דרכו; רינדור לקונסול + הפצה ל-sinks |
| 2 | `addSink` / `removeSink` | `utils/logger.js:388 / :398` | רישום יעדי sink (מחזיר unsubscribe) |
| 3 | `flush(url)` | `utils/logger.js:421` | שטיפת ה-ring buffer ב-`sendBeacon` → `fetch keepalive` → no-op (בטוח ל-unload) |
| 4 | `safeApi` | `utils/mondayApi/client.js:234` | **העטיפה היחידה** לכל קריאת Monday API — לוג + retry + עטיפה ל-`MondayApiError` |
| 5 | `parseMondayError` | `utils/errorHandler.js:254` | ממפה כל שגיאה להודעת משתמש בעברית + `errorCode` + `actionRequired` |
| 6 | `showErrorWithDetails` | `hooks/useToast.js` | **facade לוג-בלבד** — רושם ל-logger (log-once); ההצגה נעשית ע"י ה-UI sink (`useUiErrorSink`) שמאזין לרשומות ERROR |
| 7 | `ErrorBoundary` + global handlers | `components/ErrorBoundary/ErrorBoundary.jsx` / `utils/globalErrorHandler.js` | רשת ביטחון ל-render throws ול-rejections/uncaught גלובליים |

### 1.1 מבנה ה-record (מה ש-sink יקבל)
`emit` בונה אובייקט אחיד (`utils/logger.js:288`):
```
{ kind, level, module, message, data?, error?, context?,
  timestamp (epoch ms), timestampISO, correlationId, duplicate, consoleEnabled }
```
- **ring buffer**: `RING_BUFFER_SIZE = 150` (`logger.js:98`) — שומר שגיאות init מוקדמות לפני שנרשם sink.
- **חוזה log-once**: כל Error מסומן ב-`__loggedId` (non-enumerable, `logger.js:312`) ומקבל `correlationId`; רשומה כפולה לא נשלחת ל-sink (`logger.js:346`).

### 1.2 מחלקת השגיאה היחידה
| מחלקה | קובץ:שורה | שדות |
|-------|-----------|------|
| `MondayApiError extends Error` | `utils/mondayApi/client.js:97` | `message, response, apiRequest{query,variables,operationName}, errorCode, functionName, duration, timestamp, stack, toJSON()` |

אין מחלקות שגיאה מותאמות נוספות — כל שאר ה-throws הם `new Error(...)`.

---

## 2. מיפוי לפי שכבה

הסיווג בעמודות: **זורק/מחזיר** · **נתפס היכן** · **נרשם ל-logger?** · **מוצג למשתמש?**

### 2.1 שכבת ה-API — `utils/mondayApi/*`
כל קריאות ה-API עוברות דרך `safeApi`, ולכן **כל כשל API מגיע ל-logger**.

| פונקציה | קובץ:שורה | התנהגות שגיאה |
|---------|-----------|----------------|
| `safeApi(monday, caller, query, opts)` | `client.js:234` | זורק `MondayApiError` (אחרי retry); soft-error GraphQL (status 200) נרשם ב-ERROR (`:256`) ומוחזר גולמי |
| `executeWithRetry(fn,{onRetry})` | `client.js:206` | retry עד `MAX_RETRIES=2`; זורק אחרי מיצוי / שגיאה לא-retryable |
| `isRetryableError(error)` | `client.js:179` | בודק code / HTTP status (429,500,502,503) / תבניות הודעה |
| `validateQuery(query)` | `client.js:44` | מחזיר `{valid,warnings}`; רושם ERROR אם נמצאו תבניות חשודות (`:59`) |
| `assertNoGraphQLErrors(res,ctx)` | `mondayApi/assertGraphQL.js:35` | זורק `MondayApiError` אם `res.errors` קיים (`:40`); לא רושם (כבר נרשם ב-safeApi) |
| `createBoardWithColumns` | `mondayApi/columns.js:141` | זורק `MondayApiError` אם אין `boardId` |
| `createColumn` | `mondayApi/columns.js:103` | זורק `MondayApiError` על `create_column` ריק |
| `createEventTypeStatusColumn` | `mondayApi/columns.js:63` | זורק `MondayApiError` על `id` חסר |
| `findProjectLinkColumn` | `mondayApi/items.js` | `JSON.parse` של הגדרות עמודה — `catch` רושם `logger.warn` וממשיך |
| `fetchActiveAssignments` | `mondayApi/items.js` | `JSON.parse` של ערך project-type — `catch` רושם `logger.warn` |
| שאר הפונקציות (`createBoardItem`, `fetchEventsFromBoard`, `fetchProjectsForUser`, `createTask`, `updateItemColumnValues`, `fetchCurrentUser`, `fetchItemById`, `deleteItem`, `fetchItemsStatus`, `fetchItemsLinkedIds`, `fetchConnectedBoardsFromColumn`, `fetchUniquePeopleFromBoard`, `resolveMirrorSourceColumn`) | `mondayApi/items.js`, `boards.js`, `mirror.js` | זורקות `MondayApiError` דרך `safeApi` |

> הערה: `wrapMondayApiCall` **נמחקה** (F013) — `safeApi` היא העטיפה החיה היחידה (`client.js:10`).

### 2.2 Hooks — פעולות אסינכרוניות
התבנית: `catch → logger.error → throw` (מפעולות mutate, מתפשט לרכיב) או `catch → logger.error → showErrorWithDetails` (ברכיבי handler).

| Hook | קובץ:שורה (catch/throw) | התנהגות |
|------|--------------------------|----------|
| `useMondayEvents.createEvent` | `useMondayEvents.js:676` | זורק `MondayApiError` על אייטם ריק (אין יותר "false success") |
| `useMondayEvents` (update/delete/position) | `:684, :754, :786, :879` | `logger.error` + `throw error` (rollback אופטימי) |
| `useAllDayEvents` (create/update/delete/bulk) | `:99, :176, :325, :478` | `logger.error` + `throw error` |
| `useEventDataLoader.loadEventData` | `:52` | `logger.error` + `throw error` |
| `useApproval` | `:83` | `logger.error` + `throw error` |
| `useMonthlyHours` | `:169` | `logger.warn` + `throw err` (retry על `CursorException`) |
| `useFilterOptions`, `useProjects`, `useTasks*`, `useBoardOwner`, `useUndoDelete`, `useCalendarHandlers`, `useCalendarSelection` | hooks/*.js | `catch → logger.*`; חלק מציגים `showErrorWithDetails` |

### 2.3 Contexts
| מקור | קובץ:שורה | התנהגות |
|------|-----------|----------|
| `SettingsContext` — `JSON.parse` הגדרות מאוחסנות | `contexts/SettingsContext.jsx:180` | זורק `Error('Storage ... failed')`; ה-catch מבטיח `setIsLoading(false)` (אין יותר ספינר תקוע) |
| `useSettings` מחוץ ל-Provider | `SettingsContext.jsx:514` | זורק `Error` |
| `useMondayContext` מחוץ ל-Provider | `contexts/MondayContext.jsx:152` | זורק `Error` |
| `monday.listen('context')` | `MondayContext.jsx` | callback עטוף; כשל נרשם |

### 2.4 Utils — שומרי תאריך / משך / מספר
מודולים אלו הם המקור ההיסטורי ל"שגיאות שקטות" (NaN / Invalid Date). אחרי ה-rollout, **נתיב הכתיבה זורק** ו**נתיב התצוגה רושם ומחזיר ברירת מחדל**.

| פונקציה | קובץ:שורה | על קלט לא תקין |
|---------|-----------|----------------|
| `toMondayDateFormat` | `utils/dateFormatters.js:26` | **זורק** `Error('תאריך לא תקין...')` (נתיב שמירה) |
| `toMondayTimeFormat` | `dateFormatters.js:45` | **זורק** `Error('שעה לא תקינה...')` |
| `toMondayDateTimeColumn` | `dateFormatters.js:64` | **זורק** `Error('תאריך לא תקין...')` |
| `toLocalDateFormat` / `toLocalTimeFormat` | `dateFormatters.js:80 / :96` | `logger.warn` + מחזיר `''` (תצוגה) |
| `calculateDaysDiff` | `utils/durationUtils.js:37` | `logger.warn` + מחזיר `1` |
| `calculateEndDateFromDays` | `durationUtils.js:55` | `logger.warn` + מחזיר `Date(NaN)` |
| `formatDurationForSave` | `durationUtils.js:99` | `logger.warn` + מחזיר `''` על מספר לא-סופי |
| `parseAnchor` / `buildDateFilterRule` | `utils/dateFilterUtils.js:34 / :51` | `logger.warn` + מחזיר `null` / כלל fallback |
| `formatTime` / `formatDate` | `utils/dateTimeHelpers.js:22 / :45` | מחזיר `''` על Invalid Date |
| `buildColumnValues` | `utils/mondayColumns.js:191` | **זורק** `Error` אם חסר פרמטר (`:193`) או תאריך לא תקין (`:199`) |
| `parseDateColumn` / `parseHourColumn` / `parseBoardRelationColumn` | `mondayColumns.js:67 / :92 / :112` | `logger.error` + מחזיר `null` / `60` / `[]` |
| `getContrastColor` / `ensureDarkEnough` | `utils/colorUtils.js:6 / :31` | מחזיר צבע fallback (`#ffffff` / `#579bfc`) |

### 2.5 ולידציה ו-payload guards
החזרת אובייקט ולידציה (לא זורקות) אלא אם מצוין "זורק".

| פונקציה | קובץ:שורה | מחזיר / זורק |
|---------|-----------|---------------|
| `validateSettings` | `utils/settingsValidator.js:145` | `{isValid,errors,warnings,missingSettings,missingColumns,missingBoards}` |
| `checkColumnsExist` | `settingsValidator.js:17` | `{valid,missingColumns}` / `{valid:false,apiError,error}` (catch רושם `:49`) |
| `checkBoardExists` | `settingsValidator.js:60` | `{valid,boardName?}` / `{valid:true,apiError,error}` (catch רושם `:81`) |
| `parseStatusColumnLabels` | `utils/eventTypeValidation.js:38` | מערך labels; `catch` רושם ומחזיר `[]` (`:81`) |
| `validateMapping` / `validateMappingDistinction` / `smartValidateMapping` | `utils/eventTypeMapping.js:286 / :325 / :375` | `{isValid,errors}` |
| `buildStatusColumnValue` | `utils/columnValueBuilders.js:22` | **זורק** `Error` על index לא-מספרי (`:24`) |
| `buildEventTypeColumnValue` | `columnValueBuilders.js:41` | **זורק** `Error` (mapping/category/index — `:43,:52,:59`) |
| `assertNoTranslatedLabels` | `columnValueBuilders.js:78` | **זורק** `Error` אם נמצא `label`/`text` מתורגם (`:101`) |
| `assertNoForbiddenStrings` | `utils/payloadGuard.js:44` | **זורק** `Error` על מחרוזת אסורה (`:72`) |

### 2.6 רשת ביטחון: גבולות, גלובלי, lazy
| מקור | קובץ:שורה | התנהגות |
|------|-----------|----------|
| `ErrorBoundary.componentDidCatch` | `components/ErrorBoundary/ErrorBoundary.jsx:40` | `logger.error('ErrorBoundary',...)` → `parseMondayError` → `onError(modal)` / fallback UI |
| מיקום ה-boundaries | `App.jsx:239` (root מעל 3 ה-providers) + `:160,:189,:203,:215` (לכל view) | render throw בכל provider/view נתפס ונרשם |
| `handleGlobalError` | `utils/globalErrorHandler.js` | `logger.error(...)` בלבד — ההצגה דרך ה-UI sink (ה-delegate ו-`setGlobalErrorHandler` הוסרו) |
| `unhandledrejection` | `globalErrorHandler.js:64` | chunk → reload; Monday → `handleGlobalError`; אחר → `logger.error` (`:102`) |
| `window error` (uncaught) | `globalErrorHandler.js:106` | זהה; גנרי → `logger.error` (`:144`) |
| `window error` (resource SCRIPT/LINK/IMG) | `globalErrorHandler.js:50` | `handleGlobalChunkError` |
| `lazyRetry` / `handleGlobalChunkError` | `utils/lazyRetry.js:55 / :97` | זיהוי 14 תבניות chunk-load → reload יחיד (sessionStorage); ניסיון שני `logger.error` + `throw` |

---

## 3. אינדקס מלא — `throw` (47, ללא טסטים)

### 3.1 `MondayApiError` (7)
`client.js:284, :285` · `assertGraphQL.js:40` · `columns.js:63, :103, :141` · `useMondayEvents.js:676`

### 3.2 `Error` גנרי — נתיבי mutate/build/validation (~25)
`useBoardBuilder.js:100, :157, :220, :269, :286, :639` · `SettingsDialog.jsx:220` · `SettingsContext.jsx:180, :514` · `MondayContext.jsx:152` · `dateFormatters.js:29, :48, :67` · `columnValueBuilders.js:24, :43, :52, :59, :101` · `payloadGuard.js:72` · `mondayColumns.js:193, :199` · `i18n/index.js:56`

### 3.3 Re-throw מתוך catch (אחרי `logger.*`)
`useMondayEvents.js:684, :754, :786, :879` · `useAllDayEvents.js:99, :176, :325, :478` · `useEventDataLoader.js:52` · `useApproval.js:83` · `useMonthlyHours.js:169` · `useBoardBuilder.js:152, :1039` · `lazyRetry.js:67, :75` · `client.js:217`

### 3.4 טסטים (לא ב-production)
`renderWithProviders.jsx:24` · `renderCalendar.jsx:159` · `renderHookWithProviders.jsx:25`

---

## 4. טקסונומיית סוגי השגיאות

| סוג | מקור | היכן ממופה |
|-----|------|------------|
| **GraphQL soft-error** (status 200 + `errors[]`) | Monday API | `safeApi:256` (לוג) → `assertNoGraphQLErrors` (זריקה) |
| **HTTP status** (400/401/403/404/429/5xx) | רשת/Monday | `HTTP_STATUS_TO_ERROR_CODE` `errorHandler.js:211` |
| **errorCode ממופה** (27 קודים) | Monday extensions | `ERROR_MESSAGES` `errorHandler.js:10` (USER_UNAUTHORIZED, ResourceNotFoundException, ComplexityBudgetExhausted, ColumnValueException, Rate Limit Exceeded, InternalServerError, JsonParseException, ...) |
| **Retryable** (4 HTTP + 13 codes) | זמני | `isRetryableError` `client.js:179` |
| **Chunk-load / network** (14 תבניות) | deploy/CDN | `lazyRetry.js:4` |
| **Invalid Date / NaN** | קלט משתמש/נתונים | שומרי §2.4 |
| **Validation / payload leak** | פנימי (pre-write) | guards §2.5 |
| **Render throw** | React | `ErrorBoundary` |
| **Uncaught / unhandledrejection** | גלובלי | `globalErrorHandler.js` |

---

## 5. כיסוי לפי סוג שגיאה — ספירה (Coverage by error type)

ספירה ישירה על קוד הענף (לא על האודיט, שמשקף את מצב ה-*לפני*). לאימות: ראו פקודות ה-`grep` ב-§8.

### 5.1 מדדי ה"חור השחור" — כולם אפס ✅
שלושת המדדים שמעידים שאין בליעה שקטה, ושהדבר נאכף:

| מדד | ספירה | אכיפה |
|-----|:-----:|-------|
| `console.*` מחוץ ל-`logger`/טסטים | **0** | `no-console` |
| `catch {}` ריקים | **0** | `no-empty` + catch-must-log |
| בליעה שקטה (`AbortError` ללא לוג) | **0** | catch-must-log |

### 5.2 נקודות מיפוי לפי סוג שגיאה

| סוג שגיאה | נק' מיפוי | איך זה ממופה |
|-----------|:---------:|--------------|
| **Monday API** (קריאות GraphQL) | **61** | כולן דרך `safeApi` → `MondayApiError` |
| **Monday SDK ישיר** (`monday.api/get/listen/storage`) | **30** | עטופות; כשל נרשם ל-`logger` |
| **`MondayApiError` — אתרי זריקה** | **19** | `client`, `assertGraphQL`, `columns`, `useMondayEvents` |
| **GraphQL soft-error** (status 200 + `errors[]`) | **1** chokepoint | `assertNoGraphQLErrors` |
| **קודי שגיאה ממופים** | **27** | `ERROR_MESSAGES` → הודעת עברית + `actionRequired` |
| **ולידציה / payload guards** | **8** זריקות | `columnValueBuilders` (5), `payloadGuard` (1), `mondayColumns` (2) |
| **תאריך / משך / NaN** | **26** שומרים + **3** זריקות | `dateFormatters` זורק (שמירה); `durationUtils`/`dateFilter` רושם+fallback |
| **JSON parse** | **27** אתרים | מוגנים (`warn` + ברירת מחדל) |
| **Render (React) — throw ב-render/lifecycle** | **5** גבולות (1 root + 4 view) | `ErrorBoundary` → `logger.error` → modal/fallback |
| **Render — throw ב-handler/listener/timer** | רשת גלובלית | לא נתפס ע"י boundary → `window.onerror` → `globalErrorHandler` → `logger` |
| **Uncaught / unhandledrejection** | **3** listeners | `globalErrorHandler` → `logger` |
| **Chunk-load / רשת** | **14** תבניות | `lazyRetry` → reload יחיד |

### 5.3 תשתית התפיסה/התיעוד (לכמה זה זורם)

| מנגנון | אתרים |
|--------|:-----:|
| `throw` (ללא טסטים) | **46** |
| `catch` (ללא טסטים) | **164** — כולם רושמים / זורקים מחדש / מציגים |
| קריאות `logger.*` | **436** (מתוכן `error`/`apiError`: **121**, `warn`: **90**) |
| `showErrorWithDetails` | **35** |

### 5.4 שגיאות רינדור — שלושה ערוצים
רינדור הוא מקרה מיוחד: רק `ErrorBoundary` תופס throw בזמן render, וכל מה שרץ *מחוץ* לטווח שלו (handlers/listeners/timers, או NaN רך) לא נתפס על ידו.

| ערוץ | נתפס היכן | מגיע ל-logger? |
|------|-----------|:--------------:|
| throw בזמן render/lifecycle | `ErrorBoundary` (5 גבולות) → `ErrorBoundary.jsx:40` | ✅ |
| throw ב-`onClick`/scroll/resize/`MutationObserver`/`setTimeout` | `window.onerror`/`unhandledrejection` → `globalErrorHandler.js:144/:102` | ✅ (רשת גלובלית, לא הגבול) |
| `NaN`/`Infinity` רך בזמן render (`MonthlyBattery.jsx:43`, `DashboardStats.jsx`) | לא נזרק — מרונדר בשקט | ❌ (זנב רך, §5.5) |

**גבולות (production):** root ב-`App.jsx:239` *מעל* שלושת ה-providers (סוגר את פער "המסך הלבן"), + 4 לכל view (`:160, :189, :203, :215`).
**פער בידוד (לא dark):** `ProjectColorsDialog` ב-`App.jsx:180` ב-`Suspense` ללא `ErrorBoundary` משלו — throw שם נתפס ע"י ה-root (נרשם) אך מפיל את כל האפליקציה במקום להתבודד.

### 5.5 פסק דין: האם הכל ממופה?
**כן — ברמת ה-exceptions, וזה נאכף.** כל שגיאת *חריגה* נתפסת+נרשמת או מגיעה להנדלר גלובלי שרושם; 0 console, 0 catch ריק, וכלל catch-must-log מונע נסיגה. שתי הסתייגויות שאינן ברמת ה-exception (ראו §7):
1. **יעד ה-sink המרוחק טרם חובר** — השגיאות מגיעות ל-`logger` ול-ring buffer, אך לא ליעד מרוחק (נדחה בכוונה).
2. **זנב "כשל רך" שאינו exception** — פונקציות `pure` שמחזירות `NaN`/fallback בשקט (`colorUtils`, חלק מ-dashboard); בעיית איכות-נתונים, לא חריגה — חלקן רושמות `warn`, חלקן לא.

---

## 6. כללי רגרסיה (ESLint) — `package.json` `eslintConfig`
שלושת הכללים שמונעים נסיגה לבליעה שקטה:

| כלל | ערך | משמעות |
|-----|-----|--------|
| `no-console` | `error` | אסור `console.*` (פרט ל-`logger.js` וטסטים) |
| `no-empty` | `error` + `allowEmptyCatch:false` | אסור `catch {}` ריק |
| `no-restricted-syntax` (catch-must-log) | `error` | כל `catch` חייב לקרוא ל-`logger.*`, **או** `throw`, **או** `showErrorWithDetails` |

`overrides`: הכללים כבויים ל-`src/utils/logger.js` ולקבצי טסט.

---

## 7. מצב reachability ל-sink עתידי

**מה כבר מוכן:** נקודת החנק `emit`, ה-record האחיד, `addSink`/`removeSink`, ה-ring buffer (150) ו-`flush()` — כולם קיימים. כל קריאות ה-API (`safeApi`), כל render throws (`ErrorBoundary`), נתיב התצוגה (`showErrorWithDetails`, כעת מחבר ל-logger ב-`:135/:140`) וההנדלרים הגלובליים — **מגיעים ל-logger ולכן ל-sink**.

**מה שנותר לסגירה לפני "כל שגיאה מגיעה ל-sink"** (ראו פירוט מלא ב-`sink-readiness.md` §4–5):
1. **בחירת יעד ה-sink וחיווטו** — Sentry / `POST /logs` / iframe CSP. התשתית מוכנה; היעד טרם נבחר (נדחה בכוונה — אפליקציית client-only ללא backend).
2. **PII-redaction ב-`emit`** לפני שליחה מרוחקת (טוקנים, `variables`, ערכי people, notes).
3. **ניתוק forwarding ל-sink מ-gate רמת הקונסול** — כדי שב-PROD (`console=ERROR`) ה-sink עדיין יקבל WARN/INFO breadcrumbs.
4. **הזנב הארוך של מקורות "dark"** — הנדלרים/listeners/observers שמחוץ לטווח ה-`ErrorBoundary` (DOM listeners, timers), שמרכזיהם מתועדים ב-`sink-readiness.md` §4.

---

## 8. תחזוקה
- מספרי שורה וספירות זזים — לאימות הריצו:
  `grep -rn "throw " src/`, `grep -rn "catch" src/`, `grep -rn "logger\." src/`,
  `grep -rn "safeApi(" src/`, ו-`grep -rn "console\." src/` (אמור להחזיר 0 מחוץ ל-`logger.js`).
- כשמוסיפים מקור שגיאה חדש: ודאו שהוא עובר דרך אחת משבע נקודות החנק (§1) — אחרת ESLint (§6) ייכשל, וה-sink לא יראה אותו.
