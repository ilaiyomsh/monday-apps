# Deadline Confirm (deadline-confirm)

אישור משימת דדליין בקליק אחד מתוך מייל: ה-workflow של monday שולח תזכורת עם
כפתור; לחיצה עליו מעבירה את הסטטוס של האייטם מ"סטטוס מקור" ל"סטטוס יעד",
מתעדת מי אישר (עדכון על האייטם עם שם האחראי מעמודת האנשים), ומציגה דף אישור
סטטי. **הספק המלא — מקור האמת — נמצא ב-`docs/spec.md`.**

- **App ID:** 11704868 · **Dev-Center slug:** `yomsheni-il_status-email`
- **סוג:** monday code (שרת Express) + Administration View (React, מוגש מהשרת ב-`/admin`)
- **Single-tenant v1:** חשבון אחד, לוח אחד, מעבר סטטוס אחד.

## ארכיטקטורה בקצרה

```
מייל → GET /confirm?itemId={ITEM_ID}&k=<SECRET>
        1. HEAD → 200 ריק (חוסמי סורקי-מייל)   4. guards: לוח / תפוגה / סטטוס-מקור
        2. בדיקת k בזמן-קבוע לפני הכול          5. change_column_value → סטטוס יעד
        3. rate limit ‏30/דקה/IP                6. create_update "אושר במייל על ידי {אחראי}"
        → אחד משלושה דפים סטטיים בלבד (הצלחה / קישור לא בתוקף / בקשה שגויה)

Admin View (iframe) → /admin: חיבור OAuth, בחירת לוח/עמודות/לייבלים,
ניהול מפתח (rotate), קוד כפתור למייל. פיקרים רצים client-side ב-monday.api().
```

החלטות נעולות (אין "לשפר" בלי החלטת בעלים — ספק §3): קליק ישיר בלי דף ביניים;
מפתח סטטי משותף `k`; בלי רוטציה אוטומטית; בלי זהות מקליק ב-URL; OAuth של
משתמש מוגבל-הרשאות; ‏`/confirm` לא מחזיר שום דאטה חשבונית.

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
   | `ALLOWED_ACCOUNT_ID` | ה-Account ID של חשבון הלקוח (נעילת single-tenant) |
   | `BASE_URL` | הכתובת משלב 1 (Version URL בשלב draft / ‏Live URL בפרודקשן), בלי `/` בסוף |
3. **Dev Center:** להוסיף פיצ'ר **Administration View** שמצביע על `<BASE_URL>/admin`;
   להפעיל OAuth עם scopes: `me:read boards:read boards:write updates:write`
   ו-redirect URI: `<BASE_URL>/oauth/callback`.
4. **חיבור OAuth — כמשתמש מוגבל:** להתחבר ל-monday כמשתמש עם הרשאת עריכה
   **ללוח היעד בלבד** (לא אדמין!) ואז במסך האדמין → "התחבר ל-monday".
   הטוקן שנשמר קובע את היקף הנזק האפשרי.
5. **קונפיגורציה במסך האדמין:** לוח → עמודת סטטוס → סטטוס מקור/יעד → עמודת
   אחראי (ואופציונלית עמודת דדליין + ימי חסד לתפוגת קישורים) → שמירה.
6. **מפתח:** "צור מפתח חדש" → להעתיק את קוד הכפתור (סעיף "קוד לכפתור") לתבנית
   המייל של ה-workflow ולמפות את מזהה האייטם במקום `{ITEM_ID}`. לא לגעת ב-`k`.
   רוטציית מפתח מנתקת מיידית את כל הקישורים שכבר נשלחו (זה גם ה-kill switch).
7. לוודא שמצב ההרשאות של הלוח מאפשר למשתמש המחובר לערוך אייטמים.

## תפעול

- **חיבור שבור** (טוקן בוטל / משתמש הוסר): כל קליק מחזיר "הקישור אינו בתוקף",
  ומסך האדמין מציג "התחבר מחדש". אין refresh token — חיבור מחדש ידני בלבד.
- **לוגים:** כל ניסיון = שורת JSON אחת `{ts, ip, itemId, outcome}`;
  `mapps code:logs -i <APP_VERSION_ID> -s live -t console`.
- **תפוגה:** קליק תקף כל עוד `today <= deadline + graceDays` ‏(UTC, לפי עמודת
  הדדליין שנבחרה); `graceDays = 0` או ללא עמודה = ללא תפוגה.

## עובדות מימוש שכדאי להכיר

- `fromIndex`/`toIndex` בקונפיג מחזיקים **label id** (מ-`settings.labels[].id`) —
  יציב גם אחרי שינוי שם; `labels[].index` הוא סדר תצוגה בלבד. ה-value
  ‏`{"index": N}` של monday נושא את ה-id (אומת ב-probe, ראו tests/fixtures/).
- גרסת API מוצמדת: **2026-07** (`src/services/monday-api.js`).
- כל האחסון (config, מפתח, טוקן, identity, state-nonces) ב-**SecureStorage**,
  עם קאש קריאה של 60 שניות שמתבטל בכל כתיבת אדמין.
- rate limit בזיכרון (container יחיד) — החלטה נעולה בספק, לא להחליף ב-Redis.
