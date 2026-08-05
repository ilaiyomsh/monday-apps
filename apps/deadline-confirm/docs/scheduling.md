# תיזמון השליחה — deadline-confirm

מסמך אחד לכל מה שנוגע לשליחה האוטומטית: איך זה עובד, מה נרשם בפועל, מה
נמדד, ומה עוד פתוח. נכתב 2026-08-05, אחרי שהתגלה שה-cron **לא היה רשום כלל**.

מסמכים סמוכים: `README.md` (הקמה תפעולית), `docs/spec.md` (המפרט),
`docs/manual-verification-checklist.md` (אימות אחרי פריסה),
`.claude/skills/mapps/references/cli.md` (קוריוזים של ה-CLI).

---

## 1. איך זה עובד

```
פלטפורמת monday (cron שעתי, UTC)
        │  POST /mndy-cronjob/digest-send
        ▼
src/routes/scheduler.js          ← לכל חשבון ב-ALLOWED_ACCOUNT_IDS
        │  digest.sendHour == השעה הנוכחית בירושלים?
        ▼
src/services/digest-run.js       ← runDigestForAccount, לכל נמען
        │  קורא לוח משימות + לוח עובדים, בונה דיג'סט, מרנדר, שולח
        ▼
src/services/smtp-sender.js      ← SMTP XOAUTH2 מהתיבה של אותו טננט
```

**ה-cron הוא דופק, לא שעון.** הוא פועם **כל שעה** ולא בשעה מסוימת; מי מקבל
מתי נקבע באפליקציה. זו הסיבה שהביטוי חייב להיות שעתי — ראה §2.

**הסינון לפי שעה** (`hourInJerusalem` ב-`digest-run.js`): לכל טננט נקראת
`config.digest.sendHour` (0–23, ברירת מחדל 8) ומושווית לשעה הנוכחית
**בשעון ירושלים**. התאמה → ריצה; אחרת דילוג **שקט** (הטננט אפילו לא מופיע
בתשובת ה-tick). ההשוואה בשעון מקומי היא גם מה שמנטרל שעון קיץ — אין מה
לעדכן במרץ ובאוקטובר.

**השעה נקבעת במסך האדמין** ("שעת שליחה" בטאב "מייל מסכם"), לא בקוד ולא ב-cron.

---

## 2. מה רשום בפועל

נרשם 2026-08-05. **לפני התאריך הזה לא הייתה שליחה אוטומטית מעולם** —
`mapps scheduler:list -a 11704868` החזיר `No scheduler jobs found`. כל מה
שיצא עד אז נשלח ידנית ממסך האדמין.

| שדה | ערך שנשמר |
|---|---|
| name | `digest-send` |
| schedule | `0 * * * *` (כל שעה, UTC) |
| targetUrl | `/digest-send` → הפלטפורמה קוראת ל-`/mndy-cronjob/digest-send` |
| timeout | `300` שניות |
| retryConfig | `{ maxRetries: 3, minBackoffDuration: 60 }` |

**הביטוי חייב להישאר שעתי.** מסנן השעה נמצא באפליקציה, כך שביטוי כמו
`0 8 * * *` פירושו שרק טננטים שה-`sendHour` שלהם מתאים לשעת ה-UTC היחידה
שהוא פועם בה יקבלו משהו — כל השאר לא יקבלו דבר, לעולם, בשקט.

### קוריוז CLI שנמדד ברישום

`mapps scheduler:create … -r 0` **נבלע.** ה-CLI מתייחס ל-`0` כאילו לא סופק,
נופל ל-prompt אינטראקטיבי, ומאחסן את ברירת המחדל שלו (3). כלומר **אפס
retries אינו בר-השגה מה-CLI**, ולכן ההגנה מפני שליחה כפולה חייבת לשבת בקוד
ולא בהגדרת ה-job. נרשם גם ב-`references/cli.md`.

שני קוריוזים נוספים מאותה בדיקה: הדגל הוא `-e/--targetUrl` (התיעוד הפומבי
עדיין אומר `-u`), ו-`-z/--region` מקבל `us|eu|au|il` (`il` חסר בתיעוד
הפומבי). היעד הועבר **בלי לוכסן מוביל** וה-CLI נרמל אותו ל-`/digest-send`.

