/**
 * ============================================================================
 *  error-handling-rollout — מנוע יישום (dynamic workflow)
 * ============================================================================
 *
 *  מנוע יחיד שמיישם את error-handling-implementation-plan.md שלב-אחר-שלב.
 *
 *  עקרונות (לפי בחירת המשתמש):
 *   • אוטונומי עד כשל שער — רץ דרך כל השלבים; עוצר רק כשבדיקות/lint נכשלים.
 *   • שער אימות אחרי כל שלב: `pnpm test:run` (0 כשלים) + `eslint` (0 errors,
 *     warnings ≤ הסף שב-.github/workflows/test.yml).
 *   • commit פר-שלב אחרי שהשער עובר (היסטוריית git נקייה = תיעוד פר-שלב).
 *   • שלבים ארכיטקטוניים (−1,0,1,2,4,6) רצים כסוכן בודד סדרתי.
 *   • שלבים מכניים רחבים (3,5) רצים fan-out — סוכן לכל קובץ, ללא worktree
 *     (כל סוכן נוגע בקבצים נפרדים, אין התנגשות), עם barrier לפני ה-commit.
 *
 *  הרצה (אחרי אישור):
 *    Workflow({ scriptPath: "<this file>" })
 *  המשך אחרי עצירה/עריכה:
 *    Workflow({ scriptPath: "<this file>", resumeFromRunId: "<runId>" })
 *
 *  ניהול גרסאות: רץ על הענף feat/error-handling-rollout (כבר נוצר).
 *  change-tracker: רשומת שינוי נפתחת/נסגרת ב-main loop סביב כל הרצה (הסקיל
 *  אינטראקטיבי ולא רץ מתוך סוכני workflow); ה-commit-ים פר-שלב נותנים גרנולריות.
 * ============================================================================
 */

export const meta = {
  name: 'error-handling-rollout',
  description: 'מיישם את error-handling-implementation-plan.md שלב-אחר-שלב עם שער בדיקות/lint וקומיט פר-שלב; עוצר על כשל שער',
  phases: [
    { title: 'Phase 0: Foundation (green CI + live bug)' },
    { title: 'Phase 1: Logger + log-once' },
    { title: 'Phase 2: Write-path criticals' },
    { title: 'Phase 3: Dark surfaces + dedup sweep' },
    { title: 'Phase 4: High gaps' },
    { title: 'Phase 5: Tail + ErrorBoundary + dark sources' },
    { title: 'Phase 6: Regression rules' },
  ],
}

const ROOT = '/Users/ilaish/monday_app/apps/tracker/tracker'
const PLAN = `${ROOT}/error-handling-bundle/docs/error-handling-implementation-plan.md`

// ---------------------------------------------------------------------------
// סכמות
// ---------------------------------------------------------------------------
const EDIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string', description: 'מה שונה, תמציתי' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string', description: 'החלטות/אזהרות/דברים שדורשים תשומת לב' },
  },
  required: ['summary', 'filesChanged'],
}

const GATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    pass: { type: 'boolean', description: 'true רק אם הבדיקות עוברות וגם ה-lint נקי מ-errors ותחת סף האזהרות' },
    testsPass: { type: 'boolean' },
    lintPass: { type: 'boolean' },
    testSummary: { type: 'string', description: 'מספר עוברים/נכשלים + שמות הנכשלים אם יש' },
    lintSummary: { type: 'string', description: 'מספר errors/warnings + הסף' },
    details: { type: 'string', description: 'פירוט הכשל אם pass=false' },
  },
  required: ['pass', 'testsPass', 'lintPass', 'testSummary', 'lintSummary'],
}

const COMMIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { committed: { type: 'boolean' }, hash: { type: 'string' }, message: { type: 'string' } },
  required: ['committed'],
}

// ---------------------------------------------------------------------------
// עוזרים
// ---------------------------------------------------------------------------
const gate = (phaseTitle) => agent(
  `שער אימות לשלב "${phaseTitle}". אתה בודק בלבד — אל תערוך שום קובץ.\n` +
  `הרץ מ-${ROOT}:\n` +
  `1) \`pnpm run test:run\` — ספור עוברים/נכשלים; אם יש נכשלים, שמות.\n` +
  `2) \`pnpm exec eslint src/ --ext .js,.jsx\` — ספור errors ו-warnings. קרא את הסף ` +
  `(--max-warnings) מתוך ${ROOT}/.github/workflows/test.yml.\n` +
  `pass=true רק אם: 0 בדיקות נכשלות וגם 0 eslint errors וגם warnings ≤ הסף. אחרת pass=false עם details.`,
  { schema: GATE_SCHEMA, phase: phaseTitle, label: `gate:${phaseTitle}` }
)

