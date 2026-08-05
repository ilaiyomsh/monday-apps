# Changelog

## תיקון רישום ה-webhook — `change_status_column_value` דורש `columnValue` (3.15.2)

רישום עמודה אצל השומר (`POST /api/guard/enroll`) החזיר **502 לכל בעלים**, וכך גם
`/status` ו-`/bypasses`. הקונטיינר היה תקין (`/health` = 200); ה-502 היה בלוק ה-catch
של ה-handlers עצמם. האבחון החי הראה: SecureStorage תקין (הטוקן נשמר ונקרא), טוקן ה-OAuth
תקף (ה-`api.me()` בתוך ה-callback הצליח) — הכשל היה `monday API soft error thrown at the
funnel`, שגיאת GraphQL רכה בתוך תשובת 200.

השורש: `create_webhook` נקרא עם `event: change_status_column_value` ו-`config: {columnId}`
בלבד. האירוע הזה **דורש גם `columnValue`**; config עם `columnId` בלבד נדחה עם
`"This config for this event is invalid"` (`InvalidWebhookConfigException`). ה-funnel זורק
את השגיאה הרכה וה-handler מחזיר 502 — כלומר הרישום **מעולם לא עבד** (ללא קשר ל-OAuth,
להרשאות או לניתוב, שכולם תקינים). אומת אמפירית: `{columnId}` נדחה; `{columnId,
columnValue: {"$any$": true}}` מתקבל.

- **התיקון** (`monday-api.js` `createColumnWebhook`): `config` הפך ל-
  `{columnId, columnValue: {"$any$": true}}` — יורה על **כל** ערך חדש בעמודה, בדיוק מה
  שהשומר צריך (ואז מחליט לפי הכללים שלו). נשמר אותו אירוע `change_status_column_value`,
  כך שמבנה ה-payload שה-handler מפענח (`value.label.index`) לא משתנה.
- **הטסט חוזק**: הטסט הקודם בדק רק שה-config מכיל `"columnId"` ולכן פספס את החוסר;
  עכשיו הוא מאמת `config.columnValue === {"$any$": true}` (נכשל על הקוד הישן).

**תצפית (אותה גרסה):** הדיבוג של הבאג לעיל נחסם כי `mapps code:logs` מרנדר רק את שדה
`message` ומשמיט את `context` — כך שכל `catch` שהתעד `logger.error('X failed', TAG,
{error})` הראה רק `X failed` בלי הסיבה. תוקן בשלושה מישורים:

- **שרבוב הסיבה ל-`message`**: כשלים ב-enroll/status/bypasses/webhook-dispatch, ב-handler
  שינוי-הסטטוס, וב-oauth callback מצרפים עכשיו את מחרוזת השגיאה ל-message עצמו (ה-context
  נשמר לשילוח Axiom).
- **עקבות לתהליך שינוי-הסטטוס**: שורת `webhook received …` בכניסה ל-guard, ושורת
  `status change ALLOWED/BLOCKED (reason) …` אחרי ההערכה — כך שינוי-סטטוס עוקב שורה-אחר-שורה.
- **סינון רעש ה-SDK**: `installSdkLogFilter()` (helpers/sdk-log-filter.js) משתיק את שורות
  `[SecureStorage]/[Storage.get] Got data for key` של apps-sdk 0.1.4 (5-8 לכל בקשה, ללא
  כיבוי דרך env, וגם דלף מפתחות storage); error/warn לא מושפעים.

## 3.15.1 — מועמד הפיתוח הבא אחרי שחרור 3.15.0 ללייב

