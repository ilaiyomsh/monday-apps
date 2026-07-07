# תכנית: UI Sink אחיד לשגיאות (mock sink)

מסמך תכנון (ללא קוד) לשלב הבא בטיפול בשגיאות: הפיכת ה-`logger` ל**נתיב הצגה יחיד** למשתמש, באמצעות sink מקומי שמטרגט את ה-UI במקום יעד מרוחק. כל שגיאה שנתפסת תופיע בתיבה קטנה בפינה ("אירעה שגיאה") עם כפתור לפרטים מלאים.

> סטטוס: **מומש (2026-06-02).** Phase 1 הושלם בקומיטים `24f1f33` (גל 0 — יישור אתרי רישום + מילון) ו-`e24e831` (גלים 1+2+3 — sink + replay + נתיב יחיד). משלים את `error-points-map.md` (מפת נקודות השגיאה) ו-`sink-readiness.md` (מוכנות ה-sink). ענף: `feat/error-handling-rollout`.
>
> **עדכון 2026-06-02 (תכנון):** לאחר סקירה הוכרעו 5 נקודות פתוחות — טקסט הטוסט, retry, ריסון תצוגה, שגיאות רכות, ורשומות חסרות `error`. ראו טבלת ההחלטות.
>
> **עדכון 2026-06-02 (מימוש):** הכרעה נוספת בזמן המימוש — **"הכל מציג טוסט"**: גם אבחוני-רקע טהורים (כשל טעינת חגים, theme observer וכו') מציגים טוסט; לא בוצעו הורדות רמה ל-warn. ה-hook המרכזי: `src/hooks/useUiErrorSink.js` (AUTO_CLOSE_MS=6000, REPLAY_CAP=5). אתרי A-double (לוג צמוד לתצוגה מפורשת) אוחדו לרשומה אחת שה-sink מציג. מוק ה-logger בטסטים שודרג ל-fan-out אמיתי עם log-once ואיפוס פר-טסט.

---

## 1. מטרה ועיקרון

**נתיב הצגה יחיד:**
```
catch → logger.error(...)  →  emit(record)  →  fan-out ל-sinks
                                                   └─ UI-sink:  record.level === 'ERROR'
                                                        → showToast('אירעה שגיאה', 'error', errorDetails=record)
                                                        → ErrorToast (כפתור פרטים) → ErrorDetailsModal(record)
```

מכיוון שכל `catch` כבר חייב לרשום ל-`logger` (חוזה נאכף ע"י ESLint), הגבה ל*כל* רשומת ERROR == הצגת *כל* שגיאה שנתפסת. זה סוגר את הפער: היום `showErrorWithDetails` נקרא ב-**35** מקומות בלבד, מול **121** אתרי `logger.error`.

### החלטות שאושרו
| נושא | הכרעה |
|------|-------|
| מניעת כפילות | **נתיב הצגה יחיד** — ה-sink הוא המקום היחיד שמציג; `showErrorWithDetails` הופך ללוג-בלבד |
| היקף | פעיל ב-**dev וב-production** |
| ריסון — אילו שגיאות | **ללא סינון** — כל ERROR מציג טוסט, כולל שגיאות רכות שמהן הקוד מתאושש. זו הכנה מכוונת להחלפה עתידית של הטוסט ב-sink חיצוני שיקלוט את *כל* השגיאות, גם הרכות |
| ריסון — תצוגה | **סגירה אוטומטית** לטוסטים מה-sink (לא דביקים) + **תקרת תצוגה ל-replay** (3–5 טוסטים). ההגנה בשכבת התצוגה בלבד — לא נוגעת בנתיב הרישום |
| AbortError | **לא מסננים** — גם ביטול fetch שנרשם כ-ERROR יציג טוסט |
| טקסט ראשי | **הודעה מפוענחת** (`parsedError.userMessage`) — ספציפית לסוג השגיאה; "אירעה שגיאה" רק כ-fallback כשהפענוח נכשל או ריק. הודעות לפי סוג שגיאה מרוכזות במילון אחד, במבנה מוכן ל-i18n |
| Retry | כפתור **"נסה שוב"** בכל קריסת אפליקציה — ה-fallback של `ErrorBoundary` מקבל כפתור reset (remount), והתיעוד ממשיך לזרום בנתיב (`componentDidCatch` → logger → sink). `onRetry` של טוסטים אינו עובר דרך ה-sink (פונקציה לא שורדת רשומת לוג); אין כיום קוראים שמעבירים אותו |
| רשומות בלי `error` | **מתקנים את כל הקריאות מראש** — audit של 121 אתרי `logger.error` כך שכולם מעבירים אובייקט `Error` (צעד 0 החדש) |
| Buffer replay | **כן** — שגיאות init מוקדמות מה-ring buffer יוצגו עם רישום ה-sink, עד תקרת התצוגה |

---

## 2. החדשה הטובה: כל ה-UI כבר קיים

Phase 1 הוא **חיווט, לא בניית UI**. הרכיבים קיימים ומחווטים:

| רכיב | קובץ:שורה | תפקיד |
|------|-----------|-------|
| `showToast(msg, type, duration, errorDetails, onRetry)` | `hooks/useToast.js:16` | יוצר טוסט שנושא אובייקט פרטים |
| `ErrorToast` (טוסט error עם errorDetails) | `components/Toast/Toast.jsx:45-49` | מציג כפתור פרטים כשיש `errorDetails` |
| `onShowDetails → onShowErrorDetails` | `Toast.jsx:99` | חיווט הכפתור לפתיחת המודאל |
| `openErrorDetailsModal(errorDetails)` | `useToast.js:155` | פותח את `ErrorDetailsModal` |
| `ErrorDetailsModal` | `App.jsx:152-155` | מודאל פרטים מלאים (כבר `isOpen={!!errorDetailsModal}`) |
| `emit` fan-out ל-sinks + log-once | `utils/logger.js` (sink dispatch עטוף `try/catch`, מדלג על `record.duplicate`) |
| `addSink(fn)` → unsubscribe | `utils/logger.js:388` | רישום ה-sink |
| `getBuffer()` (ring buffer 150) | `utils/logger.js:412` | מקור ל-replay |
| `parseMondayError` / `createFullErrorObject` | `utils/errorHandler.js:254 / :404` | מיפוי raw→תצוגה |

---

## 3. Phase 1 — יישור קו ל-sink mock

### צעד 0 — יישור אתרי הרישום (מקדים)
- מעבר על 121 אתרי `logger.error` ותיקון קריאות שמעבירות מחרוזת/דאטה בלבד, כך שכולן יעבירו אובייקט `Error` — ה-sink בונה ממנו את מודאל הפרטים.
- אגב המעבר: ריכוז הודעות המשתמש לפי סוג שגיאה במילון אחד (מבנה מוכן ל-i18n), במקום מחרוזות מפוזרות.
- ב-`AppContent`: `useEffect` שקורא `logger.addSink(uiHandler)` ומחזיר את ה-unsubscribe ב-cleanup.
- שימוש ב-`ref` ל-`showToast`/`openErrorDetailsModal` הטריים (הימנעות מ-stale closure).
- `uiHandler(record)`: על `record.level === 'ERROR'` (כולל `kind === 'apiError'`) →
  1. בונה `errorDetails`: `parseMondayError(record.error, record.context?.rawResponse, record.context)` → `createFullErrorObject(parsed, record.module, record.timestamp, null, record.correlationId)`.
  2. `showToast(parsedError.userMessage || 'אירעה שגיאה', 'error', AUTO_CLOSE_MS, errorDetails)` — הודעה ספציפית לסוג השגיאה (מהמילון, מוכן ל-i18n), עם **סגירה אוטומטית** (לא `duration: 0`); ה-`ErrorToast` כבר מציג את כפתור הפרטים.

### צעד 2 — Buffer replay בעלייה
- מיד לאחר `addSink`, לעבור על `logger.getBuffer()` ולהריץ את `uiHandler` על רשומות ה-ERROR שכבר נצברו (שגיאות init מוקדמות).
- לסמן רשומות שכבר הוצגו (למשל לפי `correlationId`) כדי שלא יוצגו שוב אם יגיעו גם דרך ה-fan-out הרגיל.
- **תקרת תצוגה:** מציגים לכל היותר 3–5 טוסטים מה-replay (החדשים ביותר); שאר הרשומות נשארות זמינות בלוג ובמודאל הפרטים — לא מציפים את המסך בעלייה.

### צעד 3 — הפיכת ה-sink לנתיב היחיד
- **`showErrorWithDetails`** (`useToast.js:70`) → הופך ל**facade שרק רושם** (`logger.apiError`/`logger.error`). מסירים את ה-`showToast` הישיר. 35 הקוראים ממשיכים לעבוד; ההצגה עוברת ל-sink. המיפוי `parseMondayError` יורד מכאן ועובר ל-sink (הלוג נושא raw, ה-sink ממפה).
- **`globalErrorHandler`** → מסירים את ה-delegate ל-`showErrorWithDetails`; נשאר רק `logger.error` (מפעיל את ה-sink).
- **`ErrorBoundary`** → **שומרים** את ה-fallback UI למסך קריסת render **ומוסיפים כפתור "נסה שוב"** (reset ל-boundary ו-remount של תת-העץ); ה-`logger.error` ב-`componentDidCatch:40` כבר יפעיל טוסט והתיעוד ממשיך לזרום בנתיב המלא. ה-`onError`-modal הופך למיותר (אפשר להשאיר/להסיר — לא קריטי).

### צעד 4 — בטיחות לולאה (חובה)
- guard reentrancy ב-`uiHandler`: אם קוד ה-sink עצמו זורק (`parseMondayError`/`showToast`), ה-`try/catch` ב-`emit` תופס — אך נוסיף flag שמונע ש-throw בתוך ה-sink ייצור טוסט/לוג חדש, אחרת לולאה אינסופית.

### צעד 5 — בדיקות
- עדכון טסטים שמניחים ש-`showErrorWithDetails` מציג טוסט ישירות (כעת ההצגה דרך ה-sink).
- טסט חדש: רשומת ERROR שנכנסת ל-`emit` → מפיקה קריאת `showToast` אחת עם `errorDetails`.
- טסט: replay מה-buffer מציג שגיאת init מוקדמת פעם אחת בלבד.

---

## 4. Phase 2 — UI אחיד לכל השגיאות (מאוחר)

החלפת `ErrorToast`/`ErrorDetailsModal` ברכיב שגיאות אחיד חדש. כיוון שכל ההצגה כבר עוברת דרך ה-sink היחיד (Phase 1), זו החלפה בנקודה אחת — `uiHandler` קורא לרכיב החדש במקום ל-`showToast`.

---

## 5. סיכונים ואימות

- **נפח ב-production:** כל ERROR מציג טוסט — כולל שגיאות רקע חולפות, AbortError, ושגיאות רכות שמהן הקוד מתאושש (המשתמש יראה טוסט גם כשהפעולה הצליחה בסוף דרך fallback). **מודע ומאושר** — הטוסט הוא mock זמני; בעתיד יוחלף ב-sink חיצוני שמתעד את כל השגיאות, גם הרכות. ההצפה ממותנת בשכבת התצוגה בלבד: סגירה אוטומטית + תקרת replay. אם יידרש עוד — throttle/de-dup-להצגה כשכבה נפרדת מעל ה-sink, בלי לגעת בנתיב.
- **אובדן `onRetry`:** פונקציות retry לא עוברות דרך רשומות לוג. נבדק — אין כיום קוראים שמעבירים `onRetry` ל-`showErrorWithDetails`; דרישת ה-retry ממומשת ברמת ה-`ErrorBoundary` (כפתור "נסה שוב" בקריסה).
- **כפילות:** נפתרת מעצם הנתיב היחיד — `showErrorWithDetails` כבר לא מציג, רק רושם.
- **תזמון:** ה-sink פעיל רק אחרי mount של React; שגיאות pre-mount נתפסות ב-buffer ומוצגות ב-replay (צעד 2).
- **לולאה:** מנוטרלת בצעד 4 + ה-`try/catch` הקיים ב-`emit`.

---

## 6. סדר מימוש מומלץ
1. צעד 0 (יישור 121 אתרי הרישום + מילון הודעות) — מקדים; מכין את הדאטה שה-sink צורך.
2. צעד 1 (רישום sink) + צעד 4 (loop guard) — הליבה, בטוחה.
3. צעד 2 (buffer replay עם תקרה).
4. צעד 3 (single path + כפתור "נסה שוב" ב-ErrorBoundary) — השינוי ההתנהגותי; כאן מסירים את ההצגה הישירה.
5. צעד 5 (בדיקות) — לצד כל צעד.
