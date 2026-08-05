# רשימת אימות ידני — deadline-confirm (אחרי merge)

מריצים מהלפטופ של הבעלים, אחרי שה-merge ל-`develop` פרס draft (ול-`main` — live).
כל הקוד שנבדק כאן עבר טסטים מלאים, אבל ארבעה דברים רצו עד עכשיו **רק מול
test doubles או מלפטופ** — הרשימה הזו סוגרת אותם מול המערכות האמיתיות.

תנאים מקדימים: `mapps init -t` בוצע (טוקן ב-`~/.config/mapps/.mappsrc`),
`gh` מחובר, והפקודות רצות **משורש המונורפו**. הרקע המדוד לכל הצעדים:
`docs/amp-email-verified-findings.md` — אין להסיק מסקנות שסותרות אותו.

---

## 1. בדיקת sandbox ל-`change_multiple_column_values` (סטטוס + טקסט בכתיבה אחת)

**למה:** הכתיבה האטומית של סטטוס+הערה (0.12.0, `SET_COLUMNS_MUTATION` ב-
`src/services/monday-api.js`) רצה עד היום רק מול test doubles — אף פעם מול
ה-API האמיתי. חובה לאמת את פורמט הערכים (`{index}` לסטטוס, מחרוזת לטקסט)
לפני שסומכים עליה בפרודקשן.

**כללי sandbox (root CLAUDE.md, כלל 4):** רק ב-workspace הבדיקות
`16291824`, כל אובייקט זמני עם קידומת `WZ-`, מינימום קריאות (תקציב
ה-complexity משותף עם אפליקציות פרודקשן), וניקוי בסוף.

הארגומנט השלישי `'2026-07'` בכל קריאה אינו אופציונלי: האפליקציה מצמידה
`API-Version: 2026-07` (`monday-api.js`), וברירת המחדל של `mapps-api.sh` היא
2026-04 — probe בגרסה אחרת אינו מוכיח את מה שהקוד באמת שולח.

```bash
# 1a. לוח זמני עם עמודת סטטוס + עמודת טקסט
bash .claude/skills/mapps/mapps-api.sh \
  'mutation { create_board(board_name: "WZ-mcv-probe", board_kind: private, workspace_id: 16291824) { id } }' \
  '{}' '2026-07'
# → שומרים את ה-id שחזר בתור BOARD_ID

bash .claude/skills/mapps/mapps-api.sh \
  'mutation($b: ID!) { s: create_column(board_id: $b, title: "WZ-status", column_type: status) { id }
                       t: create_column(board_id: $b, title: "WZ-note", column_type: text) { id } }' \
  '{"b":"<BOARD_ID>"}' '2026-07'
# → שומרים STATUS_COL_ID ו-TEXT_COL_ID

# 1b. אינדקסים חוקיים של הסטטוס (settings.labels[].id — כמו שהאפליקציה קוראת)
bash .claude/skills/mapps/mapps-api.sh \
  'query($b: [ID!]) { boards(ids: $b) { columns { id type settings } } }' \
  '{"b":["<BOARD_ID>"]}' '2026-07'
# → בוחרים index קיים (למשל 1); label id 0 הוא ערך חוקי

# 1c. אייטם + המוטציה הנבדקת — בדיוק כמו שהקוד שולח אותה
bash .claude/skills/mapps/mapps-api.sh \
  'mutation($b: ID!) { create_item(board_id: $b, item_name: "WZ-item-1") { id } }' \
  '{"b":"<BOARD_ID>"}' '2026-07'
# → שומרים ITEM_ID

bash .claude/skills/mapps/mapps-api.sh \
  'mutation SetColumns($boardId: ID!, $itemId: ID!, $columnValues: JSON!) { change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $columnValues) { id } }' \
  '{"boardId":"<BOARD_ID>","itemId":"<ITEM_ID>","columnValues":"{\"<STATUS_COL_ID>\":{\"index\":1},\"<TEXT_COL_ID>\":\"WZ- הערת בדיקה\"}"}' '2026-07'

# 1d. קריאה חוזרת — שני הערכים באותו read
bash .claude/skills/mapps/mapps-api.sh \
  'query($i: [ID!]) { items(ids: $i) { column_values(ids: ["<STATUS_COL_ID>","<TEXT_COL_ID>"]) { id text ... on StatusValue { index } } } }' \
  '{"i":["<ITEM_ID>"]}' '2026-07'

# 1e. דריסה: מריצים שוב את 1c עם טקסט אחר ("WZ- טקסט שני") וקוראים שוב

# 1f. ניקוי — חובה
bash .claude/skills/mapps/mapps-api.sh \
  'mutation($b: ID!) { delete_board(board_id: $b) { id } }' '{"b":"<BOARD_ID>"}' '2026-07' '2026-07'
```