---

## 3. מה נחשב "ריצה שנכשלה"

מבחינת הפלטפורמה זו שאלה של HTTP בלבד. פעימה נכשלת אם הנקודה מחזירה
**קוד שאינו 2xx**, אם היא **חורגת מ-300 שניות**, או אם הקונטיינר לא נגיש.

מה שהקוד מחזיר (`src/routes/scheduler.js`):

| מצב | קוד | האם הפלטפורמה תנסה שוב |
|---|---|---|
| ריצה תקינה | 200 | לא |
| חלק מהנמענים נכשלו ב-SMTP | **200** — הכשל מדווח פר נמען בתוך ה-JSON | **לא** |
| טננט לא מוגדר / בלי סוד / בלי חיבור | 200 עם `skip` | לא |
| זריקה לא צפויה | 500 (`cron_tick failed` בלוג) | כן |
| חריגה מ-timeout | — | כן |

כלומר כשל SMTP של נמען בודד **אינו** מפעיל retry. להשלמה יש
`POST /api/digest/resend-today` במסך האדמין.

---

## 4. אף אחד לא מקבל מייל פעמיים

החלטת בעלים 2026-08-05: **אין שליחה חוזרת למי שכבר נשלח לו** באותו slot.
מיושם ב-`digest-run.js` + `storage.js`.

- **מפתח:** `${accountId}:digest_sent` = `{ slot, personIds }` — מפתח אחד
  לטננט. ה-slot השמור הוא **התפוגה**: רשומה מ-slot קודם נקראת כלוח חלק,
  ולכן אתמול לא יכול לחסום את היום ושום דבר לא נערם.
- **גרנולריות: פר (slot × עובד), לא פר טננט.** "הטננט כבר רץ" היה מפיל את
  כל מי שנמצא אחרי הנקודה שבה ריצה מתה. פר עובד מאפשר ל-retry **להמשיך**:
  מי שכבר קיבל מדולג, מי שנשאר מקבל. כך 3 ה-retries של הפלטפורמה הופכים
  מסיכון לרפוי-עצמי.
- **נשמר אחרי כל שליחה מוצלחת**, לא פעם אחת בסוף — אחרת ריצה שנהרגה
  ב-timeout לא הייתה מותירה שום עקבות, וה-retry היה שולח לכולם שוב.
- **נקרא ונכתב דרך האחסון, לא מה-cache.** זה מספר ולא סגנון: ברירת המחדל
  של ה-backoff היא 60 שניות ו-cache הקריאה מחזיק 60 שניות — בדיוק החלון
  שבו ניסיון חדש לא היה רואה מה קודמו עשה.
- **נמען נרשם רק אם השליחה שלו הצליחה.**
- **opt-in, ובכוונה.** רק ה-cron מעביר `skipAlreadySent: true`.
  `/api/digest/send` ו-`resend-today` **לא** — שליחה חוזרת מכוונת באותו slot
  היא כל תכליתם. אין "לתקן" את זה בהדלקת הדגל כברירת מחדל; יש טסט שהורג
  בדיוק את השינוי הזה.

טסטים: `tests/digest-run-idempotency.test.js`.

---

## 5. סיכומים אחרי פעימה

שני סיכומים נפרדים, שני יעדים, שתי מטרות: אחד למפעיל של האפליקציה (טקסט,
חוצה-טננטים), אחד לתיבת השולח של כל טננט (קובץ, פר עובד).

### 5.1 סיכום המפעיל

נשלח ל-`OPERATOR_EMAIL` (אופציונלי) אחרי פעימה, **רק אם היה טננט שבאמת היה
due באותה שעה**.

