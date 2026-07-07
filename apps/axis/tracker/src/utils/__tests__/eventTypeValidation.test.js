import { describe, it, expect} from 'vitest';


import {
    REQUIRED_EVENT_TYPE_LABELS,
    EVENT_TYPE_COLUMN_NAME,
    EVENT_TYPE_LABEL_COLORS,
    parseStatusColumnLabels,
    validateEventTypeColumn,
    getRequiredLabelsConfig,
    formatMissingLabelsMessage
} from '../eventTypeValidation';

describe('eventTypeValidation', () => {

    // === קבועים ===

    describe('קבועים', () => {
        it('REQUIRED_EVENT_TYPE_LABELS מכיל רק את 3 הקטגוריות (יומי/שעתי/לא לחיוב)', () => {
            expect(REQUIRED_EVENT_TYPE_LABELS).toEqual(
                ['שעתי', 'לא לחיוב', 'יומי']
            );
        });

        it('EVENT_TYPE_COLUMN_NAME הוא סוג דיווח', () => {
            expect(EVENT_TYPE_COLUMN_NAME).toBe('סוג דיווח');
        });

        it('EVENT_TYPE_LABEL_COLORS מכיל צבעים לכל הלייבלים', () => {
            for (const label of REQUIRED_EVENT_TYPE_LABELS) {
                expect(EVENT_TYPE_LABEL_COLORS[label]).toBeDefined();
            }
        });
    });

    // === parseStatusColumnLabels ===

    describe('parseStatusColumnLabels', () => {
        it('מפרסר labels מסוג מערך', () => {
            const settings = {
                labels: [
                    { label: 'שעתי', color: '#0086c0', index: 3 },
                    { label: 'חופשה', color: '#fdab3d', index: 0 }
                ]
            };
            const result = parseStatusColumnLabels(settings);
            expect(result).toHaveLength(2);
            expect(result[0].label).toBe('שעתי');
            expect(result[0].color).toBe('#0086c0');
            expect(result[0].index).toBe(3);
        });

        it('מפרסר labels מסוג אובייקט (פורמט ישן)', () => {
            const settings = {
                labels: { '3': 'שעתי', '0': 'חופשה' },
                labels_colors: {
                    '3': { color: '#0086c0' },
                    '0': { color: '#fdab3d' }
                }
            };
            const result = parseStatusColumnLabels(settings);
            expect(result).toHaveLength(2);
            expect(result.find(l => l.index === 3).label).toBe('שעתי');
        });

        it('מפרסר מחרוזת JSON', () => {
            const json = JSON.stringify({
                labels: [{ label: 'שעתי', color: '#0086c0', index: 3 }]
            });
            const result = parseStatusColumnLabels(json);
            expect(result).toHaveLength(1);
            expect(result[0].label).toBe('שעתי');
        });

        it('מסנן לייבלים מושבתים (is_deactivated)', () => {
            const settings = {
                labels: [
                    { label: 'שעתי', color: '#0086c0', index: 3, is_deactivated: false },
                    { label: 'מחוק', color: '#ccc', index: 99, is_deactivated: true }
                ]
            };
            const result = parseStatusColumnLabels(settings);
            expect(result).toHaveLength(1);
            expect(result[0].label).toBe('שעתי');
        });

        it('מחזיר מערך ריק עם settings null', () => {
            expect(parseStatusColumnLabels(null)).toEqual([]);
        });

        it('מחזיר מערך ריק ללא labels', () => {
            expect(parseStatusColumnLabels({})).toEqual([]);
        });

        it('מחזיר מערך ריק עם JSON לא תקין', () => {
            expect(parseStatusColumnLabels('{invalid json}')).toEqual([]);
        });

        it('מטפל ב-label עם שדות חסרים', () => {
            const settings = {
                labels: [
                    { label: 'שעתי' } // ללא color, index
                ]
            };
            const result = parseStatusColumnLabels(settings);
            expect(result[0].color).toBe('');
            expect(result[0].index).toBe(0);
        });
    });

    // === validateEventTypeColumn ===

    describe('validateEventTypeColumn', () => {
        it('תקין כשכל הלייבלים קיימים', () => {
            const settings = {
                labels: REQUIRED_EVENT_TYPE_LABELS.map((label, index) => ({
                    label, color: '#000', index
                }))
            };
            const result = validateEventTypeColumn(settings);
            expect(result.isValid).toBe(true);
            expect(result.missingLabels).toHaveLength(0);
        });

        it('לא תקין כשחסרים לייבלים', () => {
            const settings = {
                labels: [
                    { label: 'שעתי', color: '#000', index: 0 }
                ]
            };
            const result = validateEventTypeColumn(settings);
            expect(result.isValid).toBe(false);
            expect(result.missingLabels).toContain('לא לחיוב');
            expect(result.missingLabels).toContain('יומי');
        });

        it('מחזיר את רשימת הלייבלים הקיימים', () => {
            const settings = {
                labels: [
                    { label: 'שעתי', color: '#000', index: 0 }
                ]
            };
            const result = validateEventTypeColumn(settings);
            expect(result.existingLabels).toContain('שעתי');
        });
    });

    // === getRequiredLabelsConfig ===

    describe('getRequiredLabelsConfig', () => {
        it('מחזיר קונפיגורציה עם label, color, index לכל לייבל', () => {
            const config = getRequiredLabelsConfig();
            expect(config).toHaveLength(REQUIRED_EVENT_TYPE_LABELS.length);
            config.forEach((item, i) => {
                expect(item.label).toBe(REQUIRED_EVENT_TYPE_LABELS[i]);
                expect(item.color).toBeDefined();
                expect(item.index).toBe(i);
            });
        });
    });

    // === formatMissingLabelsMessage ===

    describe('formatMissingLabelsMessage', () => {
        it('מפורמט הודעת שגיאה עם לייבלים חסרים', () => {
            const message = formatMissingLabelsMessage(['חופשה', 'מחלה']);
            expect(message).toContain('"חופשה"');
            expect(message).toContain('"מחלה"');
            expect(message).toContain('לא מכילה');
        });

        it('מחזיר מחרוזת ריקה אם אין לייבלים חסרים', () => {
            expect(formatMissingLabelsMessage([])).toBe('');
        });
    });
});