**עובר אם:** (1) המוטציה מחזירה `id` בלי `errors`; (2) הקריאה ב-1d מראה את
ה-`index` שנשלח **וגם** את הטקסט — שניהם נחתו מכתיבה אחת; (3) בהרצה השנייה
(1e) הטקסט **הוחלף** (לא הצטבר) — זו סמנטיקת ה"דריסה" שהמוצר מבטיח;
(4) הלוח נמחק בסוף.

**נכשל אם:** `errors` בתשובה (למשל `ColumnValueException`) — לעצור, לתעד את
ההודעה המלאה, ולתקן את פורמט הערך לפי סקיל `monday-api` (column-formats)
לפני כל שליחה אמיתית.

---

## 2. חיבור מחדש של תיבת השולח (scope רחב — SMTP XOAUTH2)

**למה:** ב-2026-08-04 הורחב ה-scope ל-`https://mail.google.com/` (ממצאים §5 —
`AUTH XOAUTH2` דוחה טוקן `gmail.send`). כל grant מלפני השינוי חסר את ה-scope,
ולכן `/api/state` מדווח עליו `broken` בכוונה — עד חיבור מחדש שום שליחה לא תעבור
(השרת מסרב עם `google_scope_insufficient`).

**צעדים:**

1. לוודא שב-Google Cloud Console, ב-OAuth consent screen של האפליקציה,
   ה-scope `https://mail.google.com/` נוסף ומסך ה-consent הוא **Internal**
   (חיצוני גורר CASA — ממצאים §5).
2. לפתוח את מסך האדמין של האפליקציה במאנדיי → מקטע חיבור Gmail: הסטטוס
   הצפוי אחרי הפריסה הוא "שבור" (grant ישן).
3. ללחוץ **חבר מחדש**, להשלים את ה-consent עם התיבה השולחת, ולאשר את
   ההרשאה הרחבה.
4. לרענן את המסך.

**עובר אם:** מקטע השולח עבר מ"שבור" ל"מחובר" וכתובת התיבה מוצגת. אימות
עומק: DevTools → Network → התשובה של `GET /api/state` מציגה
`google.status: "connected"` ו-`google.lastError: null` (ה-route מחשב
`connected` רק כשה-scope השמור כולל `https://mail.google.com/`).

**נכשל אם:** הסטטוס נשאר "שבור" אחרי consent מלא — לבדוק ב-`lastError`
ולוודא שה-scope אושר בפועל (מסך consent שלא פורסם עם ה-scope החדש יחזיר
grant צר בשקט).

---

## 3. שליחה ידנית לשתי תיבות נפרדות — לעולם לא self-send

**למה:** המסלול המלא (רנדור → SMTP XOAUTH2 → Gmail dynamic email) עדיין לא רץ
מ-monday-code. **חובה שתי תיבות שונות:** self-send נמסר פנימית בלי שום
headers של אימות ולכן **לעולם לא יירנדר** (ממצאים §3) — כישלון שלו לא אומר
כלום. תיבה שנייה באותו דומיין היא יעד תקין (הגבול הוא התיבה, לא הדומיין).

**צעדים:**

1. בלוח המשתמשים של המייל המסכם: שתי שורות עם שתי כתובות שונות זו מזו
   ושונות מתיבת השולח (למשל `ilai@twyst.co.il` + `ido@twyst.co.il`),
   לכל אחת לפחות משימה ממתינה אחת — כולל משימה במקבץ שממופה לו עמודת
   טקסט חובה (`noteColumnId`), **וגם משימה אחת שעונה על תנאי שני מקבצים
   בו-זמנית** (אותה עמודת תאריך + סטטוס שנכלל בשניהם) לבדיקת עדיפות
   המקבצים.
2. לוודא שכתובת השולח נמצאת ב-`AMP_ALLOWED_SENDERS`
   (`mapps code:env -i 11704868`) — אחרת `/amp/confirm` ידחה את הטופס.