לפני 2026-08-05 השער היה `!t.skip || t.skip !== 'wrong_hour'` — ביטוי
שאמיתי לכל ערך אפשרי, כי `wrong_hour` היא סיבת דילוג שאף קוד לא מייצר
(מסלול "לא בשעה שלו" עושה `continue` בלי לדחוף כלום). לכן חשבון שפשוט עוד
לא הגדיר מייל מסכם נחשב due **בכל פעימה**: עם cron שעתי — מייל סיכום כל
שעה, כל היום; ואם לאותו חשבון אין תיבה מחוברת — כשל שליחה בלוג כל שעה.
נמדד, ותוקן לספירת טננטים שהיו due בפועל. תשובת ה-tick עדיין מונה טננטים
לא-מוגדרים לצורך אבחון — זה לא עולה לאף אחד מייל.

הסיכום נשלח **בשם הטננט הראשון שהיה due**, כי זו זהות השליחה היחידה שהריצה
מחזיקה בוודאות. טסטים: `tests/scheduler-summary-gate.test.js`.

### 5.2 דוח סיכום פר עובד (CSV)

החלטת בעלים 2026-08-05, **מיושם**. אחרי כל פעימה, לכל טננט שרץ, נשלח מייל עם
קובץ CSV מצורף — **שורה לכל עובד**.

| מה | ערך |
|---|---|
| יעד | **תיבת השולח של אותו טננט** (`${accountId}:google_sender`), שליחה לעצמה |
| טריגר | **ריצת cron בלבד** |
| שם הקובץ | `digest-summary-<slot>.csv` |
| עמודות | `עובד \| אימייל \| <מקבץ 1> \| <מקבץ 2> \| … \| סה"כ \| סטטוס \| שגיאה` |
| מבנה MIME | `multipart/mixed`: גוף `text/plain` + הקובץ כ-attachment |

**היעד הוא תיבת השולח ולא `OPERATOR_EMAIL`.** הדוח נוסע עם התיבה: מחליפים
תיבת שולח במסך האדמין — הדוח זז לבד, ואין הגדרה שנייה שיכולה להישאר מיושנת.
`OPERATOR_EMAIL` ממשיך לקבל את סיכום §5.1 הטקסטואלי בלבד — הקובץ לא מגיע לשם.

**רק ה-cron מייצר קובץ.** `/api/digest/send` ו-`resend-today` לא: שם התוצאה
מוצגת על המסך בלאו הכי. `runDigestForAccount` כן מחזיר את הנתונים
(`summaryRows`/`summarySections`) בכל קריאה — מי ששולח את הקובץ הוא
`routes/scheduler.js`, ורק הוא.

**BOM של UTF-8 בתחילת הקובץ.** בלעדיו Excel קורא את הקובץ בקודפייג' המקומי וכל
שם בעברית נפתח כג'יבריש. הקובץ נבנה עם `\uFEFF` (escape ולא תו בלתי-נראה בקוד —
`no-irregular-whitespace` היה חוסם, ותו כזה גם נמחק בקלות כ"טעות").

**עמודות המקבצים נגזרות מ-`config.digest.sections` לפי הסדר** — שהוא גם סדר
העדיפות (החלטת בעלים 2026-08-04). כך הקובץ תמיד תואם להגדרות: מוסיפים מקבץ,
משנים שם, מזיזים חץ ↑/↓ — הקובץ עוקב. כותרת קבועה בקוד הייתה ממשיכה לספור,
מתחת לכותרת הלא נכונה.

**שורה לכל עובד, כולל מי שלא נשלח לו.** זו כל הטענה של הקובץ, ולכן העמודה
האחרונה נושאת גם סיבות שאינן שגיאות.

**A dedicated `סטטוס` (outcome) column (round348).** Until now, filtering
"error not empty" in Excel also caught every benign skip — there was no way
to isolate a real SMTP failure. `סטטוס` fixes that: only three values, built
to be filtered on:

| Case | סטטוס (outcome) | שגיאה (free text, unchanged) |
|---|---|---|
| Sent | `נשלח` | empty |
| SMTP failure | `נכשל` | the transport's own message (`smtp auth failed: 535` etc.) |
| Already sent this slot (§4) | `דולג` | `כבר נשלח בסלוט הזה` |
| 0 open tasks | `דולג` | `אין משימות פתוחות` |
| Unresolved users-board row | `דולג` | `דולג: אין אימייל בשורה` / `דולג: אין עובד משויך` / `דולג: יותר מעובד אחד בשורה` |

