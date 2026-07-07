/**
 * עוטף monday.api כדי ללכוד את כל ה-payloads שיוצאים החוצה במהלך טסט.
 *
 * שימוש עיקרי: integration tests שצריכים לוודא ששינוי שפת UI לא משנה
 * את התוכן שנשלח ל-Monday API (החוזה הקריטי של פרויקט הדו-לשוניות).
 *
 * @example
 *   const monday = createMondayMock();
 *   const capture = createApiPayloadCapture(monday);
 *   await someFunctionThatCallsApi(monday);
 *   expect(capture.find(/create_item/)).toBeDefined();
 *   expect(capture.calls[0].variables.column_values).not.toContain('שעתי');
 */
export function createApiPayloadCapture(monday) {
    const calls = [];
    const originalApi = monday.api;

    monday.api = async (query, variables) => {
        calls.push({ query, variables });
        return originalApi.call(monday, query, variables);
    };

    return {
        calls,
        find(pattern) {
            const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
            return calls.find(c => typeof c.query === 'string' && re.test(c.query));
        },
        findAll(pattern) {
            const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
            return calls.filter(c => typeof c.query === 'string' && re.test(c.query));
        },
        reset() {
            calls.length = 0;
        },
        restore() {
            monday.api = originalApi;
        }
    };
}

export default createApiPayloadCapture;
