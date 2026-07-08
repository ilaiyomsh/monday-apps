# תוכנית יישום: טיפול וניטור שגיאות מקצה-לקצה

**מטרה-על:** כל שגיאה בקוד *גם נתפסת* (catch) *וגם מנוטרת* (monitor) — כלומר זורמת דרך `logger` אל נקודת איגוד אחת (`emit`) ומשם אל sink מרכזי שניתן לחבר אליו ניטור מרוחק.

מסמך זה מאחד את הלקחים משני ה-workflows שרצו ומשלושת מסמכי המקור, וקובע תוכנית מדורגת לביצוע. הוא נכתב כדי **להתבצע בהמשך** — לא בוצע עדיין שום שינוי קוד.

> **עודכן לאחר ביקורת (Wave «error-handling review»):** כל טענות ה-Critical/High אומתו מול הקוד החי (0 drift ששובר תיקון). התוכנית הורחבה כדי לסגור פערי *מוכנות ליישום* שהתגלו: שער CI אדום קיים, אכיפת ESLint חלקית, ה-logger ממוקה גלובלית בבדיקות, היעדר מנגנון log-once, ומקורות-dark לא משובצים. השינויים מסומנים בגוף המסמך.
>
> **דחייה מכוונת — היעד של הסינק המרוחק:** ההכרעה *לאן* הסינק שולח (`Sentry` / `POST /logs` / אחר) ואימות ה-CSP של ה-iframe **נדחים לשלב מאוחר**, אחרי שכל השגיאות נתפסות וזורמות מרכזית דרך `emit`. תשתית ה-`addSink`/ה-buffer וה-dedup נבנות עכשיו (הן עומדות בפני עצמן — קונסול נקי ורשומה מובנית — גם בלי יעד מרוחק); רק חיבור היעד נדחה.

> **קבצי מקור:**
> - `docs/error-handling-standard.md` — הסרגל ("מתי שגיאה נחשבת מטופלת")
> - `docs/error-handling-audit.md` — ביקורת הכיסוי (catch)
> - `docs/sink-readiness.md` — ביקורת הניטור (monitor)

---

## 1. תקצירי מנהלים של מסמכי המקור

### 1.1 `error-handling-standard.md` — הסרגל

מגדיר **מתי מקור שגיאה נחשב "מטופל"**, ומשמש קלט רשמי לוורקפלו הביקורת.

- **"מקור שגיאה"** = כל `await` / קריאת SDK (`monday.api/execute/listen/storage`) / `JSON.parse` / גישה לשדה בתשובת API / `useEffect` אסינכרוני / event handler אסינכרוני / קוד render שעלול לזרוק / פענוח תאריך-מספר.
- **PASS חייב לעמוד ב-4:** (1) **כיסוי** במנגנון המתאים לקטגוריה; (2) **אפס בליעה שקטה** — חובה קריאת `logger` בנתיב ה-catch; (3) **בהירות** — מיפוי דרך `parseMondayError`/`MondayApiError`; (4) **הצגה למשתמש** כשהכשל משפיע על פעולה שהמשתמש יזם.
- **בליעה שקטה** (`catch` בלי `logger`) = **פסילה אוטומטית**. החריג היחיד: `if (e.name === 'AbortError') return;`.
- **`console` עירום** = פער "נמוך" — visible אך לא יגיע ל-sink ונוגד את קונבנציית הפרויקט.
- **חומרה:** קריטי (בליעה שקטה בנתיב כתיבה, או כשל לא-נתפס שמלבין מסך) / גבוה / בינוני / נמוך.
- **§7 — מחוץ להיקף (לעת עתה):** "sink לניטור נדחה: קודם תופסים את כל השגיאות, ואז עוברים על שורות הטבלה ומוסיפים ניטור לכל אחת." → **המסמך הנוכחי הוא בדיוק השלב הזה.**

### 1.2 `error-handling-audit.md` — ביקורת ה-catch

ביקורת מקסימלית של כל `src/` מול הסרגל.

- **213 מקורות שגיאה: 162 PASS, 51 פערים** (3 קריטי, 12 גבוה, 13 בינוני, 23 נמוך).
- הבסיס בריא: הדפוס הקנוני (`safeApi` → `try/catch` → `logger.*` → `showErrorWithDetails` + `parseMondayError`) מיושם בעקביות.
- **3 דפוסי-על לפערים:** (א) שגיאות GraphQL "רכות" שמטופלות כהצלחה (`safeApi` רושם אך **לא זורק**); (ב) בליעות שקטות (`catch` ריק/הערה-בלבד); (ג) פענוח תאריך/מספר לא-מוגן.
- **3 קריטיים:**
  - `useAllBoardProjects.js:215` — `writeCache`/`cacheKey` שאינם מוגדרים → `ReferenceError` בכל טעינה מוצלחת, מאפס את רשימת הפרויקטים. **באג חי מאומת** (וגם שגיאת `no-undef` ב-ESLint).
  - `useMondayEvents.js:642` — `createEvent` בולע יצירה כושלת ומחזיר `null` בלי רישום/הצגה.
  - `MondayCalendar.jsx:915` — טוסט "נוצר בהצלחה" כוזב על יצירה כושלת.
- **תשתית:** גם הרשת הגלובלית וגם `ErrorBoundary` קיימות אך **חלקיות** — מסלול ה-Monday של המטפל הגלובלי מציג למשתמש אך לא רושם; ה-`ErrorBoundary` ממוקם *מתחת* ל-providers ולהחזרות המוקדמות (שורות 143–226 בתוך `AppContent`, ה-providers בשורות 233–239), כך שזריקת render שם מלבינה מסך.

