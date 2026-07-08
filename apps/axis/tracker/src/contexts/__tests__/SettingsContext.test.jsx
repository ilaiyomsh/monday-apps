import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import React from 'react';
import { SettingsProvider, useSettings } from '../SettingsContext';

// ה-Provider תלוי ב-useMondayContext — vi.mock עובר hoist אוטומטית מעל ה-import-ים
// ע"י vitest, כך שה-mock עדיין נקבע לפני שה-Provider נטען בפועל.
vi.mock('../MondayContext', () => ({
    useMondayContext: () => ({
        context: { boardId: 123, instanceId: 'test-instance' },
        currentUser: { id: 'u1', name: 'Tester' }
    })
}));

const RELOAD_GUARD_KEY = 'tracker_settings_reload_done';

function createMonday(getItemImpl) {
    return {
        storage: {
            getItem: vi.fn(getItemImpl),
            setItem: vi.fn().mockResolvedValue({ data: { success: true } }),
            instance: {
                getItem: vi.fn().mockResolvedValue({ data: {} }),
                setItem: vi.fn().mockResolvedValue({ data: { success: true } })
            }
        }
    };
}

function createWrapper(monday) {
    return ({ children }) => (
        <SettingsProvider monday={monday}>{children}</SettingsProvider>
    );
}

describe('SettingsContext loadSettings', () => {
    let reloadSpy;
    let originalReload;

    beforeEach(() => {
        sessionStorage.clear();
        originalReload = window.location.reload;
        // window.location.reload לא ניתן ל-spy ישיר; מחליפים את location כולו
        reloadSpy = vi.fn();
        Object.defineProperty(window, 'location', {
            configurable: true,
            value: { ...window.location, reload: reloadSpy }
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        Object.defineProperty(window, 'location', {
            configurable: true,
            value: { ...window.location, reload: originalReload }
        });
    });

    it('reason: success_with_value — טוען הגדרות שמורות', async () => {
        const saved = { fieldConfig: { task: 'required' }, lastModifiedAt: '2026-01-01' };
        const monday = createMonday(() =>
            Promise.resolve({ data: { success: true, value: JSON.stringify(saved) } })
        );

        const { result } = renderHook(() => useSettings(), { wrapper: createWrapper(monday) });

        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(result.current.loadError).toBeNull();
        expect(result.current.customSettings.lastModifiedAt).toBe('2026-01-01');
        expect(reloadSpy).not.toHaveBeenCalled();
    });

    it('reason: success_empty_new_instance — מופע חדש, ברירות מחדל, ללא reload', async () => {
        const monday = createMonday(() => Promise.resolve({ data: { success: true } }));

        const { result } = renderHook(() => useSettings(), { wrapper: createWrapper(monday) });

        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(result.current.loadError).toBeNull();
        expect(reloadSpy).not.toHaveBeenCalled();
        expect(sessionStorage.getItem(RELOAD_GUARD_KEY)).toBeNull();
        // customSettings נשאר ברירות המחדל — בודקים שדה ייצוגי
        expect(result.current.customSettings.projectsSourceMode).toBe('board');
    });

    it('settings פגום (JSON לא תקין) — נופל לברירות מחדל, הספינר לא נתקע (Phase 4 H1)', async () => {
        // value קיים אך אינו JSON תקין → JSON.parse זורק בתוך ה-try
        const monday = createMonday(() =>
            Promise.resolve({ data: { success: true, value: '{this is : not valid json' } })
        );

        const { result } = renderHook(() => useSettings(), { wrapper: createWrapper(monday) });

        // הקריטריון המרכזי: הספינר לא נתקע — isLoading הופך ל-false
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        // נפילה חיננית לברירות מחדל (שדה ייצוגי) — לא קריסה / מסך לבן
        expect(result.current.customSettings.projectsSourceMode).toBe('board');
        // לא מפעילים reload על parse פגום (זו לא תקלת רשת)
        expect(reloadSpy).not.toHaveBeenCalled();
    });

    it('reason: timeout — מפעיל silent reload פעם אחת ומסמן guard', async () => {
        vi.useFakeTimers();
        const monday = createMonday(() => new Promise(() => {}));   // never resolves

        renderHook(() => useSettings(), { wrapper: createWrapper(monday) });

        // ה-effect ב-Provider מפעיל את loadSettings אחרי שה-context קיים (microtask).
        // מקדמים מיקרו-טסקים ואז מקדמים 5s עד שה-timeout נורה.
        await act(async () => {
            await Promise.resolve();
            vi.advanceTimersByTime(5000);
            await Promise.resolve();
        });

        expect(reloadSpy).toHaveBeenCalledTimes(1);
        expect(sessionStorage.getItem(RELOAD_GUARD_KEY)).toBe('1');
    });

    it('reason: timeout אחרי שה-guard כבר הופעל — מציג loadError, לא קורא reload שני', async () => {
        vi.useFakeTimers();
        sessionStorage.setItem(RELOAD_GUARD_KEY, '1');
        const monday = createMonday(() => new Promise(() => {}));

        const { result } = renderHook(() => useSettings(), { wrapper: createWrapper(monday) });

        await act(async () => {
            await vi.advanceTimersByTimeAsync(5000);
        });

        expect(reloadSpy).not.toHaveBeenCalled();
        expect(result.current.loadError).toEqual({ kind: 'network' });
        expect(result.current.isLoading).toBe(false);
    });
});