const commit = (message, phaseTitle) => agent(
  `מ-${ROOT}: בצע \`git add -A\` ואז \`git commit -m\` עם ההודעה הבאה (בדיוק):\n"${message}"\n` +
  `אל תדחוף (push). דווח את ה-hash. אם אין שינויים לקומיט, דווח committed=false.`,
  { schema: COMMIT_SCHEMA, phase: phaseTitle, label: `commit:${phaseTitle}` }
)

const PLAN_REF = `קרא תחילה את התוכנית המלאה ${PLAN} (ובמיוחד את הסעיף הרלוונטי) לפני שאתה נוגע בקוד. ` +
  `שמור על קונבנציות הקוד הקיימות, הודעות משתמש בעברית, ולוגים דרך logger בלבד.`

// ---------------------------------------------------------------------------
// הרצת שלב עם עצירה-על-כשל
// ---------------------------------------------------------------------------
const trail = []
async function runPhase(title, doEdits, commitMsg) {
  phase(title)
  const edit = await doEdits()
  const g = await gate(title)
  trail.push({ phase: title, edit, gate: g })
  if (!g.pass) {
    log(`⛔ שער נכשל ב-"${title}" — עוצר. ${g.details || g.testSummary + ' / ' + g.lintSummary}`)
    return false
  }
  const c = await commit(commitMsg, title)
  trail[trail.length - 1].commit = c
  log(`✅ "${title}" עבר את השער ונשמר (${c.hash || 'no-op'}).`)
  return true
}

// ===========================================================================
// Phase 0 — יסוד: שער CI ירוק (lint+בדיקות) + הבאג החי + stub ל-matchMedia
//   מיזוג Phase −1 ו-0: שער ה-lint "0 errors" מחייב גם את תיקון ה-no-undef
//   (הבאג החי), ושער הבדיקות מחייב stub ל-matchMedia שחסר ב-setupTests מראש
//   (10 טסטי <App/> אדומים מראש, לא קשור ליוזמה).
// ===========================================================================
const ok_0 = await runPhase(
  'Phase 0: Foundation (green CI + live bug)',
  () => agent(
    `${PLAN_REF}\nשלב יסוד (מיזוג Phase −1 ו-Phase 0): הבא גם את ה-lint וגם את הבדיקות לירוק, בלי להרחיב היקף.\n` +
    `1) תקן את 5 שגיאות import/first (העבר את כל ה-import-ים מעל קריאות vi.mock; vitest hoist-ים את ה-mock ממילא; אם כבר תוקן בעץ — אמת בלבד) ב:\n` +
    `   - ${ROOT}/src/components/Dashboard/__tests__/DashboardToolbar.test.jsx\n` +
    `   - ${ROOT}/src/contexts/__tests__/SettingsContext.test.jsx\n` +
    `   - ${ROOT}/src/utils/__tests__/portfolioResolver.test.js\n` +
    `2) תקן את ה-ReferenceError החי ב-${ROOT}/src/hooks/useAllBoardProjects.js שורה ~215: \`writeCache(cacheKey, result)\` ` +
    `(שני המזהים לא מוגדרים → ReferenceError בכל טעינת direct-board מוצלחת + 2 שגיאות no-undef). החלף בדפוס המדויק מ-שורה ~145 ` +
    `של אותו קובץ — saveToStorage(instanceId, {...}) עם projects: result. העתק את ביטוי ה-timestamp מ-שורה 145, אל תקליד מחדש. ` +
    `ודא ש-saveToStorage/instanceId/signature ב-scope.\n` +
    `3) הוסף stub מלא ל-window.matchMedia ב-${ROOT}/src/setupTests.js (jsdom לא מספק אותו; ${ROOT}/src/App.jsx:63 קורא לו, ` +
    `ולכן כל טסטי ${ROOT}/src/__tests__/integration/* שמרנדרים <App/> נופלים מראש על "window.matchMedia is not a function"). ` +
    `השתמש ב-stub סטנדרטי על window (Object.defineProperty / vi.stubGlobal) שמחזיר אובייקט עם: matches:false, media:query, ` +
    `onchange:null, ו-vi.fn() ל-addEventListener/removeEventListener/addListener/removeListener/dispatchEvent.\n` +
    `4) ודא ש-${ROOT}/.github/workflows/test.yml --max-warnings ממוקם לערך ה-warnings הנוכחי בפועל (הרץ eslint וספור; ` +
    `react-hooks/exhaustive-deps + no-unused-vars הם חוב קיים מחוץ להיקף — אל תיגע בהם), עם הערה שמסבירה את המיקום-מחדש.`,
    { schema: EDIT_SCHEMA, phase: 'Phase 0: Foundation (green CI + live bug)', label: 'edit:foundation' }
  ),
  'chore: green the CI gate (lint + tests) and fix the live ReferenceError\n\nFoundation (merged Phase -1 + 0): fix 5 import/first errors, re-baseline the eslint warning budget, fix useAllBoardProjects.js:215 (undefined writeCache/cacheKey -> saveToStorage; clears 2 no-undef and the runtime ReferenceError that blanked the project list), and add a window.matchMedia stub to setupTests.js (unblocks 10 pre-existing <App/> integration test failures).'
)
if (!ok_0) return { stoppedAt: 'Phase 0: Foundation', trail }

