# תיעוד מנגנון ה-CRUD ומיפוי הנתונים - Planner App

מסמך זה מסביר את זרימת המידע במערכת, החל משכבת הממשק, דרך ה-Hooks וה-API, ועד לשמירה הפיזית בקבצי ה-CSV בשרת.

## 1. מבני הנתונים המרכזיים (Data Structures)

המערכת משתמשת בשלושה מבנים עיקריים המוגדרים ב-`src/types/gantt.types.ts`:

*   **`Allocation` (ישות בסיס):** מייצגת שורה בודדת בקובץ ה-CSV.
    *   שדות: `id`, `projectId`, `employeeId`, `role`, `startDate`, `endDate`, `hoursPerDay`, `totalHours`.
*   **`Task` (ישות תצוגה):** הרחבה של `Allocation` לצרכי ה-Gantt.
    *   שדות נוספים: `userName`, `projectName`, `color`, `userInitials`, `name` (שם התצוגה).
*   **`Employee`:** מידע על עובד מתוך `employees_data.csv`.
    *   שדות: `id`, `name`, `role`, `allocationPercentage`, `cost`.

---

## 2. מיפוי נתונים (Data Mapping)

המיפוי מתבצע ב-`src/utils/csvParser.ts` וב-`useAllocations.ts`:

### א. מ-CSV לאובייקטים (Read/Parse)
כאשר המידע מגיע מהשרת כ-JSON המכיל מערכים של מחרוזות:
1.  **`parseCSV`:** הופך את שורות ה-CSV למערך של אובייקטי `Task` ומקבץ אותם לפי פרויקטים (`Group`).
2.  **`parseCSVByEmployee`:** דומה ל-`parseCSV`, אך מקבץ את המשימות לפי עובדים.
3.  **מיפוי עמודות:**
    *   עמודה 0 -> `id`
    *   עמודה 1 -> `projectId` / `projectName`
    *   עמודה 2 -> `role`
    *   עמודה 3 -> `employeeId` / `userName`
    *   עמודה 4 -> `startDate` (ISO string)
    *   עמודה 5 -> `endDate` (ISO string)

### ב. מאובייקטים ל-CSV (Write/Stringify)
לפני שליחה לשרת, יש להפוך את האובייקט חזרה למערך של מחרוזות:
*   **`taskToRow(task)`:** פונקציה המקבלת `Task` ומחזירה מערך `string[]` לפי סדר העמודות המדויק של קובץ ה-CSV.

---

## 3. מימוש פונקציות CRUD

הלוגיקה מפוזרת בין ה-Hook `useAllocations.ts` לשירות `allocationsApi.ts`.

### Create (יצירה)
*   **בממשק:** המשתמש גורר שטח ריק או לוחץ על "הקצאה חדשה".
*   **תהליך:**
    1.  נפתח ה-`AllocationModal`.
    2.  באישור, נקראת הפונקציה `addAllocation`.
    3.  הנתונים עוברים דרך `taskToRow`.
    4.  נשלחת בקשת `POST` ל-`/api/allocations`.
    5.  השרת מוסיף שורה לסוף הקובץ ומייצר לה ID.

### Read (קריאה)
*   **תהליך:**
    1.  בטעינת האפליקציה (ובכל שינוי), נקראת הפונקציה `fetchAllocations`.
    2.  נשלחת בקשת `GET` ל-`/api/allocations`.
    3.  המידע מגיע כ-JSON (Header + Rows).
    4.  המידע עובר דרך ה-Parsers ומעדכן את ה-State של `groups`.

### Update (עדכון)
*   **בממשק:** שינוי גודל (Resize), גרירה (Drag), או שינוי עובד מהאוואטר.
*   **תהליך:**
    1.  נקראת הפונקציה `updateTask(taskId, updates)`.
    2.  ה-Hook מוצא את המשימה המקורית, ממזג את העדכונים וקורא ל-`updateAllocation`.
    3.  נשלחת בקשת `PUT` ל-`/api/allocations/:id`.
    4.  השרת מוצא את השורה לפי ה-ID בקובץ ומחליף אותה.

### Delete (מחיקה)
*   **בממשק:** לחיצה על כפתור ה-X האדום המופיע בריחוף על בר.
*   **תהליך:**
    1.  נקראת הפונקציה `deleteAllocation(id)`.
    2.  נשלחת בקשת `DELETE` ל-`/api/allocations/:id`.
    3.  השרת מסנן החוצה את השורה עם ה-ID המתאים ושומר את הקובץ.

---

## 4. ניהול ה-State והרענון (Refresh)

חשוב להבין שלאחר כל פעולת **C/U/D** (יצירה, עדכון או מחיקה), המערכת מבצעת מיד קריאה מחודשת של כל המידע (`refresh`). 
זה מבטיח ש:
1.  התצוגה תמיד מסונכרנת עם הקובץ הפיזי.
2.  חישובים מורכבים (כמו עומס צוות - Company Load) יתעדכנו על בסיס הנתונים החדשים ביותר.
