import { describe, it, expect} from 'vitest';
import {
    extractOperationName,
    parseMondayError,
    createFullErrorObject
} from '../errorHandler';

describe('errorHandler', () => {

    // === extractOperationName ===

    describe('extractOperationName', () => {
        it('מחלץ שם mutation', () => {
            expect(extractOperationName('mutation CreateItem { ... }')).toBe('CreateItem');
        });

        it('מחלץ שם query', () => {
            expect(extractOperationName('query GetBoards { ... }')).toBe('GetBoards');
        });

        it('מחלץ פעולה ראשונה עם סוגריים', () => {
            expect(extractOperationName('{ boards(ids: [123]) { id } }')).toBe('boards');
        });

        it('מחזיר null למחרוזת ריקה', () => {
            expect(extractOperationName('')).toBeNull();
        });

        it('מחזיר null ל-null', () => {
            expect(extractOperationName(null)).toBeNull();
        });

        it('מחזיר null ל-undefined', () => {
            expect(extractOperationName(undefined)).toBeNull();
        });
    });

    // === parseMondayError - GraphQL errors ===

    describe('parseMondayError - GraphQL errors', () => {
        it('מפענח שגיאת GraphQL מ-response.errors', () => {
            const response = {
                errors: [{
                    message: 'User unauthorized',
                    extensions: {
                        code: 'USER_UNAUTHORIZED',
                        status_code: 401
                    }
                }]
            };

            const result = parseMondayError(null, response);
            expect(result.errorCode).toBe('USER_UNAUTHORIZED');
            expect(result.canRetry).toBe(false);
            expect(result.userMessage).toContain('הרשאות');
        });

        it('מפענח complexity budget exhausted', () => {
            const response = {
                errors: [{
                    message: 'Complexity budget exhausted',
                    extensions: { code: 'ComplexityBudgetExhausted' }
                }]
            };

            const result = parseMondayError(null, response);
            expect(result.errorCode).toBe('ComplexityBudgetExhausted');
            expect(result.canRetry).toBe(true);
        });

        it('מוציא request_id ו-error_data', () => {
            const response = {
                errors: [{
                    message: 'error',
                    extensions: {
                        code: 'InternalServerError',
                        request_id: 'req-123',
                        error_data: { detail: 'something' }
                    }
                }]
            };

            const result = parseMondayError(null, response);
            expect(result.fullDetails.requestId).toBe('req-123');
            expect(result.fullDetails.errorData).toEqual({ detail: 'something' });
        });
    });

    // === parseMondayError - Error objects ===

    describe('parseMondayError - Error objects', () => {
        it('מפענח Error instance', () => {
            const error = new Error('Something failed');
            const result = parseMondayError(error);
            expect(result.fullDetails.errorMessage).toBe('Something failed');
            expect(result.fullDetails.stackTrace).toBeTruthy();
        });

        it('מפענח אובייקט שגיאה רגיל', () => {
            const error = { message: 'custom error', code: 'ParseError' };
            const result = parseMondayError(error);
            expect(result.errorCode).toBe('ParseError');
            expect(result.canRetry).toBe(false);
        });

        it('מפענח מחרוזת כשגיאה', () => {
            const result = parseMondayError('Network timeout');
            expect(result.fullDetails.errorMessage).toBe('Network timeout');
        });

        it('Error עם errorCode (MondayApiError)', () => {
            const error = new Error('Board not found');
            error.errorCode = 'InvalidBoardIdException';
            const result = parseMondayError(error);
            expect(result.errorCode).toBe('InvalidBoardIdException');
            expect(result.canRetry).toBe(false);
        });

        // שגיאות תעבורת רשת — הודעת הדפדפן הגולמית ממופה להודעה עברית ידידותית
        // (ולא מוצגת כמו שהיא בטוסט של ה-UI sink)
        it.each([
            'Failed to fetch',                    // Chrome/Edge
            'NetworkError when attempting to fetch resource.', // Firefox
            'Load failed',                        // Safari
        ])('שגיאת רשת "%s" → הודעה עברית עם canRetry', (rawMessage) => {
            const result = parseMondayError(new Error(rawMessage));
            expect(result.userMessage).toContain('חיבור');
            expect(result.canRetry).toBe(true);
            expect(result.actionRequired).toContain('בדוק');
        });
    });

    // === parseMondayError - HTTP status mapping ===

    describe('parseMondayError - HTTP status mapping', () => {
        it('401 → USER_UNAUTHORIZED', () => {
            const error = { message: 'Unauthorized', statusCode: 401 };
            const result = parseMondayError(error);
            expect(result.errorCode).toBe('USER_UNAUTHORIZED');
        });

        it('429 → Rate Limit Exceeded', () => {
            const error = { message: 'Too many requests', statusCode: 429 };
            const result = parseMondayError(error);
            expect(result.errorCode).toBe('Rate Limit Exceeded');
            expect(result.canRetry).toBe(true);
        });

        it('500 → InternalServerError', () => {
            const error = { message: 'Server error', statusCode: 500 };
            const result = parseMondayError(error);
            expect(result.errorCode).toBe('InternalServerError');
            expect(result.canRetry).toBe(true);
        });

        it('503 → InternalServerError', () => {
            const error = { message: 'Service unavailable', statusCode: 503 };
            const result = parseMondayError(error);
            expect(result.errorCode).toBe('InternalServerError');
        });
    });

    // === parseMondayError - message search ===

    describe('parseMondayError - זיהוי קוד מתוך הודעה', () => {
        it('מזהה ResourceNotFoundException בהודעה', () => {
            const error = { message: 'ResourceNotFoundException: Column not found' };
            const result = parseMondayError(error);
            expect(result.errorCode).toBe('ResourceNotFoundException');
        });

        it('מזהה ColumnValueException בהודעה', () => {
            const error = { message: 'ColumnValueException: invalid value for column' };
            const result = parseMondayError(error);
            expect(result.errorCode).toBe('ColumnValueException');
        });
    });

    // === parseMondayError - fallbacks ===

    describe('parseMondayError - fallbacks', () => {
        it('UNKNOWN_ERROR כשאין קוד מזוהה', () => {
            const error = { message: 'something weird happened' };
            const result = parseMondayError(error);
            expect(result.errorCode).toBe('UNKNOWN_ERROR');
            expect(result.canRetry).toBe(true); // ברירת מחדל
        });

        it('לא קורס עם null', () => {
            const result = parseMondayError(null);
            expect(result.errorCode).toBe('UNKNOWN_ERROR');
            expect(result.userMessage).toBeTruthy();
        });

        it('מחלץ operationName מ-apiRequest', () => {
            const apiRequest = {
                query: 'mutation CreateItem { ... }',
                variables: { name: 'test' }
            };
            const result = parseMondayError(new Error('fail'), null, apiRequest);
            expect(result.apiRequest.operationName).toBe('CreateItem');
            expect(result.apiRequest.query).toContain('CreateItem');
        });

        it('response.errors עדיף על error object', () => {
            const error = new Error('generic');
            const response = {
                errors: [{
                    message: 'specific',
                    extensions: { code: 'ColumnValueException' }
                }]
            };
            const result = parseMondayError(error, response);
            // response.errors קוד צריך לגבור
            expect(result.errorCode).toBe('ColumnValueException');
        });
    });

    // === createFullErrorObject ===

    describe('createFullErrorObject', () => {
        it('עוטף parsed error עם metadata', () => {
            const parsed = parseMondayError(new Error('test'));
            const result = createFullErrorObject(parsed, 'myFunction', 1000, 200);

            expect(result.error.userMessage).toBeTruthy();
            expect(result.request.functionName).toBe('myFunction');
            expect(result.request.timestamp).toBe(1000);
            expect(result.request.duration).toBe(200);
        });

        it('משתמש ב-Date.now() כשאין timestamp', () => {
            const parsed = parseMondayError(new Error('test'));
            const before = Date.now();
            const result = createFullErrorObject(parsed);
            const after = Date.now();

            expect(result.request.timestamp).toBeGreaterThanOrEqual(before);
            expect(result.request.timestamp).toBeLessThanOrEqual(after);
        });

        it('functionName null כברירת מחדל', () => {
            const parsed = parseMondayError(new Error('test'));
            const result = createFullErrorObject(parsed);
            expect(result.request.functionName).toBeNull();
        });
    });
});