// ===========================================================================
// Phase 1 — תשתית הלוגר + log-once (קריטי; סוכן בודד זהיר + בדיקות)
// ===========================================================================
const ok_1 = await runPhase(
  'Phase 1: Logger + log-once',
  () => agent(
    `${PLAN_REF}\nשלב Phase 1 (סעיף 3, 3.1 ו-"Phase 1"): הפוך את logger ל-sink-ready עם חוזה log-once. זהו השלב הקריטי — ` +
    `הוא נוגע בכל הקוד; עבוד זהיר וכסה בבדיקות.\n` +
    `קבצים: ${ROOT}/src/utils/logger.js, ${ROOT}/src/utils/errorHandler.js, ${ROOT}/src/setupTests.js, ` +
    `ובדיקה חדשה ${ROOT}/src/utils/__tests__/logger.test.js.\n` +
    `צעדים (לפי התוכנית): (1) נקודת איגוד emit(record) שכל המתודות עוברות דרכה; העבר את כל הפורמט פנימה. ` +
    `(2) נתב דרך emit את ה-console.error של הסטאק ב-error (~:169), ואת api/apiResponse/apiError (~:177-236) ו-initDone/initSummary (~:276-306). ` +
    `(3) addSink(fn)/removeSink(fn); כל dispatch ב-try/catch משלו. (4) WARN/ERROR נשלחים ל-sink גם כש-console מושתק ב-PROD. ` +
    `(5) ring buffer (100-200) + flush() ב-visibilitychange/beforeunload; navigator.sendBeacon לא קיים ב-jsdom → fallback חינני (fetch keepalive/no-op). ` +
    `(6) רשומה אחידה מ-createFullErrorObject + timestamp epoch/ISO; שמור מחרוזת he-IL רק לרינדור קונסול. ` +
    `(7) log-once: correlationId מוטבע פעם אחת בנקודת ה-catch המוקדמת; emit מסמן error.__loggedId ומדלל כפילויות. ` +
    `(8) הרחב את ה-mock הגלובלי של logger ב-setupTests.js (vi.mock סביב שורה 5) ב-addSink/removeSink/emit/flush כדי ש~54 הבדיקות לא ישברו.\n` +
    `בדיקות (logger.test.js): חייב לעקוף את ה-mock הגלובלי (vi.unmock + vi.importActual). כסה: addSink(spy) מקבל כל רמה כולל apiError+stack; ` +
    `ring buffer נשמר לפני רישום sink; flush עם stub ל-sendBeacon + ענף ה-absent; מצב PROD (vi.stubEnv('PROD',true)+resetModules); ` +
    `console-spy שלא מזהם פלט; dedup: re-throw של אותו Error → רשומה אחת.\n` +
    `אל תשנה חתימות ציבוריות של logger (debug/info/warn/error/api/apiResponse/apiError/functionStart/functionEnd/initDone/initSummary).`,
    { schema: EDIT_SCHEMA, phase: 'Phase 1: Logger + log-once', label: 'edit:phase1' }
  ),
  'feat(logger): single emit() chokepoint, sink registry, ring buffer, and log-once contract\n\nPhase 1: makes logger sink-ready (emit/addSink/buffer/flush), normalizes the record + correlationId, dedups re-thrown errors, and extends the test mock. Adds logger.test.js.'
)
if (!ok_1) return { stoppedAt: 'Phase 1', trail }

