# AMP for Email — בדיקת עמידה בדרישות Google (29 ביולי 2026)

מקורות (נקראו במלואם בסשן הזה, גרסה חיה):

- `developers.google.com/workspace/gmail/ampemail/authenticating-requests`
- `developers.google.com/workspace/gmail/ampemail/security-requirements`
- `developers.google.com/workspace/gmail/ampemail/register`
- `developers.google.com/workspace/gmail/ampemail/testing-dynamic-email`
- `developers.google.com/workspace/gmail/ampemail/debugging-dynamic-email`
- `developers.google.com/workspace/gmail/ampemail/tips`
- מפרט "CORS in AMP for Email" (amp.dev / ampproject) — נקרא דרך חיפוש, amp.dev עצמו חסום 403 בסביבה הזו

הקוד שנבדק מול המקורות: `src/helpers/amp-cors.js`, `src/routes/amp.js`,
`src/helpers/rate-limit.js`, `src/helpers/digest-amp.js`, `src/app.js`
(ענף `develop`, גרסה 0.9.5).

---

## 1. העובדה שמכתיבה את כל מודל האבטחה

> "all HTTP requests made from inside AMP emails within Gmail are **proxied and
> stripped of cookies**."
> — Authenticating requests

וההנחיה הישירה של Google לפתרון:

> "To authenticate requests made from AMP emails, you may use **access tokens**
> … cryptographically secure and **time- and scope-limited** … to ensure only
> those with access to the AMP email can make the requests contained within
> that email."

זו התשובה הרשמית לשאלה 1 ולשאלה 2 של היועץ: **אימות פר-לחיצה מול המשתמש אינו
אפשרי ב-AMP, לא בגלל בחירת עיצוב שלנו אלא כי Gmail מסיר עוגיות ומעביר את
הבקשה דרך פרוקסי.** המנגנון ש-Google עצמה מגדירה הוא בדיוק טוקן חתום, מוגבל
בהיקף ובזמן — וזה מה שמומש.

### איפה אנחנו מחמירים מעבר לתקן

| נושא | הנחיית Google | המימוש שלנו |
|---|---|---|
| מיקום הטוקן | בתוך ה-URL (`?token=…`) | בגוף ה-POST — לא דולף ל-Referer, ללא היסטוריה ולוגי פרוקסי |
| היקף (scope) | "scope-limited", לא מוגדר איך | מניפסט חתום עם רשימה סגורה של זוגות (משימה × כפתור); כל דבר מחוץ לרשימה נדחה |
| תוקף | "31 days" (כי חלק ה-AMP חי 30 יום) | חלון שליחה יומי אחד. הודעת אתמול מתה. **פי ~30 מחמיר מההמלצה** |
| קישור זהות | לא נדרש | `p` (recipientPersonId) חתום ונאכף מול משויכי המשימה בזמן הביצוע (D11) |

זה מנוסח כך במסמך ללקוח: אין לנו סטייה מהתקן — יש לנו התקן פלוס ארבע החמרות.

---

## 2. דרישות CORS — מצב העמידה

> "All server endpoints used by `amp-list` and `amp-form` must implement CORS
> in AMP for Email and correctly set the `AMP-Email-Allow-Sender` HTTP header."