Both columns are derived from the same lookup (`KIND_META` in
`digest-summary-report.js`), so a new `kind` can never update one column and
forget the other. An unrecognized `kind` still **throws**
(`unknown_summary_row_kind`) — round348 left that alone.

הסדר: קודם מי שיש לו משימות, אחר כך מי שאין לו, ולבסוף שורות שלא נפתרו לעובד.

**כשל בשליחת הדוח לא עולה לאף דיג'סט.** הדיג'סטים כבר יצאו כשהקובץ נשלח; כשל
נרשם בלוג והפעימה עדיין מחזירה 200 — אחרת קובץ שבור היה מפעיל retry של
הפלטפורמה ומריץ את כל הטננט מחדש.

**הזרקת נוסחאות ל-Excel נוטרלה.** ערך שמתחיל ב-`=`/`+`/`-`/`@` מקבל גרש מוביל.
שמות באים מלוח משימות של הלקוח, והקובץ נפתח על מכונה של אדם.

טסטים: `tests/digest-summary-report.test.js` (הבייטים והנוסח),
`tests/digest-summary-rows.test.js` (מאיפה המספרים),
`tests/scheduler-summary-file.test.js` (מי מקבל ומתי),
`tests/mime-mixed.test.js` (העוטף שמאפשר צירוף).

---

## 6. ספר הפעלה

```bash
# מה רשום
mapps scheduler:list -a 11704868

# רישום (רק אם אין job). הדגל הוא -e ולא -u; היעד בלי לוכסן מוביל.
mapps scheduler:create -a 11704868 -n digest-send -s "0 * * * *" \
  -e "digest-send" -t 300 \
  -d "hourly tick; the app filters tenants by digest.sendHour (Asia/Jerusalem)"

# שינוי פרמטרים בלי למחוק
mapps scheduler:update -a 11704868 -n digest-send -t 600

# בדיקת עשן: להריץ בשעה שאף טננט אינו due → לא נשלח מייל לאף אחד
mapps scheduler:run -a 11704868 -n digest-send

# לוגים — -i הוא app VERSION id, לא ה-app id!
mapps app-version:list -i 11704868
mapps code:logs -i <APP_VERSION_ID> -t console -s live
```

בלוג לחפש `cron_tick` עם `hour`, `tenants`, `due`, `summarySent`.
`tenants` ריק = הכול מחובר, פשוט אף אחד לא היה בתור.

**להריץ `scheduler:run` בשעת ה-`sendHour` = שליחה אמיתית ללקוחות.**

---

## 7. מה עוד פתוח

### 7.1 באיזו גרסה ה-cron פוגע — draft או live? (לא ידוע)

הרישום הוא לפי אפליקציה (`-a`), לא לפי גרסה, והתיעוד לא אומר. זה חשוב כי
0.13.x נמצא ב-draft ו-`main` נושא גרסה קודמת: אם ה-cron פוגע ב-live,
השליחה האוטומטית מריצה קוד **ישן** — כולל בלי ההגנה מ-§4.

**איך לבדוק — רצף מדויק.** דורש `MONDAY_TOKEN`, כלומר **הבעלים בלבד** (סוכן לא
מריץ `mapps` — חוק ריפו). להריץ בשעה שאף טננט אינו due, אחרת זו שליחה אמיתית
ללקוחות (§6).

```bash
# 1. רשימת הגרסאות. לרשום את שני ה-IDs ומי draft ומי live.
mapps app-version:list -i 11704868

# 2. לפתוח שני טרמינלים, סטרים חי, אחד לכל גרסה — לפני הפעימה.
mapps code:logs -i <DRAFT_VERSION_ID> -t console -s live
mapps code:logs -i <LIVE_VERSION_ID>  -t console -s live

# 3. בטרמינל שלישי — פעימה יזומה.
mapps scheduler:run -a 11704868 -n digest-send
```