// ===========================================================================
// Phase 2 — קריטיים במסלולי כתיבה (תלוי ב-Phase 1)
// ===========================================================================
const ok_2 = await runPhase(
  'Phase 2: Write-path criticals',
  () => agent(
    `${PLAN_REF}\nשלב Phase 2: סגור את שורש "GraphQL רך = הצלחה" ואת 2 הקריטיים.\n` +
    `(1) הוסף עוזר משותף assertNoGraphQLErrors(res) ב-${ROOT}/src/utils/mondayApi/ ושלב אותו במסלולי הכתיבה ` +
    `(createBoardItem/updateItemColumnValues/deleteItem). הוא זורק MondayApiError ללא רישום — כי safeApi כבר רשם את ה-soft-error ` +
    `ב-client.js:256 (הרשומה הקנונית). (2) ${ROOT}/src/hooks/useMondayEvents.js createEvent (~642-673): createdItem falsy → logger.error + throw MondayApiError ` +
    `(במקום להחזיר null בשקט). (3) ${ROOT}/src/MondayCalendar.jsx handleCreateEvent (~916-918): אם createEvent מחזיר falsy → showErrorWithDetails, ` +
    `בלי showSuccess/checkCelebration.\n` +
    `הוסף/עדכן בדיקות: soft-error מאולץ ב-createEvent מייצר בדיוק רשומה אחת ומציג שגיאה (לא טוסט הצלחה).`,
    { schema: EDIT_SCHEMA, phase: 'Phase 2: Write-path criticals', label: 'edit:phase2' }
  ),
  'fix(api): throw on soft GraphQL errors in write paths; surface failed event create\n\nPhase 2: adds assertNoGraphQLErrors, makes createEvent throw on falsy item, removes the false-success toast.'
)
if (!ok_2) return { stoppedAt: 'Phase 2', trail }

// ===========================================================================
// Phase 3 — שני משטחי dark + סחיפת רישום כפול (fan-out)
//   stage1 (סדרתי): נתב useToast + globalErrorHandler דרך logger (חייב לקרות לפני הסחיפה)
//   stage2 (מקבילי): הסר logger.error מיותר הצמוד ל-showErrorWithDetails, פר-קובץ
// ===========================================================================
const SWEEP_FILES = [
  { f: 'src/MondayCalendar.jsx', pairs: '921/922, 943/944, 1000/1001, 1028/1029, 1038/1039' },
  { f: 'src/hooks/useCalendarHandlers.js', pairs: '129/130, 170/171' },
  { f: 'src/hooks/useCalendarSelection.js', pairs: '77/78' },
  { f: 'src/components/SettingsWizard/SettingsWizard.jsx', pairs: '70/71' },
  { f: 'src/components/SettingsDialog/SettingsDialog.jsx', pairs: '91/92, 197/198' },
  { f: 'src/components/SettingsDialog/MappingTab.jsx', pairs: '225/226, 248/249, 276/277, 354/355, 380/381, 407/408, 462/463, 490/491, 519/520, 750/751' },
  { f: 'src/components/SettingsDialog/AdditionalTab.jsx', pairs: '109/110, 134/135, 154/155' },
]
const ok_3 = await runPhase(
  'Phase 3: Dark surfaces + dedup sweep',
  async () => {
    // stage1 — ניתוב המסלולים הגלובליים דרך logger (סדרתי, חייב לפני הסחיפה)
    const route = await agent(
      `${PLAN_REF}\nשלב Phase 3 שלב-משנה 1+2: נתב את שני המסלולים הגלובליים דרך logger, עם נקודת רישום אחת (log-once מ-Phase 1).\n` +
      `(א) ${ROOT}/src/hooks/useToast.js showErrorWithDetails (~69-134): קרא logger.error/apiError עם ה-fullErrorObject — ` +
      `אך ורק אם !error.__loggedId (כדי לא להכפיל שגיאות שכבר נרשמו ב-safeApi/catch).\n` +
      `(ב) ${ROOT}/src/utils/globalErrorHandler.js: הוסף import של logger; החלף את 5 ה-console.error (~:23,:34,:35,:97,:139) ב-logger.error; ` +
      `handleGlobalError רושם (נקודת הרישום היחידה במסלול הגלובלי), ו-showErrorWithDetails מדלג כשמופעל ממנו (דרך __loggedId).\n` +
      `הוסף בדיקה ${ROOT}/src/utils/__tests__/globalErrorHandler.test.js: setupGlobalErrorHandlers()+setGlobalErrorHandler(spy)+logger.addSink(spy); ` +
      `dispatch של ErrorEvent ו-PromiseRejectionEvent → ה-sink נקרא פעם אחת; afterEach מנקה listeners. רץ עם logger אמיתי.`,
      { schema: EDIT_SCHEMA, phase: 'Phase 3: Dark surfaces + dedup sweep', label: 'edit:phase3-route' }
    )
    // stage2 — סחיפת רישום כפול, סוכן לכל קובץ (קבצים נפרדים → מקבילי בטוח)
    const sweeps = await parallel(SWEEP_FILES.map(({ f, pairs }) => () => agent(
      `${PLAN_REF}\nשלב Phase 3 שלב-משנה 3 (סחיפת רישום כפול) בקובץ ${ROOT}/${f}.\n` +
      `כעת ש-showErrorWithDetails רושם בעצמו (שלב-משנה 1), הסר את שורות logger.error/apiError ה*מיותרות* שצמודות ` +
      `ל-showErrorWithDetails על אותו אובייקט שגיאה. זוגות מאומתים (קרא ואמת לפני מחיקה — מספרים אינדיקטיביים): ${pairs}.\n` +
      `הסר רק את ה-logger.* שמכפיל את אותה שגיאה שמוצגת ב-showErrorWithDetails הסמוך. אל תיגע ב-logger.error שמתעד שגיאה אחרת ` +
      `או הקשר נוסף. אל תשנה התנהגות אחרת.`,
      { schema: EDIT_SCHEMA, phase: 'Phase 3: Dark surfaces + dedup sweep', label: `sweep:${f.split('/').pop()}` }
    )))
    return { summary: 'route + sweep', filesChanged: [route, ...sweeps.filter(Boolean)].flatMap(r => r.filesChanged || []), notes: route.notes }
  },
  'feat(logging): route showErrorWithDetails + globalErrorHandler through logger; remove duplicate logs\n\nPhase 3: closes the two structural dark surfaces and sweeps ~24 redundant logger.error sites (single emit per error).'
)
if (!ok_3) return { stoppedAt: 'Phase 3', trail }