אין שינוי מוצרי. 3.15.0 שוחררה ללייב (PR #623), ולכן develop מקדם את המספר למועמד
הבא — כפי ש-corridor-guard דורש (גרסת develop חייבת לשבת מעל main). בנוסף, תיקון
שורת JSDoc אחת שנעשה על ענף השחרור: ה-`@returns` של `enrollColumnGuard` לא כלל את
`'not_board_owner'` שנוסף ב-round330.

## round330 — חיווי רישום ה-webhook במסך ההגדרות + כפתור רישום ידני (3.15.0)

עד כה לא היה שום מקום במסך שאומר אם העמודה **באמת** רשומה אצל השומר — והרישום הוא
מה שמכריע אם משהו מזה עובד בכלל: בלי webhook אין החזרה, וגם אין רישום עקיפה בניטור.
`/api/guard/status` כבר החזיר `enrolled` לכל עמודה; הקליינט פשוט זרק אותו.

- **שורת מצב הרישום** (מוצגת לכל בעלים שפותח את ההגדרות, ללא תלות במתג ההחזרה
  האוטומטית — כי בלי webhook גם המעקב לא רואה כלום). שלושה מצבים, והשלישי נחוץ:
  `רשומה ✓` / `אינה רשומה` / `לא ידוע` — כשהשומר לא ענה זה **לא** "אינה רשומה",
  ולא נציג התראה על בעיה שאולי אינה קיימת.
- **כפתור "רישום השומר על העמודה"** — רושם את ה-webhook בלי לשמור מחדש את כל הטופס,
  ומרענן את השורה כדי שהמצב יתהפך מול העיניים. מוצג רק כשהעמודה **אינה** רשומה, כך
  שלחיצה לא יכולה להוסיף webhook שני לאותה עמודה, ומוגן מפני לחיצה כפולה.
  זה גם הכלי לתקן עמודות שנשמרו לפני round329 ולכן אין להן webhook.
- **403 קיבל סטטוס משלו** (`not_board_owner`): יצירת webhook ללוח היא זכות של **בעלי
  הלוח**, ובעל עמודה אינו בהכרח אחד מהם. ההודעה אומרת את זה במקום "נסו שוב" — ניסיון
  חוזר לא מתקן הרשאה.

**מוגבלות מכוונת:** `enrolled` אומר "השומר מחזיק מזהה webhook לעמודה", לא "ה-webhook
קיים כרגע אצל monday". אימות מול monday דורש סקופ `webhooks:read` — הוספת סקופ מחייבת
עדכון ב-Developer Center ואישור מחדש של כל בעלים שכבר אישר, ולכן לא נכנסה כאן.

## round329 — ה-webhook לא נוצר אף פעם: הרישום נהרג בסגירת מסך ההגדרות

הסבר לתקלת "אישרתי, חיברתי חשבון, שמרתי — ולא נוצר webhook": רישום העמודה נשלח
**fire-and-forget** (`void enrollColumnGuard(...)`) ומיד אחריו נסגר המסך
(`closeDialog`). אבל `enrollColumnGuard` חייב קודם לבקש `sessionToken` מ-monday —
הלוך-חזור של postMessage לחלון האב — וסגירת המסך הורסת את ה-iframe לפני שה-POST
נשלח בכלל. כלומר: השמירה הצליחה, הודעת "ההגדרות נשמרו" הוצגה, ו**אף עמודה לא
נרשמה** אצל השומר. שום דבר במסך לא גילה את זה — גם לא כשהשרת היה עונה 409/403.

- **הרישום מסתיים לפני הסגירה**: `handleSave` ממתין ל-`enrollColumnGuard` ורק אז
  סוגר. הפונקציה טוטאלית (מחזירה סטטוס, לא זורקת), כך שההמתנה לא יכולה להפיל שמירה.
- **ההמתנה חסומה בזמן** (`timeoutMs`, ברירת מחדל 8 שניות, עם `AbortController`):
  שומר שלא עונה עולה השהיה קצרה — לא מסך הגדרות שאי אפשר לסגור.
- **`keepalive: true`** על הבקשה: אם המסך נסגר בכל זאת תוך כדי, הדפדפן מסיים את
  הבקשה במקום להרוג אותה.
- **כשל רישום נאמר למשתמש**: `not_activated` ו-`failed` מציגים הודעת שגיאה בעברית
  ליד "ההגדרות נשמרו" — המתג במסך מבטיח שהעמודה מוגנת, ולכן החמצה שקטה היא שקר.
  עכשיו גם 403 (`not_board_owner`) ו-502 מהצד של monday נראים למשתמש במקום להיעלם.

**לאחר העלייה**: יש להיכנס להגדרות העמודה ולשמור פעם אחת — הרישום מתבצע בשמירה.

## round328 — אישור ה-OAuth ננעל לחשבון ולמשתמש שלחצו (דפדפן מרובה-חשבונות)

הסבר לתקלת "מאשר ושוב דורש חיבור, ואין החזרות": מסך האישור של monday
(`auth.monday.com`) רץ על **החשבון הפעיל בדפדפן** — משתמש עם כמה חשבונות monday
אישר בשקט על החשבון הלא-נכון. הטוקן נשמר תחת הזהות הזרה, דף "חובר בהצלחה" הוצג,
אבל שורת החיבור לעולם לא התהפכה וכל החזרה דולגה. שתי הגנות:
- **נעילת חשבון**: `/oauth/start` מפנה ל-`<slug>.monday.com/oauth2/authorize`
  (ה-slug מגיע מתוך ה-sessionToken החתום; צורת slug בלבד — מוגן מהזרקת hostname),
  כך שהאישור נכפה על חשבון מסך ההגדרות.
- **אימות זהות ב-callback**: אם המאשר בפועל (`me`) אינו המשתמש שלחץ על החיבור —
  הטוקן **לא נשמר**, ומוצג דף שגיאה בעברית שמסביר לעבור לחשבון הנכון ולנסות שוב.
  בלי זה, טוקן של חשבון זר היה הופך ל-reader של החשבון ומצביע על לוחות זרים.

- **שורת האישור/"חיבור מחדש" מוצגת רק לבעלים הראשי** של העמודה (בקשת בעלים):
  ההחזרות נכתבות בזהותו, כך שהאישור הוא שלו בלבד — בעלים אחר שהיה מאשר לא היה
  מפעיל את ההחזרות של העמודה הזו, רק מטעה. גם הפתיחה האוטומטית של לשונית ה-OAuth
  בהדלקת המתג מוגבלת עכשיו לבעלים הראשי.
- **אות החיבור מדויק**: `/api/guard/status` מחזיר עכשיו `primaryAuthorized` —
  האם **הבעלים הראשי של העמודה** מחזיק טוקן — במקום להסתפק ב-`activated`
  שהוא ברמת החשבון (יכול להיות true בזכות בעלים אחר, בעוד שכל החזרה בעמודה
  הזו מדולגת). tri-state: true/false/null (לא ניתן לדעת — עמודה בלי בעלים עדיין),
  והלקוח נופל ל-`activated` רק במקרה ה-null.
- **תיקון מהסקירה (Codex P2):** השורה מוצגת רק כשהבעלים הראשי **בטיוטה** הוא
  המשתמש הנוכחי — והכתרה עצמית בטיוטה עוד לא נשמרה, כך שאות הבעלים-השמור מתיישן
  ברגע ההכתרה. השרת מחזיר לכן גם `meAuthorized` ("האם המבקש עצמו מאושר" —
  שאלה שאינה תלויה בעמודה), והשורה קוראת `meAuthorized ?? primaryAuthorized ??
  activated`.

## round326 — מתג אחד: "שמירה אוטומטית על העמודה" (חיבור + החזרה בלחיצה)

איחוד חוויית ההפעלה למתג יחיד, כדי שבעל עמודה יפעיל שמירה בשתי לחיצות בתוך
האפליקציה בלבד — בלי לשוטט במסכי monday. הדלקת המתג:
- מדליקה `autoRevert` (נשמר עם ההגדרות, ורישום ה-webhook קורה בשמירה כמו קודם);
- אם החשבון עדיין לא אישר OAuth — פותחת מיד את אישור הבעלים החד-פעמי;
- מציגה מצב חיבור חי ("מחובר ✓" מול "דרוש אישור") דרך `services/guardStatus.js`
  (endpoint `/api/guard/status`), עם רענון ב-focus כדי שהחזרה מלשונית האישור
  תעדכן את התצוגה בלי טעינה מחדש. קישור "חיבור מחדש" נשאר למקרה של החלפת בעלים ראשי.

הכפתור הנפרד של round325 הוחלף במתג המאוחד הזה. **תזכורת:** הגדרת ה-OAuth ברמת
האפליקציה (New OAuth Flow + Redirect + env) נשארת חד-פעמית ב-Developer Center —
זה מה שהופך את חוויית בעל-העמודה ל"מתג אחד" לכל שאר הזמן.

## round325 — כפתור חיבור הגרד בתוך ההגדרות (הפעלת OAuth)

עד עכשיו הפעלת ה-OAuth של הגרד (שנדרשת כדי שהחזרות ייכתבו על שם הבעלים) לא הייתה
נגישה מתוך האפליקציה — הבעלים היה צריך לפתוח `<BASE_URL>/oauth/start?st=<sessionToken>`
ידנית. נוסף כפתור **"חיבור הגרד (אישור בעלים)"** במסך ההגדרות, ליד "החזרה אוטומטית".
- שירות חדש `services/guardAuthorize.js` (במתכונת `guardEnroll`): משיג sessionToken
  דרך ה-SDK, בונה את הכתובת היחסית `/oauth/start?st=…` (same-origin) ופותח לשונית
  חדשה. מחזיר סטטוס לכל תוצאה, לעולם לא זורק. חלון קופץ חסום → הודעה למשתמש.
- שימוש ב-`window.open` (ולא `openLinkInNewTab` של monday) בכוונה: ב-same-origin
  הכתובת יחסית וחייבת להיפתר מול origin של ה-iframe (הגרד), לא מול monday.com.

## round324 — איחוד same-origin (שרת מגיש את ה-SPA)

שינוי ארכיטקטוני, ללא שינוי בהתנהגות שרואה המשתמש: **שרת ה-monday-code מגיש עכשיו
בעצמו את ה-SPA** (`server/public`), אותו origin עם `/api/guard/*` ו-`/oauth/*`.
- ה-client קורא לגרד בנתיבים **יחסיים** — `VITE_TWYST_GUARD_URL` וה-secret המקביל
  ב-GitHub נמחקו לגמרי, וה-CORS בשרת הוסר (מיותר ב-same-origin). לוגיקת הבסיס
  מרוכזת ב-`services/guardBase.js`: ברירת מחדל `''` (יחסי), ורק תחת דגל ה-mock של
  ה-dev-harness (`VITE_MONDAY_MOCK`) הגרד מדולג.
- הפריסה אוחדה ל**דחיפת שרת אחת** (`deploy-{draft,live}-twyst-your-status`, ללא
  `-c`): ה-CI בונה את ה-SPA, מעתיק ל-`server/public`, מפשיט sourcemaps, ודוחף את
  השרת (שנושא את ה-bundle וגם את ה-SPA). ה-workflows הנפרדים של `twyst-guard` הוסרו.
- שלב בעלים חדש בהפעלה: הפניית משטחי עמודת הסטטוס (`/picker`, `/settings`,
  `/settings-full`) לכתובת ה-monday-code (ראה `docs/GUARD-ACTIVATION.md`). חיתוך
  מתואם עם מיזוג ה-PR.

## Guard 1.1.0 — הקשחת שרת (round323 review)

עקב סקירת קוד (Codex P1) — שינויי שרת בלבד, ללא שינוי משטח לקוח (גרסת הלקוח נשארת 3.14.0):
- **OAuth 2.1 (New OAuth Flow) לשומר**: מעבר מזרימת authorization-code קלאסית ל-PKCE
  S256 מול נקודת הקצה `oauth_ms/oauth/token`. טוקני גישה פגים; refresh חד-פעמי
  ומתחלף; רענון אוטומטי single-flight ששומר את ה-refresh המחודש; `invalid_grant`
  מסמן `reauth_required`. הקורא (`:token:default`) הפך ל**מצביע** לבעלים במקום עותק,
  כדי ששני עותקים של אותו grant לא ישרפו את ה-refresh המתחלף (P1-D).
- **שילוח שגיאות ל-Axiom מהשומר** (error-kit): logger מודע-sink, עותקים מוטמעים של
  `axiomServerSink` ו-`process-guards` (זהים לתבנית הבין-אפליקטיבית, ננעלים ע"י
  `drift.test.ts`), מידלוור שגיאה טרמינלי 4-ארגומנטים, ורישום ב-SURFACES של
  `error-wiring-audit`. גדור על `AXIOM_*` (fail-soft) ושולח WARN/ERROR בלבד (P1-E).
- קריאות לוח משתמשות בטוקן הבעלים הראשי (P1-C, כבר נכלל).

## 3.14.0

- **ניטור עקיפות במסך ההגדרות** (בקשת בעלים, round323): אזור לבעלי העמודה שמראה
  כמה פעמים מישהו קבע לייבל בדרך שההגדרות לא מתירות (עורך נייטיבי בטעינת הלוח /
  מובייל, או API). מספר גדול לפי תקופה — **השבוע (ברירת מחדל, השבוע הנוכחי)**,
  החודש, השנה, או טווח תאריכים — עם מגמה מול התקופה הקודמת ופילוח מקור.
- **פירוט לכל אירוע**: לחיצה פותחת מתי, איזה אייטם, מי שינה, מעבר הלייבל, והסבר
  טכני בשני חלקים — "איך זה עקף" (עורך נייטיבי מול API — ביושר, ה-webhook אינו
  מבחין בין מובייל לחלון הטעינה) ו"למה זה מנוגד להגדרות" (לייבל מוסתר, מעבר לא
  מותר עם רשימת המותרים, אין הרשאה, שער עמודת אנשים, או שדות חובה ריקים).
- **החזרה אוטומטית הפכה להגדרה שמפעילים** (ברירת מחדל: מעקב בלבד): כל עקיפה
  **נרשמת תמיד** בשרת; היא מוחזרת רק כשהטוגל "החזרה אוטומטית" דלוק בהגדרות
  העמודה. כך הבעלים מחליט על סמך המספרים אם להפעיל, וגם עקיפות שלא הוחזרו מנוטרות
  ומאפשרות תיקון.
- שרת: יומן עקיפות מדורג פר-עמודה (append סריאלי, capped) + endpoint שאילתה לפי
  טווח עם הרשאת בעל-עמודה; הרשומה נושאת id-ים + סיווג ההפרה, והמסך מרנדר את הטקסט
  והשמות בצד לקוח. תיוג המקור ישר: `app` של ה-webhook מבחין API מנייטיבי בלבד.
- מודולים טהורים תחת test-guard: `reportingPeriod` (חישוב תקופות), `bypassReason`
  (סיווג ההפרה + תיאור + הערכת מקור), `bypassMonitor` (שליפה), `bypassLog` (יומן).

## 3.13.0

- **בעלי עמודה (owners) במסך ההגדרות** (בקשת בעלים, round322): לכל עמודה רשימת
  בעלים משלה. פותח העמודה הופך אוטומטית לבעלים הראשון ולבעלים הראשי; בעלים יכולים
  לצרף/להסיר בעלים ולהעביר את תפקיד הבעלים הראשי. **שאר המשתמשים אינם נחשפים
  להגדרות העמודה כלל** — במקום הכפתור הם רואים "רק בעלי העמודה יכולים לנהל את
  ההגדרות". עמודה שטרם אומצה (בלוב ישן) נופלת לשער בעלי-הלוח הישן, וההגדרה הראשונה
  מאמצת את המבצע. אחסון `owners` נשמר לצד הכללים ונשא רק כשהוא קיים (בלובים ישנים
  שומרים על צורתם).
- **הבעלים הראשי הוא זהות הביטול**: השומר (למטה) כותב את החזרת השינוי הלא-חוקי על
  שם הבעלים הראשי — כי monday רושמת כל כתיבה על שם בעל הטוקן. אין זהות-שירות/בוט
  נפרד: הבעלים הראשי מאשר פעם אחת (OAuth של עצמו). לא אישר → אין החזרה, נרשמת אזהרה
  (fail-open, וגם כדי לא לשבור את הגנת הלולאה).

- **השומר (Guard) — רכיב שרת ראשון לאפליקציה** (בקשת בעלים, round322): שרת
  monday-code של אותו App ID שמאמת **כל** שינוי בעמודה מנוהלת — מכל משטח, כולל
  חלון הטעינה הקרה שבו העמודה מתנהגת כעמודת סטטוס רגילה (הבעיה שדווחה בווידאו),
  מובייל, קנבן, כרטיס פריט ו-API — ומחזיר שינוי לא חוקי לערכו הקודם תוך שניות,
  עם הודעה למבצע בנוסח הבעלים: "השינוי שבוצע בוטל - מכיוון שאינו עומד בהגדרות
  העמודה".
- **מקור אמת אחד לכללים**: ה-bundle של השרת (esbuild) מטמיע את מודולי
  `src/domain/` של ה-client עצמם — הרשאות משתמש/צוות, לייבלים מוסתרים, שער
  עמודות אנשים, חוקי מעברים כולל זהות ריק≡5, ורגיסטרי שדות החובה (ריקנות לפי
  טיפוס: checkbox לא מסומן = ריק, סטטוס 0 = מלא). אין עותק כללים שני.
- **שדות חובה נאכפים גם בעקיפה**: שינוי ללייבל שדורש שדות נבדק מול ערכי הפריט
  בפועל; שדה ריק ⇒ החזרה. כשל קריאה שלנו לעולם לא מחזיר שינוי (fail-soft).
- בטיחות תפעולית: loop-guard (השומר לא שופט את ההחזרות של עצמו), הגנת staleness
  (החזרה רק כשהתא עדיין מחזיק את הערך הפסול), סריאליזציה פר-פריט, אימות JWT על
  משלוחי webhook (fail-closed), ו-endpoint רישום אידמפוטנטי שמאמת בעלות-לוח
  בצד השרת.
- שמירת הגדרות רושמת את העמודה לשומר אוטומטית (best-effort, לעולם לא מכשילה
  שמירה); ללא `VITE_TWYST_GUARD_URL` ההרשמה כבויה לגמרי.
- הפעלה חד-פעמית: OAuth של משתמש-שירות (ההחזרות נכתבות על שמו; כל שאר הפעילות
  נשארת על שם המשתמשים עצמם — זו הייתה דרישת הבעלים). צעדים:
  `docs/GUARD-ACTIVATION.md`; תיעוד ההחלטה: `docs/BYPASS-PROOF-DECISION.md`.

## 3.12.0

- **מעברים בין לייבלים** (בקשת בעלים, round321): לכל לייבל אפשר לקבוע אילו לייבלים
  יוצעו בבורר אחריו — ואילו לא יוצגו כלל. הכלל נשמר כ-`nextLabelIds` על חוקת
  הלייבל הקיימת: בלי השדה = ללא הגבלה (כל blob שנשמר לפני הסבב קורא כך), רשימה =
  רק אלה, רשימה ריקה = סטטוס סופי ששום דבר לא בא אחריו.
- **גם המצב הריק הוא מקור מעבר.** פריט שהסטטוס שלו מעולם לא נקבע נשלט על ידי
  הכלל של לייבל ברירת המחדל (id 5 השמור) — הכרטיס האפור שכבר תמיד מוצג במסך
  (round313) — כך שאפשר לקבוע גם מה מותר לבחור *ראשון*. פריט שמחזיק את הלייבל
  האפור במפורש פוגש את אותו כלל, בכוונה: שניהם נראים אותו דבר על הלוח.
- ההגבלה מצטרפת לסינונים הקיימים ואינה מחליפה אותם: לייבל מוסתר נשאר מוסתר,
  ומשתמש מחוץ ל-allowlist נשאר חסום, גם אם הלייבל מופיע ברשימת המעברים.
- מחיקת לייבל גוררת אותו החוצה מכל רשימות המעברים בשמירה הבאה; כלל ה-id-5 נשמר
  תמיד, גם כשהלייבל האפור מעולם לא נוצר בפועל.
- **סקירה אדוורסרית (22 סוכנים) רצה על הסבב לפני המיזוג** וזיקקה את הפיצ'ר:
  - הזהות "ריק ≡ הלייבל האפור" הושלמה גם בצד ההיצע: סטטוס ריק לא מציע את לייבל
    id 5 (הוא כבר "נמצא" שם) — קודם הלייבל האפור הוצע מתאים ריקים ונעלם בשקט
    ברגע שהוגדרה הגבלה כלשהי על כרטיס ברירת המחדל, בלי שום צ'קבוקס שיחזיר אותו.
  - קיומו של לייבל ברירת המחדל כיעד־מעבר נגזר מהעמודה החיה ולא משם הטיוטה:
    לייבל id 5 שהטקסט שלו נוקה (round313) הוא עדיין לייבל אמיתי שהבורר מציע,
    והוא מוצג ברשימות היעדים כ"ברירת מחדל".
  - הגבלה שכל היעדים שלה נמחקו מהעמודה חוזרת ל"ללא הגבלה" במקום להפוך בשקט
    לסטטוס סופי; רשימה ריקה מפורשת נשארת סופית. יעד `5` פאנטומי (ברירת מחדל
    שנקראה בשם ונוקתה באותו ביקור) נגרר החוצה בשמירה.
  - עמודה עם לייבל יחיד: הגבלה שמורה בלי יעדים נראים קיבלה כפתור "ביטול ההגבלה".
  - נגישות: הטקסטים העמומים הוכהו לעמידה ב-AA ‏(4.5:1) על כל הרקעים שלהם, טקסט
    התגיות הכחולות קיבל מדרגה כהה משלו, ה-accent הכהה נדרס ב-dark theme, גבול
    hover של הבורר עבר לטוקן, וחץ ה-disclosure הסגור מצביע שמאלה — מוסכמת RTL.
- **עיצוב מחודש למסך ההגדרות** (בקשת בעלים): כותרת עם תת-כותרת, שורת מדור
  "לייבלים" עם מונה, כפתורי אייקון (חצים/פח) במקום גליפי טקסט, צ'יפים שקטים
  שמסכמים את מצב הכרטיס בלי לפתוח אותו, פאנל תצורה מקובץ עם כותרות מדור,
  ורשימת מעברים עם נקודות צבע של הלייבלים. מערכת טוקנים אחת (צבע/רדיוס/טקסט)
  מזינה את כל המסך, כולל התאמות dark-theme.

## 3.11.1

- **The picker no longer explains that the current status was set outside it** (owner
  request). The sentence "הסטטוס הנוכחי נקבע מחוץ לבורר (למשל אוטומציה) ואינו מוצג
  לבחירה" is gone. It appeared whenever the status the item already holds is one the
  admin hid — and it described a state the user cannot act on, in a dialog whose height
  is computed from the pills alone (`pickerDialogHeightPx` counts option/gap/padding and
  nothing for prose), so it was taking the last pill's space to say it.
- The view-only note is untouched, and `buildAvailableLabels` still reports
  `currentIsHidden` — nothing renders from it now.

## 3.11.0

- **The text of the default (grey) label is now editable here**, like it is in a normal
  status column's settings (owner request). Its card is always in the list, at the bottom
  where monday shows it, with no colour picker and no remove button: the platform forces
  the colour to grey `#c4c4c4` whatever enum is sent, and a label in that slot can never
  be deleted afterwards. Two controls that would lie are two controls we do not draw.
- **An empty default label is never written.** monday does not create it until it is
  given a name — a fresh status column comes back with its four labels and no id 5 — so
  the row the settings screen shows is synthesised, and a save that leaves it untouched
  sends nothing. Otherwise merely opening the settings would hand the admin the one label
  on the column that cannot be removed. Type a name and it is created (`color: explosive`,
  no id — monday derives id 5 from the colour); clear the name on a label that already
  exists and it is written as `label: ""`, which the platform keeps with its id intact.
- The empty-name validation now applies to coloured labels only, `explosive` is reserved
  out of every other label's colour picker, and the grey card is pinned to the bottom of
  the list — the arrows neither move it nor move a coloured label past it.
- All of it goes through the same `update_status_column` the app already used; no new
  API path. Behaviour verified against the live API in the sandbox workspace (2026-07):
  same id and hex across a rename, `id: 5` intact after clearing to `""`.

## 3.10.1

- **Breathing room between monday's close button and the required-fields title** (owner
  request). The X is drawn by monday inside the box it hands us, and our `עמודות חובה`
  heading sat directly beneath it, so the two read as one crowded row. The heading now
  clears it by 16px — 36px from the top of the modal instead of 20.
