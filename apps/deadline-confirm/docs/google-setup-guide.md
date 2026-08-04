# הקמת שליחת Gmail לארגון — מדריך הפעלה

מדריך זה מבוצע **פעם אחת לכל ארגון**: קודם ב-Twyst (בדיקה פנימית), אחר כך
בזהות מלאה אצל הלקוח. כל ארגון מקים OAuth client משלו, בחשבון Google
הארגוני שלו (החלטת בעלים 2026-07-29 — מחליפה את D12/D13 שהניחו תיבה אחת
בבעלות הספק).

**מה הסוכן לא עושה:** אינו נוגע בקרדנציאלס, אינו מריץ פריסות, ואינו קורא
טוקנים. כל השלבים כאן הם על המפעיל.

---

## שלב א — תיבת השולח

1. `admin.google.com` → Directory → Users → **Add new user**.
   שם מוצע: `deadline@<domain>` או `digest@<domain>`.
2. חייב להיות **משתמש מלא עם רישיון Gmail פעיל** — קבוצה, alias או תיבה
   ללא רישיון לא יעבדו. Gmail API שולח כמשתמש מאומת.
3. להיכנס לתיבה פעם אחת ולאשר את תנאי השימוש, אחרת ההרשאה תיכשל.

הכתובת הזו היא שתופיע כשולח אצל כל הנמענים בארגון, והיא שנרשמת מול Google
בשלב ד'. בחירה קבועה — שינוי בהמשך מחייב רישום מחדש.

## שלב ב — פרויקט Google Cloud ו-OAuth client

1. `console.cloud.google.com` → **New Project**. שם מוצע:
   `deadline-confirm-mail`. פרויקט נפרד ולא שימוש חוזר בפרויקט של
   sync-calender — מסך ההסכמה וה-scopes צריכים להישאר מבודדים.
2. APIs & Services → **Library** → חיפוש **Gmail API** → **Enable**.
   רק Gmail API. לא Calendar, לא People.
3. APIs & Services → **OAuth consent screen** → סוג **Internal**.
   - Internal אפשרי רק כשמקימים מחשבון Workspace ארגוני, וזו בדיוק הסיבה
     שכל ארגון מקים אצלו: **Internal פוטר מאימות Google.**
   - **אזהרת CASA:** ה-scope שבשימוש (שלב 4) הוא scope **מוגבל (restricted)**.
     על מסך הסכמה **External** הוא מפעיל את הערכת האבטחה **CASA** של Google
     (כולל חידוש שנתי). **מסך Internal פוטר מזה לחלוטין** — ולכן שלב
     הבדיקות אפשרי רק על מסך Internal, וההקמה אינה מכלילה ל-External.
