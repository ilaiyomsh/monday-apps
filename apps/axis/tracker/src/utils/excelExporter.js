import { format } from 'date-fns';

/**
 * צבעי מילוי לפי קובץ הדוגמה
 */
const FILL = {
    header: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBDC0BF' } },
    dateCol: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBDBDB' } },
    sumTotal: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEFC78' } },
};

/**
 * border דק מכל הצדדים
 */
const thinBorder = {
    top: { style: 'thin' },
    bottom: { style: 'thin' },
    left: { style: 'thin' },
    right: { style: 'thin' }
};

/**
 * פונט בסיסי
 */
const baseFont = { name: 'Arial', size: 10 };

/**
 * יישור ברירת מחדל — ימין/למעלה (RTL)
 */
const rtlAlignment = { horizontal: 'right', vertical: 'top', readingOrder: 'rtl' };
const ltrAlignment = { horizontal: 'right', vertical: 'top', readingOrder: 'ltr' };

/**
 * ייצוא נתוני דשבורד לקובץ Excel מעוצב
 * @param {import('../hooks/useDashboardData').DashboardEvent[]} filteredEvents
 * @param {Array} reporters - מערך מדווחים { id, name }
 * @param {string} [filename] - שם הקובץ
 * @param {boolean} [enableDistinction] - מצב הבחנה פנימי/חיצוני
 */
export async function exportDashboardToExcel(filteredEvents, reporters, filename, enableDistinction = false) {
    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('גיליון 1', {
        views: [{ rightToLeft: true }]
    });

    // מפת שמות מדווחים
    const reporterMap = new Map();
    if (reporters?.length) {
        reporters.forEach(r => {
            reporterMap.set(String(r.id), r.name);
        });
    }

    // --- רוחב עמודות (לפי קובץ הדוגמה) ---
    worksheet.getColumn(1).width = 12.52;
    worksheet.getColumn(2).width = 15.67;
    worksheet.getColumn(3).width = 29.17;
    worksheet.getColumn(4).width = 14.85;
    worksheet.getColumn(5).width = 18.52;
    worksheet.getColumn(6).width = 62.67;

    // --- שורה 1: כותרות טבלה (ללא שורת כותרת "דיווחי שעות") ---
    const headers = ['תאריך', 'מדווח', 'פרויקט', 'משך זמן דיווח', 'סיווג', 'הערות'];
    const headerRow = worksheet.getRow(1);
    headerRow.height = 19.2;

    headers.forEach((header, i) => {
        const cell = headerRow.getCell(i + 1);
        cell.value = header;
        cell.font = { ...baseFont, bold: true };
        cell.alignment = { ...rtlAlignment };
        cell.fill = FILL.header;
        cell.border = thinBorder;
        cell.numFmt = '@';
    });

    // --- שורות נתונים ---
    let totalHours = 0;

    filteredEvents.forEach((event, index) => {
        const rowNum = index + 2;
        const row = worksheet.getRow(rowNum);
        row.height = 19;

        // לוגיקת סיווג
        let classification;
        if (enableDistinction) {
            classification = (event.category === 'routine')
                ? (event.nonBillableType || '')
                : (event.stageLabel || '');
        } else {
            classification = event.isBillable
                ? (event.stageLabel || '')
                : (event.nonBillableType || '');
        }

        const values = [
            event.date ? format(event.date, 'dd/MM/yyyy') : '',
            reporterMap.get(String(event.reporterId)) || '',
            event.projectName || '',
            event.hours ?? 0,
            classification,
            event.notes || ''
        ];

        values.forEach((val, i) => {
            const cell = row.getCell(i + 1);
            cell.value = val;
            cell.font = i === 0 ? { ...baseFont, bold: true } : { ...baseFont };
            cell.border = thinBorder;
            // תאריך ופרויקט — LTR, שאר — RTL
            cell.alignment = (i === 0 || i === 2) ? { ...ltrAlignment } : { ...rtlAlignment };
            // עמודת תאריך — רקע אפור
            if (i === 0) {
                cell.fill = FILL.dateCol;
            }
            // עמודות טקסט — numFmt text (לא עמודת משך זמן)
            if (i !== 3) {
                cell.numFmt = '@';
            }
        });

        totalHours += event.hours || 0;
    });

    // --- שורת סיכום ---
    if (filteredEvents.length > 0) {
        // שורה ריקה
        const emptyRowNum = filteredEvents.length + 2;
        const emptyRow = worksheet.getRow(emptyRowNum);
        emptyRow.height = 19;
        for (let col = 1; col <= 6; col++) {
            const cell = emptyRow.getCell(col);
            cell.border = thinBorder;
            if (col === 1) cell.fill = FILL.dateCol;
        }

        // שורת סיכום
        const sumRowNum = emptyRowNum + 1;
        const sumRow = worksheet.getRow(sumRowNum);
        sumRow.height = 19;

        for (let col = 1; col <= 6; col++) {
            const cell = sumRow.getCell(col);
            cell.border = thinBorder;
            cell.font = { ...baseFont };
            cell.alignment = { ...rtlAlignment };
            if (col === 1) cell.fill = FILL.dateCol;
        }

        // תא D — סכום שעות בבולד + רקע צהוב
        const sumCell = sumRow.getCell(4);
        sumCell.value = totalHours;
        sumCell.font = { ...baseFont, bold: true };
        sumCell.fill = FILL.sumTotal;
    }

    // --- הורדה ---
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || `דיווח-שעות-${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
