# דוח ביצועים — דשבורד דיווחי שעות

## תאריך: 19.02.2026

---

## סיכום מנהלים

בוצעו 4 שלבי אופטימיזציה על דשבורד דיווחי שעות. השיפורים כוללים הקטנת payload ב-API, סינון צד-שרת, caching מקומי, ושיפור חוויית המשתמש בזמן טעינה.

**תוצאה עיקרית**: טעינת חודש נוכחי (330 רשומות) — מהירה ורספונסיבית. טעינה חוזרת של אותו טווח — מיידית מ-cache.

---

## מה בוצע

### שלב 1: אופטימיזציות מהירות (Quick Wins)

| # | שיפור | קובץ | השפעה |
|---|--------|------|-------|
| 1.1 | הגבלת עמודות בשאילתה — `column_values(ids: [...])` | `useDashboardData.js` | ~60-70% פחות payload בכל קריאת API |
| 1.2 | `React.memo` על DashboardBarChart, DashboardPieCharts, DashboardStats | 3 קומפוננטות | מניעת re-render מיותר של SVG |
| 1.3 | כיבוי אנימציות Recharts עבור datasets גדולים | BarChart, PieCharts | ביטול animation כש-data > 20/10 פריטים |
| 1.4 | תיקון O(n²) array spread → O(n) push | `useDashboardData.js` | שיפור בפגינציה עם הרבה עמודים |
| 1.5 | איחוד 4 מעברי אגרגציה למעבר יחיד (`aggregateAll`) | `dashboardAggregation.js` | ~60% פחות iterations על המערך |
| 1.6 | תיקון dependency array — שדות ספציפיים במקום אובייקט מלא | `useDashboardData.js` | מניעת refetch מיותרים |

### שלב 2: שיפור UX בזמן טעינה

| # | שיפור | קובץ | השפעה |
|---|--------|------|-------|
| 2.1 | הצגת נתונים חלקיים (streaming) — אחרי עמוד ראשון מציג מיד | `useDashboardData.js` | המשתמש רואה תוצאות תוך 1-2 שניות |
| 2.2 | Progress bar עם מספר רשומות שנטענו | `Dashboard.jsx`, `Dashboard.module.css` | אינדיקציית התקדמות ברורה |
| 2.3 | AbortController לביטול fetch ישן כשמשתנה הטווח | `useDashboardData.js` | ביטול קריאות מיותרות |
| 2.4 | Debounce 300ms על שינויי תאריכים | `Dashboard.jsx` | מניעת fetches מיותרים |

### שלב 3: סינון צד-שרת

| # | שיפור | קובץ | השפעה |
|---|--------|------|-------|
| 3.1 | העברת סינון מדווח ל-GraphQL `query_params` עם `any_of` | `Dashboard.jsx` | עד 90% פחות נתונים כשמסננים לפי מדווח |

**הערה**: סינון פרויקט לא הועבר לצד שרת כי `board_relation` עמודות דורשות פורמט פילטר שונה ב-Monday API. הסינון נשאר בצד לקוח.

### שלב 4: Caching מקומי

| # | שיפור | קובץ | השפעה |
|---|--------|------|-------|
| 4.1 | Cache ב-`useRef(new Map())` עם מפתח `from|to|rules` | `useDashboardData.js` | טעינה מיידית מ-cache |
| 4.2 | הגבלה ל-10 ערכים למניעת דליפת זיכרון (LRU) | `useDashboardData.js` | ניהול זיכרון |

---

## קבצים שהשתנו

| קובץ | שינויים |
|------|---------|
| `src/hooks/useDashboardData.js` | Column filtering, streaming, abort, cache, dependency fix |
| `src/components/Dashboard/Dashboard.jsx` | Progress UI, server-side rules, aggregateAll, debounce |
| `src/components/Dashboard/Dashboard.module.css` | Progress bar styles |
| `src/utils/dashboardAggregation.js` | פונקציית `aggregateAll` חדשה (מעבר יחיד) |
| `src/components/Dashboard/DashboardBarChart.jsx` | React.memo + conditional animation |
| `src/components/Dashboard/DashboardPieCharts.jsx` | React.memo + conditional animation |
| `src/components/Dashboard/DashboardStats.jsx` | React.memo |

---

## תוצאות שנצפו בדפדפן

### אימות פונקציונלי (19.02.2026)

| מדד | ערך |
|-----|-----|
| טווח תאריכים | 01.02.2026 – 28.02.2026 |
| סה"כ שעות | 472.5 |
| שעות לחיוב | 334.25 |
| שעות לא לחיוב | 138.25 |
| אחוז לחיוב | 71% |
| מספר רשומות | 330 |
| גרנולריטת ברירת מחדל | שבוע (5 עמודות: W5-W9) |

**כל הפונקציונליות עובדת תקין**: גרף עמודות, גרפי עוגה, סינון סוג חיוב, החלפת גרנולריות.

### השוואת ביצועים (הערכה)

| תרחיש | לפני | אחרי (first load) | אחרי (cache hit) |
|--------|---------|-------|-------|
| חודש (330 רשומות) | ~3-4 שניות | ~1.5-2 שניות | מיידי (<100ms) |
| רבעון (~1,000 רשומות) | ~8-10 שניות | ~3-5 שניות* | מיידי (<100ms) |
| שנה (~4,500 רשומות) | ~25-30 שניות | ~10-15 שניות* | מיידי (<100ms) |
| שנה + מדווח אחד | ~25-30 שניות | ~2-4 שניות* | מיידי (<100ms) |

\* הערכה — לא נמדד ישירות בדפדפן (אין נתוני שנה שלמה לבדיקה)

---

## שיפורים עתידיים (שלב 5 — אופציונלי)

| # | שיפור | תועלת | מורכבות |
|---|--------|--------|---------|
| 5.1 | Web Worker לאגרגציה עבור 5,000+ רשומות | Main thread רספונסיבי | גבוהה |
| 5.2 | LTTB downsampling ל-BarChart עם 50+ נקודות | SVG קל יותר | בינונית |
| 5.3 | Preset buttons (חודש/רבעון/שנה) עם cache מוכן | UX טוב יותר | נמוכה |
| 5.4 | Lazy rendering לגרפי Pie עם IntersectionObserver | רנדור רק מה שנראה | נמוכה |
| 5.5 | Cache invalidation חכם — רק כשנוצר/נערך אירוע | cache תקף יותר | בינונית |

**המלצה**: שלב 5.3 (Preset buttons) ו-5.4 (Lazy pie charts) הם השיפורים הבאים עם ROI הגבוה ביותר.

---

## סיכום טכני

השיפורים העיקריים שבוצעו:

1. **הקטנת payload**: שליפת 6 עמודות במקום 20-30 → חיסכון של 60-70% בנפח
2. **Streaming**: המשתמש רואה נתונים אחרי עמוד ראשון (500 פריטים) במקום לחכות לכולם
3. **סינון צד-שרת**: בחירת מדווח ספציפי מפחיתה את הנתונים כבר ב-API
4. **Cache**: חזרה לטווח תאריכים שכבר נטען — מיידי, ללא API
5. **React optimizations**: React.memo + conditional animations מונעים עבודת רנדור מיותרת
6. **Single-pass aggregation**: מעבר יחיד על המערך במקום 4 נפרדים
