# תוכנית שיפור ביצועים — דשבורד דיווחי שעות

## מצב קיים

### מדדים שנמדדו
- **חודש נוכחי (פברואר 2026)**: 330 רשומות, 472.5 שעות → נטען תוך ~3-4 שניות
- **שנה שלמה (הערכה)**: ~4,000-5,000 רשומות → נטען תוך ~30 שניות (לפי דיווח משתמשים)
- **מספר קריאות API לשנה**: ~10 עמודים × 500 פריטים = ~10 קריאות סדרתיות

### צוואר בקבוק ראשי: ה-API
Monday.com GraphQL API מגביל concurrency ומחזיר תשובות ב-1-3 שניות לכל עמוד.
עבור שנה שלמה:
```
10 עמודים × ~2 שניות ממוצע = ~20 שניות רק ב-API
+ עיבוד צד-לקוח (mapping, filtering, aggregation) = ~2-5 שניות
+ רנדור גרפים (Recharts SVG) = ~1-2 שניות
───────────────────────────────────────
סה"כ: ~25-30 שניות
```

---

## בעיות שזוהו (לפי חומרה)

### 🔴 קריטי

#### 1. שליפת כל העמודות בשאילתה (Over-fetching)
**קובץ**: `src/hooks/useDashboardData.js:92-126`

השאילתה מבקשת `column_values` ללא הגבלת `ids`, כלומר כל 20-30 העמודות בלוח חוזרות עבור כל פריט. הדשבורד צריך רק 6 עמודות ספציפיות.

**השפעה**: payload גדול פי 3-5 מהנדרש, API איטי יותר, parsing כבד יותר.

**תיקון**: הוספת `column_values(ids: [...])` עם רק העמודות הנדרשות:
```graphql
column_values(ids: ["date_col", "duration_col", "reporter_col", "project_col", "event_type_col", "non_billable_col"]) {
    ...
}
```

**השפעה צפויה**: ירידה של 60-70% בגודל ה-payload, זמן תשובת API קצר יותר.

#### 2. סינון צד-לקוח בלבד — ללא ניצול query_params
**קובץ**: `src/components/Dashboard/Dashboard.jsx:66`

`fetchEvents` תומך ב-`customFilterRules` אבל `Dashboard.jsx` לא מעביר אותם. כל הסינון (מדווח, פרויקט) קורה רק בצד הלקוח.

**השפעה**: כשמשתמש בוחר מדווח יחיד, המערכת שולפת את כל הנתונים (20 עובדים × חודש) ומסננת 95% בצד הלקוח.

**תיקון**: המרת `selectedReporterIds` ו-`selectedProjectIds` ל-GraphQL rules:
```javascript
// בתוך Dashboard.jsx useEffect
const rules = [];
if (selectedReporterIds.length > 0) {
    rules.push({
        column_id: customSettings.reporterColumnId,
        compare_value: selectedReporterIds,
        operator: "any_of"
    });
}
fetchEvents(from, to, rules);
```

**השפעה צפויה**: הפחתה של עד 90% בנפח הנתונים כשמסננים לפי מדווח.

---

### 🟠 גבוה

#### 3. תלות ב-`customSettings` גורמת ל-refetch מיותרים
**קובץ**: `src/hooks/useDashboardData.js:250`

`fetchEvents` תלוי באובייקט `customSettings` המלא. כל שינוי הגדרות (אפילו לא רלוונטי) גורם ליצירת מחדש של `fetchEvents`, שמפעיל את ה-`useEffect` ב-Dashboard.

**תיקון**: חילוץ רק השדות הנדרשים ל-dependency array:
```javascript
const { dateColumnId, durationColumnId, eventTypeStatusColumnId,
        projectColumnId, reporterColumnId, nonBillableStatusColumnId,
        eventTypeMapping, eventTypeLabelColors } = customSettings;

const fetchEvents = useCallback(async (...) => {
    // ...
}, [effectiveBoardId, monday, dateColumnId, durationColumnId, ...]);
```

#### 4. חישובי אגרגציה חוזרים — 4 מעברים על המערך
**קובץ**: `src/components/Dashboard/Dashboard.jsx:96-102`

```javascript
const stats = calcStats(filteredEvents);        // מעבר 1
const barData = groupByGranularity(...)         // מעבר 2
const billableEvents = filtered.filter(...)     // מעבר 3
const nonBillableEvents = filtered.filter(...)  // מעבר 4
```

**תיקון**: איחוד ל-`useMemo` אחד שעושה מעבר יחיד:
```javascript
const { stats, barData, billableEvents, nonBillableEvents } = useMemo(() => {
    let totalHours = 0, billableHours = 0;
    const billable = [], nonBillable = [];
    const granularityMap = {};

    for (const event of filteredEvents) {
        totalHours += event.hours;
        if (event.isBillable) {
            billableHours += event.hours;
            billable.push(event);
        } else {
            nonBillable.push(event);
        }
        // grouping logic...
    }
    return { stats: {...}, barData: [...], billableEvents: billable, nonBillableEvents: nonBillable };
}, [filteredEvents, granularity]);
```

