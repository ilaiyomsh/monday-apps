import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * בדיקת רגרסיה לנתיב הייצוא (Phase 5 — מקורות-dark לא משובצים).
 *
 * exportDashboardToExcel הוא async ומכיל שני awaits שעלולים להידחות:
 *   1. await import('exceljs')          — dynamic-import שעלול להיכשל (chunk-load / רשת)
 *   2. await workbook.xlsx.writeBuffer() — בנייה שעלולה להיכשל
 *
 * שני הנתיבים חייבים להפיץ rejection החוצה, כדי שה-catch ב-Dashboard.jsx
 * (handleExport) ירשום אותם דרך logger. הבדיקה מוודאת שאף נתיב לא נבלע בשתיקה.
 */

// --- mock ל-exceljs: ניתן להחלפה דינמית פר-בדיקה ---
const writeBufferMock = vi.fn();
const addWorksheetMock = vi.fn();

vi.mock('exceljs', () => {
    class Workbook {
        constructor() {
            this.xlsx = { writeBuffer: writeBufferMock };
        }
        addWorksheet(...args) {
            return addWorksheetMock(...args);
        }
    }
    return { default: { Workbook }, Workbook };
});

// עזר: בונה worksheet מינימלי שתומך ב-API ש-excelExporter קורא לו
function buildFakeWorksheet() {
    const makeCell = () => ({ value: undefined, font: undefined, alignment: undefined, fill: undefined, border: undefined, numFmt: undefined });
    const rowCellCache = new Map();
    const makeRow = () => ({
        height: undefined,
        getCell: (i) => {
            if (!rowCellCache.has(i)) rowCellCache.set(i, makeCell());
            return rowCellCache.get(i);
        }
    });
    return {
        getColumn: () => ({ width: undefined }),
        getRow: () => makeRow()
    };
}

describe('excelExporter — exportDashboardToExcel', () => {
    let exportDashboardToExcel;

    const sampleEvents = [
        { date: new Date(2026, 0, 15), reporterId: '1', projectName: 'פרויקט א', hours: 8, isBillable: true, stageLabel: 'פיתוח', notes: 'הערה' }
    ];
    const reporters = [{ id: '1', name: 'דני' }];

    beforeEach(async () => {
        vi.clearAllMocks();
        addWorksheetMock.mockReturnValue(buildFakeWorksheet());
        // jsdom: spy רק על מתודות ה-URL (לא לדרוס את הקונסטרקטור — Blob תלוי בו)
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        // jsdom לא מממש ניווט; דורסים את click של <a> כדי שנתיב ההורדה לא יזעיק warning
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        ({ exportDashboardToExcel } = await import('../excelExporter'));
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('נתיב מוצלח: כותב buffer ולא זורק', async () => {
        writeBufferMock.mockResolvedValue(new ArrayBuffer(8));
        await expect(
            exportDashboardToExcel(sampleEvents, reporters, 'test.xlsx', false)
        ).resolves.toBeUndefined();
        expect(writeBufferMock).toHaveBeenCalledTimes(1);
    });

    it('נתיב כשל #2 (writeBuffer נדחה): ה-rejection מופץ החוצה — לא נבלע', async () => {
        const err = new Error('writeBuffer failed');
        writeBufferMock.mockRejectedValue(err);
        await expect(
            exportDashboardToExcel(sampleEvents, reporters, 'test.xlsx', false)
        ).rejects.toThrow('writeBuffer failed');
    });

    it('נתיב כשל #1 (טעינת exceljs נכשלת): ה-rejection מופץ החוצה', async () => {
        // מדמים כשל בנתיב הראשון (await import('exceljs') + new ExcelJS.Workbook()):
        // הקונסטרקטור זורק → הכשל מתרחש מיד אחרי ה-dynamic import, לפני כל עיבוד.
        // וריאנט נאמן ל-chunk-load שמתפרק (חבילה לא זמינה/פגומה).
        // excelExporter ניגש ל-ExcelJS.Workbook על אובייקט ה-namespace (לא .default),
        // לכן ה-spy חייב להיות על אותו אובייקט שהקוד צורך.
        const ExcelJS = await import('exceljs');
        vi.spyOn(ExcelJS, 'Workbook').mockImplementation(function FailingWorkbook() {
            throw new Error('chunk load failed');
        });
        await expect(
            exportDashboardToExcel(sampleEvents, reporters, 'test.xlsx', false)
        ).rejects.toThrow('chunk load failed');
    });
});