- The gap is bought in the modal's requested height, not just styled. This modal is sized
  to the pixel, so pushing the heading down without paying for the space would have taken
  it from the field list — the one box here allowed to scroll — answering a spacing request
  by making the form scroll. `FORM_HEADER_TOP_PX` is counted in `requiredFormModalSize`
  and mirrored by the stylesheet rule, the same contract every other constant in that
  module follows.

## 3.10.0

Owner-reported: a new label showed one colour in settings, a different one on the board,
and a third on the next visit. Probing that on a live column turned up three defects
behind it, all of the same family as 3.9.1 — invisible state on the column that the
settings screen cannot show.

- **A new label's `id` is derived by monday from its COLOUR, and a taken id rejects the
  whole mutation.** `purple`(4) becomes label id 4; if id 4 already exists — including as
  a deactivated row nobody can see — `update_status_column` fails with
  `INVALID_ARGUMENT_EXCEPTION` / "request to change default status label color", a message
  that names neither the colour nor the id. Verified live with five discriminating probes:
  `blackish`(10) landing on id 10 rather than the next free id 6 is what settles it.
- **That made "add a label" fail on any column where a label had ever been removed.**
  Removing a label frees its COLOUR while its ID stays taken forever, so the old
  lowest-free-colour picker reached for exactly the colour that would collide. On a default
  column (ids 0,1,2) removing any label broke the next add, every time — and removing one
  and adding one in the same visit failed too. Colour choice is now an identity decision:
  `pickColorForNewLabel` requires the colour to be free AND its numeric id to be free as a
  label id.
