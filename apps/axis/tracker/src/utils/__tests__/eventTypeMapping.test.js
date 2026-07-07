import { describe, it, expect} from 'vitest';


import {
    EVENT_CATEGORIES,
    CATEGORY_LABELS,
    DISTINCTION_CATEGORY_LABELS,
    getCategoryLabels,
    getCategory,
    getBillableIndex,
    getNonBillableIndexes,
    getAllDayIndexes,
    getInternalProjectIndex,
    getExternalProjectIndex,
    getRoutineIndexes,
    isBillableIndex,
    isNonBillableIndex,
    isAllDayIndex,
    isProjectIndex,
    isRoutineOrNonBillableIndex,
    getLabelText,
    getLabelColor,
    getLabelsByCategory,
    getTimedEventIndex,
    resolveTimedEventIndex,
    isSingleUseCategory,
    validateMapping,
    validateMappingDistinction,
    smartValidateMapping,
    createLegacyMapping,
    isLegacyMapping
} from '../eventTypeMapping';

// מיפוי תקין לדוגמה (מצב רגיל)
// אחרי הרפקטור: ALL_DAY = בדיוק 1 לייבל; התת-סוגים בעמודה נפרדת
const VALID_MAPPING = {
    '3': 'billable',
    '0': 'allDay',
    '101': 'nonBillable'
};

// מיפוי תקין לדוגמה (מצב הבחנה)
const VALID_DISTINCTION_MAPPING = {
    '3': 'internalProject',
    '4': 'externalProject',
    '0': 'allDay',
    '101': 'routine'
};

// מטא-דאטה של לייבלים
const LABEL_META = {
    '3': { label: 'שעתי', color: '#0086c0' },
    '0': { label: 'יומי', color: '#fdab3d' },
    '101': { label: 'לא לחיוב', color: '#ff7575' }
};