// ===========================================================================
// Phase 4 — פערי High (H1-H10)
// ===========================================================================
const ok_4 = await runPhase(
  'Phase 4: High gaps',
  () => agent(
    `${PLAN_REF}\nשלב Phase 4: סגור את H1-H10 (כולם אומתו בקוד החי). בכל אתר: אין catch ללא logger; פעולת-משתמש כושלת מציגה הודעה ממופה.\n` +
    `- ${ROOT}/src/contexts/SettingsContext.jsx:248-318 — עטוף את ה-JSON.parse/migrations ב-catch → logger.error + fallback ל-DEFAULT_SETTINGS + ודא setIsLoading(false). :337-340 — .catch על loadSettings().\n` +
    `- ${ROOT}/src/utils/mondayApi/items.js:194-202 (findProjectLinkColumn) ו-:523-529 (fetchActiveAssignments) — החלף catch ריק/הערה ב-logger.warn.\n` +
    `- ${ROOT}/src/components/SettingsDialog/SettingsDialog.jsx:230-232 — logger.error ב-FileReader.onerror (כמו ה-onload ב-~226).\n` +
    `- ${ROOT}/src/components/SettingsWizard/SettingsWizard.jsx:~63-68 — בענף ok===false: logger.error + הודעה ספציפית בעברית.\n` +
    `- ${ROOT}/src/hooks/useAllDayEvents.js:107-174 (handleUpdateAllDayEvent) — בדוק res.errors לפני showSuccess; soft-error → showError ממופה.\n` +
    `- ${ROOT}/src/hooks/useCalendarSelection.js:40-82 — failureCount; אם successCount===0 או failureCount>0 → showErrorWithDetails.\n` +
    `- ${ROOT}/src/utils/mondayApi/columns.js:59-62 (createEventTypeStatusColumn) ו-:90-93 (createColumn) — זרוק MondayApiError על id/null חסר.\n` +
    `הוסף בדיקות פר-פער (settings פגום, import כושל, soft-error בעדכון).`,
    { schema: EDIT_SCHEMA, phase: 'Phase 4: High gaps', label: 'edit:phase4' }
  ),
  'fix(error-handling): close 10 high-severity gaps (silent swallows, false success, stuck spinner)\n\nPhase 4: H1-H10 from the audit.'
)
if (!ok_4) return { stoppedAt: 'Phase 4', trail }

