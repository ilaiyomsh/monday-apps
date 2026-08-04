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
שעת שליחה, עמודת טקסט חובה לכל מקבץ, תצוגה מקדימה plain+AMP,
עורך AMP + שליחת בדיקה, שליחה ידנית)
```

**נמחק ב-V6:** `/confirm`, snippet, email-template, Resend.

## פקודות פיתוח

```bash
pnpm install                # מריצים משורש המונורפו
npm run dev                 # שרת (:8080) + vite admin (:5173)
npm test                    # vitest — 568+ טסטים
npm run typecheck && npm run lint && npm run build
USE_LOCAL_STORAGE=true npm start
```

פריסה: **רק דרך הצנרת** — merge ל-`develop` = draft, merge ל-`main` = live.

## הקמה (מפעיל)

1. פריסה דרך הצנרת; `BASE_URL` = Live URL קבוע.
2. Env חובה: `MONDAY_CLIENT_ID`, `MONDAY_CLIENT_SECRET`, `BASE_URL`,
   **`ALLOWED_ACCOUNT_IDS`** (רשימת חשבונות — ריק = חסימה מלאה, D15),
   `AMP_ALLOWED_SENDERS`.
3. Env אופציונלי: `OPERATOR_EMAIL` (סיכום אחרי ריצת scheduler).
4. Dev Center: Administration View → `<BASE_URL>/admin`; OAuth scopes + callback.
5. במסך האדמין: חיבור OAuth, לוח, כפתורים, הפעלת מייל מסכם, שעת שליחה, מפתח.
6. Scheduler (אחרי פריסה):  
   `mapps scheduler:create -a 11704868 -n digest-send -s "0 * * * *" -e "/digest-send"`  
   (שעתי UTC; האפליקציה מסננת לפי `sendHour` בירושלים).
7. אפליקציית Google Cloud (מדריך מלא: `docs/google-setup-guide.md`): OAuth client
   + scope **`https://mail.google.com/`** (החלטת בעלים 2026-08-04, שלב בדיקות —
   מסך consent חייב להיות Internal), `GOOGLE_OAUTH_CLIENT_ID/SECRET` ב-env.
8. חיבור תיבת השולח במסך האדמין (**חבר מחדש** אם ה-grant קדם להרחבת ה-scope —
   `/api/state` מדווח עליו `broken` עד אז).
9. אימות אחרי פריסה: **`docs/manual-verification-checklist.md`** — בדיקת sandbox
   לכתיבה האטומית, שליחה לשתי תיבות נפרדות, סבב scheduler, ופורט 465.

## תפעול

- **רוטציית מפתח** מבטלת את כל החתימות הקיימות — kill switch.
- **ערוץ השליחה: SMTP XOAUTH2** (`smtp.gmail.com:465`, `src/services/smtp-sender.js`)
  — לא ה-Gmail API, שמוחק את חלק ה-AMP במסירה חיצונית
  (`docs/amp-email-verified-findings.md` §2). דורש grant עם
  `https://mail.google.com/`; grant ישן מסומן `broken` עד **חבר מחדש** במסך האדמין.
- **שליחה אוטומטית:** `/mndy-cronjob/digest-send` מחובר לערוץ האמיתי; הסינון
  לפי `digest.sendHour` (שעון ירושלים). `/api/digest/send` ו-
  `/api/digest/resend-today` מחזירים 409 `email_not_configured` רק כשחסרים
  `GOOGLE_OAUTH_CLIENT_ID/SECRET` בסביבת השרת.
- **אחרי merge:** לעבור על `docs/manual-verification-checklist.md` — כולל
  הסיכון הידוע של פורט 465 יוצא מ-monday-code (fallback מוכן: 587 + STARTTLS).