- **`id 5` is monday's reserved slot for the default empty label** and is now excluded. A
  label created there is forced grey `#c4c4c4` and can never be deleted afterwards
  ("Unable to delete a label already in use", with no item referencing it). This is the
  direct cause of the report: the picker landed on `explosive`(5), monday stored id 5 as
  grey, and settings then re-derived the swatch from colour index 5 and drew it orange.
- **Labels are created when the button is clicked, not when settings are saved.** monday
  decides the id and can override the colour, so no locally invented row can be trusted:
  the click now does the round trip behind a busy button and the card is rendered from the
  response. The swatch shows the hex monday STORED rather than one re-derived from the
  colour enum, which is the other half of the same bug. Note the behaviour change —
  the label exists from the click, so Cancel no longer un-creates it.
- **Every labels save was silently clearing the column's "Done" designation.** The payload
  omitted `is_done` and `description`, and the labels array is a full replace, so anything
  left out is cleared — `done_colors` was observed going from `[1]` to `[]` after renaming
  an unrelated label. Both now round trip through read → draft → payload → mutation.
- **3.9.0's client-key remap is gone.** With a real monday id present before the
  permissions accordion is ever opened, `resolveNewLabelIds` and `remapDraftLabelKeys` had
  nothing left to do — along with the error path for rules that could not be re-keyed. The
  requirement they served, configuring a brand-new label without leaving the screen, is
  unchanged and still pinned.