4. Scopes → הוספת **`https://mail.google.com/`**, ובנוסף `openid` ו-`email`
   (זיהוי כתובת השולח; אינם קוראים דואר).
   - **החלטת בעלים 2026-08-04 (שלב הבדיקות):** מסלול השליחה עובר ל-SMTP
     XOAUTH2, ו-`smtp.gmail.com` מקבל **רק** את ה-scope הרחב — נמדד
     ב-`docs/amp-email-verified-findings.md` §5: טוקן `gmail.send` נדחה,
     ואתגר ה-334 נוקב במפורש ב-`https://mail.google.com/`.
   - ההנחיה הקודמת של מדריך זה ("`gmail.send` בלבד; `mail.google.com`
     אסור") **הושעתה לשלב הבדיקות** — ראו את הערת ההשעיה על D12
     ב-`docs/v6-amp-only-decisions.md`. חיבור שנעשה עם ה-scope הישן
     יסומן במסך האדמין כ"דורש חיבור מחדש" (broken) עד הסכמה מחודשת.
   - אין להוסיף scopes נוספים — `gmail.readonly` ו-`gmail.modify`
     מיותרים לחלוטין ונשארים אסורים.
5. Credentials → Create credentials → **OAuth client ID** → סוג
   **Web application**.
   - **Authorized redirect URI:** `<BASE_URL>/oauth/google/callback`
     כאשר `<BASE_URL>` הוא כתובת ה-monday code של האפליקציה. להשתמש
     ב-**Live URL** היציב (`mapps code:status`), לא בכתובת של פריסה בודדת —
     אחרת הקישור יישבר בפריסה הבאה.
   - לשמור את **Client ID** ואת **Client secret**.

### שתי מלכודות שהורגות את זה שקט

- **סטטוס Testing — רלוונטי רק ל-External.** אפליקציה **External** במצב
  Testing מנפיקה refresh token שפג אחרי **7 ימים** — השליחה תמות שבוע אחרי
  ההשקה בלי שום שגיאה עד אז. לאפליקציה **Internal אין בכלל** מסלול
  Testing/Published (אומת מול הקונסול 2026-08-04: אין כפתור פרסום — היא
  פעילה מיידית לחברי הארגון), ולכן גם אין תפוגת 7 ימים. ה-token של Internal
  תקף עד ביטול יזום: החלפת סיסמה לתיבת השולח (כלל של Google לכל scope של
  Gmail), ביטול הרשאה ידני, או חצי שנה בלי שימוש. בכל אחד מאלה האפליקציה
  מזהה `invalid_grant`, מסמנת את החיבור כמנותק ומסך האדמין מציג "חבר מחדש".
- **חסר refresh token.** אם מסך ההסכמה אושר פעם אחת בעבר, אישור חוזר יחזיר
  access token בלבד. הקוד מבקש `access_type=offline` + `prompt=consent`
  כדי לכפות הנפקה מחדש, ונכשל בקול אם לא התקבל refresh token.

## שלב ג — אימות דואר (DNS)

בלי שלושת אלה Gmail **לא יציג את החלק הדינמי** — ההודעה תיפול לגרסת טקסט.
קודי הכשל שיוצגו: `DKIM_FAILED`, `DKIM_NOT_MATCHING_FROM`, `SPF_FAILED`.

| רשומה | פעולה |
|---|---|
| **DKIM** (חובה) | Admin console → Apps → Google Workspace → Gmail → **Authenticate email** → Generate new record → להוסיף את ה-TXT ל-DNS → **Start authentication** |
| **SPF** (חובה) | TXT על הדומיין: `v=spf1 include:_spf.google.com ~all` |
| **DMARC** (מומלץ, עשוי להפוך לחובה) | TXT על `_dmarc.<domain>`: `v=DMARC1; p=quarantine; rua=mailto:...` |

דומיין החתימה של DKIM חייב להתיישר עם הדומיין ב-`From`. מכיוון שהתיבה
והדומיין הם של אותו ארגון, זה מתקיים אוטומטית — וזה בדיוק היתרון של
תיבה פר-ארגון על פני שליחה מדומיין הספק.

**שלוש עובדות שנמדדו בשטח (2026-08-03) ולא יובנו מהטבלה** — הפירוט המלא
ב-`docs/amp-email-verified-findings.md`:

1. **`dmarc=pass` אינו מספיק — SPF חייב לעבור בעצמו.** נצפה ישירות: עם
   `dkim=pass` מיושר ועם `dmarc=pass` (ההתיישרות הושגה דרך DKIM לבדו), Gmail
   בכל זאת סירבה ב-`SPF_FAILED` כי `spf=softfail`. דואר רגיל נמסר כרגיל —
   רק AMP נפגע.
2. **DKIM של Workspace אינו אוטומטי.** עד ש-`google._domainkey.<domain>`
   מתפרסם, גוגל חותמת בסלקטור ברירת המחדל `*.gappssmtp.com`, שאינו מיושר עם
   דומיין ה-`From` ואינו מספק ל-AMP. מפתח 2048 ביט חוזר מ-`dig` כשתי מחרוזות
   מצוטטות — זה תקין לערך מעל 255 בתים, לא רשומה פגומה.
3. **אחרי שינוי DNS אין לבדוק AMP לפני שחלף TTL ישן שלם.** בתוך החלון
   מתקבלות בעיקר כשלים עם הצלחה מזדמנת, כי כל פותר מחזיק את הרשומה הישנה
   ל-TTL שלו מרגע השליפה שלו. הצלחה אחת מוכיחה שהרשומה נכונה; כשל בתוך
   החלון אינו מוכיח דבר. הורדת ה-TTL אינה עוזרת בדיעבד.

## שלב ד — Dynamic Email (AMP)

1. **מתג ארגוני.** Admin console → Apps → Google Workspace → Gmail →
   **User settings** → Dynamic email — לוודא שמופעל לארגון. כבוי = אף אחד
   לא יראה את החלק הדינמי, ללא קשר לכל השאר.
2. **בדיקה לפני רישום.** בתיבת ה**נמען**: Gmail → Settings → General →
   Dynamic email → **Developer settings** → להוסיף את כתובת השולח.
   הגדרה **פר-משתמש** — פועלת רק בתיבה שהגדירה אותה. מספיקה לבדיקה
   פנימית, לא לפריסה.
3. **רישום פרודקשן.** שליחת מייל פרודקשן אמיתי ל-
   `ampforemail.whitelisting@gmail.com` + מילוי טופס הרישום. כ-5 ימי
   עסקים. **פר כתובת שולח** — כל ארגון נרשם בנפרד. דרישות: מייל אמיתי ולא
   דמו, קיום fallback טקסט, ו-eTLD+1 שמגיש אתר תקין ששייך לשולח.

## שלב ה — מה למסור לאפליקציה

| ערך | לאן |
|---|---|
| Client ID | env של monday code: `mapps code:env -i 11704868 -m set -k GOOGLE_OAUTH_CLIENT_ID -v <value>` |
| Client secret | אותו הדבר, `GOOGLE_OAUTH_CLIENT_SECRET` |
| כתובת השולח | נלמדת אוטומטית מה-`id_token` בזמן החיבור — אין להזין ידנית |
| refresh token | נוצר בזמן החיבור ונשמר ב-SecureStorage — לא עובר בשום קובץ |

לבדיקה הפנימית ב-Twyst, env ברמת האפליקציה מספיק. כשנוסיף את הלקוח,
הקרדנציאלס עוברים לרשומה פר-טננט ב-SecureStorage — הקוד קורא אותם
כפרמטרים, כך ששני המצבים נתמכים בלי שינוי ארכיטקטוני.

---

## מסלול מהיר לבדיקת ההעברה — לא תלוי בכל האמור לעיל

השאלה "האם העברת מייל מנקה את החלק הדינמי" היא התנהגות של Gmail בלבד, ואינה
תלויה בשולח, בדומיין או ב-API. אפשר לענות עליה היום:

1. בתיבה שלך: Gmail → Settings → General → Dynamic email → Developer
   settings → להוסיף `amp@gmail.dev`.
2. `amp.gmail.dev/playground` → לשלוח לעצמך הודעת AMP.
3. להעביר אותה: (א) לעצמך, (ב) לעובד פנימי, (ג) לכתובת חיצונית.
4. בכל אחת: **Show original** → לבדוק אם חלק `text/x-amp-html` שרד, ואם
   הכפתורים מוצגים או שנפלנו לטקסט.

זה מה שסוגר את סעיף 4 בתשובה ליועץ. החיווט המלא נחוץ למוצר, לא לתשובה.
