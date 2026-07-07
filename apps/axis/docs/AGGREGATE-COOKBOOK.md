# aggregate — מדריך + קריאות מוכנות (לוח דיווחי שעות 2.0)

לוח: **18390430440** ("דיווחי שעות 2.0")
כל הקריאות כאן נבדקו בפועל מול הלוח ועובדות.

הרצה דרך ה-helper:
`/Users/ilaish/monday_app/apps/.claude/skills/mapps/mapps-api.sh '<query>'`

---

## איך זה בנוי (4 רכיבים)

```
aggregate(query: {
  from:     { type: TABLE, id: "<board_id>" }   # 1. מקור
  select:   [ ... ]                             # 2. רכיבים: מה לחשב/להציג
  group_by: [ { column_id: "<alias>" } ]        # 3. קיבוץ
  query:    { rules: [...] }                    # 4. פילטר (ItemsQuery רגיל)
  limit:    100
})
```

**כללי ברזל:**
- כל אלמנט ב-`select` הוא `COLUMN` (ערך גולמי) או `FUNCTION` (פונקציה, אפשר מקונן ב-`params`), וחייב `as` (כינוי).
- **`group_by.column_id` מצביע על ה-`as` של אלמנט ב-select — לא על id העמודה בלוח.** אחרת: `Failed to find a matching select elements for groupBy elements`.
- מבנה התוצאה: `results[].entries[]`, כש-`value` הוא union:
  - `AggregateGroupByResult { value }` — מפתח הקיבוץ (JSON)
  - `AggregateBasicAggregationResult { result }` — מספר הצבירה (Float)
- עמודת **status**: `COLUMN` גולמי מחזיר צבע (`#007eb5`) → עטוף ב-`LABEL` לטקסט.
- עמודת **people / board_relation**: השתמש ב-`LABEL` לשם. (`PERSON` החזיר שגיאת שרת בלוח הזה — העדף `LABEL`.)
- עמודת **date**: `DATE_TRUNC_DAY/WEEK/MONTH/QUARTER/YEAR` → מחזיר epoch במ"ש.

### עמודות הלוח (id → כותרת)
| id | כותרת | type |
|---|---|---|
| person | מדווח | people |
| date4 | תאריך דיווח | date |
| numeric_mky7eqsf | משך זמן (שעות) | numbers |
| board_relation_mkyg2zeq | פרויקט | board_relation |
| board_relation_mm2bjxk4 | לקוח | board_relation |
| color_mm008jha | סוג דיווח | status |
| multiple_person_mm373gaa | מנהל | people |

### פונקציות זמינות (`AggregateSelectFunctionName`)
צבירה: `SUM AVERAGE MEDIAN MIN MAX COUNT COUNT_ITEMS COUNT_SUBITEMS COUNT_DISTINCT`
status/people: `LABEL COLOR PERSON IS_DONE`
תאריך: `DATE_TRUNC_DAY DATE_TRUNC_WEEK DATE_TRUNC_MONTH DATE_TRUNC_QUARTER DATE_TRUNC_YEAR HOUR DATE START_DATE END_DATE`
טקסט: `UPPER LOWER TRIM LENGTH FIRST LEFT`

---

## 1. סך הכל שעות ודיווחים (ללא קיבוץ)

```graphql
query {
  aggregate(query: {
    from: { type: TABLE, id: "18390430440" }
    select: [
      { type: FUNCTION, as: "total_hours", function: { function: SUM, params: [ { type: COLUMN, column: { column_id: "numeric_mky7eqsf" }, as: "h" } ] } }
      { type: FUNCTION, as: "items", function: { function: COUNT_ITEMS } }
    ]
  }) { results { entries { alias value { ... on AggregateBasicAggregationResult { result } } } } }
}
```

## 2. שעות לפי סוג דיווח (status → LABEL)

```graphql
query {
  aggregate(query: {
    from: { type: TABLE, id: "18390430440" }
    select: [
      { type: FUNCTION, as: "report_type", function: { function: LABEL, params: [ { type: COLUMN, column: { column_id: "color_mm008jha" }, as: "c" } ] } }
      { type: FUNCTION, as: "total_hours", function: { function: SUM, params: [ { type: COLUMN, column: { column_id: "numeric_mky7eqsf" }, as: "h" } ] } }
      { type: FUNCTION, as: "items", function: { function: COUNT_ITEMS } }
    ]
    group_by: [{ column_id: "report_type" }]
  }) { results { entries { alias value { ... on AggregateGroupByResult { value } ... on AggregateBasicAggregationResult { result } } } } }
}
```

## 3. שעות לפי עובד (people → LABEL)

```graphql
query {
  aggregate(query: {
    from: { type: TABLE, id: "18390430440" }
    select: [
      { type: FUNCTION, as: "employee", function: { function: LABEL, params: [ { type: COLUMN, column: { column_id: "person" }, as: "p" } ] } }
      { type: FUNCTION, as: "total_hours", function: { function: SUM, params: [ { type: COLUMN, column: { column_id: "numeric_mky7eqsf" }, as: "h" } ] } }
    ]
    group_by: [{ column_id: "employee" }]
    limit: 100
  }) { results { entries { alias value { ... on AggregateGroupByResult { value } ... on AggregateBasicAggregationResult { result } } } } }
}
```

## 4. שעות לפי חודש (date → DATE_TRUNC_MONTH; הערך epoch במ"ש)