### 1.3 `sink-readiness.md` — ביקורת ה-monitor

האם כל מקור שגיאה יגיע ל-sink מרכזי עתידי? **לא — בשני הצירים.**

- **ציר A (ארכיטקטורה):** ל-`logger` **אין נקודת איגוד אחת**. `logWithColor` מאחד רק 6 מתודות, ואף אותן דולפות: `error` יורה `console.error` נוסף לסטאק (`:169`), ו-`api`/`apiResponse`/`apiError` (`:177–236`) + `initDone`/`initSummary` (`:276–306`) עוקפות אותו לגמרי. ה-payload **חלקי** — אין רשומה אחידה `{level, module, message, error, timestamp, context}`; ה-timestamp צרוב כמחרוזת `he-IL`.
- **ציר B (כיסוי):** מתוך **510 מקורות שגיאה — 311 מגיעים ל-`logger` (61%)**, **28 dark-console**, **171 dark-swallowed** → **199 dark (39%)**.
- **שני משטחי ה-dark המבניים:**
  - `useToast.showErrorWithDetails` — מסלול הצגת השגיאות הראשי, **לא קורא ל-`logger` כלל** (אומת: אין import).
  - `globalErrorHandler.js` — ה-fallback (`:23,:34,:35,:97,:139` — **חמש** קריאות `console.error`, לא ארבע) הם `console.error` עירום (אין import של `logger`).
  - תוצאה משולבת: כשלי Monday-API שנתפסים גלובלית **מוצגים למשתמש אך בלתי-נראים לכל sink**.
- **תיקון תיעוד:** `wrapMondayApiCall` **נמחקה ב-4.1.5** — `safeApi` הוא ה-funnel היחיד שנותר (אומת ב-`client.js:10`, `index.js:5`, `items.js:4`). ⚠️ `CLAUDE.md` עדיין מתעד אותה.

> **למה המספרים שונים (213 מול 510)?** הביקורת ספרה את מקורות הטיפול הקנוניים; סקירת הסינק הרחיבה לכל נתיב listener/timer/observer/render-math/fire-and-forget. שניהם עקביים פנימית; 510 היא תצוגת ה-reachability הממצה.

---

## 2. העיקרון המנחה: `catch` ≠ `monitor`

הביקורת מדדה **תפיסה**. סקירת הסינק מדדה **ניטור**. הפער ביניהן הוא הלקח המרכזי: קוד יכול לתפוס שגיאה (`try/catch`) ועדיין לא לנטר אותה (אם ה-catch לא קורא ל-`logger`, או קורא ל-`console`, או שאין בכלל sink מאחורי `logger`).

לכן התוכנית בנויה בשתי שכבות מתואמות:

1. **תשתית (enabler):** הופכים את `logger` ל-sink-ready — נקודת איגוד אחת + רשומה מובנית + רישום sinks + **חוזה log-once**. בלי זה, אפילו 311 המקורות ש"מגיעים" כותבים רק ל-console, *וכל שגיאה נכתבת 3–4 פעמים* (ראה §3.1).
2. **כיסוי (coverage):** עוברים על שורות הטבלה ומוודאים שכל נתיב כשל מתנקז ל-`logger`. כל בליעה שקטה שנסגור משרתת *גם* את פער הביקורת *וגם* את פער הסינק.

---

## 3. ארכיטקטורת היעד

```
                                   ┌────────────────────────────┐
  מקור שגיאה (await/SDK/parse/…)   │   logger.emit(record)      │
        │                          │   record = {level, module, │
        ▼                          │     message, error,        │
   catch / .catch / ErrorBoundary  │     context, correlationId,│
        │                          │     timestamp}             │
        ▼                          └──────────┬─────────────────┘
   logger.error / warn / apiError ────────────┤  dedup (log-once) → fan-out
                                              ├──► consoleSink   (dev: צבעוני, מלא)
                                              ├──► ringBuffer    (100–200 אחרונות)
                                              └──► remoteSink    (יעד נדחה — §Phase 6)
                                                     ▲
                                                     │ addSink(fn) — מתווסף בהמשך
```

**עקרונות:**
- מתודה אחת פרטית — `emit(record)` — שכל המתודות הציבוריות עוברות דרכה.
- ה-console נשאר sink אחד מני רבים; שאר ה-sinks מתווספים דרך `logger.addSink(fn)`.
- כל נתיב כשל שכיום עוקף את `logger` (`showErrorWithDetails`, `globalErrorHandler`, `console.*` עירום) מנותב חזרה אליו.
- `ErrorBoundary` עוטף את כל העץ (כולל ה-providers), כדי שזריקות render לא יחמקו.

### 3.1 חוזה ה-log-once (חדש — חובה לפני Phase 2/3)

היום אותה שגיאה נרשמת **3–4 פעמים**. שרשרת מאומתת בקוד החי, לכשל יצירת אירוע:

| # | רישום | מקור |
|---|---|---|
| 1 | `logger.error('API', '… GraphQL errors in response')` (soft, ללא throw) | `mondayApi/client.js:256` |
| 2 | `logger.apiError(callerName, error, …)` (ב-catch, לפני re-throw) | `mondayApi/client.js:278` |
| 3 | `logger.error('useMondayEvents.createEvent', …)` (catch) | `useMondayEvents.js:677` (וכן `:747`/`:779`/`:872`) |
| 4 | `showErrorWithDetails(error, …)` + `logger.error('MondayCalendar', …)` צמודים | `MondayCalendar.jsx:921–922` (וכן `:943`/`:1000`/`:1028`/`:1038`) |

