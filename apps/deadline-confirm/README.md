# Deadline Confirm (deadline-confirm)

עדכון סטטוס משימה בקליק אחד מתוך מייל (v2 — כפתורים דינמיים): ה-workflow של
monday שולח מייל (התזמון ממומש מחוץ לאפליקציה) עם כפתורי פעולה שהוגדרו במסך
האדמין — כל כפתור קובע עמודת סטטוס ולייבל יעד משלו. לחיצה מציבה את הסטטוס
ביעד (ללא תלות בסטטוס הנוכחי), מתעדת מי אישר (עדכון עם שם האחראי), ומציגה
דף אישור. מסך האדמין כולל גם **עורך תבניות מייל** בבלוקים עם העתקת ה-HTML
המלא. **הספק המלא — מקור האמת — `docs/spec.md` (כולל V2 Amendment בסופו).**

- **App ID:** 11704868 · **Dev-Center slug:** `yomsheni-il_status-email`
- **סוג:** monday code (שרת Express) + Administration View (React, מוגש מהשרת ב-`/admin`)
- **Single-tenant v1:** חשבון אחד, לוח אחד, מעבר סטטוס אחד.

## ארכיטקטורה בקצרה

```
מייל → GET /confirm?itemId={ITEM_ID}&k=<SECRET>&btn=<BUTTON_ID>
        1. HEAD → 200 ריק                       GET: בדיקת k → rate limit →
        2. בדיקת k בזמן-קבוע לפני הכול              דף נחיתה עם אישור-JS אוטומטי
        3. rate limit ‏30/דקה/IP                     (סורקי מייל בלי JS לא משנים כלום)
        POST /confirm (הטופס מהדף):
        4. guards: לוח בלבד (אין from/תפוגה)    5. כבר ביעד? → הצלחה שקטה בלי כתיבה
        6. change_column_value → יעד הכפתור     7. create_update 'סומן "{יעד}" במייל…'
        → אחד משלושה דפים סטטיים (הצלחה / קישור לא בתוקף / בקשה שגויה)

Admin View (iframe) → /admin: חיבור OAuth, לוח+עמודת אחראי, ניהול כפתורים
(עמודה/לייבל/צבע/אייקון/גודל + תצוגה מקדימה), עורך תבניות מייל בבלוקים
והעתקת HTML מלא, ניהול מפתח. פיקרים רצים client-side ב-monday.api().
```

החלטות נעולות (ספק §3 + ‏V2 Amendment): מפתח סטטי משותף `k` (ה-kill switch);
בלי רוטציה אוטומטית; בלי זהות מקליק ב-URL; OAuth של משתמש מוגבל-הרשאות;
‏`/confirm` לא מחזיר שום דאטה חשבונית; הגנת הסורקים היא דף אישור-JS (לא
דף ביניים ידני).

## פקודות פיתוח

```bash
pnpm install                # מריצים משורש המונורפו
npm run dev                 # שרת (nodemon, :8080) + vite admin ‏(:5173, פרוקסי ל-8080)
npm test                    # vitest — כל חבילת הטסטים (§15 ממומש עם fixtures אמיתיים)
npm run typecheck           # tsc על הקליינט
npm run lint                # eslint (שרת + קליינט + טסטים)
npm run build               # vite build → public/admin/
USE_LOCAL_STORAGE=true npm start   # ריצה מקומית עם אחסון בזיכרון (בלי monday)
```

פריסה: **רק דרך הצנרת** — merge ל-`develop` = draft, ‏merge ל-`main` = live
(ראו CLAUDE.md בשורש). לעולם לא `mapps code:push` מקומי.

## הקמה חד-פעמית בפלטפורמה (מפעיל)

