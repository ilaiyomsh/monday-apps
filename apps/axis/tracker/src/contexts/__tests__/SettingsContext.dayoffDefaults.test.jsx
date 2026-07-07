/**
 * W4.8 (אינטגרציית Day-off) — נעילת ברירות המחדל של מפתחות מקור ההיעדרויות.
 *
 * הערובה לכך ש~855 הטסטים הוותיקים ממשיכים לבדוק את ההתנהגות הנוכחית היא
 * שברירות המחדל של W4.4/W4.5 משמרות את זרימת ה-tracker — אבל עד כאן אף טסט
 * לא קיבע אותן (שום קובץ לא בודק את ערכי DEFAULT_SETTINGS של ה-day-off).
 * שינוי ברירת מחדל כאן = שינוי התנהגות לכל התקנה קיימת שה-blob השמור שלה
 * לא מכיל את המפתח — ולכן חייב להפיל טסט בקול, לא לעבור בשקט.
 *
 * חשוב: ה-cutover (W5.4) מתבצע בהיפוך הערך השמור פר-התקנה דרך דיאלוג
 * ההגדרות — לעולם לא בהיפוך ברירת המחדל שבקוד.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { SettingsProvider, useSettings } from '../SettingsContext';

// ה-Provider תלוי ב-useMondayContext — vi.mock עובר hoist אוטומטית מעל
// ה-import-ים (אותה תבנית כמו SettingsContext.test.jsx)
vi.mock('../MondayContext', () => ({
    useMondayContext: () => ({
        context: { boardId: 123, instanceId: 'test-instance' },
        currentUser: { id: 'u1', name: 'Tester' }
    })
}));

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

async function loadSettingsWith(getItemImpl) {
    const monday = createMonday(getItemImpl);
    const { result } = renderHook(() => useSettings(), { wrapper: createWrapper(monday) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.loadError).toBeNull();
    return result.current.customSettings;
}

describe('SettingsContext — ברירות המחדל של אינטגרציית Day-off (W4.8)', () => {

    beforeEach(() => {
        sessionStorage.clear();
    });

    it('מופע חדש: absenceSource=tracker וכל מיפוי ה-day-off ריק — הזרימה הוותיקה נשמרת', async () => {
        // success ללא value = success_empty_new_instance ⇒ ברירות מחדל נטו
        const s = await loadSettingsWith(() => Promise.resolve({ data: { success: true } }));

        // הדגלים ההתנהגותיים (W4.4/W4.5) — אלה הערכים שכל שאר הסוויטה נשענת עליהם
        expect(s.absenceSource).toBe('tracker');
        expect(s.showAbsences).toBe(true);
        expect(s.dayOffApprovalRequired).toBe(false);
        expect(s.dayOffAppUrl).toBe('');

        // מיפוי לוח החופשות (D9) — ריק עד שמוגדר ידנית; לוח לא ממופה משאיר
        // את שכבת ה-overlay רדומה (useDayOffAbsences gating)
        expect(s.dayOffBoardId).toBeNull();
        expect(s.dayOffPersonColumnId).toBeNull();
        expect(s.dayOffStartDateColumnId).toBeNull();
        expect(s.dayOffEndDateColumnId).toBeNull();
        expect(s.dayOffKindColumnId).toBeNull();
        expect(s.dayOffKindGeneralLabelId).toBeNull();
        expect(s.dayOffKindPersonalLabelId).toBeNull();
        expect(s.dayOffTypeColumnId).toBeNull();
        expect(s.dayOffApprovalColumnId).toBeNull();
        expect(s.dayOffApprovedLabelIds).toEqual([]);
        expect(s.dayOffPendingLabelIds).toEqual([]);
        expect(s.dayOffRejectedLabelIds).toEqual([]);
    });

    it('merge-on-load: blob שמור מלפני W4.5 (ללא מפתחות day-off) נפתר ל-tracker — back-compat', async () => {
        // הגדרות אמיתיות של התקנה ותיקה: אף מפתח day-off לא קיים ב-blob
        const preW45Blob = {
            timeReportingBoardId: '2002',
            dateColumnId: 'date_col',
            lastModifiedAt: '2026-01-01T00:00:00.000Z'
        };
        const s = await loadSettingsWith(() =>
            Promise.resolve({ data: { success: true, value: JSON.stringify(preW45Blob) } })
        );

        // המפתחות השמורים שרדו את ה-merge
        expect(s.timeReportingBoardId).toBe('2002');
        expect(s.dateColumnId).toBe('date_col');

        // ומפתחות ה-day-off הושלמו מברירת המחדל — התנהגות ותיקה נשמרת
        expect(s.absenceSource).toBe('tracker');
        expect(s.showAbsences).toBe(true);
        expect(s.dayOffApprovalRequired).toBe(false);
        expect(s.dayOffBoardId).toBeNull();
        expect(s.dayOffApprovedLabelIds).toEqual([]);
    });

    it("blob שמור עם 'dayoff' גובר על ברירת המחדל; מפתחות שלא נשמרו עדיין מושלמים", async () => {
        const dayoffBlob = {
            absenceSource: 'dayoff',
            dayOffBoardId: '5005',
            lastModifiedAt: '2026-01-01T00:00:00.000Z'
        };
        const s = await loadSettingsWith(() =>
            Promise.resolve({ data: { success: true, value: JSON.stringify(dayoffBlob) } })
        );

        // הערך השמור מנצח את ברירת המחדל (זה מנגנון ה-cutover של W5.4)
        expect(s.absenceSource).toBe('dayoff');
        expect(s.dayOffBoardId).toBe('5005');

        // והשלמת ברירות מחדל למפתחות שלא נשמרו ממשיכה לעבוד
        expect(s.showAbsences).toBe(true);
        expect(s.dayOffApprovalRequired).toBe(false);
        expect(s.dayOffApprovedLabelIds).toEqual([]);
    });
});
