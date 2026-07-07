import React, { createContext, useContext, useState, useEffect, useMemo, useRef } from 'react';
import { resolveLanguage } from '../i18n';
import logger from '../utils/logger';
import { setAxiomContext, isAxiomSinkActive } from '../utils/axiomSink';

// default = null: צרכנים שמשתמשים ב-useMondayContext מחוץ ל-Provider ייכשלו
// בצורה ברורה (TypeError on destructuring) במקום ליפול בשקט ל-locale עברי.
// בכל מסלול בייצור הקומפוננטות עטופות ב-MondayProvider; כשלון בייצור מעיד על באג.
const MondayContext = createContext(null);

/**
 * מיפוי שפה ל-locale שלם — locale עם region לפורמטים של Intl/date-fns.
 * נשמר מצומצם בכוונה: רק שפות נתמכות.
 */
const LANGUAGE_TO_LOCALE = {
    he: 'he-IL',
    en: 'en-US'
};

/**
 * נגזרות מ-language. לא תלויות בקונטקסט של Monday — רק בשפה הסופית.
 *
 * dir: 'rtl' לעברית, 'ltr' לאנגלית (אינקרמנט 10).
 */
function deriveLanguageMeta(language) {
    return {
        dir: language === 'en' ? 'ltr' : 'rtl',
        locale: LANGUAGE_TO_LOCALE[language] || LANGUAGE_TO_LOCALE.he
    };
}

/**
 * ספק מרכזי לקונטקסט Monday SDK
 * טוען את הקונטקסט פעם אחת ומנגיש אותו לכל האפליקציה
 * @param {object} props.monday - אובייקט ה-Monday SDK
 */
