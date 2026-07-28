import React from 'react';
import i18next from 'i18next';
import { parseMondayError, createFullErrorObject } from '../../utils/errorHandler';
import { isChunkLoadError } from '../../utils/lazyRetry';
import logger from '../../utils/logger';

/**
 * Error Boundary - תופס שגיאות React שלא טופלו ומציג מסך אחיד.
 *
 * שני מצבי הצגה (החלטת אחידות, 2026-06-03):
 *  1. כשל טעינת רכיב (chunk-load) — מסך רענון ייעודי עם כפתור "רענן את הדף"
 *     (remount לא יעזור אם ה-chunk לא נטען). זהו ה*נתיב היחיד* לכשלי chunk —
 *     הטוסטים ב-lazyRetry/globalErrorHandler הורדו ל-warn כדי לא להציף את המסך.
 *  2. קריסת render אמיתית (באג בקוד) — מסך ידידותי בעברית עם "נסה שוב" (remount)
 *     וכפתור "פרטים" אופציונלי (פותח את ErrorDetailsModal דרך onError, לפי לחיצה).
 *     ה-stack הגולמי אינו מוצג למשתמש; הוא נרשם ל-logger ונשמר בפרטים.
 *
 * ה-UI sink מדלג על רשומות ERROR שמקורן 'ErrorBoundary' (ההצגה כאן, לא בטוסט).
 *
 * זו class component, אז אין hooks. במקום useTranslation() אנחנו קוראים
 * ל-`i18next.t` ישירות. אם i18next טרם אותחל (boot מוקדם או שגיאה ב-init),
 * נופלים לעברית קשיחה — בטוח יותר מ-crash. הכיוון inline נשאר 'inherit'
 * כדי לכבד את ה-dir של ה-document/parent (ב-LTR ייצא LTR, ב-RTL ייצא RTL).
 */

const fallback = (key, hebrew) => {
    try {
        if (i18next?.isInitialized) {
            const translated = i18next.t(key);
            if (translated && translated !== key) return translated;
        }
    } catch (error) {
        // נופלים ל-fallback העברי הקשיח, אבל לא בולעים בשקט —
        // כשל ב-i18next.t בתוך ה-ErrorBoundary עצמו הוא מקור-dark שצריך ניטור.
        logger.warn('ErrorBoundary', 'i18next.t fallback failed', error);
    }
    return hebrew;
};

const btnStyle = {
    padding: '8px 24px',
    borderRadius: '4px',
    border: '1px solid var(--color-border, #c3c6d4)',
    background: 'var(--color-bg-primary, #ffffff)',
    cursor: 'pointer',
    fontSize: '14px'
};

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, isChunk: false, fullErrorObject: null };
        this.handleReset = this.handleReset.bind(this);
        this.handleRefresh = this.handleRefresh.bind(this);
        this.handleShowDetails = this.handleShowDetails.bind(this);
    }

    static getDerivedStateFromError(error) {
        // מבדילים כבר כאן בין כשל טעינת chunk (פתיר ברענון) לקריסת render אמיתית.
        return { hasError: true, isChunk: isChunkLoadError(error) };
    }

    componentDidCatch(error, errorInfo) {
        // מטביעים את componentStack של React על אובייקט השגיאה כדי שיזרום ל-Axiom sink:
        // logger.error(module,message,error) של tracker נעול-טסטים ואינו נושא context bag,
        // לכן ה-sink קורא את errorInfo.componentStack מתוך אובייקט השגיאה (mapRecordToEvent →
        // component_stack). Object.isExtensible מונע זריקה על שגיאה קפואה בלי catch ריק.
        if (error && typeof error === 'object' && errorInfo?.componentStack && Object.isExtensible(error)) {
            error.componentStack = errorInfo.componentStack;
        }
        // נשאר logger.error (הרשומה הקנונית ל-sink חיצוני עתידי). ה-UI sink מדלג על
        // module='ErrorBoundary' ולכן אין טוסט כפול — ההצגה היא מסך ה-fallback בלבד.
        logger.error('ErrorBoundary', 'React error caught', error);
        // בונים את אובייקט הפרטים מראש; נפתח אותו רק אם המשתמש ילחץ "פרטים".
        const parsedError = parseMondayError(error);
        const fullErrorObject = createFullErrorObject(parsedError, 'ErrorBoundary', Date.now(), null);
        this.setState({ fullErrorObject });
    }

    /** "נסה שוב" — איפוס ה-boundary ו-remount של תת-העץ (לקריסת render). */
    handleReset() {
        this.setState({ hasError: false, isChunk: false, fullErrorObject: null });
    }

    /** "רענן את הדף" — לכשל chunk-load (remount לא יטען chunk חסר). */
    handleRefresh() {
        if (typeof window !== 'undefined') window.location.reload();
    }

    /** "פרטים" — פתיחת ErrorDetailsModal לפי בקשה (לא אוטומטית), אם סופק onError. */
    handleShowDetails() {
        if (this.props.onError && this.state.fullErrorObject) {
            this.props.onError(this.state.fullErrorObject);
        }
    }

    render() {
        if (!this.state.hasError) {
            return this.props.children;
        }
        if (this.props.fallback) {
            return this.props.fallback;
        }

        // --- מסך כשל טעינת רכיב (chunk-load): רענון ---
        if (this.state.isChunk) {
            const chunkTitle = fallback('errorBoundary.chunkTitle', 'טעינת רכיב נכשלה');
            const chunkMessage = fallback('errorBoundary.chunkMessage', 'ייתכן שיצאה גרסה חדשה או שאין חיבור לרשת. רענן את הדף כדי להמשיך.');
            const refreshLabel = fallback('errorBoundary.refresh', 'רענן את הדף');
            return (
                <div style={{ padding: '20px', textAlign: 'center' }}>
                    <h2>{chunkTitle}</h2>
                    <p>{chunkMessage}</p>
                    <button type="button" onClick={this.handleRefresh} style={btnStyle}>
                        {refreshLabel}
                    </button>
                </div>
            );
        }

        // --- מסך קריסת render: הודעה ידידותית בלבד (בלי stack) ---
        const title = fallback('errorBoundary.title', 'אירעה שגיאה');
        const message = fallback('errorBoundary.message', 'אנא רענן את הדף או פנה לתמיכה.');
        const retryLabel = fallback('errors.toast.retry', 'נסה שוב');
        const detailsLabel = fallback('errorBoundary.details', 'פרטים');
        return (
            <div style={{ padding: '20px', textAlign: 'center' }}>
                <h2>{title}</h2>
                <p>{message}</p>
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                    <button type="button" onClick={this.handleReset} style={btnStyle}>
                        {retryLabel}
                    </button>
                    {this.props.onError && (
                        <button type="button" onClick={this.handleShowDetails} style={btnStyle}>
                            {detailsLabel}
                        </button>
                    )}
                </div>
            </div>
        );
    }
}

export default ErrorBoundary;