**מה לחפש:** שורת `cron_tick` (`{"tag":"scheduler","message":"cron_tick",…}`).
היא מופיעה בסטרים של **גרסה אחת בלבד** — זו הגרסה שה-cron מריץ. מ-0.14.0 יש
גם `tenant run finished` עם `durationMs`, שמאשרת שהקוד החדש הוא זה שרץ.

⚠️ **`-i` הוא app VERSION id ולא app id.** העברת `11704868` ל-`code:logs`
מחזירה סטרים ריק **בלי שגיאה** — נראה בדיוק כמו "לא היו לוגים", וזו הדרך
הקלה ביותר להסיק מסקנה הפוכה. נרשם ב-`references/cli.md`.

**אם `cron_tick` לא מופיע באף אחת מהן:** לוודא שה-timestamp של הפעימה בכלל
נכנס לחלון הסטרים, ואז לנסות `code:logs -i <version> -t http` — בקשה שנחסמה
לפני ה-handler תיראה שם ולא ב-console.

**התוצאה נכנסת לכאן.** כשהפלט חוזר: לרשום איזו גרסה, למחוק את הפריט מ-§7 —
ואם התשובה היא live, §7.2 הופך מ"סיכון צר" לחסימה: השליחה האוטומטית מריצה קוד
בלי ההגנה של §4 ובלי הדוח של §5.2 עד לשחרור ל-`main`.

### 7.2 ההגנה מפני כפילות עדיין לא בפרודקשן

היא קיימת בקוד ובטסטים, אבל מגיעה ל-draft רק במיזוג ל-`develop` ולפרודקשן
רק בשחרור ל-`main`. עד אז ה-job נושא 3 retries מול קוד ללא הגנה. הסיכון צר
(retry קורה רק על 500 או timeout — §3), אבל קיים.

### 7.3 האם 300 שניות מספיקות? (מכשור קיים, מדידה טרם נאספה)

השליחה **סדרתית**: שתי קריאות בורד ואז חיבור SMTP **לא-מאוגד** לכל נמען בלופ
`await` (`smtp-sender.js` פותח transport חדש לכל הודעה, בכוונה). כמה זמן זה
לוקח בפועל לא נמדד — **וקודם גם לא היה ניתן למדוד**: שום דבר בלוגים לא נשא זמן.

**מה נוסף ב-0.14.0:** `durationMs` פר טננט, בשני מקומות —
- שורת לוג `tenant run finished` עם `accountId`, `durationMs`, `recipients`;
- **בתשובת ה-tick עצמה**, כך ש-`mapps scheduler:run -a 11704868 -n digest-send`
  מדפיס את המספר מיד, בלי לחפש בלוגים.

המספר הוא פר טננט ולא לפעימה, כי כל השאר בפעימה הוא קריאת config מה-cache —
סכום הטננטים הוא בפועל הבקשה כולה, והפירוט אומר גם **איזה** טננט איטי.

**איך למדוד (בלי לשלוח לאף אחד):** בשעה שאף טננט אינו due, `scheduler:run` →
`durationMs` של ריצה שלא שלחה כלום = תקורת שתי קריאות הבורד. אחר כך לקרוא
`durationMs` מהריצות האמיתיות (`sendHour`) לאורך כמה ימים ולחלק ב-`recipients`
כדי לקבל שנייה-לנמען, שהיא המספר שמאפשר לחזות.

**כלל ההחלטה — לא לשנות כלום לפני שיש מספרים:**

| מדידה | פעולה |
|---|---|
| < 150 שניות | לא לגעת |
| 150–250 שניות | `mapps scheduler:update -a 11704868 -n digest-send -t 600` — שינוי הגדרה בלבד, בלי קוד |
| > 250 שניות, או שנייה-לנמען שגדלה עם מספר העובדים | שליחה מקבילית בקבוצות (למשל 5 במקביל) **בנוסף** להגדלת ה-timeout |