3. במסך האדמין → "מייל מסכם" → **שליחה עכשיו** (עם אישור "שליחה אמיתית
   לכל הנמענים").
4. בכל אחת משתי התיבות: לפתוח את ההודעה → ⋮ → **הצגת מקור** (Show
   original).

**עובר אם — כל הסעיפים, בשתי התיבות:**

- [ ] ב-source: ה-boundary הוא **שלנו** (`dc_…`), לא `000000000000…` של
      Gmail — ההוכחה שהערוץ לא בנה את ההודעה מחדש (ממצאים §2).
- [ ] שלושת חלקי ה-MIME קיימים, בסדר `text/plain` → `text/x-amp-html` →
      `text/html`.
- [ ] בשורת `Authentication-Results`: `spf=pass` **וגם** `dkim=pass` **וגם**
      `dmarc=pass` — שלושתם, `dmarc=pass` לבד לא מספיק (ממצאים §4).
- [ ] הכרטיס האינטראקטיבי מרונדר בהודעה (טבלת משימות עם כפתורים — לא
      ה-fallback הסטטי).
- [ ] שער שדה ההערה: בחירת סטטוס למשימה ממופה **בלי** למלא טקסט משאירה את
      כפתור השליחה חסום והשדה מסומן; מילוי הטקסט משחרר אותו.
- [ ] אחרי שליחה מתוך המייל: הסטטוס בלוח התעדכן והטקסט שהוזן **דרס** את
      הערך הקודם בעמודה הממופה (לבדוק בלוח מול ערך שהיה שם קודם).
- [ ] **עדיפות מקבצים:** המשימה שעונה על תנאי שני המקבצים מופיעה **פעם
      אחת בלבד**, במקבץ הגבוה יותר בהגדרות. היפוך הסדר עם החיצים במסך
      האדמין, שמירה ושליחה חוזרת — המשימה עוברת למקבץ השני.

**נכשל אם:** `smtp_connect_failed` בתשובת השליחה — זה סעיף 5 למטה, לא באג
בהודעה. אם ההודעה הגיעה אך לא רונדרה — לבדוק קודם את שלוש שורות ה-auth ואת
ה-boundary לפי הסדר שלמעלה, ורק אחר כך לחשוד במסמך ה-AMP.

הערה: רינדור אצל נמענים **מחוץ לארגון** דורש בנוסף רישום שולח AMP אצל גוגל
(ממצאים §7 — עדיין פתוח). בתוך ה-Workspace אפשר לאשר את השולח דרך
Admin console → Gmail → הגדרות דוא"ף דינמי.

---

## 4. הגעה בשעה קבועה — סבב scheduler אמיתי

**למה:** מסלול ה-cron (`POST /mndy-cronjob/digest-send`) מעולם לא הריץ שליחה
אמיתית מקצה לקצה.

**צעדים:**

1. לוודא שה-scheduler קיים: `mapps scheduler:list -a 11704868` (אם לא —
   README שלב 6).
2. לוודא `digest.sendHour` במסך האדמין (ברירת מחדל 8, שעון ירושלים) ולחכות
   לסבב של השעה הזו.
3. אחרי השעה: לבדוק שההודעה הגיעה לשתי התיבות, ואת הלוגים. **`-i` הוא app
   VERSION id ולא ה-app id** — `mapps app-version:list -i 11704868` ואז
   `mapps code:logs -i <APP_VERSION_ID> -t console -s live`
   (חלון הלוגים קצר; להריץ סמוך לשעה).
4. אם `OPERATOR_EMAIL` מוגדר — לוודא שהגיע מייל סיכום למפעיל.

**עובר אם:** ההודעות הגיעו בתוך שעת ה-`sendHour` (הסינון הוא לפי שעה שלמה
בירושלים — ה-cron השעתי של הפלטפורמה רץ ב-UTC וכל סבב מסנן טננטים לפי
השעה המקומית), הלוגים מראים סבב תקין בלי שגיאות `smtp_*`, וחתימת ההודעה
זהה לזו של שליחה ידנית באותו slot (resend באותו יום slot = חתימות זהות, D6/D8).

---

## 5. סיכון ידוע: פורט 465 יוצא מ-monday-code — לא הוכח

**הרקע:** כל ניסויי ה-SMTP המוצלחים (ממצאים §1–§2) רצו **מלפטופ**. אין עדיין
שום מדידה של חיבור יוצא ל-`smtp.gmail.com:465` מתוך container של monday-code.
אם הפלטפורמה חוסמת 465, צעדים 3–4 ייכשלו עם `smtp_connect_failed`
(קוד ה-nodemailer יהיה `ECONNECTION`/`ETIMEDOUT` בלוגים).

**אבחון:** ההודעה של `smtp_connect_failed` חוזרת בתשובת ה-502 של
`POST /api/digest/send` ובלוגים (`mapps code:logs -i <APP_VERSION_ID>` — version
id, לא app id) — היא נכתבה
כדי להיות פלט הדיבוג של המפעיל.

**הפתרון המוכן:** מעבר לפורט 587 עם STARTTLS. אופציות ה-transport כבר
מוזרקות (`smtp` ב-`createSmtpSender`), כך שזה שינוי שורה אחת בחיווט של
`src/index.js`:

```js
createSmtpSender({
  storage,
  clientId: env.googleOauthClientId,
  clientSecret: env.googleOauthClientSecret,
  smtp: { host: 'smtp.gmail.com', port: 587, secure: false, requireTLS: true },
})
```

(או, שקול לזה, שינוי ברירת המחדל של הפרמטר `smtp` ב-
`src/services/smtp-sender.js`.) `requireTLS: true` הוא חלק מהתיקון — בלעדיו
nodemailer עלול להמשיך בלי הצפנה אם השרת לא מציע STARTTLS, וזה אסור.

התיקון עובר כרגיל דרך הצנרת: ענף `feature/*` → PR ל-`develop` (fix-forward,
לעולם לא push ידני) → לחזור לצעד 3.

**עובר אם:** צעדים 3–4 הצליחו על 465 (אין צורך בשינוי), או שהצליחו אחרי
מעבר ל-587. את התוצאה — איזה פורט עובד מ-monday-code — לתעד ב-
`docs/amp-email-verified-findings.md` באותו יום.