describe('eventTypeMapping', () => {

    // === קבועים ===

    describe('EVENT_CATEGORIES', () => {
        it('מכיל את כל הקטגוריות הנדרשות', () => {
            expect(EVENT_CATEGORIES.BILLABLE).toBe('billable');
            expect(EVENT_CATEGORIES.NON_BILLABLE).toBe('nonBillable');
            expect(EVENT_CATEGORIES.ALL_DAY).toBe('allDay');
            expect(EVENT_CATEGORIES.INTERNAL_PROJECT).toBe('internalProject');
            expect(EVENT_CATEGORIES.EXTERNAL_PROJECT).toBe('externalProject');
            expect(EVENT_CATEGORIES.ROUTINE).toBe('routine');
        });

        it('לא חושף עוד את הקטגוריה temporary', () => {
            expect(EVENT_CATEGORIES.TEMPORARY).toBeUndefined();
        });
    });

    describe('CATEGORY_LABELS', () => {
        it('מכיל תוויות עבריות לקטגוריות רגילות', () => {
            expect(CATEGORY_LABELS.billable).toBe('פרויקטים');
            expect(CATEGORY_LABELS.nonBillable).toBe('שוטף');
            expect(CATEGORY_LABELS.allDay).toBe('יומי');
        });
    });

    describe('DISTINCTION_CATEGORY_LABELS', () => {
        it('מכיל תוויות עבריות לקטגוריות הבחנה', () => {
            expect(DISTINCTION_CATEGORY_LABELS.internalProject).toBe('פנימי');
            expect(DISTINCTION_CATEGORY_LABELS.externalProject).toBe('חיצוני');
            expect(DISTINCTION_CATEGORY_LABELS.routine).toBe('שוטף');
            expect(DISTINCTION_CATEGORY_LABELS.allDay).toBe('יומי');
        });
    });

    describe('getCategoryLabels', () => {
        it('מחזיר CATEGORY_LABELS כשהבחנה כבויה', () => {
            expect(getCategoryLabels(false)).toBe(CATEGORY_LABELS);
        });

        it('מחזיר DISTINCTION_CATEGORY_LABELS כשהבחנה דלוקה', () => {
            expect(getCategoryLabels(true)).toBe(DISTINCTION_CATEGORY_LABELS);
        });
    });

    // === getCategory ===

    describe('getCategory', () => {
        it('מחזיר קטגוריה נכונה לאינדקס קיים', () => {
            expect(getCategory('3', VALID_MAPPING)).toBe('billable');
            expect(getCategory('0', VALID_MAPPING)).toBe('allDay');
        });

        it('מחזיר null לאינדקס שלא קיים', () => {
            expect(getCategory('999', VALID_MAPPING)).toBe(null);
        });

        it('מחזיר null עבור null index', () => {
            expect(getCategory(null, VALID_MAPPING)).toBe(null);
        });

        it('מחזיר null עבור undefined index', () => {
            expect(getCategory(undefined, VALID_MAPPING)).toBe(null);
        });

        it('מחזיר null עבור mapping null', () => {
            expect(getCategory('3', null)).toBe(null);
        });

        it('ממיר אינדקס מספרי למחרוזת', () => {
            expect(getCategory(3, VALID_MAPPING)).toBe('billable');
        });
    });

    // === getBillableIndex ===

    describe('getBillableIndex', () => {
        it('מחזיר את האינדקס הנכון', () => {
            expect(getBillableIndex(VALID_MAPPING)).toBe('3');
        });

        it('מחזיר null אם אין billable', () => {
            const mapping = { '0': 'allDay', '101': 'nonBillable' };
            expect(getBillableIndex(mapping)).toBe(null);
        });

        it('מחזיר null עם mapping null', () => {
            expect(getBillableIndex(null)).toBe(null);
        });
    });

    // === getNonBillableIndexes ===

    describe('getNonBillableIndexes', () => {
        it('מחזיר מערך של כל אינדקסי nonBillable', () => {
            expect(getNonBillableIndexes(VALID_MAPPING)).toEqual(['101']);
        });

        it('מחזיר מספר אינדקסים כשיש כמה', () => {
            const mapping = { ...VALID_MAPPING, '102': 'nonBillable' };
            expect(getNonBillableIndexes(mapping)).toEqual(['101', '102']);
        });

        it('מחזיר מערך ריק אם אין nonBillable', () => {
            const mapping = { '3': 'billable', '0': 'allDay' };
            expect(getNonBillableIndexes(mapping)).toEqual([]);
        });

        it('מחזיר מערך ריק עם mapping null', () => {
            expect(getNonBillableIndexes(null)).toEqual([]);
        });
    });

    // === getAllDayIndexes ===

    describe('getAllDayIndexes', () => {
        it('מחזיר את אינדקס ה-allDay (בדיוק 1)', () => {
            const indexes = getAllDayIndexes(VALID_MAPPING);
            expect(indexes).toEqual(['0']);
        });

        it('מחזיר מערך ריק עם mapping null', () => {
            expect(getAllDayIndexes(null)).toEqual([]);
        });
    });

    // === Distinction Resolvers ===

    describe('getInternalProjectIndex', () => {
        it('מחזיר את האינדקס הנכון', () => {
            expect(getInternalProjectIndex(VALID_DISTINCTION_MAPPING)).toBe('3');
        });

        it('מחזיר null אם אין internalProject', () => {
            expect(getInternalProjectIndex(VALID_MAPPING)).toBe(null);
        });

        it('מחזיר null עם mapping null', () => {
            expect(getInternalProjectIndex(null)).toBe(null);
        });
    });

    describe('getExternalProjectIndex', () => {
        it('מחזיר את האינדקס הנכון', () => {
            expect(getExternalProjectIndex(VALID_DISTINCTION_MAPPING)).toBe('4');
        });

        it('מחזיר null אם אין externalProject', () => {
            expect(getExternalProjectIndex(VALID_MAPPING)).toBe(null);
        });

        it('מחזיר null עם mapping null', () => {
            expect(getExternalProjectIndex(null)).toBe(null);
        });
    });

    describe('getRoutineIndexes', () => {
        it('מחזיר מערך של כל אינדקסי routine', () => {
            expect(getRoutineIndexes(VALID_DISTINCTION_MAPPING)).toEqual(['101']);
        });

        it('מחזיר מערך ריק אם אין routine', () => {
            expect(getRoutineIndexes(VALID_MAPPING)).toEqual([]);
        });

        it('מחזיר מערך ריק עם mapping null', () => {
            expect(getRoutineIndexes(null)).toEqual([]);
        });
    });

    // === Boolean Checkers ===

    describe('Boolean Checkers', () => {
        it('isBillableIndex - מזהה נכון', () => {
            expect(isBillableIndex('3', VALID_MAPPING)).toBe(true);
            expect(isBillableIndex('0', VALID_MAPPING)).toBe(false);
        });

        it('isNonBillableIndex - מזהה נכון', () => {
            expect(isNonBillableIndex('101', VALID_MAPPING)).toBe(true);
            expect(isNonBillableIndex('3', VALID_MAPPING)).toBe(false);
        });

        it('isAllDayIndex - מזהה נכון', () => {
            expect(isAllDayIndex('0', VALID_MAPPING)).toBe(true);
            expect(isAllDayIndex('3', VALID_MAPPING)).toBe(false);
        });
    });

    // === isProjectIndex ===

    describe('isProjectIndex', () => {
        it('מזהה billable כפרויקט', () => {
            expect(isProjectIndex('3', VALID_MAPPING)).toBe(true);
        });

        it('מזהה internalProject כפרויקט', () => {
            expect(isProjectIndex('3', VALID_DISTINCTION_MAPPING)).toBe(true);
        });

        it('מזהה externalProject כפרויקט', () => {
            expect(isProjectIndex('4', VALID_DISTINCTION_MAPPING)).toBe(true);
        });

        it('לא מזהה nonBillable כפרויקט', () => {
            expect(isProjectIndex('101', VALID_MAPPING)).toBe(false);
        });

        it('לא מזהה routine כפרויקט', () => {
            expect(isProjectIndex('101', VALID_DISTINCTION_MAPPING)).toBe(false);
        });

        it('לא מזהה allDay כפרויקט', () => {
            expect(isProjectIndex('0', VALID_MAPPING)).toBe(false);
        });
    });

    // === isRoutineOrNonBillableIndex ===

    describe('isRoutineOrNonBillableIndex', () => {
        it('מזהה nonBillable', () => {
            expect(isRoutineOrNonBillableIndex('101', VALID_MAPPING)).toBe(true);
        });

        it('מזהה routine', () => {
            expect(isRoutineOrNonBillableIndex('101', VALID_DISTINCTION_MAPPING)).toBe(true);
        });

        it('לא מזהה billable', () => {
            expect(isRoutineOrNonBillableIndex('3', VALID_MAPPING)).toBe(false);
        });

        it('לא מזהה internalProject', () => {
            expect(isRoutineOrNonBillableIndex('3', VALID_DISTINCTION_MAPPING)).toBe(false);
        });
    });

    // === Label Meta Helpers ===

    describe('getLabelText', () => {
        it('מחזיר טקסט לייבל נכון', () => {
            expect(getLabelText('3', LABEL_META)).toBe('שעתי');
            expect(getLabelText('0', LABEL_META)).toBe('יומי');
        });

        it('מחזיר מחרוזת ריקה לאינדקס לא קיים', () => {
            expect(getLabelText('999', LABEL_META)).toBe('');
        });

        it('מחזיר מחרוזת ריקה עם labelMeta null', () => {
            expect(getLabelText('3', null)).toBe('');
        });

        it('מחזיר מחרוזת ריקה עם index null', () => {
            expect(getLabelText(null, LABEL_META)).toBe('');
        });
    });

    describe('getLabelColor', () => {
        it('מחזיר צבע לייבל נכון', () => {
            expect(getLabelColor('0', LABEL_META)).toBe('#fdab3d');
        });

        it('מחזיר מחרוזת ריקה לאינדקס לא קיים', () => {
            expect(getLabelColor('999', LABEL_META)).toBe('');
        });
    });

    describe('getLabelsByCategory', () => {
        it('מחזיר את הלייבל היחיד בקטגוריית allDay', () => {
            const labels = getLabelsByCategory('allDay', VALID_MAPPING, LABEL_META);
            expect(labels).toHaveLength(1);
            expect(labels[0].label).toBe('יומי');
        });

        it('מחזיר מערך ריק לקטגוריה ריקה', () => {
            const mapping = { '3': 'billable' };
            expect(getLabelsByCategory('allDay', mapping, LABEL_META)).toEqual([]);
        });

        it('מחזיר מערך ריק עם mapping null', () => {
            expect(getLabelsByCategory('billable', null, LABEL_META)).toEqual([]);
        });

        it('מחזיר מערך ריק עם labelMeta null', () => {
            expect(getLabelsByCategory('billable', VALID_MAPPING, null)).toEqual([]);
        });
    });

    // === getTimedEventIndex ===

    describe('getTimedEventIndex', () => {
        it('מחזיר billable index כש-isBillable=true', () => {
            expect(getTimedEventIndex(true, VALID_MAPPING)).toBe('3');
        });

        it('מחזיר nonBillable index ראשון כש-isBillable=false', () => {
            expect(getTimedEventIndex(false, VALID_MAPPING)).toBe('101');
        });

        it('מחזיר null כשאין mapping', () => {
            expect(getTimedEventIndex(true, null)).toBe(null);
        });
    });

    // === resolveTimedEventIndex ===

    describe('resolveTimedEventIndex', () => {
        describe('מצב רגיל (enableDistinction=false)', () => {
            it('מחזיר billable index לפרויקט', () => {
                expect(resolveTimedEventIndex({
                    isBillable: true,
                    project: null,
                    mapping: VALID_MAPPING,
                    enableDistinction: false
                })).toBe('3');
            });

            it('מחזיר nonBillable index לשוטף', () => {
                expect(resolveTimedEventIndex({
                    isBillable: false,
                    project: null,
                    mapping: VALID_MAPPING,
                    enableDistinction: false
                })).toBe('101');
            });
        });

        describe('מצב הבחנה (enableDistinction=true)', () => {
            it('מחזיר internalProject index לפרויקט פנימי', () => {
                expect(resolveTimedEventIndex({
                    isBillable: true,
                    project: { id: '1', name: 'פרויקט', projectType: 'internal' },
                    mapping: VALID_DISTINCTION_MAPPING,
                    enableDistinction: true
                })).toBe('3');
            });

            it('מחזיר externalProject index לפרויקט חיצוני', () => {
                expect(resolveTimedEventIndex({
                    isBillable: true,
                    project: { id: '1', name: 'פרויקט', projectType: 'external' },
                    mapping: VALID_DISTINCTION_MAPPING,
                    enableDistinction: true
                })).toBe('4');
            });

            it('ברירת מחדל חיצוני כשאין projectType', () => {
                expect(resolveTimedEventIndex({
                    isBillable: true,
                    project: { id: '1', name: 'פרויקט' },
                    mapping: VALID_DISTINCTION_MAPPING,
                    enableDistinction: true
                })).toBe('4');
            });

            it('ברירת מחדל חיצוני כש-project=null', () => {
                expect(resolveTimedEventIndex({
                    isBillable: true,
                    project: null,
                    mapping: VALID_DISTINCTION_MAPPING,
                    enableDistinction: true
                })).toBe('4');
            });

            it('מחזיר routine index לשוטף', () => {
                expect(resolveTimedEventIndex({
                    isBillable: false,
                    project: null,
                    mapping: VALID_DISTINCTION_MAPPING,
                    enableDistinction: true
                })).toBe('101');
            });
        });

        it('מחזיר null כשאין mapping', () => {
            expect(resolveTimedEventIndex({
                isBillable: true,
                project: null,
                mapping: null,
                enableDistinction: false
            })).toBe(null);
        });
    });

    // === isSingleUseCategory ===

    describe('isSingleUseCategory', () => {
        it('billable חד-פעמי במצב רגיל', () => {
            expect(isSingleUseCategory('billable', false)).toBe(true);
        });

        it('billable לא חד-פעמי במצב הבחנה', () => {
            expect(isSingleUseCategory('billable', true)).toBe(false);
        });

        it('internalProject חד-פעמי במצב הבחנה', () => {
            expect(isSingleUseCategory('internalProject', true)).toBe(true);
        });

        it('externalProject חד-פעמי במצב הבחנה', () => {
            expect(isSingleUseCategory('externalProject', true)).toBe(true);
        });

        it('nonBillable לא חד-פעמי', () => {
            expect(isSingleUseCategory('nonBillable', false)).toBe(false);
        });

        it('routine לא חד-פעמי', () => {
            expect(isSingleUseCategory('routine', true)).toBe(false);
        });

        it('allDay לא חד-פעמי', () => {
            expect(isSingleUseCategory('allDay', false)).toBe(false);
            expect(isSingleUseCategory('allDay', true)).toBe(false);
        });
    });

    // === validateMapping ===

    describe('validateMapping', () => {
        it('מיפוי תקין - isValid=true', () => {
            const result = validateMapping(VALID_MAPPING);
            expect(result.isValid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('חסר billable - שגיאה', () => {
            const mapping = { '0': 'allDay', '101': 'nonBillable' };
            const result = validateMapping(mapping);
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.includes('פרויקטים'))).toBe(true);
        });

        it('billable כפול - שגיאה', () => {
            const mapping = { '3': 'billable', '4': 'billable', '0': 'allDay' };
            const result = validateMapping(mapping);
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.includes('פרויקטים'))).toBe(true);
        });

        it('חסר allDay - שגיאה', () => {
            const mapping = { '3': 'billable' };
            const result = validateMapping(mapping);
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.includes('יומי'))).toBe(true);
        });

        it('יותר מ-1 allDay - שגיאה (התת-סוגים בעמודה נפרדת)', () => {
            const mapping = { '3': 'billable', '0': 'allDay', '2': 'allDay' };
            const result = validateMapping(mapping);
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.includes('יומי'))).toBe(true);
        });

        it('mapping ריק - שגיאה', () => {
            const result = validateMapping({});
            expect(result.isValid).toBe(false);
            expect(result.errors[0]).toContain('מיפוי ריק');
        });

        it('mapping null - שגיאה', () => {
            const result = validateMapping(null);
            expect(result.isValid).toBe(false);
            expect(result.errors[0]).toContain('חסר מיפוי');
        });

        it('mapping לא אובייקט - שגיאה', () => {
            const result = validateMapping('not an object');
            expect(result.isValid).toBe(false);
        });

        it('nonBillable אופציונלי - מיפוי תקין בלעדיו', () => {
            const mapping = { '3': 'billable', '0': 'allDay' };
            const result = validateMapping(mapping);
            expect(result.isValid).toBe(true);
        });
    });

    // === validateMappingDistinction ===

    describe('validateMappingDistinction', () => {
        it('מיפוי תקין - isValid=true', () => {
            const result = validateMappingDistinction(VALID_DISTINCTION_MAPPING);
            expect(result.isValid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('חסר internalProject - שגיאה', () => {
            const mapping = { '4': 'externalProject', '0': 'allDay' };
            const result = validateMappingDistinction(mapping);
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.includes('פנימי'))).toBe(true);
        });

        it('חסר externalProject - שגיאה', () => {
            const mapping = { '3': 'internalProject', '0': 'allDay' };
            const result = validateMappingDistinction(mapping);
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.includes('חיצוני'))).toBe(true);
        });

        it('internalProject כפול - שגיאה', () => {
            const mapping = { '3': 'internalProject', '7': 'internalProject', '4': 'externalProject', '0': 'allDay' };
            const result = validateMappingDistinction(mapping);
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.includes('פנימי'))).toBe(true);
        });

        it('externalProject כפול - שגיאה', () => {
            const mapping = { '3': 'internalProject', '4': 'externalProject', '7': 'externalProject', '0': 'allDay' };
            const result = validateMappingDistinction(mapping);
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.includes('חיצוני'))).toBe(true);
        });

        it('חסר allDay - שגיאה', () => {
            const mapping = { '3': 'internalProject', '4': 'externalProject' };
            const result = validateMappingDistinction(mapping);
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.includes('יומי'))).toBe(true);
        });

        it('יותר מ-1 allDay - שגיאה גם במצב הבחנה', () => {
            const mapping = { '3': 'internalProject', '4': 'externalProject', '0': 'allDay', '2': 'allDay' };
            const result = validateMappingDistinction(mapping);
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.includes('יומי'))).toBe(true);
        });

        it('routine אופציונלי - מיפוי תקין בלעדיו', () => {
            const mapping = { '3': 'internalProject', '4': 'externalProject', '0': 'allDay' };
            const result = validateMappingDistinction(mapping);
            expect(result.isValid).toBe(true);
        });

        it('mapping null - שגיאה', () => {
            const result = validateMappingDistinction(null);
            expect(result.isValid).toBe(false);
        });

        it('mapping ריק - שגיאה', () => {
            const result = validateMappingDistinction({});
            expect(result.isValid).toBe(false);
        });
    });

    // === smartValidateMapping ===

    describe('smartValidateMapping', () => {
        it('משתמש ב-validateMapping כשהבחנה כבויה', () => {
            const result = smartValidateMapping(VALID_MAPPING, false);
            expect(result.isValid).toBe(true);
        });

        it('משתמש ב-validateMappingDistinction כשהבחנה דלוקה', () => {
            const result = smartValidateMapping(VALID_DISTINCTION_MAPPING, true);
            expect(result.isValid).toBe(true);
        });

        it('כושל במיפוי רגיל כשהבחנה דלוקה', () => {
            const result = smartValidateMapping(VALID_MAPPING, true);
            expect(result.isValid).toBe(false);
        });
    });

    // === createLegacyMapping ===

    describe('createLegacyMapping', () => {
        it('יוצר מיפוי מלייבלים ידועים (יומי בודד)', () => {
            const labels = [
                { label: 'שעתי', color: '#0086c0', index: 3, id: 3 },
                { label: 'לא לחיוב', color: '#ff7575', index: 101, id: 101 },
                { label: 'יומי', color: '#fdab3d', index: 0, id: 0 }
            ];
            const result = createLegacyMapping(labels);
            expect(result).not.toBeNull();
            expect(result.mapping['3']).toBe('billable');
            expect(result.mapping['0']).toBe('allDay');
            expect(result.labelMeta['3'].label).toBe('שעתי');
        });

        it('מחזיר null עם מערך ריק', () => {
            expect(createLegacyMapping([])).toBe(null);
        });

        it('מחזיר null עם null', () => {
            expect(createLegacyMapping(null)).toBe(null);
        });

        it('מחזיר null אם לא כל הלייבלים הנדרשים קיימים', () => {
            const labels = [
                { label: 'שעתי', color: '#0086c0', index: 3 }
            ];
            // חסר allDay
            expect(createLegacyMapping(labels)).toBe(null);
        });

        it('מונע כפל billable (שעתי + חיוב)', () => {
            const labels = [
                { label: 'שעתי', color: '#0086c0', index: 3, id: 3 },
                { label: 'חיוב', color: '#0086c0', index: 4, id: 4 }, // שני billable
                { label: 'יומי', color: '#fdab3d', index: 0, id: 0 }
            ];
            const result = createLegacyMapping(labels);
            expect(result).not.toBeNull();
            // רק הראשון (שעתי) צריך להיות ממופה כ-billable
            const billableIndexes = Object.entries(result.mapping)
                .filter(([, cat]) => cat === 'billable');
            expect(billableIndexes).toHaveLength(1);
        });
    });

    // === isLegacyMapping ===

    describe('isLegacyMapping', () => {
        it('מזהה מיפוי בפורמט ישן (מפתחות טקסט)', () => {
            const legacy = { 'שעתי': 'billable', 'חופשה': 'allDay' };
            expect(isLegacyMapping(legacy)).toBe(true);
        });

        it('מזהה מיפוי חדש (מפתחות מספריים)', () => {
            expect(isLegacyMapping(VALID_MAPPING)).toBe(false);
        });

        it('מחזיר false עם null', () => {
            expect(isLegacyMapping(null)).toBe(false);
        });

        it('מחזיר false עם אובייקט ריק', () => {
            expect(isLegacyMapping({})).toBe(false);
        });

        it('מחזיר false עם סוג לא תקין', () => {
            expect(isLegacyMapping('string')).toBe(false);
        });
    });
});