`helpers/amp-cors.js` מממש את שני הווריאנטים (v2 header-based, v1
`Origin` + `__amp_source_origin`), עם default-deny ובלי תמיכה ב-`*`.
**המפרט מתיר להחזיר `AMP-Email-Allow-Sender: *`** ("either the same value as
`AMP-Email-Sender` in the request, or `*` indicating all sender emails are
allowed") — אנחנו מסרבים לו במפורש. זו החמרה נכונה ויש לשמר אותה.

### F-1 🟡 — preflight OPTIONS לא תואם מפרט (זמינות)

המפרט:

> "The server should appropriately respond to preflight requests (OPTIONS) that
> contain the `Access-Control-Request-Headers: AMP-Email-Sender` header, though
> the email client is **not guaranteed** to issue preflight requests."

שתי בעיות ב-`routes/amp.js` (`router.options`):

1. בבקשת preflight אמיתית הדפדפן **לא** שולח `AMP-Email-Sender` — הוא שולח
   `Access-Control-Request-Headers: AMP-Email-Sender`. לכן `corsGate` נופל
   לענף v1 ודורש `__amp_source_origin`; קליינט v2 שכן עושה preflight יקבל
   `403 missing_source_origin` והטופס ימות לפני ה-POST.
2. התשובה מחזירה `Access-Control-Allow-Headers: Content-Type` בלבד — בלי
   `AMP-Email-Sender`. גם preflight שעובר את הגייט ייכשל בדפדפן.

**חומרה:** זמינות, לא סודיות. ממוסך היום כי Gmail לא מובטח שיעשה preflight
ו-playground הולך במסלול v1 — לכן זה עובד אצלנו בבדיקות. בודק PT **כן**
ישלח OPTIONS.

**כיוון תיקון:** preflight אינו נושא נתונים ואינו משנה מצב. לגייט אותו על
`Origin` + `Access-Control-Request-Headers`, להחזיר
`Access-Control-Allow-Headers: AMP-Email-Sender, Content-Type`, ולהשאיר את
אכיפת השולח ל-POST עצמו (שם היא ממילא היחידה שנחשבת).

### F-2 🟢 — כש-v2 מנצח, `Access-Control-Allow-Origin` נשמט

`resolveAmpCors` מעדיף v2 ומחזיר רק `AMP-Email-Allow-Sender`. אם קליינט שולח
גם `AMP-Email-Sender` וגם `Origin` (דפדפן אמיתי — playground, ואולי Gmail web),
בדיקת ה-CORS של הדפדפן תיכשל כי אין ACAO. תיקון זול: כששני האותות נוכחים,
להחזיר את שתי מערכות הכותרות. המפרט מברך על זה במפורש ("may also include
`Access-Control-Allow-Origin` to allow email playgrounds to use the endpoint").

### F-3 🟢 — `AMP-Same-Origin: true` — **לא** לממש. החלטה, לא פער

מפרט CORS של AMP (בהקשר web) אומר: "If the `Origin` header is missing, AMP will
set `AMP-Same-Origin: true` … endpoints should allow requests that contain this
header." **בהקשר מייל זו עקיפה חינם** — כל `curl` יכול לשלוח את הכותרת הזו
ולדלג על גייט השולח. אנחנו לא מממשים אותה, וזה נכון. לתעד כהחלטה נעולה, כדי
שסבב "התאמה למפרט" עתידי לא יכניס אותה בטעות.

### F-4 ⚪ — גייט ה-CORS אינו בקרת אימות, ואסור להציג אותו ככזו

CORS נאכף בצד הלקוח. הכותרת `AMP-Email-Sender` ניתנת לקביעה חופשית על ידי כל
תוקף. גייט 1 הוא היגיינה נגד שימוש לרעה ועמידה במפרט — **האימות היחיד הוא
ה-HMAC בגייט 6.** במסמך ללקוח ובשיחה עם היועץ יש לומר את זה מפורשות, אחרת
נמצא את עצמנו מגנים על טענה שלא נכונה.

---

## 3. F-5 🟡 — הפרוקסי שובר את דלי ה-rate-limit הראשון (וגם: XFF ניתן לזיוף)

שתי בעיות שמצטרפות לאותה מסקנה.

**(א) התעבורה הלגיטימית מגיעה מפרוקסי של Google.** "requests … are proxied" —
כלומר `req.ip` של כל הקוראים האמיתיים הוא כתובת פרוקסי של Google, משותפת. דלי A
(`perIp`, 30 לדקה) הופך בפועל לתקרה **גלובלית** של 30 בקשות לדקה לכל הנמענים של
כל הטננטים ביחד. דייג'סט בוקר ל-100 נמענים שלוחצים באותה דקה — חוסם משתמשים
אמיתיים.

**(ב) `app.set('trust proxy', true)` ב-`app.js` גורם ל-Express לקחת את הערך
השמאלי ביותר של `X-Forwarded-For`** — ערך בשליטת השולח. תוקף שמסובב את הכותרת
עוקף את דלי A לחלוטין.

יחד: הדלי חוסם את הישרים ולא את התוקף. גם דלי B (`${a}:${ip}`) מדולל מאותה
סיבה.

**כיוון תיקון:** `trust proxy` למספר hops קבוע שתואם את monday code (לא `true`);
דלי A לפי מפתח שאינו בשליטת הלקוח, ודלי B לפי `${a}:${p}` — שני הערכים חתומים
ומאומתים בשלב הזה, ולכן לא ניתנים לזיוף. בנוסף מפסק גלובלי לחשבון.

---

## 4. F-6 🟢 — איסור 3XX על כתובת ה-XHR

> "XHR URLs mustn't use HTTP redirection. Requests that return a status code
> from the redirection class (3XX range) … fail."

`action-xhr` נבנה כ-`${baseUrl}/amp/confirm` (`digest-amp.js:449`).
הנתיב עצמו לא מפנה. מה שצריך אימות בפועל: שקצה monday code לא מייצר הפניה
(נרמול host, trailing slash, http→https) עבור ה-`BASE_URL` שמוגדר בפרודקשן.
בדיקה של דקה, ורק מחוץ לסביבה הזו.

---

## 5. דרישות שהן על הלקוח, לא על הקוד — חייבות להיכנס לחבילת ה-PT

מ-`security-requirements`, כולן חובה (לא המלצות) אלא אם צוין:

| דרישה | מה נדרש | אצל מי |
|---|---|---|
| DKIM | המייל חייב לעבור אימות DKIM | IT הלקוח (Workspace) |
| DKIM alignment | הדומיין החותם חייב להתיישר עם דומיין ה-`From` (relaxed, RFC7489 §3.1.1) | IT הלקוח |
| SPF | המייל חייב לעבור SPF | DNS הלקוח |
| DMARC | מומלץ `quarantine` או `reject`; Google מציינת ש**עשוי להיאכף בעתיד** | DNS הלקוח |
| TLS | המייל חייב להישלח מוצפן TLS | נתיב המסירה |

קודי הכשל התואמים שהנמען יראה בבאנר הדיבאג: `DKIM_FAILED`,
`DKIM_NOT_MATCHING_FROM`, `SPF_FAILED`, `TLS_ENCRYPTION`, `AUTH_FAILED`.

### רישום כשולח פרודקשן

- שליחת מייל פרודקשן אמיתי ל-`ampforemail.whitelisting@gmail.com` + טופס
  רישום; תשובה תוך ~5 ימי עסקים.
- "a real, production-quality example email, not a demo or 'Hello World'".
- **כל כתובת שולח נרשמת בנפרד.**
- ה-eTLD+1 של הדומיין חייב להגיש אתר תקין ונגיש ששייך לשולח.
- "Don't allow third parties to directly author/send emails" — רלוונטי לנו:
  ההודעה נשלחת מחשבון Google ייעודי **של הלקוח** בדומיין של הלקוח (scope
  `gmail.send` בלבד), ולא משרת של Twyst. זה בצד הנכון של הכלל, אבל היועץ
  ישאל — כדאי להגיע עם התשובה.
- כלי בדיקה ו-playgrounds לא ניתנים לרישום.

### מסלול לפני רישום (הבחירה שלך)

Gmail → Settings → General → Dynamic email → **Developer settings** → הוספת
כתובת השולח. **הגדרה פר-משתמש בלבד** — לא מתג ארגוני, ופועלת רק בתיבה שהגדירה
אותה. מספיק לפיילוט מצומצם; לא מספיק לפריסה.

---

## 6. תנאים בצד הנמען שייראו כמו "האפליקציה לא עובדת"

מ-`debugging-dynamic-email` — כולם נופלים חזרה לגרסת הטקסט:

`DYNAMIC_EMAIL_DISABLED` (הגדרת משתמש) · `HIDING_IMAGES` — אם "always display
external images" כבוי, אין AMP בכלל · `THREAD_TOO_LONG` — AMP מוצג רק ב-10
ההודעות האחרונות בשרשור · `OLD_EMAIL` — מעל 30 יום · `MESSAGE_CLIPPED` — חלק
ה-AMP חורג ממגבלת גודל · `INVALID_AMP` · `MALFORMED` (יותר מחלק AMP אחד או
חוסר fallback) · `SPAM`/`PHISHY`/`SUSPICIOUS` · `TIMEOUT`.

שני דברים תפעוליים שנגזרים מזה:

1. הפולבאק הטקסטואלי **לא נושא קישורי פעולה** — נכון, וזה מה שמונע נתיב
   ביצוע לא-מאומת בכל אחד מהמצבים האלה. לא לשנות.
2. דייג'סט יומי באותו שרשור עלול להיקפל (`email.contentIds`) או לחצות את
   סף 10 ההודעות. פריט תפעול, לא אבטחה.

---

## 7. סיכום — מה נכנס למעקב לפני ה-PT

| # | חומרה | ממצא | סוג |
|---|---|---|---|
| F-1 | 🟡 | preflight OPTIONS לא תואם מפרט (חסר `AMP-Email-Sender` ב-`Allow-Headers`; v2 נופל ל-403) | קוד |
| F-5 | 🟡 | דלי A חסר משמעות: תעבורה מגיעה מפרוקסי משותף, ו-`trust proxy: true` מאפשר זיוף XFF | קוד |
| F-2 | 🟢 | v2 מנצח ומשמיט `Access-Control-Allow-Origin` כששניהם נוכחים | קוד |
| F-6 | 🟢 | לוודא שאין 3XX על `BASE_URL/amp/confirm` בפרודקשן | אימות |
| F-3 | ⚪ | `AMP-Same-Origin` — החלטה לא לממש, לתעד כנעולה | תיעוד |
| F-4 | ⚪ | לא להציג CORS כבקרת אימות מול היועץ | תיעוד |
| — | 🟡 | DKIM/alignment/SPF/DMARC/TLS + רישום שולח | הלקוח |

הממצאים מהסשן הקודם (מתזמן ציבורי 🔴, stack trace ב-`detail` 🟡,
`sendHour` ב-`bad_slot` 🟢) עומדים בעינם ומטופלים בנפרד.