הערה: אחרי §4 חריגת timeout אינה אסון — ה-retry ממשיך מהמקום שבו נעצר — אבל
היא מעכבת את הדיג'סט, ובאמצע פעימה שנהרגה הדוח של §5.2 **לא נשלח** (הוא נשלח
בסוף), כך שריצה איטית קונה גם עיוורון לדוח.

### 7.4 ~~A missed hour is never caught up~~ — implemented in round348

Was: the comparison is to a **whole hour** (`sendHour !== hour`). A tick that
is delayed and crosses the hour boundary misses the tenant for the entire
day — no automatic catch-up, only a manual `resend-today`.

**Now:** an hour that has already passed today is a catch-up candidate —
every tick from that hour on retries the tenant, relying on the per-slot
marker (`skipAlreadySent`, `digest-run.js`) to avoid a double send. A tick
that already mailed everyone does not send again; a tick that died mid-run
(e.g. hitting the §7.3 timeout) completes only whoever has not received it
yet. The `due` flag (the audience for the operator summary + the CSV report)
changed accordingly: at the tenant's own scheduled hour it is always true
(even zero recipients is the normal reporting moment); on a catch-up hour it
is true **only** when something actually happened (`sent>0` or `failed>0`) —
otherwise every remaining hour of the day would re-report "nothing new,"
exactly the hourly noise §5.1 already fixed once, for a different reason.

**Cost:** a tenant already fully sent today is re-checked against the boards
every remaining hour — the same two-board-read overhead §7.3 measures for a
tick that sends nobody anything. Accepted overhead: there is no cheaper way
to know "nothing left to do" without asking.

Tests: `tests/scheduler-catchup.test.js`.

### 7.5 ~~קובץ סיכום פר עובד~~ — מיושם ב-0.14.0, ראה §5.2

### 7.6 `OPERATOR_EMAIL` — להשאיר לא מוגדר עד המיזוג

אחרי שתיקון §5 יגיע ל-draft/פרודקשן אפשר להגדיר אותו בלי רעש שעתי.

### 7.7 קשור אך לא של התיזמון

`change` על שדה טקסט בג'ימייל (מנעול ההערה, 0.13.0) עדיין לא אומת בשליחה
חיה. אינו נוגע לתיזמון, אבל נוגע לתוכן שהתיזמון שולח — ראה `CLAUDE.md`.

---

## 8. איפה הקוד

| קובץ | תפקיד |
|---|---|
| `src/routes/scheduler.js` | הנקודה, סינון השעה, שער סיכום המפעיל, שליחת הדוח, מדידת `durationMs` |
| `src/services/digest-run.js` | `runDigestForAccount` — הצינור המשותף + סימון ה-slot + `summaryRows` |
| `src/services/digest-service.js` | `buildDigest` — כולל `emptyRecipients` (עובדים בלי משימות) |
| `src/services/storage.js` | `getDigestSent` / `setDigestSent` (read/write through) |
| `src/helpers/operator-summary.js` | פורמט הסיכום הטקסטואלי (§5.1) |
| `src/helpers/digest-summary-report.js` | ה-CSV + הרכבת מייל הדוח (§5.2) |
| `src/helpers/mime-mixed.js` | `multipart/mixed` — העוטף שמאפשר צירוף קובץ |
| `tests/scheduler.test.js` | סינון השעה, דילוגים, שני המסלולים |
| `tests/scheduler-summary-gate.test.js` | מי נחשב due לצורך הסיכום |
| `tests/scheduler-summary-file.test.js` | מי מקבל את הדוח ומתי (§5.2) |
| `tests/scheduler-duration.test.js` | מדידת זמן הריצה (§7.3) |
| `tests/scheduler-catchup.test.js` | missed-hour catch-up, with no noise to the summary/report (§7.4) |
| `tests/digest-summary-report.test.js` | הבייטים של ה-CSV, ה-BOM, הנוסח |
| `tests/digest-summary-rows.test.js` | מאיפה המספרים — שורה לכל עובד |
| `tests/mime-mixed.test.js` | העוטף, כולל אלטרנטיב מקונן בייט-אחר-בייט |
| `tests/digest-run-idempotency.test.js` | סימון ה-slot: כפילות, המשכיות, opt-in |
