# Deadline Confirm (deadline-confirm)

עדכון סטטוס משימות מתוך מייל מסכם יומי (V6 — AMP-only): Gmail dynamic email
מציג טבלת משימות עם כפתורי פעולה; שליחה אחת מעדכנת את כל המשימות שנבחרו.
חתימה קryptografית יומית מגבילה את מה שהמייל מורשה לעשות — המפתח הבסיסי לא
יוצא מהשרver. **הספק המלא — `docs/spec.md` (V6 Amendment) + `docs/v6-amp-only-decisions.md`.**

- **App ID:** 11704868 · **Dev-Center slug:** `yomsheni-il_status-email`
- **סוג:** monday code (שרת Express) + Administration View (React, `/admin`)

## ארכיטקטורה בקצרה (V6)

```
מייל מסכם → multipart/alternative:
  text/plain  — רשימת משימות בלבד (ללא קישורים)
  text/x-amp-html — טופס דינמי בג׳ימייל → POST /amp/confirm
    (חתימה אחת לכל הודעה, manifest של task×button, slot יומי)

Admin View → /admin: OAuth, לוח+כפתורים, מייל מסכם (לוח משתמשים, מקבצים,
שעת שליחה, תצוגה מקדימה plain+AMP, שליחה ידנית)
```

**נמחק ב-V6:** `/confirm`, snippet, email-template, Resend.

## פקודות פיתוח

```bash
pnpm install                # מריצים משורש המונורפו
npm run dev                 # שרת (:8080) + vite admin (:5173)
npm test                    # vitest — 548+ טסטים
npm run typecheck && npm run lint && npm run build
USE_LOCAL_STORAGE=true npm start
```

פריסה: **רק דרך הצנרת** — merge ל-`develop` = draft, merge ל-`main` = live.

## הקמה (מפעיל)

1. פריסה דרך הצנרת; `BASE_URL` = Live URL קבוע.
2. Env: `MONDAY_CLIENT_ID`, `MONDAY_CLIENT_SECRET`, `BASE_URL`, `AMP_ALLOWED_SENDERS`.
3. Dev Center: Administration View → `<BASE_URL>/admin`; OAuth scopes + callback.
4. במסך האדמין: חיבור OAuth, לוח, כפתורים, הפעלת מייל מסכם, שעת שליחה, מפתח.
5. Gmail dynamic email: הנמען מאשר את כתובת השולח פעם אחת (Developer settings).

## תפעול

- **רוטציית מפתח** מבטלת את כל החתימות הקיימות — kill switch.
- **שליחה אוטומטית** (scheduler + Gmail) — בפיתוח (T9–T12); כרגע שליחה ידנית בלבד.