**השפעה צפויה**: הפחתה של ~60% בזמן עיבוד עבור 5,000 רשומות.

#### 5. Pagination סדרתי ללא abort, timeout, או progress
**קובץ**: `src/hooks/useDashboardData.js:154-166`

לולאת `while (cursor)` רצה ללא הגבלה, ללא AbortController, וללא אינדיקציית התקדמות מעבר ללודר הראשוני.

**תיקון**:
```javascript
// 1. AbortController לביטול כשמשתנה הטווח
const abortRef = useRef(null);

const fetchEvents = useCallback(async (dateFrom, dateTo, rules) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // 2. Progress callback
    setProgress({ loaded: 0, total: null });

    while (cursor && !controller.signal.aborted) {
        // ... fetch next page
        setProgress(p => ({ ...p, loaded: p.loaded + items.length }));
    }
}, [...]);
```

**השפעה צפויה**: UX טוב יותר עם אינדיקציית התקדמות, ביטול refetch מיותרים.

---

### 🟡 בינוני

#### 6. חסר debounce על שינוי תאריכים
**קובץ**: `src/components/Dashboard/Dashboard.jsx:58-67`

כל שינוי ב-`dateFrom` או `dateTo` מפעיל fetch מיידי. שינוי תאריך בdate picker יכול לגרום למספר fetches רצופים.

**תיקון**:
```javascript
// Debounce 300ms
useEffect(() => {
    const timer = setTimeout(() => {
        if (!monday || !effectiveBoardId) return;
        const from = new Date(dateFrom + 'T00:00:00');
        const to = new Date(dateTo + 'T23:59:59');
        if (isNaN(from.getTime()) || isNaN(to.getTime())) return;
        fetchEvents(from, to);
    }, 300);
    return () => clearTimeout(timer);
}, [dateFrom, dateTo, monday, effectiveBoardId, fetchEvents]);
```

#### 7. `React.memo` חסר על קומפוננטות גרפים
**קבצים**: `DashboardBarChart.jsx`, `DashboardPieCharts.jsx`, `DashboardStats.jsx`

הקומפוננטות לא עטופות ב-`React.memo`, כך שכל שינוי state ב-Dashboard גורם לרנדור מחדש של כל הגרפים.

**תיקון**:
```javascript
export default React.memo(DashboardBarChart);
export default React.memo(DashboardPieCharts);
export default React.memo(DashboardStats);
```

**השפעה צפויה**: מניעת רנדור מיותר של SVG כבד (~30-50% שיפור ב-responsiveness).

#### 8. Recharts animations עם datasets גדולים
כל הגרפים רצים עם animations כברירת מחדל. עבור 52 עמודות (שנה בגרנולריטת שבוע) זה מייצר אנימציות כבדות.

**תיקון**:
```jsx
<Bar dataKey="hours" isAnimationActive={data.length <= 20} />
<Pie isAnimationActive={data.length <= 10} />
```

#### 9. Lazy loading לגרפים מתחת ל-viewport
גרפי Pie מתחת ל-fold מרונדרים מיד גם אם לא נראים.

**תיקון**: שימוש ב-IntersectionObserver:
```javascript
function LazyChart({ children }) {
    const [ref, inView] = useInView({ triggerOnce: true, rootMargin: '200px' });
    return <div ref={ref}>{inView ? children : <Skeleton height={300} />}</div>;
}
```

---

### 🟢 נמוך

#### 10. Array spread ב-pagination loop
**קובץ**: `src/hooks/useDashboardData.js:163`

`allItems = [...allItems, ...nextPage.items]` יוצר O(n²) העתקות.

**תיקון**: `allItems.push(...nextPage.items)`

#### 11. שליפת `filterProjects` לא מנוצלת
`useFilterOptions` שולף פרויקטים מה-board אבל Dashboard מחלץ פרויקטים מה-events במקום.

**תיקון**: שימוש ב-`filterProjects` מ-`useFilterOptions` במקום חילוץ מ-events.

---

## תוכנית יישום — שלבים

### שלב 1: אופטימיזציות מהירות (Low-hanging fruit) 🎯
**זמן משוער**: 2-3 שעות | **השפעה**: ירידה של ~50% בזמן טעינה

| # | משימה | קובץ | השפעה |
|---|--------|------|-------|
| 1.1 | הגבלת עמודות בשאילתה (`column_values(ids: [...])`) | `useDashboardData.js` | 60-70% פחות payload |
| 1.2 | `React.memo` על קומפוננטות גרפים | `DashboardBarChart.jsx`, `DashboardPieCharts.jsx`, `DashboardStats.jsx` | פחות re-renders |
| 1.3 | כיבוי אנימציות עבור datasets גדולים | `DashboardBarChart.jsx`, `DashboardPieCharts.jsx` | 30-50% שיפור ברנדור |
| 1.4 | תיקון array spread ב-pagination | `useDashboardData.js` | O(n) במקום O(n²) |
| 1.5 | איחוד חישובי אגרגציה למעבר יחיד | `Dashboard.jsx` | 60% פחות iterations |
| 1.6 | תיקון dependency array ב-`fetchEvents` | `useDashboardData.js` | מניעת refetch מיותרים |