// ===========================================================================
// Phase 5 — בינוני + זנב + ErrorBoundary + מקורות-dark (fan-out פר-אשכול)
// ===========================================================================
const P5 = [
  { label: 'date/duration guards', prompt:
    `מודולי תאריך/משך שמייצרים NaN/Invalid Date לכתיבות — הוסף guards (instanceof Date && !isNaN(getTime())) ולוג/החזרת '' בענף הלא-תקין: ` +
    `${ROOT}/src/utils/dateFormatters.js (11-16,23-28,45-50,57-61,35-38), durationUtils.js (29-33,43-48,83-91), dateFilterUtils.js (37-83,92-116,146-170), ` +
    `dateTimeHelpers.js, mondayColumns.js, dashboardAggregation.js (58-64,83-143,183-377,342,385-407). הערה: formatPeriodLabel מקבל Date (לא string) — guard מותנה.` },
  { label: 'console -> logger', prompt:
    `העבר console.* ל-logger.* (28 dark-console): ${ROOT}/src/hooks/useAllBoardProjects.js (33,43,45,81,101,146,162,171,216), ` +
    `src/contexts/ProjectColorsContext.jsx (58-60), src/components/SettingsDialog/ProjectColorsTab.jsx (25-30,51-60), src/utils/projectColorsStorage.js, ` +
    `src/components/ErrorDetailsModal/ErrorDetailsModal.jsx (clipboard catch), src/components/ErrorToast/ErrorToast.jsx (clipboard catch). שמור רמת לוג הולמת.` },
  { label: 'silent-swallow closes', prompt:
    `סגור בליעות שקטות: ${ROOT}/src/components/SettingsDialog/MappingTab.jsx (306-331 per-column JSON.parse bare-catch → logger.warn), ` +
    `src/hooks/useApproval.js (misconfig no-ops), src/hooks/useProjects.js (cache catches כולל ה-catch {} הריק ב-:39), src/hooks/useMonthlyHours.js:198 (duration parse).` },
  { label: 'ErrorBoundary hoist', prompt:
    `${ROOT}/src/App.jsx — הוסף גבול שורש ErrorBoundary *מעל* שלושת ה-providers (כרגע ה-ErrorBoundary בתוך AppContent בשורות ~143-226, מתחת ל-providers ב-~233-239). ` +
    `ה-ErrorBoundary self-contained (תלוי רק ב-i18next) — ניתן להרמה. הוסף גם גבולות פר-רכיב לעצי ה-lazy (MondayCalendar, Dashboard, SettingsDialog). הוסף בדיקה לגבול השורש.` },
  { label: 'listeners/observers', prompt:
    `עטוף נתיבי listener/timer/observer שה-ErrorBoundary לא תופס ב-try/catch → logger.error: ${ROOT}/src/components/MobileResizeOverlay/MobileResizeOverlay.jsx, ` +
    `src/components/DatePickerInput/DatePickerInput.jsx, src/hooks/useFocusTrap.js, src/hooks/useTokens.js, src/hooks/useMultiSelect.js, ` +
    `src/components/Toast/Toast.jsx (300ms exit timer לא מנוקה), src/components/UndoBanner/UndoBanner.jsx (setTimeout לא מנוקה), src/components/MonthlyBattery/MonthlyBattery.jsx:46 (divide-by-zero guard).` },
  { label: 'unscheduled dark sources', prompt:
    `מקורות dark שלא היו משובצים: ${ROOT}/src/i18n/index.js (עטוף i18next.init() ב-.then/.catch → logger.error), ` +
    `src/utils/holidayUtils.js:11 (Location.lookup('Jerusalem') ב-module-load → פונקציה מוגנת/lazy), src/hooks/useIsraeliHolidays.js:71 (try/catch → logger סביב fetchIsraeliHolidays), ` +
    `src/components/ErrorBoundary/ErrorBoundary.jsx:16-25 (catch הערה-בלבד של fallback i18next → logger). ` +
    `נתיב exceljs: src/utils/excelExporter.js (await import('exceljs') + workbook.xlsx.writeBuffer()) + ודא ש-src/components/Dashboard/Dashboard.jsx:256-263 רושם על שני נתיבי הכשל. הוסף בדיקת רגרסיה לייצוא.` },
]
const ok_5 = await runPhase(
  'Phase 5: Tail + ErrorBoundary + dark sources',
  async () => {
    const parts = await parallel(P5.map(p => () => agent(
      `${PLAN_REF}\nשלב Phase 5 — אשכול "${p.label}".\n${p.prompt}\n` +
      `הערה descope (מ-§9 בתוכנית): columnValueBuilders.js (buildStatusColumnValue/buildEventTypeColumnValue/assertNoTranslatedLabels) הוא קוד מת — אל תאינסטרמנט. ` +
      `אל תיגע ב-SettingsDialog.jsx:79-96/:392-399, DashboardFilterPanel.jsx:88-99, AdditionalTab.jsx:74-85 (אומתו כמטופלים/מוגנים).`,
      { schema: EDIT_SCHEMA, phase: 'Phase 5: Tail + ErrorBoundary + dark sources', label: `p5:${p.label}` }
    )))
    return { summary: 'tail + boundary + dark', filesChanged: parts.filter(Boolean).flatMap(r => r.filesChanged || []), notes: parts.filter(Boolean).map(r => r.notes).filter(Boolean).join(' | ') }
  },
  'fix(error-handling): medium/low tail, hoist root ErrorBoundary, instrument unscheduled dark sources\n\nPhase 5: date/duration guards, console->logger, silent-swallow closes, listener wrapping, i18n/holiday/exceljs.'
)
if (!ok_5) return { stoppedAt: 'Phase 5', trail }