- Also recorded while probing: omitting a label from the array is a DELETE (refused with
  "Unable to delete a label already in use" — where "in use" is broader than any item's
  current value), and deactivated rows CAN be deleted that way. See the `monday-api`
  skill's `column-formats.md`.
- Tests: 3 new suites (33 cases) covering the colour/id rule, the `is_done`/`description`
  round trip and the create-on-click flow, each observed failing first; 10 mutation
  spot-checks, all killed. The fixed path was then run end-to-end against a live column.

## 3.9.1

- **Adding a label failed with `INVALID_INPUT` / "Indexes should be unique"** — reported
  from production on the first attempt to use 3.9.0's new-label flow. Not a fault in that
  flow: `update_status_column` replaces the FULL labels array, deactivated rows included,
  and the index assignment could hand the same number to two of them. The payload now
  numbers the whole array as ONE unique space — active labels 0..n-1 in the order the
  admin arranged, deactivated rows packed above them.
- **It needed only a label that had been removed at some point in the past, and there were
  two ways in.** A new label took `max(active index) + 1`, which is exactly the index of a
  deactivated row sitting above every active one — i.e. whenever the label removed last was
  the last in the list (the reported case: the payload went out as `[0, 1, 2, 2, 3]`). And
  a reorder renumbered the actives to 0..n-1, colliding with a deactivated row inside that
  range — any removed MIDDLE label (`[0, 1, 2, 1]`). The second path has been live since
  labels became editable in settings; nothing exercised it until now.
