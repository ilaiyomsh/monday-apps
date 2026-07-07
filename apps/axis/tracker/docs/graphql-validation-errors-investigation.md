# חקירת שגיאת "Graphql validation errors"

> מקור: שיחה עם `ask_developer_docs` API של Monday.com (API-Version: 2026-04)

---

## שאלה 1: מה המשמעות של "Graphql validation errors"?

**שאלה:** What does the error "Graphql validation errors" mean in the Monday SDK? When does the client SDK throw this error and what causes it?

**תשובה:**

החל מ-API version `2025-01`, Monday.com הכניסו **parser מחמיר יותר** שאוכף ולידציות GraphQL spec שבעבר לא נאכפו. זהו breaking change.

סיבות נפוצות:
- שימוש ב-**line break בתוך string**
- שליחת **`null` בשדה non-nullable**
- שימוש ב-**סוגריים ריקים** (לא חוקי ב-GraphQL spec)
- **מחרוזות לא מצוטטות** במקום שנדרש ציטוט

בנוסף, ולידציות עמודות מוחמרות עבור אפליקציות — JSON לא תקין בערכי עמודות מחזיר `ColumnValueException`.

> מקור: [migrating to 2025-04](https://developer.monday.com/api-reference/docs/migrating-to-version-2025-04#additional-breaking-changes-only-for-2024-10-users-)

---

## שאלה 2: האם `settings_str` הוסר?

**שאלה:** We are using settings_str field in our GraphQL column queries. Is settings_str deprecated? Was it removed in a recent API version? Should we use settings instead?

**תשובה:**

- שדה **`settings`** מתועד כשדה של Column type: *"The column's dynamic JSON settings. For multi-level boards, use this field to retrieve labels and color mappings for status rollup columns."*
- **`settings_str` לא מופיע** בטבלת השדות המתועדת של Column type
- קיים גם `settings_json` עבור managed columns

**המלצת Monday:** מאחר ש-`settings_str` לא מופיע בתיעוד הנוכחי ו-`settings` הוא השדה המתועד, יש לעבור ל-`settings`.

> מקור: [Get columns](https://developer.monday.com/api-reference/reference/columns#get-columns)

---

## שאלה 3: מה ה-breaking changes בין 2024-10 ל-2025-04?

**שאלה:** What are the breaking changes between API version 2024-10 and 2025-04?

**תשובה — שינויים שוברים עיקריים:**

| # | שינוי | השפעה |
|---|--------|--------|
| 1 | פורמט שגיאת complexity budget עודכן | צריך לעדכן parsing של שגיאות |
| 2 | Variables חייבים להישלח כ-JSON object (לא string) | שאילתות עם variables כ-string ייכשלו |
| 3 | שדה `value` ב-Connect Boards/Dependency/Subtasks מחזיר `null` | חייבים להשתמש ב-`linked_items` / `linked_item_ids` |
| 4 | `column_type` ב-ColumnValueException השתנה | `"StatusColumn"` → `"status"` |
| 5 | שגיאות חדשות ב-`create_webhook` | `InvalidArgumentException` על board ID לא קיים |
| 6 | `renewal_date` הפך nullable | `String!` → `String` |

**שינויים נוספים (רק למשתמשי 2024-10):**

| # | שינוי | השפעה |
|---|--------|--------|
| 7 | **ולידציית GraphQL מחמירה** | parser חדש אוכף spec-compliant queries |
| 8 | **ולידציית עמודות מחמירה** | JSON לא תקין → `ColumnValueException` |
| 9 | queries חייבים להישלח ב-request body | URL query parameters לא נתמכים |
| 10 | שגיאות בפורמט GraphQL אחיד | HTTP 200 + errors array |
| 11 | `account_id` לא מוחזר אוטומטית | צריך לבקש account object מפורשות |

**לגבי `settings_str`:** התיעוד לא מציין במפורש באיזה version הוסר.

> מקור: [migrating to 2025-04](https://developer.monday.com/api-reference/docs/migrating-to-version-2025-04)

---

## שאלה 4: איזה API version ה-SDK משתמש?

**שאלה:** In the monday client SDK (monday-sdk-js), when using monday.api() to query columns, what API version does the SDK use?

**תשובה:**

- **ברירת מחדל:** ה-SDK משתמש ב-**current stable API version** (כרגע `2025-04`)
- ה-SDK **לא אוכף** גרסה קבועה — משתמש ב-stable האחרון אלא אם מוגדר אחרת

**שתי דרכים לקבוע גרסה:**

```javascript
// גלובלית — לכל הקריאות
monday.setApiVersion("2024-10");

// לקריאה בודדת
monday.api('query { ... }', { apiVersion: '2024-10' });
```

**המלצת Monday:** אפליקציות production צריכות **תמיד לציין version מפורש** בקריאות API כדי להימנע מ-breaking changes.

> מקור: [monday.api docs](https://developer.monday.com/apps/docs/mondayapi), [API versioning](https://developer.monday.com/api-reference/docs/api-versioning)

---

## מסקנות

### שורש הבעיה של המשתמש

1. **ה-SDK משתמש ב-current stable version (`2025-04`) כברירת מחדל** — האפליקציה שלנו לא מגדירה version מפורש
2. **גרסה `2025-04` אוכפת ולידציית GraphQL מחמירה** — שאילתות שעבדו בגרסאות קודמות עלולות להיכשל
3. **`settings_str` לא מתועד בגרסה הנוכחית** — ייתכן שהוסר מה-schema, מה שמסביר את `"Graphql validation errors"` על שאילתות שמבקשות את השדה הזה

### מה עשינו (כבר בוצע)

- ✅ החלפת `settings_str` ב-`settings` בכל הקוד (30+ מקומות)
- ✅ שיפור לוגינג של `error.data` מה-SDK לחשיפת שגיאות מלאות

### מה צריך לשקול

- ⚠️ **קביעת API version מפורש** — להוסיף `monday.setApiVersion("2025-04")` ב-init כדי למנוע שבירות עתידיות כש-Monday יעדכנו את ה-stable version
- ⚠️ **בדיקה שכל ה-queries תואמים ל-spec** — line breaks, null values, empty parentheses
- ⚠️ **שדה `value` ב-Connect Boards** — אם משתמשים ב-`value` על עמודות board_relation, צריך לעבור ל-`linked_items` / `linked_item_ids`
