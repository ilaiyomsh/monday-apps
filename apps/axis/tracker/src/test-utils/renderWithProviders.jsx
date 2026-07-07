import React from 'react';
import { render } from '@testing-library/react';
import { MondayProvider } from '../contexts/MondayContext';
import { SettingsProvider } from '../contexts/SettingsContext';

/**
 * מרנדר רכיב עטוף ב-providers עם ברירות מחדל בטוחות לטסטים.
 *
 * @param {React.ReactElement} ui הרכיב לרינדור
 * @param {object} options
 * @param {object} options.monday — חובה. ה-Mock של Monday SDK (createMondayMock).
 * @param {object} [options.initialContext] — קונטקסט לזרוק ל-Monday SDK
 * @param {object} [options.initialSettings] — הגדרות לזרוק ל-storage
 * @param {'he'|'en'} [options.language] — קיצור: קובע context.user.currentLanguage
 */
export function renderWithProviders(ui, {
    monday,
    initialContext,
    initialSettings,
    language,
    ...renderOptions
} = {}) {
    if (!monday) {
        throw new Error('renderWithProviders: monday mock is required');
    }

    // בניית קונטקסט סופי על בסיס initialContext + language
    const baseContext = initialContext ? { ...initialContext } : {};
    if (language) {
        baseContext.user = { ...(baseContext.user || {}), currentLanguage: language };
    }

    if (initialContext || language) {
        monday.get.mockImplementation(async (key) => {
            if (key === 'context') return { data: baseContext };
            if (key === 'settings') return { data: {} };
            return { data: null };
        });
    }

    // Seed של ה-storage עם ההגדרות הראשוניות (סינכרוני — בלי race עם
    // SettingsProvider שיקרא getItem ב-useEffect מיד אחרי mount).
    if (initialSettings) {
        const instanceId = baseContext?.instanceId || baseContext?.boardId || 'default';
        const globalKey = `customSettings_${instanceId}`;
        const payload = JSON.stringify(initialSettings);
        if (typeof monday.__seedStorage === 'function') {
            monday.__seedStorage(globalKey, payload);
        } else {
            // נפילה רכה: עדיין עובד עם mocks שלא חושפים __seedStorage
            monday.storage.setItem(globalKey, payload);
        }
    }

    const Wrapper = ({ children }) => (
        <MondayProvider monday={monday}>
            <SettingsProvider monday={monday}>
                {children}
            </SettingsProvider>
        </MondayProvider>
    );

    return render(ui, { wrapper: Wrapper, ...renderOptions });
}

export default renderWithProviders;