- Rewriting a deactivated row's index is safe, which is what makes the fix this cheap: the
  `index` field is display order only, and a status CELL references its label by **id**
  (`{"index": <labelId>}` is monday's naming quirk, not a position).
- **The test suite was pinning the bug.** The `buildStatusLabelsUpdatePayload` expectation
  asserted `index: 2` on both a new active label and a deactivated one — a payload monday
  rejects. Corrected, and both collision paths now have their own test against the actual
  index numbers (uniqueness alone would also pass on a payload that quietly reshuffled the
  admin's order), plus an end-to-end pin through the settings save on a column that carries
  a removed label.
- The settings screen renumbers its draft with the same rule before saving, so the draft
  holds the indexes that were actually sent — `resolveNewLabelIds` matches a new label to
  its assigned id by text AND index, and a draft still holding `max + 1` would quietly
  degrade that to a text-only match.

## 3.9.0

Three owner-reported items from the live 3.8.0 app.

- **A label created in settings can now be opened and configured in the same visit.**
  The permissions accordion was rendered only for labels that already had a monday id
  — `showPermissions={!label.isNew}` — because the settings are keyed BY that id and a
  new label has none until `update_status_column` has run. So restricting a new label
  took two visits (save, re-open, configure), and nothing on the card said why it had
  an identity row and nothing else. The accordion is now there from the moment the
  label is added: its rules are held under the draft's client key (`new:1`) and moved
  onto the id monday assigns, in the same save.
- The re-key never GUESSES. Candidates are what the post-mutation refresh has that the
  pre-mutation labels did not (a set difference, so a pre-existing label can never be
  claimed), matched on the two things we sent — the label text and the index. A draft
  that matches neither stays unresolved, because attaching one status's permissions to
  another is worse than losing them: the rules are then dropped by the prune and the
  screen says so (`הלייבל נוצר, אך ההרשאות של הלייבל החדש לא נשמרו`) instead of closing
  on configuration that went nowhere.
- **Fixed a duplicate-label hazard the new flow would have made easy to hit.** After the
  labels mutation, the label draft is re-seeded from the refresh. It was not, so any
  save that failed AFTER the mutation (a storage error, the unsupported-column check)
  left the new labels still marked `isNew` — and the retry created them a second time.
  Pre-existing, reachable in 3.8.0 by hitting a validation error, now pinned by a test.
- **The required-fields form is 25% wider (526 → 658px), and every added pixel went to
  the column names.** The control column keeps its 320px — the fields themselves must
  not change — so the label column went 150 → 282px, where a longer Hebrew column title
  used to be ellipsised after roughly a dozen characters. The row grid takes that width
  from the same constant the modal is sized with (passed down as a custom property)
  rather than the stylesheet holding a second copy of the number: with a hard-coded
  `150px` the modal would have opened wider with the labels still laid out narrow.
- **The modal's X could not be moved to the left, and that is a platform limit, not a
  decision.** monday draws the modal chrome itself; `openAppFeatureModal` takes only
  `url`/`urlPath`/`urlParams`/`width`/`height` (monday-sdk-js 0.5.9), and the X lives in
  monday's DOM outside our iframe. The only alternative — drawing our own X inside the
  form — leaves monday's in place too, so on the owner's call nothing was added.
  Recorded in the mapps skill's `references/known-issues.md`.
- **Neither surface closes until the status has actually changed.** Awaiting the write
  before closing has been the behaviour since 3.6.1; what is new is that "the request
  came back" is no longer accepted as "the status changed". Both mutations now echo the
  status column back (`StatusValue.index` carries the label id), and the echo is checked
  before the picker or the form closes: a different label, or `change_column_value: null`
  inside a 200 with no `errors`, keeps the surface open and shows the failure. The fill
  form's save button also carries a spinner now — it stays open for the whole round trip,
  and a disabled button with only its text changed reads as a click that did nothing.
- An unreadable echo is deliberately NOT a failure. If an API version stops returning the
  fragment, treating absence as a mismatch would put an error on every successful
  transition in the app; the mutation returning without errors is monday's own answer and
  it is kept (and logged).

## 3.8.0

- **A warm picker open now costs ONE monday round trip instead of two, and no longer
  flashes.** The second round trip was not a redundant fetch someone forgot to remove —
  it was `migrateSettings` building a fresh object on every storage read. The
  stale-while-revalidate read that confirmed *nothing had changed* still handed down a
  new object identity, `OnClickDialog` keys its board fetch on that object, so the whole
  `Promise.all` ran again. And because the boot overlay is released the moment the first
  result paints, the dialog went **blank for the length of the second round trip** before
  repainting the exact same pills. That flash was shipped behaviour, on the most common
  interaction in the app. The hook now compares content before publishing.
- **The board request no longer waits for the storage read.** It was gated on
  `if (settingsLoading) return`, so every open paid storage-then-network in series. It
  never had to: the request asks for `[the status column, ...people columns named by a
  gate]`, settings can only ever *widen* that set, and the settings hook seeds from its
  local cache synchronously during the first render — so on a warm open the gate columns
  are already known before the first `await`. The fetch is now keyed on the column set, so
  widening it re-issues the request instead of silently asking for too little.
- **An unconfigured column stopped sleeping for a second.** `monday.storage` transiently
  answers `success:true` + `value:null` for a key that *is* populated, so a single null
  read cannot be trusted — and both `mondayService` and `useColumnSettings` were retrying
  it. Stacked, that cost **4 storage reads and 1050 ms** to conclude "nobody configured
  this column", on every open, since an unconfigured column is never cached. The retry now
  has one owner: **2 reads, 350 ms**. `apps/team-people-column`, which this app was copied
  from, has always done it that way; twyst grew the second retry and kept the copied one.
- **`@vibe/core` left the picker's critical chunk: 114.06 kB → 66.16 kB gzip (−42%)**
  (raw 377.23 → 203.06 kB), re-parsed on every iframe boot. Three imports held the whole
  `Button → Tooltip → Dialog → popper` and `Icon → react-inlinesvg` chain, for components
  a successful open never renders — and one of them, an `AttentionBox` in `OnClickDialog`,
  sat after an early `return` on the same condition and could never render at all. Vibe is
  now its own chunk (47.66 kB gzip) fetched only by the lazy settings and required-fields
  routes. Measured by sourcemap attribution on a real `vite build`, not estimated: zero
  `@vibe/core` sources in the eager chunk.
- Measured request counts on a real picker open, not reasoned about: **4 GraphQL calls → 1**
  on a warm open, and **4 `storage.getItem` → 2** on an unconfigured column. The one
  regression is the first open of a *gated* column on a cold cache — two requests instead
  of one, same wall clock, because the gate columns are only known once storage answers.
- Wrong theory this replaces: the latency was read as "too many separate requests, fix it
  by prefetching on the board page and batching every item". There is nowhere to hang that
  — this is a client-only `AppFeatureStatusColumn`, **no app code runs on the board page**,
  and the `/picker` iframe is created on the cell click and destroyed on close. And one
  round trip is the floor, not zero: the picker removes the item's *current* status from the
  options, and the current value is not in the monday context, so painting from cache would
  reorder the pill list under the cursor in a 200×250 dialog.
- A theme fix that came along: `ErrorState`'s Tailwind `text-red-500` / `text-gray-700`
  were fixed light-mode greys, so that screen was unreadable in monday's dark themes. Now
  `--negative-color` / `--secondary-text-color`.
- CI gained an **eager-import guard** (`scripts/lib/eager-graph.mjs`), deliberately an
  invariant rather than a size budget — a byte threshold measures a symptom, needs the
  build to evaluate, and only ever ratchets upward. It walks the static import graph from
  the entry, stops at `import()` (that is how a heavy dependency is *supposed* to be
  reached), and fails if a forbidden package is reachable eagerly.

## 3.7.1

- **The required-fields form's title and submit button are now actually fixed, at any
  number of required columns.** 3.6.0 claimed this and 3.6.1 claimed to have fixed the
  claim; both were looking in the wrong place. Everything inside
  `.twyst-required-fields-modal` was already correct — the `minmax(0, 1fr)` row, the
  `overflow: hidden`, the field list as the only scrolling box. The box that was
  scrolling sat two levels ABOVE it: `.app-shell` adds `padding: 20px` and, on this
  route, nothing in the chain (`html`, `body`, `#root`, the shell) had a height or
  `overflow: hidden`. So the modal filled the viewport with `100dvh`, the shell's
  padding pushed 40px past it, and `body` — which carries only `min-height` — grew
  rather than clipping. The DOCUMENT scrolled, taking the header and the button along,
  and `overflow: hidden` on the modal could do nothing about a scroll happening
  outside it.
- The tell was that the overflow measured a **constant 40px at every field count** —
  1, 3, 8 and 14 required columns all overflowed by exactly the shell's two 20px
  paddings. A content-driven overflow would have grown with the rows. Measured in a
  real browser at the exact pixel size the app asks monday for, not reasoned about:
  with 8 fields the document scrolled 40px while the field list did not scroll at all,
  and the submit button sat flush on the viewport's bottom edge with its own padding
  below the fold.
- The required-fields route now carries an `is-modal` shell modifier, and that class
  gets the same treatment the picker has always had: no shell padding, and
  `height: 100%` + `overflow: hidden` on `html`, `body`, `#root` and the shell.
  `requiredFormModalSize` budgets exactly ONE padding box (`FORM_PADDING_PX`) and the
  modal is the element that owns it, so the shell must contribute none.
- `.twyst-required-fields-modal` is sized `block-size: 100%` instead of `100dvh`.
  A viewport unit measures the iframe and silently ignores every ancestor between,
  which is what let the shell's padding be added on top of a box already as tall as
  the window. It also degrades better: with no definite parent height a percentage
  falls back to content height, where a viewport unit overflows.
- After the fix the document scrolls **0px** at 1, 3, 8 and 14 fields; the button
  keeps its 20px of padding, the header sits at one padding box rather than two, and
  past the 8-row cap the field LIST scrolls while the document still does not.

## 3.7.0

- **The settings button is now for board owners only.** The slim shell behind the column's
  settings placement asks who the actor is before it offers to configure anything; a
  non-owner gets a one-line statement, `Only board owners can configure`, where the button
  used to be. Same gate as axis-tracker's (`useBoardOwner`), applied to this app's settings
  shell.
- **Ownership includes the board's OWNING TEAMS, not just its user owners.** tracker
  compares the actor against `boards { owners { id } }` alone; on a shared board the
  ownership is often held by a team instead, and that check locks a genuine owner out. So
  `team_owners` is resolved against the actor's own team membership too. It costs nothing in
  the common case: a direct user owner is answered in ONE request, and the two team lookups
  are only sent for an actor who is not already a user owner. No new scope — `boards:read`,
  `users:read` and `teams:read` were all declared already.
- **A check that could not run is not a denial.** Where tracker quietly resolves a failed
  ownership query to "not an owner", a failure here says so in Hebrew and withholds the
  button: reporting a network error as a permission verdict tells a real owner they have no
  rights, and buries the actual fault while doing it. The one sanctioned narrowing is a
  missing `teams:read`, which degrades to user owners only rather than failing — it is
  already how this app treats that scope everywhere else.
- The gate fails CLOSED in every other direction, which is deliberately the inverse of the
  per-label rules next door: an empty `allowedUserIds` means "everyone may pick that
  status", but a board with no owners at all hands the settings button to nobody.
- While the check is in flight the shell keeps showing the SAME loading state its Suspense
  fallback was already showing, so the wait is continuous instead of one spinner replaced
  by another — and no button appears and then vanishes.

## 3.6.1

- **The title and the save button no longer scroll with the fields.** 3.6.0 claimed to
  pin them and did not: the form sat in the modal's single implicit grid row, which is
  sized by its CONTENT, and `align-content: stretch` only hands out space that is left
  over — never takes it away. So the moment the form wanted more height than the iframe
  had, the row grew past the box and the whole form scrolled as one piece. Worse, the
  `overflow: hidden` added in 3.6.0 then clipped the submit button instead, meaning it
  could not be reached at all. The row is now `minmax(0, 1fr)`, so it shrinks to the
  window it actually got and the field list is the only thing that scrolls.
- The requested modal height carries a flat 24px of headroom. monday draws its own modal
  chrome inside the box it hands us and a row can render a pixel over budget, so sizing
  the form to fit exactly was a few pixels short in practice — and those few pixels were
  what put the header and footer into the scroll in the first place. One flat allowance,
  not per row, so it costs no visible dead space.
- **Choosing a status with no required fields closes the picker as soon as the write
  lands, with no toast.** The write is still awaited rather than fired and forgotten:
  `closeDialog` tears the iframe down, and a request still in flight when that happens
  is cancelled by the browser — the dialog would close on a status that was never
  written, with nothing to say so. The spinner on the clicked pill covers the round trip.
- **No success toast for a status change**, in the picker or after the required-fields
  form. The cell already shows the result and the dialog closing is the confirmation.
  Failures still speak.
- **A single required column no longer opens a sliver.** The modal is never sized below
  two rows (`FORM_MIN_ROWS`), so one field still opens as a form rather than as a title, a
  box and a button squeezed together. The floor is a sizing concern only —
  `requiredFormLayout` still reports the real row count, so the list renders one row and
  the spare height falls below it.
- The date picker's "היום" shortcut now closes the popover like a day click does — when
  the hour toggle is off. It used to set the date and leave the popover open, so the same
  action behaved two different ways. The typed date input deliberately still does not
  close: it fires on every keystroke.

## 3.6.0

- **Connected-board (`board_relation`) columns can now be required fields.** The control
  reads the linked board off the column's own `settings.boardIds` and offers its items in
  a searchable menu, single- or multi-select according to the column's
  `allowMultipleItems`. An absent setting means single, deliberately: writing two ids to a
  single-link column is a `ColumnValueException`, while offering one pick on a column that
  would have taken several is merely restrictive. Candidates are one page of 500 fetched on
  first open, not on form load — a relation field must not slow down the form that is
  blocking the user's transition — and when that page is full the menu says so rather than
  showing a silent prefix. The write format, the read fragment and the empty-clear path
  were all verified live against the sandbox, not copied on faith.
- The item **NAME** column is gone from the required-fields checklist in settings. It was
  listed but greyed out, which amounted to offering to make an item's own title a required
  field.
- **The modal now grows to fit up to 8 fields** instead of 4, and past that only the field
  LIST scrolls: the title stays at the top and the button stays at the bottom. Previously a
  form taller than the window scrolled the page and took the header and footer with it.
- Removed the dead space above the footer. The height budget reserved 48px for a row that
  actually renders at 36 — 12 wasted pixels per field, which at the new 8-row cap would
  have been a 96px hole.
- **Clicking a status label no longer replaces its text with "שומר…"** — the pill keeps its
  own label and shows a small spinner instead. The text swap hid the very thing the user
  had just clicked.
- The required-fields modal reuses the picker's loader: monday's black spinner, continued
  from `index.html`, with no text. Being its own iframe it was already painting that
  spinner and then throwing it away to draw a second, differently-styled loader with
  "טוען שדות חובה…" underneath.
- The submit button is a blue **"שמור"**. It was white because the only blue
  `.primary-action` rule was scoped to `.status-guard-dialog`, and the fill form renders
  under `.twyst-required-fields-modal` — so the rule never matched.
- The form header is one title, "עמודות חובה". The "מעבר סטטוס" eyebrow and the
  "השלמת פרטים לפני מעבר ל״X״" heading are gone, which also gave the row list 24px back.
- Removed the cancel button and the red asterisks. The modal's X is the way out, and an
  asterisk on every row of a form where every field is required carried no information.
- A status label with no text renders with no text, everywhere — the "ללא שם" stand-in is
  gone. The save notice is now just "הסטטוס עודכן בהצלחה"; it used to interpolate the label
  name, which read as `ל״״` for an unnamed label.
- **Fixed option menus opening detached from their field.** Three separate causes: the menu
  asked for 320px of height inside an iframe as short as 216px, so it was clamped, flipped
  and pinned to the top edge, covering the field it belonged to; the popover kept its last
  position on close and painted one frame at the old coordinates on reopen; and its
  rendered height came from the stylesheet (430px) rather than the height the placement
  math had reserved. Also made the whole bar one click target — a click that landed on the
  label text or the chevron was a click on a child of the button.

## 3.5.1

- Fixed the field label breaking onto three lines. A leftover
  `.twyst-form label { display: grid }` rule from the pre-3.4.0 form OUTRANKED
  `.twyst-field-title` (0,1,1 vs 0,1,0), so the icon, the name and the asterisk
  stacked vertically. That tripled every row's height, which in turn made the modal
  scroll and clipped the footer buttons — the computed height was right, the rendered
  rows were not. Icon, name and asterisk now sit on one line as intended.
- Status and dropdown fields are a single field-height bar that opens its options in
  a popover, instead of rendering every option as an inline chip. A row of chips
  spilled across the row and made a status field look nothing like the fields above
  it; a column with a dozen labels now costs the same one row as a text field. A
  chosen status paints the bar its own label colour, like a monday cell.
- Removed the dead chip CSS the inline options used.

## 3.5.0

- The required-fields form now follows monday's own item form: a LIST of rows, one
  field per row, with the column's coloured icon and title in a label column beside a
  wide control column. The 2-column grid from 3.4.0 is gone. Modal width is constant;
  only the height follows the rows, still capped at 4 visible with the list scrolling
  past that.
- The hour of a date field is set INSIDE the date picker — a popover with "היום", a
  clock toggle and a month grid — instead of a separate time input beside the day. It
  stays optional: a date with no hour is a complete answer, and switching the clock
  off CLEARS the hour rather than keeping a hidden value that would still be written.
- The picker no longer sits on "שומר…" while the form is open. `openAppFeatureModal`
  resolves only when the modal CLOSES, and awaiting it pinned the clicked pill for the
  whole time — that was the stuck dialog visible behind the modal.
- After a successful write the modal closes itself and asks monday to close the picker
  dialog behind it, so nothing is left over on screen.

## 3.4.0

- Required fields now support far more column types. `people`, `checkbox`,
  `timeline`, `rating`, another `status` column, and `date` with an optional hour
  can all be marked required, alongside the text/number/contact types that already
  worked. `dropdown` was fixed: it used to write from a free-text box (a typo
  failed the write or invented a label) and now offers the column's real labels.
- Which types are allowed is decided in ONE place — `src/domain/columnFields.js`.
  Each type carries its form control, typed GraphQL read fragment, read/write
  conversion, and its own "still empty?" rule, so adding a type is one record and
  the settings checklist picks it up automatically. Types monday cannot write
  through `column_values` (formula, mirror, file, …) stay unselectable by design.
- Required-field enforcement moved off the browser's `required` attribute, which
  cannot express "this checkbox must be checked" or "this picker must hold an
  entry". Emptiness is now judged per type: rating 0 and a half-entered timeline
  count as empty, status label id `0` counts as filled, and the hour part of a date
  is optional so skipping it never fails the transition.
- The fill form opens as its own modal on `/required-fields`, sized from the fields
  it shows: a 2-column grid, at most 4 rows, scrolling past that. `date` and
  `timeline` span the full row because each renders two inputs. The picker's own
  dialog is fixed at 200×250 by the Developer Center and the SDK has no runtime
  resize, so the form could not stay there.
- A single unusable value no longer fails the whole transition: the payload passes
  through a sanitizer that omits the junk column, since monday rejects the entire
  mutation on one bad column. A required column deleted from the board fails closed
  — the transition is blocked with a message pointing at the settings.
- Fixed two read bugs a live probe caught: monday returns `DateValue` in the
  ACCOUNT timezone while the write is UTC (the app was converting twice), and
  `TimelineValue` arrives as full ISO timestamps, not `YYYY-MM-DD`.

## 3.3.0

- Picker boot is now a single continuous spinner. monday shows a black spinner in
  the Dialog while the iframe loads; the app used to answer it with a shimmer
  skeleton, so the user saw monday's spinner, then a blank frame, then bars —
  a visible jump. The app now continues monday's spinner instead: a pixel copy of
  `@vibe/core`'s `Loader` (`dark`, 40px), inline in `index.html` so it paints on
  the first frame with no request of its own, and held as the SAME DOM node for
  the whole boot so its rotation never restarts.
- Held across every boot phase — monday context, column settings, board data —
  and released only when the picker has real content, or an error to show.
  Backstops: the error boundary and a 15s timer, so nothing can leave a dialog
  spinning forever.
- Removed the shimmer skeleton added in 3.2.9 (`StatusPickerSkeleton`) and its CSS.

## 3.2.9

- Picker shows a monday-style shimmer skeleton (6 label-sized bars, no loading
  copy) from the first paint while context/labels load.
- Document Dialog Design size: width `200`, height `250` (fits 6 pills, no scroll).

## 3.2.8

- Settings: teams join the people picker (no separate checklist); each label
  accordion starts closed; required-columns list collapsed by default; people-
  column gate uses a custom dropdown matching the settings chrome.

## 3.2.7

- Settings UI redesign (Vercel-style clarity): soft canvas, compact label rows,
  capped field widths, checkbox lists instead of stretched multi-selects,
  collapsible permissions, and ↑/↓ reorder.

## 3.2.6

- Per-label people-column gate: pick a People column; only actors who appear on
  that column (as a person or via a team listed there) may select the label.
  Combines with user/team allowlists as AND.

## 3.2.5

- Settings overlay ignores the tiny column-settings iframe size (root cause of
  the postcard modal). Uses the physical screen at ≥80%, floored at the
  known-good `1100×820`.

## 3.2.4

- Settings overlay opens at ≥80% of the viewport (min 720×560, capped at 94%
  on tiny screens) — no more postcard-sized `744px` dialog.

## 3.2.3

- Revert status picker to the cell-attached Dialog Design (no centered
  `openAppFeatureModal`). The previous hand-off looked wrong next to the board.
  Bind only On-Click to `/picker` — not On-Hover — so the popover stays open
  while choosing.

## 3.2.2

- Fix settings load crash: User photos query uses `photo_thumb` (API 2026-04).
  `photo_url { thumb }` is only available from 2026-07 and was rejected by GraphQL.

## 3.2.1

- Status picker no longer closes when the mouse moves: the column Dialog Design
  shell immediately opens a stable `openAppFeatureModal` (`/picker-full`) so the
  label list stays open until a choice or an intentional dismiss.

## 3.2.0

- Settings UI cleaned up to match discussions: header + scroll body + footer,
  Vibe ColorPicker (circle) and PersonPicker, no subheadings or help prose.
- Full-settings overlay size is viewport-relative (`min(744px, 94vw/vh)`), not
  a fixed 1100×820.

## 3.1.5

- Picker no longer lists the currently selected status (or shows it as a header
  chip) — only other allowed labels appear for switching.

## 3.1.4

- Fix settings save failing with monday `Colors should be unique` on
  `update_status_column`: payloads now force unique StatusColumnColors across
  active + deactivated labels (active colors stay; collisions are remapped), and
  new labels pick the first unused color instead of always `done_green`.

## 3.1.3

- Picker labels stretch edge-to-edge inside the monday Dialog Design iframe
  (removed the 20px app-shell padding and width cap that left side gaps).

## 3.1.2

- Picker UI matches discussions' monday-native status label menu: full-width
  colored pills with white centered text (same look as TaskTableRow statusMenu).

## 3.1.1

- Column settings shell is now a single button that opens a full-size nested
  overlay (`openAppFeatureModal` → `/settings-full`) for label editing and
  permissions — the native settings iframe stays minimal.

## 3.1.0

- Default when no settings are saved: **all active statuses are allowed** (removed the
  "העמודה לא הוגדרה" picker gate).
- Settings now edit board status labels in place — rename, recolor, add, and deactivate —
  via `update_status_column` (same pattern as day-off), alongside per-label permissions.

## 3.0.0

- Rewrote the app as a **client-only** Status Column surface (CDN), matching the
  `team-people-column` architecture — no monday-code server, OAuth, or webhooks.
- Routing is pathname-based: `/picker` (on-click) and `/settings` (column settings).
- Settings persist in global monday storage (`twystStatus:boardId:columnId`) with
  per-target-label allowlists (users or teams) and required board columns.
- The picker hides unauthorized and hidden labels; missing storage means open allowlists.
  Selecting a label with required fields always opens a fill form before writing
  status + columns together.

## 2.1.0

- Added governed Status workflows with transition permissions, required fields,
  protected labels, rollback enforcement, notifications, and per-item audit history
  (server-side path; superseded by 3.0.0 client-only rewrite).