// ===========================================================================
// Phase 6 — מניעת רגרסיה (הסינק המרוחק נדחה — לא נוגעים בו)
// ===========================================================================
const ok_6 = await runPhase(
  'Phase 6: Regression rules',
  () => agent(
    `${PLAN_REF}\nשלב Phase 6 — *רק* החלק הלא-דחוי (מניעת רגרסיה + תיעוד). אל תיגע ביעד הסינק המרוחק (Sentry/POST /logs/CSP) — נדחה.\n` +
    `(1) ${ROOT}/package.json eslintConfig — הוסף את הכללים וה-overrides בדיוק כמו ב-§6.2 בתוכנית: no-console:"error" (ללא allow), ` +
    `no-empty:["error",{allowEmptyCatch:false}], ו-no-restricted-syntax עם הסלקטור המאומת ` +
    `(CatchClause > BlockStatement שמסנן logger | ThrowStatement | showErrorWithDetails), + overrides ל-src/utils/logger.js ולתחום הבדיקות.\n` +
    `(2) ${ROOT}/CLAUDE.md — הסר את wrapMondayApiCall (אם נותר), סמן safeApi כ-funnel היחיד, ועדכן את דפוס "Error Handling" כך ש-showErrorWithDetails היא נקודת ה-emit היחידה למשתמש.\n` +
    `דרישת קבלה: אחרי הוספת הכללים, \`pnpm exec eslint src/ --ext .js,.jsx\` חייב לעבור (0 errors). אם נשארו אתרי console/empty-catch/silent-catch — תקן אותם (הם היו אמורים להיסגר ב-Phase 3-5).`,
    { schema: EDIT_SCHEMA, phase: 'Phase 6: Regression rules', label: 'edit:phase6' }
  ),
  'chore(lint): add no-console/no-empty/catch-must-log regression rules; update CLAUDE.md\n\nPhase 6 (non-deferred): locks the standard. Remote sink target deferred per decision.'
)
if (!ok_6) return { stoppedAt: 'Phase 6', trail }