אחרי Phase 3 (שבו `showErrorWithDetails` יתחיל לרשום) תיפתח קריאה רביעית לאותה שגיאה. בלי dedup, כל אלה גם יישלחו לסינק המרוחק.

**החוזה (תוצר Phase 1):**

1. **`correlationId`** — מזהה שמוטבע פעם אחת על אובייקט ה-`Error` בנקודת ה-catch המוקדמת ביותר (בתוך `safeApi` בעת עטיפה ל-`MondayApiError`; בתוך `globalErrorHandler` לשגיאות לא-API). נכלל בכל רשומה.
2. **log-once ב-`emit`** — בכל מעבר ראשון של `Error` instance דרך `emit`, מסומן `error.__loggedId`. מעבר חוזר של *אותו* instance מסומן `record.duplicate = true`; הקונסול יכול לקצר, והעברה ל-remoteSink מדולגת.
3. **כלל בעלות (recommended):** הרישום העשיר ביותר הוא הקנוני — `safeApi` לשגיאות API (יש לו `query`/`rawResponse`), `globalErrorHandler` ללא-נתפסות, `ErrorBoundary` ל-render. `showErrorWithDetails` ירשום **רק אם** `!error.__loggedId` (כלומר רק שגיאות שעוד לא נרשמו — למשל render/validation עירום). שורות ה-`logger.error` הצמודות ל-`showErrorWithDetails` שמכפילות שגיאה שכבר נרשמה — **יוסרו** ב-Phase 3 (ראה הרשימה שם).
   - *חלופה:* להפוך את `showErrorWithDetails` ל-logger היחיד למשתמש ולהסיר את רישומי ה-`safeApi`/catch — נדחתה כי מאבדת את ההקשר העשיר של `apiError`.

---

## 4. תוכנית מדורגת

כל שלב כולל: היקף, צעדים קונקרטיים, קריטריון קבלה, אימות, ומאמץ משוער. הסדר אופטימלי לפי תלות וערך.

### Phase −1 — ירקקת שער ה-CI (חדש; חוסם מקדים)

