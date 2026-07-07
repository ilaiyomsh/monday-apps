import React from 'react';
import { renderHook } from '@testing-library/react';
import { MondayProvider } from '../contexts/MondayContext';
import { SettingsProvider } from '../contexts/SettingsContext';

/**
 * renderHook עם MondayProvider + SettingsProvider — לטסטי integration על hooks
 * שצורכים את ה-Contexts. דומה ל-renderWithProviders אבל לרינדור hooks.
 *
 * @param {Function} hook הפונקציה לקריאה (() => useMyHook(...))
 * @param {object} options
 * @param {object} options.monday — חובה. createMondayMock instance.
 * @param {object} [options.initialContext]
 * @param {object} [options.initialSettings]
 * @param {'he'|'en'} [options.language]
 */
export function renderHookWithProviders(hook, {
    monday,
    initialContext,
    initialSettings,
    language,
    ...renderOptions
} = {}) {
    if (!monday) {
        throw new Error('renderHookWithProviders: monday mock is required');
    }

    const baseContext = initialContext ? { ...initialContext } : {};
    if (language) {
        baseContext.user = { ...(baseContext.user || {}), currentLanguage: language };
    }

    if (initialContext || language) {
        monday.get.mockImplementation(async (key) => {
            if (key === 'context') return { data: baseContext };
            if (key === 'settings') return { data: {} };
            if (key === 'filter') return { data: null };
            return { data: null };
        });
    }

    if (initialSettings) {
        const instanceId = baseContext?.instanceId || baseContext?.boardId || 'default';
        const globalKey = `customSettings_${instanceId}`;
        const payload = JSON.stringify(initialSettings);
        if (typeof monday.__seedStorage === 'function') {
            monday.__seedStorage(globalKey, payload);
        } else {
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

    return renderHook(hook, { wrapper: Wrapper, ...renderOptions });
}

export default renderHookWithProviders;