```graphql
query {
  aggregate(query: {
    from: { type: TABLE, id: "18390430440" }
    select: [
      { type: FUNCTION, as: "month", function: { function: DATE_TRUNC_MONTH, params: [ { type: COLUMN, column: { column_id: "date4" }, as: "d" } ] } }
      { type: FUNCTION, as: "total_hours", function: { function: SUM, params: [ { type: COLUMN, column: { column_id: "numeric_mky7eqsf" }, as: "h" } ] } }
    ]
    group_by: [{ column_id: "month" }]
  }) { results { entries { alias value { ... on AggregateGroupByResult { value } ... on AggregateBasicAggregationResult { result } } } } }
}
```

## 5. שעות לפי פרויקט × יום (קיבוץ דו-ממדי + פילטר טווח תאריכים)

```graphql
query {
  aggregate(query: {
    from: { type: TABLE, id: "18390430440" }
    select: [
      { type: FUNCTION, as: "project", function: { function: LABEL, params: [ { type: COLUMN, column: { column_id: "board_relation_mkyg2zeq" }, as: "p" } ] } }
      { type: FUNCTION, as: "day", function: { function: DATE_TRUNC_DAY, params: [ { type: COLUMN, column: { column_id: "date4" }, as: "d" } ] } }
      { type: FUNCTION, as: "total_hours", function: { function: SUM, params: [ { type: COLUMN, column: { column_id: "numeric_mky7eqsf" }, as: "h" } ] } }
      { type: FUNCTION, as: "items", function: { function: COUNT_ITEMS } }
    ]
    group_by: [{ column_id: "project" }, { column_id: "day" }]
    query: { rules: [{ column_id: "date4", compare_value: ["2025-12-01","2025-12-31"], operator: between }] }
    limit: 200
  }) { results { entries { alias value { ... on AggregateGroupByResult { value } ... on AggregateBasicAggregationResult { result } } } } }
}
```

## 6. שעות לפי עובד × חודש (טבלת זמן-עבודה)

```graphql
query {
  aggregate(query: {
    from: { type: TABLE, id: "18390430440" }
    select: [
      { type: FUNCTION, as: "employee", function: { function: LABEL, params: [ { type: COLUMN, column: { column_id: "person" }, as: "p" } ] } }
      { type: FUNCTION, as: "month", function: { function: DATE_TRUNC_MONTH, params: [ { type: COLUMN, column: { column_id: "date4" }, as: "d" } ] } }
      { type: FUNCTION, as: "total_hours", function: { function: SUM, params: [ { type: COLUMN, column: { column_id: "numeric_mky7eqsf" }, as: "h" } ] } }
    ]
    group_by: [{ column_id: "employee" }, { column_id: "month" }]
    limit: 500
  }) { results { entries { alias value { ... on AggregateGroupByResult { value } ... on AggregateBasicAggregationResult { result } } } } }
}
```

## 7. ממוצע משך דיווח לפי לקוח (AVERAGE)

```graphql
query {
  aggregate(query: {
    from: { type: TABLE, id: "18390430440" }
    select: [
      { type: FUNCTION, as: "client", function: { function: LABEL, params: [ { type: COLUMN, column: { column_id: "board_relation_mm2bjxk4" }, as: "c" } ] } }
      { type: FUNCTION, as: "avg_hours", function: { function: AVERAGE, params: [ { type: COLUMN, column: { column_id: "numeric_mky7eqsf" }, as: "h" } ] } }
      { type: FUNCTION, as: "items", function: { function: COUNT_ITEMS } }
    ]
    group_by: [{ column_id: "client" }]
    limit: 200
  }) { results { entries { alias value { ... on AggregateGroupByResult { value } ... on AggregateBasicAggregationResult { result } } } } }
}
```

## 8. שעות של עובד מסוים לפי פרויקט (פילטר על people + קיבוץ)

```graphql
query {
  aggregate(query: {
    from: { type: TABLE, id: "18390430440" }
    select: [
      { type: FUNCTION, as: "project", function: { function: LABEL, params: [ { type: COLUMN, column: { column_id: "board_relation_mkyg2zeq" }, as: "p" } ] } }
      { type: FUNCTION, as: "total_hours", function: { function: SUM, params: [ { type: COLUMN, column: { column_id: "numeric_mky7eqsf" }, as: "h" } ] } }
    ]
    group_by: [{ column_id: "project" }]
    query: { rules: [{ column_id: "person", compare_value: ["person-<USER_ID>"], operator: any_of }] }
    limit: 200
  }) { results { entries { alias value { ... on AggregateGroupByResult { value } ... on AggregateBasicAggregationResult { result } } } } }
}
```
> החלף `<USER_ID>` ב-id המשתמש. אפשר גם לסנן לפי `color_mm008jha` (סוג דיווח) עם `operator: any_of` וערך = label index.

---

## עזר: המרת epoch של DATE_TRUNC לתאריך (פייתון)
```python
import datetime
datetime.datetime.fromtimestamp(ms/1000, datetime.UTC).strftime('%Y-%m-%d')
```

## נתונים שחולצו בפועל (לאימות)
- סה"כ: **8,654.96 שעות** ב-**5,699** דיווחים.
- לפי סוג: פרויקט חיצוני 5,426.41 / שוטף 1,448.07 / (ריק) 1,157.50 / פרויקט פנימי 510.99 / יומי 112.00.