| | |
|---|---|
| **היקף** | להביא את שער ה-`eslint` הקיים ב-`.github/workflows/test.yml:45–47` (`pnpm exec eslint src/ --ext .js,.jsx --max-warnings 34`) למצב ירוק. **השער אדום היום** ללא קשר ליוזמה: `49 problems (7 errors, 42 warnings)`. אי אפשר להוסיף כללים חדשים על עץ שכבר לא עובר lint. |
| **צעדים** | 1. לתקן את 7 השגיאות: 2× `no-undef` ב-`useAllBoardProjects.js:215` (נסגרות ע"י Phase 0), 5× `import/first` בקבצי בדיקה committed (`portfolioResolver.test.js`, `SettingsContext.test.jsx`, `DashboardToolbar.test.jsx`). <br>2. להוריד אזהרות ל-≤34 או למקם מחדש את הסף (38 מתוך 42 הן `react-hooks/exhaustive-deps` — חוב ידוע; להחליט אם לתקן או לעדכן את `--max-warnings`). |
| **קבלה** | `pnpm exec eslint src/ --ext .js,.jsx --max-warnings 34` מחזיר exit 0. |
| **אימות** | הרצת הפקודה לוקאלית + ירוק ב-CI. |
| **מאמץ** | ~0.5–1 יום (תלוי בהחלטה על ה-exhaustive-deps). |

### Phase 0 — הבאג החי (חוסם, ראשון)

| | |
|---|---|
| **היקף** | תיקון ה-`ReferenceError` המאומת ב-`useAllBoardProjects.js:215`. |
| **צעדים** | להחליף `writeCache(cacheKey, result)` ב-`saveToStorage(instanceId, { signature, projects: result, ts: Date.now() })`, כמראה למסלול האסיינמנטס ב-`:145`. אומת שהתיקון ישים: `saveToStorage` מוגדרת (`:38–47`), ו-`instanceId`+`signature` ב-scope בשורה 215. |
| **קבלה** | טעינת direct-board מוצלחת משאירה `projects` מאוכלס; לא מופיע "Error fetching board projects"; **וגם** נסגרות 2 שגיאות ה-`no-undef` ב-ESLint. |
| **אימות** | בדיקה ידנית (טעינת לוח פרויקטים) + טסט יחידה ל-`useAllBoardProjects` במצב direct. |
| **מאמץ** | ~15 דק'. |

### Phase 1 — תשתית הלוגר + log-once (Workstream A; הנעילה)

| | |
|---|---|
| **היקף** | להפוך את `logger` ל-sink-ready **ולספק את חוזה ה-log-once (§3.1)**. קבצים: `src/utils/logger.js`, `src/utils/errorHandler.js`, **`src/setupTests.js`** (תשתית בדיקות). |
| **צעדים** | 1. נקודת איגוד `emit(record)`; להעביר את כל הפורמט (`formatMessage`/`logWithColor`/`console.group`) פנימה. <br>2. לנתב את העוקפים דרך `emit`: ה-`console.error` של הסטאק ב-`error` (`:169`), ו-`api`/`apiResponse`/`apiError` (`:177–236`)/`initDone`/`initSummary` (`:276–306`). <br>3. רישום sinks: `logger.addSink(fn)`/`removeSink(fn)`; כל dispatch ב-`try/catch` משלו (sink כושל לא זורק חזרה ולא רקורסיבי). <br>4. ניתוק ה-forwarding מ-gate ה-console (WARN/ERROR נשלחים ל-sink גם כש-console מושתק ב-PROD). <br>5. ring buffer (100–200) + `flush()` ב-`visibilitychange`/`beforeunload`. **`navigator.sendBeacon` לא קיים ב-jsdom** → ל-`flush` חייב fallback חינני (`fetch` keepalive / no-op) כשאין `sendBeacon`. <br>6. רשומה אחידה מ-`createFullErrorObject` (קיים, `errorHandler.js:399–419`; timestamp כבר epoch) + נורמליזציית timestamp ל-epoch/ISO; להשאיר את מחרוזת ה-`he-IL` רק לרינדור קונסול. <br>7. **log-once:** `correlationId` מוטבע פעם אחת בנקודת ה-catch המוקדמת; `emit` מסמן `error.__loggedId` ומדלל כפילויות (§3.1). <br>8. **עדכון `setupTests.js`:** ה-mock הגלובלי של `logger` (שם, `vi.mock('./utils/logger', …)`) **חייב להתרחב** ב-`addSink`/`removeSink`/`emit`/`flush` כדי ש-~54 הבדיקות האחרות לא ישברו כשקוד אפליקציה יקרא `logger.addSink` ב-import-time. |
| **קבלה** | `emit` הוא המסלול היחיד ל-console; sink רשום מקבל את **כל** הרמות כולל `apiError`+סטאק; **שגיאה אחת = רשומה אחת לסינק** (log-once); אין רגרסיה בפלט ה-dev. |
| **אימות** | טסטים: (א) הטסט ל-`logger` **חייב לעקוף את ה-mock הגלובלי** — `vi.unmock('../utils/logger')` + `vi.importActual`. (ב) `logger.addSink(spy)` → כל מתודה מפעילה את ה-spy עם רשומה מובנית. (ג) ה-buffer נשמר לפני רישום sink (חוזה נצפה: replay-on-register, או `getBuffer()` לבדיקה; לתעד מדיניות FIFO + cap). (ד) flush עם stub ל-`navigator.sendBeacon` (`Object.defineProperty`/`vi.stubGlobal`) + ענף ה-absent. (ה) הדמיית מצב PROD: `vi.stubEnv('PROD', true)` + `vi.resetModules()` + `await import` (או רפקטור של ה-gate ל-per-call). (ו) console-spy helper (`vi.spyOn` על log/error/group) ב-`beforeEach`/`afterEach` כדי לאמת שהקונסול נשלט ב-`emit` ולא לזהם פלט בדיקות. (ז) טסט dedup: re-throw של אותו `Error` → רשומה אחת לסינק. |
| **מאמץ** | ~1.5–2 ימים (כולל ה-log-once וה-test-infra). |

### Phase 2 — קריטיים במסלולי כתיבה (audit C2/C3 + שורש `safeApi`)

> **עדכון תלות:** Phase 2 **תלוי ב-Phase 1** (ולא מקבילי). הוא הופך soft-errors שקטים ל-`MondayApiError` שנזרקים — ואלה זורמים לאותם catch-blocks שכבר רושמים. בלי ה-dedup של Phase 1, Phase 2 *מכפיל* את הרישום שהוא נועד לחשוף.

| | |
|---|---|
| **היקף** | לסגור את 2 הקריטיים הנותרים ואת שורש "GraphQL רך = הצלחה". |
| **צעדים** | 1. עוזר משותף `assertNoGraphQLErrors(res)` שנקרא בכל מסלולי הכתיבה (`createBoardItem`/`updateItemColumnValues`/`deleteItem`). **הוא זורק ללא רישום** — כי ה-soft-error כבר נרשם ב-`client.js:256` (זו הרשומה הקנונית לאותו כשל). <br>2. `useMondayEvents.js:642` — `createItem` falsy → `logger.error` + לזרוק `MondayApiError`. <br>3. `MondayCalendar.jsx:915` — אם `createEvent` מחזיר falsy → `showErrorWithDetails`, בלי `showSuccess`/`checkCelebration`. |
| **קבלה** | יצירה כושלת מציגה שגיאה ממופה (לא טוסט הצלחה) ונרשמת; **soft-error מאולץ מייצר בדיוק רשומה אחת** (לא 2–4). |
| **אימות** | טסטים ל-`createEvent` עם תשובת soft-error; טסט שמאמת רשומה-אחת; בדיקה ידנית של יצירת אירוע עם הרשאות חסרות. |
| **מאמץ** | ~0.5 יום. |

### Phase 3 — שני משטחי ה-dark המבניים + סחיפת רישום כפול

| | |
|---|---|
| **היקף** | לנתב את שני המסלולים הגלובליים דרך `logger`, **ובאותה תנועה להסיר את הרישום הכפול**. |
| **צעדים** | 1. `useToast.showErrorWithDetails` (`:69–134`) — לקרוא `logger.error`/`apiError` עם ה-`fullErrorObject` **רק אם `!error.__loggedId`** (§3.1). <br>2. `globalErrorHandler.js` — להוסיף import של `logger`; להחליף את **5** ה-`console.error` (`:23,:34,:35,:97,:139`) ב-`logger.error`. **נקודת רישום אחת בלבד במסלול הגלובלי:** `handleGlobalError` רושם (כדי לתפוס את ה-source), ו-`showErrorWithDetails` מדלג כשמופעל ממנו (דרך `__loggedId`). <br>3. **סחיפה מכנית:** בכל אתר שבו `showErrorWithDetails` צמוד ל-`logger.error`/`apiError` על אותה שגיאה — להסיר את ה-`logger.*` המיותר. אתרים מאומתים: `MondayCalendar.jsx` 921/922, 943/944, 1000/1001, 1028/1029, 1038/1039; `useCalendarHandlers.js` 129/130, 170/171; `useCalendarSelection.js` 77/78; `SettingsWizard.jsx` 70/71; `SettingsDialog.jsx` 91/92, 197/198; `MappingTab.jsx` 225/226, 248/249, 276/277, 354/355, 380/381, 407/408, 462/463, 490/491, 519/520, 750/751; `AdditionalTab.jsx` 109/110, 134/135, 154/155. |
| **קבלה** | כל unhandled rejection / uncaught error / כשל Monday-API שנתפס גלובלית מגיע ל-sink **פעם אחת**; אין זוג `logger.error`+`showErrorWithDetails` על אותו מזהה ב-catch יחיד. |
| **אימות** | טסט ל-`globalErrorHandler` (קובץ חדש): `beforeEach` → `setupGlobalErrorHandlers()` + `setGlobalErrorHandler(spy)` + `logger.addSink(spy)`; `window.dispatchEvent(new ErrorEvent('error', {error}))` ו-`new PromiseRejectionEvent('unhandledrejection', {promise, reason})` → ה-sink נקרא **פעם אחת**; `afterEach` מנקה listeners (מניעת דליפה בין קבצים). הטסט רץ עם ה-logger האמיתי. עדכון `useToast.test.js`: לאמת רישום-יחיד + שאינו מכפיל נתיב שכבר נרשם ב-`safeApi`. |
| **מאמץ** | ~1 יום (הסחיפה מוסיפה מעבר על ~24 אתרים). |

### Phase 4 — פערי High (audit H1–H10)

| | |
|---|---|
| **היקף** | 12 הפערים בחומרה גבוהה — רובם בליעות שקטות (= גם מקורות dark). |
| **צעדים** | `SettingsContext.jsx:248/337` (`JSON.parse` בלי catch + `loadSettings` לא-await, מקפיא ספינר) · `items.js:196/202/525/527` (catch ריק/הערה) · `SettingsDialog.jsx:230` (`FileReader.onerror`) · `SettingsWizard.jsx:~63–68` (שמירה כושלת, ענף `ok===false`) · `useAllDayEvents.js:107–174` (soft-error = הצלחה כוזבת) · `useCalendarSelection.js:40–82` (כשל-מלא ללא הצגה; `failureCount`) · `columns.js:59/90` (עמודות חסרות בשתיקה). |
| **קבלה** | אין `catch` ללא `logger`; ספינר ההגדרות לא נתקע על parse כושל; כל פעולת-משתמש כושלת מציגה הודעה ממופה. |
| **אימות** | טסטים פר-פער (settings פגום, import כושל, soft-error בעדכון). |
| **מאמץ** | ~1–1.5 יום. |

### Phase 5 — בינוני + הזנב הארוך + הקשחת ErrorBoundary + מקורות-dark לא משובצים

| | |
|---|---|
| **היקף** | ~13 בינוני + ~23 נמוך + נתיבי listener/timer/observer שה-`ErrorBoundary` לא תופס + **שלושה מקורות-dark שלא היו משובצים** + נתיב הייצוא של `exceljs`. |
| **צעדים** | 1. אינסטרומנטציה למודולי תאריך/משך שמייצרים `NaN`/Invalid Date לכתיבות: `dateFormatters.js`, `durationUtils.js`, `dateFilterUtils.js`, `dateTimeHelpers.js`, `mondayColumns.js`, `dashboardAggregation.js`. <br>2. העברת `console.*` ל-`logger.*`: `useAllBoardProjects.js` (`:33,43,45,81,101,146,162,171,216`), `ProjectColorsContext`, `ProjectColorsTab`, `projectColorsStorage`, `ErrorDetailsModal`/`ErrorToast` (clipboard). <br>3. סגירת בליעות שקטות: `MappingTab.jsx:306–331` (per-column `JSON.parse` bare-catch), `useApproval.js`, `useProjects.js` (cache catches; כולל ה-`catch {}` הריק ב-`:39`), `useMonthlyHours.js:198`. <br>4. **הרחבת `ErrorBoundary`** — גבול שורש **מעל** ה-providers (`App.jsx`; ה-`ErrorBoundary` self-contained — תלוי רק ב-`i18next`, ניתן להרמה) + גבולות פר-רכיב לעצי ה-lazy (`MondayCalendar`, `Dashboard`, `SettingsDialog`). <br>5. עטיפת נתיבי listener/observer ב-`try/catch → logger` (`MobileResizeOverlay`, `DatePickerInput`, `useFocusTrap`, `useTokens`, `useMultiSelect`). <br>6. **מקורות-dark שהתגלו כלא-משובצים (חדש):** <br>&nbsp;&nbsp;• `i18n/index.js:19–30` — לעטוף `i18next.init()` ב-`.then/.catch → logger.error` (נתיב boot דרך `import "./i18n"` ב-`index.jsx:6`). <br>&nbsp;&nbsp;• `holidayUtils.js:11` — `Location.lookup('Jerusalem')` ב-module-load; להעביר לפונקציה מוגנת/lazy. <br>&nbsp;&nbsp;• `useIsraeliHolidays.js:71` — `try/catch → logger` סביב `fetchIsraeliHolidays`. <br>&nbsp;&nbsp;• `ErrorBoundary.jsx:16–25` — ה-catch של fallback ה-`i18next` (הערה-בלבד) → `logger`. <br>7. **נתיב `exceljs`:** לעגן את `excelExporter.js` (`await import('exceljs')` + `workbook.xlsx.writeBuffer()`) ואת ה-catch ב-`Dashboard.jsx:256–263` — לאמת רישום על כשל dynamic-import וגם על `writeBuffer`, + טסט רגרסיה. |
| **קבלה** | אין `console.*` בקוד אפליקציה; render-throw בכל עץ נתפס ונרשם; **שלושת מקורות ה-dark וה-exceljs מתנקזים ל-`logger`**. |
| **אימות** | חיפוש `grep` שמוודא 0 `console.` מחוץ ל-`logger.js`; טסט ל-`ErrorBoundary` השורש; טסט רגרסיה לייצוא; ספוט-צ'ק ידני. |
| **מאמץ** | ~2.5–3.5 ימים. |

### Phase 6 — מניעת רגרסיה + הסינק המרוחק (היעד נדחה)

| | |
|---|---|
| **היקף** | נעילת הסטנדרט כך שלא יישחק. **מימוש הסינק המרוחק עצמו — היעד — נדחה** (ראה הערת הפתיחה): הוא מבוצע רק אחרי שכל השגיאות נתפסות וזורמות מרכזית דרך `emit`. |
| **צעדים (מבוצעים עכשיו)** | 1. עדכון `CLAUDE.md` — הסרת `wrapMondayApiCall`, סימון `safeApi` כ-funnel היחיד; **ועדכון דפוס "Error Handling" כך ש-`showErrorWithDetails` הוא נקודת ה-emit היחידה למשתמש** (אחרת הקונבנציה תחזיר את הכפילות). <br>2. **מניעת רגרסיה ב-ESLint** (ראה §6.1 לפירוט מלא): `no-console: "error"` (ללא `allow`), `no-empty: ["error", {allowEmptyCatch:false}]`, **כלל מותאם `catch-must-log`**, + `overrides` ל-`logger.js` ולתחום הבדיקות. **שער קשיח של סדר:** הכללים נכנסים רק *אחרי* ש-Phase 4/5 ניקו את האתרים. |
| **צעדים (נדחים — לשלב מאוחר)** | 3. בחירת יעד הסינק (`Sentry` / `POST /logs` / אחר) + אימות CSP/`connect-src` ב-iframe החי של monday + הזרקת `VITE_*` ב-build + redaction ל-PII/טוקנים/`variables`/notes + filter ל-`AbortError`/chunk-load. **תזכורת:** אין backend בריפו (אפליקציית client-side ל-CDN), לכן היעד הריאלי הוא browser-to-3rd-party; ההכרעה הזו תיעשה כשהתשתית בשלה. |
| **קבלה** | CI נכשל על `console.*`/`catch` חדש שלא קורא ל-`logger`. (קבלת הסינק המרוחק תיקבע בשלב הדחוי.) |
| **אימות** | הרצת lint; בדיקת ה-overrides. |
| **מאמץ** | ~1 יום (החלק הלא-דחוי). |

---

## 5. רצף ותלויות

```
Phase −1 (ירוק CI) ─► Phase 0 ─┐
                                ├─► Phase 1 (תשתית + log-once) ─► Phase 2 ─► Phase 3 ─► Phase 4 ─► Phase 5 ─► Phase 6
                                │              │
                                └──────────────┘
            (Phase 2 תלוי ב-Phase 1 — לא מקבילי — בגלל ה-dedup;
             Phase 6 דורש Phase 1; שאר השלבים נשענים על התשתית)
```

- **Phase −1** מקדים — אסור להוסיף כללים על עץ lint אדום.
- **Phase 0** עצמאי (וסוגר גם 2 שגיאות lint), אפשר במקביל ל-Phase 1.
- **Phase 2 תלוי ב-Phase 1** (שינוי מהגרסה הקודמת): ה-throw החדשים מחייבים את ה-dedup קיים.
- **Phase 3–6** נשענים על תשתית ה-`emit`/`addSink`/log-once של Phase 1.
- **המלצה להתחלה:** Phase −1 + Phase 0 יחד (ירוק CI + באג חי), ואז Phase 1.

---

## 6. הגדרת סיום ומדדי הצלחה

**Definition of Done:** "כל שגיאה נתפסת וגם מנוטרת" מתקיים כאשר:

1. כל `catch`/`.catch` ב-`src/` (פרט ל-`AbortError`) כולל קריאת `logger` — **0 בליעות שקטות**.
2. אין `console.*` בקוד אפליקציה (רק בתוך `logger.js`) — **0 dark-console**.
3. `logger` מנתב לכל ה-sinks הרשומים דרך `emit` יחיד, עם log-once; sink מרוחק — **נדחה** (התשתית קיימת, היעד יחובר בשלב מאוחר).
4. `ErrorBoundary` עוטף את כל העץ כולל ה-providers.
5. כלל CI מונע רגרסיה.

### 6.1 מדידה דטרמיניסטית (מחליפה את יעד ה-% הלא-ניתן-לאימות)

> **הבעיה שתוקנה:** היעד "reachability ~100%" נמדד רק ע"י ה-workflow היקר (~10M tokens) שהתוכנית עצמה אוסרת להריץ שוב. לכן אין דרך לאשר שעלינו מ-61% ל-90% ל-100%. במקום יעד-אחוז, מדד הסיום הוא **שערים דטרמיניסטיים שניתן להריץ בכל PR**:

| שער | בדיקה | יעד |
|---|---|---|
| empty-catch | `no-empty` (allowEmptyCatch:false) | 0 |
| silent-catch | כלל מותאם `catch-must-log` | 0 (פרט ל-`AbortError`) |
| dark-console | `no-console` מחוץ ל-`logger.js` | 0 |
| כיסוי מקורות | כל שורה ב-`RELEVANT-SOURCES.md` סומנה סגורה | 100% |
| dark-allowlist | רשימת מקורות-dark ידועים-ומותרים (מתועדת) | ריקה / מנומקת |

> **"reachability ~100%"** מוגדר מחדש כ: כל המקורות המנויים ב-`RELEVANT-SOURCES.md` סגורים **וגם** ה-dark-allowlist ריקה. (אופציונלי: סקריפט סטטי קטן בחבילה שסופר catch/console/fire-and-forget באופן דטרמיניסטי, כדי לגזור מחדש את המכנה 510 בלי ה-workflow.) המספרים 61%/510 נשמרים כ-baseline אינפורמטיבי בלבד, לא כקריטריון חתימה.

| מדד | מצב נוכחי | יעד |
|---|---|---|
| empty/silent catches | 171 (1 ריק לגמרי, 170 הערה/return/console) | 0 |
| dark-console | 28 (24 בקוד אפליקציה) | 0 |
| פערי audit פתוחים | 51 | 0 (קריטי/גבוה), ≤ זנב מתועד |
| רישום כפול לשגיאה | 3–4× | 1× (log-once) |

### 6.2 פירוט מניעת הרגרסיה ב-ESLint (Phase 6 step 2)

> **למה זה הורחב:** `no-empty` לבדו אוכף ~1/171 מהבליעות (רק בלוקים ריקים לגמרי; `catch { return null }` / `catch { /* … */ }` / `catch { console.error(e) }` **עוברים**). הוא גם לא תופס הערה-בלבד.

קונפיג מדויק ב-`package.json` → `eslintConfig` (סגנון eslintrc; אין flat-config בריפו):

```jsonc
{
  "extends": "react-app",
  "rules": {
    "no-console": "error",
    "no-empty": ["error", { "allowEmptyCatch": false }],
    "no-restricted-syntax": ["error", {
      "selector": "CatchClause > BlockStatement:not(:has(CallExpression[callee.object.name='logger'])):not(:has(ThrowStatement)):not(:has(CallExpression[callee.name='showErrorWithDetails']))",
      "message": "כל catch חייב לקרוא ל-logger, לזרוק מחדש (throw), או להציג דרך showErrorWithDetails (בליעת AbortError-בלבד מסומנת בכוונה)"
    }]
  },
  "overrides": [
    { "files": ["src/utils/logger.js"], "rules": { "no-console": "off" } },
    { "files": ["**/__tests__/**", "**/*.test.js", "**/*.test.jsx", "src/test-utils/**", "src/setupTests.js"],
      "rules": { "no-console": "off", "no-restricted-syntax": "off" } }
  ]
}
```

- **חומרה `error` ולא `warn`** — כדי לא להתנגש בתקציב `--max-warnings 34`.
- **בלי `allow`** ב-`no-console` — גם `console.error` עירום הוא פער לפי הסטנדרט.
- **הכלל המותאם** (`no-restricted-syntax`) הוא מה שאוכף בפועל את "כל catch קורא ל-logger". **הסלקטור אומת אמפירית** (`eslint` 8 עם `eslint-config-react-app` — `esquery` תומך ב-`:has`/`:not`): על 9 דפוסי catch הוא מסמן נכון empty / הערה-בלבד / `console`-בלבד / `return` ברירת-מחדל / `AbortError`-בלבד (בליעה), ומעביר נכון catch עם `logger`, עם `throw` (re-throw לגיטימי), ועם `showErrorWithDetails` (העברה דרך ה-funnel המאוחד). שלושת ה-`:not(:has(...))` הם בדיוק החריגים הלגיטימיים. *חלופה:* `eslint-plugin-local-rules` (מדויק יותר אך מוסיף dependency) — לשדרג רק אם יתגלו false-positives נוספים.
- **שער סדר קשיח:** אסור להפעיל את `no-console` לפני ש-Phase 5 ניקה את 24 אתרי ה-console, ואת `no-empty`/`catch-must-log` לפני ש-Phase 4 ניקה את ה-catch הריקים. commit הכלל ו-commit הניקוי **לא יחצו גבול CI-ירוק**.
- חריג ה-`AbortError`: בנתיב `if (e.name === 'AbortError') return; logger.error(...)` יש `logger` → עובר. אבל catch ש**רק** מטפל ב-`AbortError` ובולע את השאר (`if (e.name==='AbortError') return;` ותו לא) מסומן **בכוונה** — זו בליעה שקטה של כל שאר השגיאות.

---

## 7. סיכונים והערות תפעוליות

- **שער CI אדום קיים (חדש):** ראה Phase −1. אסור לבנות מעל עץ lint שבור.
- **`logger` נוגע לכל הקוד:** Phase 1 חייב כיסוי טסטים לפני המשך, ולשמר את התנהגות ה-console בפיתוח. **ה-mock הגלובלי ב-`setupTests.js` חייב להתעדכן יחד עם ה-API החדש** — אחרת ~54 בדיקות יישברו.
- **רישום כפול (חדש):** `showErrorWithDetails` במסלול קריטי. בלי חוזה ה-log-once (§3.1) Phase 3 *מעמיק* את הכפילות במקום לסגור אותה. ה-dedup הוא תוצר Phase 1 מחייב.
- **jsdom חסר `sendBeacon`:** בדיקת ה-flush דורשת stub, ועל ה-`flush` עצמו fallback חינני.
- **רגרסיה שקטה:** בלי כללי ה-ESLint המורחבים (§6.2), הזנב הארוך ייפתח מחדש; `no-empty` לבדו אינו מספיק.
- **מגבלת workflows:** את שלבי המימוש לבצע כעבודת קוד רגילה עם אימות ממוקד — **לא** כ-workflows ענקיים (כל אחד מהשניים שרץ צרך ~10M tokens והגיע למגבלת הסשן).

---

## 8. נספח — מיפוי פערים בולטים → שלב

| מקור | סוג | חומרה | שלב |
|---|---|---|---|
| שער `eslint` אדום (49 problems) | חוסם CI | — | −1 |
| `useAllBoardProjects.js:215` | ReferenceError חי / no-undef | קריטי | 0 |
| `logger.js` (אין chokepoint/registry/log-once) | ארכיטקטורה | — | 1 |
| `setupTests.js` (mock גלובלי של logger) | תשתית בדיקות | — | 1 |
| log-once / `correlationId` | ארכיטקטורה | — | 1 |
| `useMondayEvents.js:642` | בליעת יצירה | קריטי | 2 |
| `MondayCalendar.jsx:915` | הצלחה כוזבת | קריטי | 2 |
| `safeApi` רך = הצלחה | שורש | קריטי/גבוה | 2 |
| `useToast.showErrorWithDetails` | dark מבני | גבוה | 3 |
| `globalErrorHandler.js` (×5 console.error) | dark-console | קריטי/גבוה | 3 |
| רישום כפול (~24 אתרים `showErrorWithDetails`+`logger.error`) | כפילות | גבוה | 3 |
| `SettingsContext.jsx:248/337` | parse לא-נתפס | גבוה | 4 |
| `items.js:196/202/525/527` | catch ריק | גבוה | 4 |
| `SettingsWizard.jsx:~63–68` | שמירה כושלת | גבוה | 4 |
| `dateFormatters`/`durationUtils`/… | NaN שקט | בינוני | 5 |
| `ProjectColors*` + clipboard | dark-console | נמוך | 5 |
| `ErrorBoundary` מתחת ל-providers (143–226) | כיסוי render | בינוני | 5 |
| `i18n/index.js` (init ללא catch) | dark לא-משובץ | בינוני | 5 |
| `holidayUtils.js:11` (module-load throw) | dark לא-משובץ | בינוני | 5 |
| `useIsraeliHolidays.js:71` (sync throw) | dark לא-משובץ | בינוני | 5 |
| `excelExporter.js` + `Dashboard.jsx:256–263` | נתיב ייצוא לא-מעוגן | בינוני | 5 |
| `CLAUDE.md` (`wrapMondayApiCall` + דפוס) | תיעוד מיושן | — | 6 |
| כללי ESLint (`no-console`/`no-empty`/`catch-must-log`) | מניעת רגרסיה | — | 6 |
| יעד הסינק המרוחק (`Sentry`/`POST /logs`/CSP) | **נדחה** | — | 6 (מאוחר) |

---

## 9. אימות הזנב (Medium/Low) מול הקוד החי

51 שורות Medium/Low אומתו מול הקוד החי: **39 אומתו, 5 drifted, 7 הופרכו**. הטענות הקריטיות וה-High אומתו בנפרד (0 drift ששובר תיקון). מסקנות שמשנות היקף:

### 7 שורות שהופרכו — להוריד מההיקף

**קוד מת (test-only — אין קוראים בפרודקשן; להסיר או להתעלם, *לא* לאינסטרמנט):**
- `columnValueBuilders.js:22–29` `buildStatusColumnValue`
- `columnValueBuilders.js:41–68` `buildEventTypeColumnValue`
- `columnValueBuilders.js:78–105` `assertNoTranslatedLabels` — הוולידציה החיה בפרודקשן היא `payloadGuard.js:44` (`assertNoForbiddenStrings`); בניית ה-column_values היא `mondayColumns.js:184` (`buildColumnValues`).

**כבר מטופל/מוגן — אין פעולה:**
- `SettingsDialog.jsx:79–96` `fetchBoards` — ה-catch *כן* רושם וגם מציג דרך `showErrorWithDetails` (לא שקט).
- `SettingsDialog.jsx:392–399` `new Date(lastModifiedAt)` — עטוף ב-`{lastModifiedAt && …}`, לא יזרוק.
- `DashboardFilterPanel.jsx:88–99` `map(String)` — ההורה תמיד מעביר `[]`; אין סיכון ריצה (קוסמטי).
- `AdditionalTab.jsx:74–85` `parseStatusColumnLabels` — מחזיר `[]` fallback; מוגן.

### 5 שורות drifted — התיקון בעינו, מספרי שורות/פרטים עודכנו

| שורה (audit) | מצב נוכחי | הערה |
|---|---|---|
| `MappingTab.jsx:309–315` | `306–317` | bare-catch של `projectColumns` |
| `MappingTab.jsx:323–329` | `320–331` | bare-catch של `taskColumns` |
| `dateFilterUtils.js:146–170` `formatPeriodLabel` | אותן שורות | מקבל אובייקט `Date` (לא string) → פגיע רק אם קורא מעביר `Invalid Date` (מותנה, לא כמו ה-string parsers) |
| `editLockUtils.js:43–75` `isEventLocked` | אותן שורות | יש guard `!eventDate` ב-`:55`; פגיע רק ל-string truthy לא-תקין |
| `MobileResizeOverlay.jsx:175` | `175` | ה-catch הוא הערה-בלבד (לא ריק לגמרי) — `no-empty` לא יתפוס; הכלל המותאם כן |

> **השלכה ל-`RELEVANT-SOURCES.md`:** האינדקס עדיין מצביע על שורות ה-audit המקוריות עבור 5 ה-drifted ומשבץ את 3 ה-builders המתים ב-Phase 5ב. לעדכן את האינדקס בהתאם (descopе של ה-7 + מספרי שורות חדשים) כשמתחילים את Phase 5.
