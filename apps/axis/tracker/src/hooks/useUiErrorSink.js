import { useEffect, useRef } from 'react';
import logger from '../utils/logger';
import { parseMondayError, createFullErrorObject } from '../utils/errorHandler';

/**
 * משך הצגת טוסט-שגיאה מה-sink (לא דביק — החלטה 3 ב-ui-sink-plan.md)
 */
export const AUTO_CLOSE_MS = 6000;

/**
 * תקרת רשומות בשידור החוזר מה-ring buffer בעלייה (שגיאות init מוקדמות).
 * התקרה היא על רשומות; מספר הטוסטים הגלויים עשוי להיות קטן יותר בגלל
 * חלון ה-dedup הפנימי של showToast (הודעות זהות מקוצצות).
 */
export const REPLAY_CAP = 5;

/**
 * UI Error Sink — נתיב ההצגה היחיד לשגיאות (Phase 1 של docs/ui-sink-plan.md).
 *
 * נרשם כ-sink על ה-logger: כל רשומת ERROR (logger.error / logger.apiError)
 * מציגה טוסט עם ההודעה המפוענחת (parseMondayError.userMessage) וכפתור "פרטים"
 * שפותח את ErrorDetailsModal (דרך ה-errorDetails שהטוסט נושא).
 *
 * עקרונות:
 * - כיוון שכל catch חייב לרשום ל-logger (חוזה ה-ESLint), הצגת כל רשומת ERROR
 *   == הצגת כל שגיאה שנתפסת. אין סינון — גם שגיאות רכות ואבחוני-רקע מוצגים
 *   (הכרעת משתמש, 2026-06-02).
 * - רשומות duplicate (log-once) מדולגות כבר ב-emit — אין טוסט כפול על אותו instance.
 * - replay: רשומות ERROR שנצברו ב-ring buffer לפני ה-mount (שגיאות init) מוצגות
 *   עם הרישום, עד REPLAY_CAP רשומות.
 * - loop guard: throw מתוך ה-sink עצמו לא ייצור רשומה/טוסט חדשים (בנוסף ל-try/catch
 *   שב-dispatchToSinks). re-entry אסינכרוני (למשל כשל העתקה בתוך ErrorToast) מייצר
 *   לכל היותר טוסט-עודף אחד לאירוע משתמש בדיד — לא לולאה.
 *
 * @param {Object} deps
 * @param {function} deps.showToast - showToast של מופע ה-useToast הגלובלי (AppContent)
 */
export const useUiErrorSink = ({ showToast }) => {
    // ref ל-showToast הטרי — הימנעות מ-stale closure בלי לרשום את ה-sink מחדש
    const showToastRef = useRef(showToast);
    useEffect(() => { showToastRef.current = showToast; }, [showToast]);

    // loop guard סינכרוני — מונע ש-throw בתוך ה-handler ייצור רקורסיה דרך emit
    const inSinkRef = useRef(false);

    useEffect(() => {
        const uiHandler = (record) => {
            if (record.level !== 'ERROR') return;
            // קריסות render כבר מוצגות ע"י מסך ה-ErrorBoundary — לא מקפיצים גם טוסט
            // (נתיב הצגה יחיד; ה-record עדיין נרשם ב-buffer ויגיע ל-sink חיצוני עתידי).
            if (record.module === 'ErrorBoundary') return;
            if (inSinkRef.current) return;
            inSinkRef.current = true;
            try {
                // logger.error שם Error ב-record.error ולא-Error ב-record.data — מכסים את שניהם
                const rawError = record.error ?? record.data;
                // rawResponse מגיע ב-context (logger.apiError); הגנה כפולה: bag ישן ב-record.data
                // (rawResponse) או אובייקט-שגיאה רגיל עם .response (כמו שה-facade הישן קיבל)
                const response = record.context?.rawResponse
                    ?? (rawError && typeof rawError === 'object' && !(rawError instanceof Error)
                        ? (rawError.rawResponse ?? rawError.response)
                        : null)
                    ?? null;
                const apiRequest = record.context?.query
                    ? { query: record.context.query, variables: record.context.variables ?? null }
                    : null;

                const parsed = parseMondayError(rawError, response, apiRequest);
                let details = createFullErrorObject(
                    parsed,
                    record.module,
                    record.timestamp,
                    record.context?.duration ?? null,
                    record.correlationId ?? null
                );
                // אותה צורה שה-ErrorDetailsModal מצפה לה (כמו showErrorWithDetails לשעבר)
                details = { ...details, ...parsed };

                showToastRef.current(
                    parsed.userMessage || 'אירעה שגיאה',
                    'error',
                    AUTO_CLOSE_MS,
                    details
                );
            // בליעה שקטה מכוונת וייחודית: זהו ה-sink עצמו — רישום מתוכו היה יוצר
            // רקורסיה דרך emit (בדיוק מה שה-guard מונע). ה-try/catch ב-dispatchToSinks
            // מדווח כשלי-sink ל-console הגולמי.
            // eslint-disable-next-line no-restricted-syntax
            } catch {
                // ראו הערה מעל ה-catch
            } finally {
                inSinkRef.current = false;
            }
        };

        const unsubscribe = logger.addSink(uiHandler);

        // --- Buffer replay: שגיאות init מוקדמות שנרשמו לפני ה-mount ---
        // duplicate מדולג (כבר ייוצג דרך הרשומה המקורית); de-dup לפי correlationId
        // בתוך ה-replay עצמו; עד REPLAY_CAP הרשומות האחרונות, בסדר כרונולוגי.
        const errorRecords = logger.getBuffer().filter(r => r.level === 'ERROR' && !r.duplicate);
        const seen = new Set();
        const toReplay = [];
        for (let i = errorRecords.length - 1; i >= 0 && toReplay.length < REPLAY_CAP; i--) {
            const r = errorRecords[i];
            if (r.correlationId && seen.has(r.correlationId)) continue;
            if (r.correlationId) seen.add(r.correlationId);
            toReplay.push(r);
        }
        toReplay.reverse().forEach(uiHandler);

        return unsubscribe;
        // ריצה פעם אחת ב-mount — ה-handler קורא דרך refs טריים
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
};

export default useUiErrorSink;