### שלב 2: שיפור UX בזמן טעינה 🎨
**זמן משוער**: 2-3 שעות | **השפעה**: חוויה נתפסת טובה יותר גם אם הנתונים איטיים

| # | משימה | קובץ | השפעה |
|---|--------|------|-------|
| 2.1 | Progress indicator (X רשומות נטענו מתוך ~Y) | `useDashboardData.js`, `Dashboard.jsx` | המשתמש רואה התקדמות |
| 2.2 | Debounce על שינויי תאריכים (300ms) | `Dashboard.jsx` | מניעת fetches מיותרים |
| 2.3 | AbortController לביטול fetch ישן | `useDashboardData.js` | ביטול קריאות מיותרות |
| 2.4 | Skeleton loading עבור גרפים | `DashboardBarChart.jsx`, `DashboardPieCharts.jsx` | תצוגה מהירה יותר |
| 2.5 | Lazy rendering לגרפי Pie (IntersectionObserver) | `DashboardPieCharts.jsx` | רנדור רק מה שנראה |
| 2.6 | הצגת נתונים חלקיים תוך כדי pagination | `useDashboardData.js`, `Dashboard.jsx` | תוצאות מיידיות |

### שלב 3: סינון צד-שרת (Server-side filtering) ⚡
**זמן משוער**: 3-4 שעות | **השפעה**: ירידה דרמטית עבור סינונים ספציפיים

| # | משימה | קובץ | השפעה |
|---|--------|------|-------|
| 3.1 | העברת סינון מדווח ל-GraphQL rules | `Dashboard.jsx`, `useDashboardData.js` | עד 90% פחות נתונים |
| 3.2 | העברת סינון פרויקט ל-GraphQL rules | `Dashboard.jsx`, `useDashboardData.js` | עד 80% פחות נתונים |
| 3.3 | שימוש ב-filterProjects מ-useFilterOptions | `Dashboard.jsx` | מניעת שליפה כפולה |

### שלב 4: Caching ו-Stale-While-Revalidate 💾
**זמן משוער**: 4-5 שעות | **השפעה**: ניווט מיידי בין טווחי תאריכים שכבר נטענו

| # | משימה | השפעה |
|---|--------|-------|
| 4.1 | הוספת שכבת cache מקומית ל-useDashboardData | טעינה מיידית מ-cache |
| 4.2 | `keepPreviousData` — הצגת נתונים קודמים בזמן טעינה חדשה | מניעת "ריצוד" (flash of empty) |
| 4.3 | Cache invalidation חכם — רק כשנוצר/נערך אירוע | cache תקף ליותר זמן |

**אפשרויות:**
- **Option A**: מימוש cache עצמי עם `useRef` + Map (פשוט, 0 תלויות)
- **Option B**: שימוש ב-TanStack Query (חזק יותר, +30KB bundle)

### שלב 5 (אופציונלי): Progressive Loading מתקדם 🚀
**זמן משוער**: 5-6 שעות | **השפעה**: טעינה מורגשת של פחות מ-2 שניות גם לשנה

| # | משימה | השפעה |
|---|--------|-------|
| 5.1 | טעינה בשכבות: Stats ← BarChart ← PieCharts | KPIs מוצגים תוך 1-2 שניות |
| 5.2 | Web Worker לאגרגציה (עבור 5,000+ רשומות) | Main thread נשאר responsive |
| 5.3 | LTTB downsampling עבור BarChart עם 50+ נקודות | SVG קל יותר |
| 5.4 | Preset buttons (חודש / רבעון / שנה) עם cache מוכן | טעינה מיידית לטווחים נפוצים |

---

## סיכום השפעה צפויה

| מצב | זמן טעינה נוכחי | אחרי שלב 1 | אחרי שלבים 1-3 | אחרי שלבים 1-4 |
|-----|-----------------|-------------|-----------------|-----------------|
| חודש (330 רשומות) | ~3-4 שניות | ~1.5-2 שניות | ~1-1.5 שניות | <1 שנייה (cache) |
| רבעון (~1,000 רשומות) | ~8-10 שניות | ~4-5 שניות | ~2-3 שניות | <1 שנייה (cache) |
| שנה (~4,500 רשומות) | ~25-30 שניות | ~12-15 שניות | ~5-8 שניות | ~3-5 שניות (first), <1 (cache) |
| שנה + מדווח אחד | ~25-30 שניות | ~12-15 שניות | ~2-3 שניות | <1 שנייה (cache) |

---

## מקורות
- [Recharts Performance Guide](https://recharts.github.io/en-US/guide/performance/)
- [TanStack Query v5 Caching](https://tanstack.com/query/v5/docs/framework/react/overview)
- [LTTB Downsampling Algorithm](https://www.npmjs.com/package/downsample-lttb)
- [React Suspense Guide](https://refine.dev/blog/react-suspense-guide/)
- [Monday.com GraphQL API - items_page](https://developer.monday.com/api-reference/reference/items-page)
- [Web Workers in React](https://blog.logrocket.com/web-workers-react-typescript/)
