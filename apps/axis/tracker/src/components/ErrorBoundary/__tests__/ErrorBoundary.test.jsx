import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ErrorBoundary from '../ErrorBoundary';
import logger from '../../../utils/logger';

// Phase 5 — אשכול "ErrorBoundary hoist".
// הגבול נתפס ב-App.jsx *מעל* שלושת ה-providers (self-contained — תלוי רק ב-i18next/logger).
// בדיקות אלה מאמתות את שתי ההתנהגויות הקריטיות של גבול השורש:
//   1. זריקת render נתפסת ומציגה fallback (לא מלבין מסך, לא מפיל את כל העץ).
//   2. השגיאה נרשמת דרך logger (מנוטרת — לא נבלעת בשתיקה).

// רכיב שזורק בעת render — מדמה כשל בתוך ה-providers / עץ ה-lazy.
const Boom = () => {
    throw new Error('boom-from-render');
};

const Ok = () => <div>תוכן תקין</div>;

describe('ErrorBoundary (גבול שורש)', () => {
    let consoleErrorSpy;

    beforeEach(() => {
        vi.clearAllMocks();
        // React מדפיס את ה-componentStack ל-console.error כשגבול תופס שגיאה — מושתק כדי לא לזהם פלט.
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it('מרנדר את הילדים כשאין שגיאה', () => {
        render(
            <ErrorBoundary>
                <Ok />
            </ErrorBoundary>
        );
        expect(screen.getByText('תוכן תקין')).toBeInTheDocument();
    });

    it('תופס זריקת render ומציג fallback במקום להלבין מסך', () => {
        render(
            <ErrorBoundary>
                <Boom />
            </ErrorBoundary>
        );
        // ה-fallback של i18next (errorBoundary.title) — i18next מאותחל ב-setupTests.
        expect(screen.getByText('אירעה שגיאה')).toBeInTheDocument();
    });

    it('רושם את השגיאה דרך logger.error (מנוטרת, לא נבלעת)', () => {
        render(
            <ErrorBoundary>
                <Boom />
            </ErrorBoundary>
        );
        expect(logger.error).toHaveBeenCalledWith(
            'ErrorBoundary',
            'React error caught',
            expect.objectContaining({ message: 'boom-from-render' })
        );
    });

    it('כפתור "פרטים" קורא ל-onError עם אובייקט שגיאה (לפי לחיצה, לא אוטומטית)', () => {
        const onError = vi.fn();
        render(
            <ErrorBoundary onError={onError}>
                <Boom />
            </ErrorBoundary>
        );
        // לא נקרא אוטומטית — המסך נקי, ה-modal לא קופץ מעצמו
        expect(onError).not.toHaveBeenCalled();

        // לחיצה על "פרטים" פותחת את מודאל הפרטים
        fireEvent.click(screen.getByRole('button', { name: 'פרטים' }));
        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError).toHaveBeenCalledWith(expect.any(Object));
    });

    it('כשל טעינת chunk → מסך רענון ייעודי (לא מסך הקריסה הגנרי)', () => {
        const ChunkBoom = () => {
            throw new Error('Unable to preload CSS for /assets/TaskSelect-fdNbKiiw.css');
        };
        render(
            <ErrorBoundary>
                <ChunkBoom />
            </ErrorBoundary>
        );
        // מסך chunk — כותרת ייעודית וכפתור רענון, לא "אירעה שגיאה"/"נסה שוב"
        expect(screen.getByText('טעינת רכיב נכשלה')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'רענן את הדף' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'נסה שוב' })).not.toBeInTheDocument();
    });

    it('כפתור "נסה שוב" מאפס את הגבול ומרכיב מחדש את הילדים', () => {
        // ילד שזורק רק כל עוד הדגל פעיל — אחרי האיפוס הוא מתרנדר תקין
        let shouldThrow = true;
        const OnceBoom = () => {
            if (shouldThrow) throw new Error('boom-once');
            return <div>התאוששנו</div>;
        };

        render(
            <ErrorBoundary>
                <OnceBoom />
            </ErrorBoundary>
        );
        expect(screen.getByText('אירעה שגיאה')).toBeInTheDocument();

        shouldThrow = false;
        fireEvent.click(screen.getByRole('button', { name: 'נסה שוב' }));

        // הגבול אופס — הילדים מורכבים מחדש ומציגים תוכן תקין
        expect(screen.getByText('התאוששנו')).toBeInTheDocument();
        expect(screen.queryByText('אירעה שגיאה')).not.toBeInTheDocument();
    });

    it('לא דורש onError — גבול השורש פועל בלעדיו', () => {
        // גבול השורש ב-App.jsx מורם מעל ה-providers ולכן אין לו גישה ל-openErrorDetailsModal;
        // עליו לפעול גם בלי onError (fallback UI + logger בלבד).
        expect(() =>
            render(
                <ErrorBoundary>
                    <Boom />
                </ErrorBoundary>
            )
        ).not.toThrow();
        expect(screen.getByText('אירעה שגיאה')).toBeInTheDocument();
        expect(logger.error).toHaveBeenCalled();
    });
});