// ===========================================================================
// Phase 7 — תיקוני ביקורת: 3 ממצאי-HIGH שאומתו אדוורסרית + בדיקות חסרות
//   #1 (logger.js): logger.error/warn עם payload שאינו Error לא מודפס לקונסול
//   #2 (logger.js): log-once לא מטביע __loggedId על אובייקט שאינו Error → רישום כפול
//   #3 (dateFormatters.js): guards מחזירים '' לנתיב כתיבה → תאריך ריק נכתב בשקט
// ===========================================================================
const ok_7 = await runPhase(
  'Phase 7: Review fixes',
  async () => {
    const parts = await parallel([
      // #1 + #2 — טיפול ב-payload שאינו Error ב-logger
      () => agent(
        `תקן שני ליקויי logger שאומתו בביקורת, ב-${ROOT}/src/utils/logger.js (אחרי Phase 1). קרא קודם את הקובץ.\n` +
        `#1 (רגרסיית קונסול): logger.error/warn עם ארגומנט-שלישי שאינו Error כבר לא מדפיס את ה-payload לקונסול הפיתוח — כי ` +
        `renderToConsole במקרה error/warn מעביר ל-logWithColor רק את record.error, אך logger.error מנתב ערך שאינו Error ל-record.data. ` +
        `תיקון: ב-renderToConsole, כש-record.error הוא undefined, ליפול חזרה ל-record.data (למשל logWithColor(level, formatted, error !== undefined ? error : data)). ` +
        `יישר עם המקרה ה-'simple' שכבר קורא data.\n` +
        `#2 (פגם log-once): ה-dedup ב-emit מטביע __loggedId רק על record.error, ולכן שגיאות plain-object (למשל שגיאת Monday דרך globalErrorHandler → logger.error(fn,'...',plainObj)) לא מסומנות ונרשמות פעמיים. ` +
        `תיקון: ב-emit, חשב יעד-dedup = record.error או (record.data כשהוא אובייקט לא-null), והטבע/בדוק __loggedId עליו. ודא ש-context bags (אובייקט טרי בכל קריאה, כמו client.js:256 {query,rawResponse}) עדיין נרשמים בכל פעם (הם טריים → לא יעברו dedup), ושהרשומה הקנונית של ה-soft-error נשמרת.\n` +
        `אמת ש-showErrorWithDetails (useToast.js) מגודר על error.__loggedId — כך שהמסלול הגלובלי עם אובייקט Monday פשוט מתכנס לרשומת-sink אחת.\n` +
        `הוסף/הרחב בדיקות ב-${ROOT}/src/utils/__tests__/logger.test.js (עוקף את ה-mock הגלובלי דרך vi.unmock+importActual): (א) logger.error עם אובייקט פשוט מדפיס אותו לקונסול (spy); (ב) אותו אובייקט שמועבר ל-emit פעמיים → רשומת-sink אחת; (ג) אובייקט context טרי בכל קריאה לא עובר dedup.\n` +
        `אל תשנה חתימות ציבוריות. כל בדיקות ה-logger הקיימות חייבות להמשיך לעבור.`,
        { schema: EDIT_SCHEMA, phase: 'Phase 7: Review fixes', label: 'fix:logger-nonError' }
      ),
      // #3 — תאריך לא-תקין בנתיב כתיבה: לזרוק ולהציג במקום לכתוב ''
      () => agent(
        `תקן רגרסיית בליעה-שקטה בנתיב כתיבה שאומתה בביקורת. ב-${ROOT}/src/utils/dateFormatters.js (אחרי Phase 5), הפורמטרים לכתיבה ` +
        `toMondayDateFormat / toMondayTimeFormat / toMondayDateTimeColumn מחזירים '' (או {date:'',time:''}) על Invalid Date עם logger.warn בלבד (מושתק ב-prod). ` +
        `הם נקראים ללא guard בנתיבי כתיבה אמיתיים (buildColumnValues inline ב-${ROOT}/src/hooks/useMondayEvents.js, ו-createSingleAllDayEvent), ולכן Invalid Date נכתב כעת ל-Monday כתאריך ריק + טוסט הצלחה — בליעה שקטה חדשה.\n` +
        `הכרעה (אושרה): לאמת בגבול הכתיבה ולהציג — שלושת פורמטרי toMonday* י*זרקו* Error ברור (הודעה בעברית) על Invalid Date (עם logger.error לפני הזריקה) במקום להחזיר ''. פורמטרי התצוגה toLocalDateFormat/toLocalTimeFormat ממשיכים להחזיר '' (תצוגה בלבד).\n` +
        `צעדים: (1) grep לכל הקוראים של שלושת toMonday* — ודא שכולם נתיב-כתיבה וכל אחד נמצא בתוך try/catch שמציג דרך showErrorWithDetails (createEvent/updateEvent/all-day). אם קורא-כתיבה כלשהו אינו עטוף — עטוף אותו כך שהזריקה תיתפס+תוצג+תירשם. (2) הפוך את שלושת toMonday* לזרוק על Invalid Date (logger.error קודם). (3) עדכן בדיקות dateFormatters קיימות שציפו ל-'' מ-toMonday* כך שיצפו לזריקה; הוסף בדיקה: toMonday* זורק על Invalid Date, ו-Date תקין מפורמט זהה-לחלוטין (אין שינוי על קלט תקין).\n` +
        `אל תיגע בהתנהגות toLocal*.`,
        { schema: EDIT_SCHEMA, phase: 'Phase 7: Review fixes', label: 'fix:date-writepath' }
      ),
      // כיסוי בדיקות לתיקון הראשי של Phase 0
      () => agent(
        `הוסף את בדיקת ה-unit החסרה למצב direct ב-${ROOT}/src/hooks/useAllBoardProjects.js (התיקון הראשי של Phase 0 — באג ה-writeCache/cacheKey — כרגע ללא בדיקות כלל). ` +
        `צור ${ROOT}/src/hooks/__tests__/useAllBoardProjects.test.jsx. מקם mock ל-safeApi ולעוזרי האחסון לפי הדפוס בבדיקות hooks קיימות (${ROOT}/src/hooks/__tests__). ` +
        `אמת: (א) על שליפת direct-board מוצלחת — projects נשארים מאוכלסים (לא מתאפסים) ולא נקבע error; (ב) saveToStorage נקרא עם { signature, projects, ts } בצורה שה-reader (loadFromStorage, ~שורות 32-47/76-79) מצפה לה; (ג) לא מתרחש ReferenceError. ` +
        `שמור מינימלי ותואם לדפוסי הבדיקות הקיימים; ודא שעובר.`,
        { schema: EDIT_SCHEMA, phase: 'Phase 7: Review fixes', label: 'test:useAllBoardProjects' }
      ),
    ])
    return { summary: 'review fixes (logger non-Error, write-path date validation, Phase 0 test)', filesChanged: parts.filter(Boolean).flatMap(r => r.filesChanged || []), notes: parts.filter(Boolean).map(r => r.notes).filter(Boolean).join(' | ') }
  },
  'fix(error-handling): address 3 verified review findings + missing tests\n\nPhase 7: (#1) logger renders non-Error payloads to console; (#2) log-once dedups plain-object errors (one sink record on the global path); (#3) toMonday* date formatters throw on Invalid Date in write paths instead of silently writing a blank date + false success. Adds tests for the logger non-Error paths, the date write-path throw, and the Phase 0 useAllBoardProjects direct-mode fix.'
)
if (!ok_7) return { stoppedAt: 'Phase 7: Review fixes', trail }

log('🎉 כל השלבים (יסוד עד 7, ללא הסינק המרוחק הדחוי) עברו את השער ונשמרו.')
return { stoppedAt: null, completed: true, phases: trail.length, trail }