1. **פריסה ראשונה** דרך הצנרת. יש שני סוגי כתובות: ‏**Version URL**
   ‏(`e47e2-…`, פר-פריסה) ו-**Live URL** קבוע (`live1-…`). שניהם מופיעים
   ב-`mapps code:status -i <VERSION_ID>` — עמודת ה-Live URL מופיעה רק
   מהפריסה השנייה בערך, והיא מגישה גם את ה-draft. **כל האימות (BASE_URL,
   ‏redirect, קישור הפיצ'ר) מוצמד ל-Live URL הקבוע** — הוא לא משתנה לעולם.
2. **משתני סביבה** (`mapps code:env -i 11704868 -m set -k <KEY> -v <VALUE>`):
   | משתנה | ערך |
   |---|---|
   | `MONDAY_CLIENT_ID` / `MONDAY_CLIENT_SECRET` | מה-Dev Center → האפליקציה → OAuth |
   | `ALLOWED_ACCOUNT_IDS` | אופציונלי: רשימת Account IDs מופרדת בפסיקים (allowlist). ריק = כל חשבון שמתקין מתקבל — הבידוד בין חשבונות מובנה באחסון. ‏`ALLOWED_ACCOUNT_ID` הישן ממוזג פנימה אם עדיין מוגדר |
   | `BASE_URL` | הכתובת משלב 1 (Version URL בשלב draft / ‏Live URL בפרודקשן), בלי `/` בסוף |
3. **Dev Center:** להוסיף פיצ'ר **Administration View** שמצביע על `<BASE_URL>/admin`;
   להפעיל OAuth עם scopes: `me:read boards:read boards:write updates:write`
   ו-redirect URI: `<BASE_URL>/oauth/callback`.
4. **חיבור OAuth — כמשתמש מוגבל:** להתחבר ל-monday כמשתמש עם הרשאת עריכה
   **ללוח היעד בלבד** (לא אדמין!) ואז במסך האדמין → "התחבר ל-monday".
   הטוקן שנשמר קובע את היקף הנזק האפשרי.
5. **קונפיגורציה במסך האדמין:** לוח + עמודת אחראי → הגדרת כפתורי פעולה
   (עמודת סטטוס, לייבל יעד, צבע/אייקון/גודל) → בניית תבניות מייל בעורך
   הבלוקים → שמירה.
6. **מפתח:** "צור מפתח חדש" → "העתק HTML מלא" מכל תבנית לתוך עורך המייל של
   ה-workflow, ולמפות את מזהה האייטם במקום `{ITEM_ID}`. לא לגעת ב-`k` וב-`btn`.
   רוטציית מפתח מנתקת מיידית את כל הקישורים שכבר נשלחו (זה גם ה-kill switch).
7. לוודא שמצב ההרשאות של הלוח מאפשר למשתמש המחובר לערוך אייטמים.

## תפעול

- **חיבור שבור** (טוקן בוטל / משתמש הוסר): כל קליק מחזיר "הקישור אינו בתוקף",
  ומסך האדמין מציג "התחבר מחדש". אין refresh token — חיבור מחדש ידני בלבד.
- **לוגים:** כל ניסיון = שורת JSON אחת `{ts, ip, itemId, outcome}`;
  `mapps code:logs -i <APP_VERSION_ID> -s live -t console`.
- **קליקים חוזרים:** מייל תזכורת נשלח מחדש יומית (מחוץ לאפליקציה); קליק
  כשהסטטוס כבר ביעד מחזיר דף הצלחה בלי כתיבה נוספת (‏`already_done` בלוג).

## עובדות מימוש שכדאי להכיר

- `buttons[].targetIndex` בקונפיג מחזיק **label id** (מ-`settings.labels[].id`) —
  יציב גם אחרי שינוי שם; `labels[].index` הוא סדר תצוגה בלבד. ה-value
  ‏`{"index": N}` של monday נושא את ה-id (אומת ב-probe, ראו tests/fixtures/).
  ‏label id ‏0 חוקי — לעולם לא בדיקת truthy.
- גרסת API מוצמדת: **2026-07** (`src/services/monday-api.js`).
- כל האחסון (config, מפתח, טוקן, identity, state-nonces) ב-**SecureStorage**,
  עם קאש קריאה של 60 שניות שמתבטל בכל כתיבת אדמין.
- rate limit בזיכרון (container יחיד) — החלטה נעולה בספק, לא להחליף ב-Redis.
