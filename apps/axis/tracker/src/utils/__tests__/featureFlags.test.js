import { describe, it, expect } from 'vitest';
import { isLanguagePickerEnabled } from '../featureFlags';

describe('featureFlags (Increment 8-9)', () => {

    describe('isLanguagePickerEnabled', () => {
        it('מחזיר תוצאה boolean ולא משהו אחר', () => {
            // הערה: מאז אינקרמנט 9 (.env מכיל VITE_ENABLE_LANGUAGE_PICKER=true)
            // הערך בפועל יהיה true. הטסט מאמת רק את הצורה.
            const result = isLanguagePickerEnabled();
            expect(typeof result).toBe('boolean');
        });

        it('משקף את ערך ה-env (אינקרמנט 9 — soft launch מופעל)', () => {
            // .env מכיל VITE_ENABLE_LANGUAGE_PICKER=true. אם בעתיד מבטלים
            // (לדוגמה אם תופס באג בייצור), מורידים את השורה מ-.env והטסט
            // הזה ייכשל — סיגנל ברור שמשהו השתנה בקונפיגורציה.
            expect(isLanguagePickerEnabled()).toBe(true);
        });
    });
});