export function MondayProvider({ monday, children }) {
    const [context, setContext] = useState(null);
    const [currentUser, setCurrentUser] = useState(null);

    useEffect(() => {
        let realContextLoaded = false;

        // טיפול ב-context אמיתי — תמיד מעדכן את ה-state, גם אם ה-watchdog הציב fallback קודם
        const handleContext = (res) => {
            if (!res?.data) return;
            realContextLoaded = true;
            setContext(res.data);
            setCurrentUser(res.data.user ? {
                id: res.data.user.id || null,
                name: res.data.user.name || ''
            } : null);
            // העשרת שורות ה-Axiom במזהים בלבד (acc/usr/obj/board) — מיזוג, קריאות חוזרות בטוחות
            setAxiomContext({
                accountId: res.data.account?.id ?? res.data.accountId,
                userId: res.data.user?.id,
                boardId: res.data.boardId,
                instanceId: res.data.instanceId
            });
            if (import.meta.env.DEV) {
                // probe חד-פעמי: שם השדה האמיתי של חשבון בקונטקסט (account.id מול accountId)
                logger.debug('MondayProvider', 'context keys', { keys: Object.keys(res.data) });
            }
            logger.initDone(3, 'Context loaded', { boardId: res.data.boardId, userId: res.data.user?.id });
            logger.info('MondayProvider', 'Loaded context', res.data);
        };

        monday.get('context').then(handleContext).catch(error => {
            logger.error('MondayProvider', 'Error loading context', error);
        });

        // Listener קבוע - במובייל לפעמים monday.get('context') לא מחזיר אבל context מגיע באירוע
        const unsubscribe = monday.listen('context', handleContext);

        // Watchdog - מציב context ריק כ-fallback רק אם המקורי עדיין לא הגיע
        // אם context אמיתי יגיע מאוחר יותר (דרך listen) הוא יחליף את הריק
        const watchdog = setTimeout(() => {
            if (!realContextLoaded) {
                logger.warn('MondayProvider', 'Context load timeout after 5s, using empty context as fallback');
                setContext(prev => prev ?? {});
            }
        }, 5000);

        return () => {
            clearTimeout(watchdog);
            if (typeof unsubscribe === 'function') unsubscribe();
        };
    }, [monday]);

    useEffect(() => {
        // אם כבר יש שם משתמש מה-context אין צורך בקריאת API נוספת
        if (!context?.user?.id || context?.user?.name || typeof monday.api !== 'function') return;

        let isCancelled = false;
        const loadCurrentUser = async () => {
            try {
                const response = await monday.api('query { me { id name } }');
                const me = response?.data?.me;
                if (!me || isCancelled) return;

                setCurrentUser({ id: me.id, name: me.name || '' });
                setContext(prev => {
                    if (!prev) return prev;
                    return {
                        ...prev,
                        user: {
                            ...(prev.user || {}),
                            id: prev.user?.id || me.id,
                            name: prev.user?.name || me.name || ''
                        }
                    };
                });
            } catch (error) {
                logger.error('MondayProvider', 'Error loading current user profile', error);
            }
        };

        loadCurrentUser();
        return () => {
            isCancelled = true;
        };
    }, [monday, context]);

    // השלמת accountId לשורות ה-Axiom כשהקונטקסט לא סיפק אותו — שאילתה חד-פעמית,
    // רק כשהשילוח בכלל פעיל (בניית prod עם token): לא שורפים קריאת API על
    // טלמטריה ב-dev/tunnel. סובל גם את ה-fallback הריק של ה-watchdog ({}).
    const accountIdQueriedRef = useRef(false);
    useEffect(() => {
        if (!isAxiomSinkActive() || !context || accountIdQueriedRef.current) return;
        if (context.account?.id ?? context.accountId) return;
        if (typeof monday.api !== 'function') return;
        accountIdQueriedRef.current = true;

        monday.api('query { me { account { id } } }')
            .then(response => {
                const accountId = response?.data?.me?.account?.id;
                if (accountId) setAxiomContext({ accountId });
            })
            .catch(error => {
                // scope חסר ⇒ acc נשאר ריק — מצב מדורדר מקובל (plan §8.4); DEBUG לא משולח
                logger.debug('MondayProvider', 'accountId fallback query failed', error);
            });
    }, [monday, context]);

    const isMobile = context?.mode === 'mobile';

    // שפה ונגזרות ה-i18n של ההפעלה (Increment 5).
    // resolveLanguage מטפל ב-fallback ל-'he' עבור שפות לא נתמכות —
    // לכן השדות language/dir/locale תקפים גם כשהקונטקסט עוד null.
    const language = useMemo(
        () => resolveLanguage({}, context),
        [context]
    );
    const { dir, locale } = useMemo(
        () => deriveLanguageMeta(language),
        [language]
    );

    // ברירות מחדל לאפליקציה (ישראל). המשתמש יכול לדרוס דרך SettingsContext.
    // TODO (locale-driven): להפיק weekStartDay/timeFormat מ-useLocale() / מ-locale
    // של המשתמש כשנפתח השימוש לארגונים מחוץ לישראל. כרגע נשאר hardcoded כי כל
    // הצרכנים משתמשים ב-SettingsContext לדריסה.
    const weekStartDay = 0;
    const timeFormat = '24h';

    const value = useMemo(
        () => ({ context, isMobile, currentUser, language, dir, locale, weekStartDay, timeFormat }),
        [context, isMobile, currentUser, language, dir, locale]
    );

    return (
        <MondayContext.Provider value={value}>
            {children}
        </MondayContext.Provider>
    );
}

/**
 * Hook לגישה לקונטקסט Monday המלא
 * @returns {{ context: object|null, isMobile: boolean }}
 */
export function useMondayContext() {
    const value = useContext(MondayContext);
    if (value === null) {
        throw new Error('useMondayContext must be used within a MondayProvider');
    }
    return value;
}

/**
 * Hook קיצור לבדיקת מובייל
 * @returns {boolean}
 */
export function useMobile() {
    const { isMobile } = useMondayContext();
    return isMobile;
}
