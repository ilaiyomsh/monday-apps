/**
 * Utility לזיהוי ופענוח שגיאות Monday API
 * מפענח שגיאות GraphQL/API ומחזיר הודעות ידידותיות למשתמש בעברית
 */

/**
 * Mapping של קודי שגיאה להודעות בעברית
 * מבוסס על spec/error_hendaling.md
 */
const ERROR_MESSAGES = {
    // שגיאות הרשאות
    'USER_UNAUTHORIZED': {
        userMessage: 'אין לך הרשאות לבצע פעולה זו בלוח. יש לפנות לבעל הלוח לשינוי הרשאות.',
        canRetry: false,
        actionRequired: 'פנה לבעל הלוח לשינוי הרשאות'
    },
    'UserUnauthorizedException': {
        userMessage: 'אין לך הרשאות לבצע פעולה זו בלוח. יש לפנות לבעל הלוח לשינוי הרשאות.',
        canRetry: false,
        actionRequired: 'פנה לבעל הלוח לשינוי הרשאות'
    },
    'USER_ACCESS_DENIED': {
        userMessage: 'אין לך הרשאות לבצע פעולה זו בלוח. יש לפנות לבעל הלוח לשינוי הרשאות.',
        canRetry: false,
        actionRequired: 'פנה לבעל הלוח לשינוי הרשאות'
    },

    // עמודה לא נמצאה
    'ResourceNotFoundException': {
        userMessage: 'אחת העמודות המוגדרות אינה קיימת בלוח. אנא היכנס להגדרות ובחר את העמודות מחדש.',
        canRetry: false,
        actionRequired: 'היכנס להגדרות ובחר את העמודות מחדש'
    },
    'InvalidColumnIdException': {
        userMessage: 'אחת העמודות המוגדרות אינה קיימת בלוח. אנא היכנס להגדרות ובחר את העמודות מחדש.',
        canRetry: false,
        actionRequired: 'היכנס להגדרות ובחר את העמודות מחדש'
    },
    'Column not found': {
        userMessage: 'אחת העמודות המוגדרות אינה קיימת בלוח. אנא היכנס להגדרות ובחר את העמודות מחדש.',
        canRetry: false,
        actionRequired: 'היכנס להגדרות ובחר את העמודות מחדש'
    },

    // חריגה מתקציב סיבוכיות
    'ComplexityBudgetExhausted': {
        userMessage: 'העומס על המערכת גבוה מדי כרגע. אנא המתן מספר שניות ונסה שנית.',
        canRetry: true,
        actionRequired: 'המתן מספר שניות ונסה שוב'
    },
    'COMPLEXITY_BUDGET_EXHAUSTED': {
        userMessage: 'העומס על המערכת גבוה מדי כרגע. אנא המתן מספר שניות ונסה שנית.',
        canRetry: true,
        actionRequired: 'המתן מספר שניות ונסה שוב'
    },

    // ערך לא תקין
    'ColumnValueException': {
        userMessage: 'הנתונים שהוזנו אינם תואמים את סוג העמודה בלוח. אנא בדוק את הקלט.',
        canRetry: false,
        actionRequired: 'בדוק את הנתונים שהוזנו'
    },
    'CorrectedValueException': {
        userMessage: 'הנתונים שהוזנו תוקנו אוטומטית. אנא בדוק את הערכים בלוח.',
        canRetry: false,
        actionRequired: 'בדוק את הערכים בלוח'
    },
    'ParseError': {
        userMessage: 'הנתונים שהוזנו אינם תואמים את סוג העמודה בלוח. אנא בדוק את הקלט.',
        canRetry: false,
        actionRequired: 'בדוק את הנתונים שהוזנו'
    },
    'Parse error on...': {
        userMessage: 'הנתונים שהוזנו אינם תואמים את סוג העמודה בלוח. אנא בדוק את הקלט.',
        canRetry: false,
        actionRequired: 'בדוק את הנתונים שהוזנו'
    },

    // שגיאת שרת
    'InternalServerError': {
        userMessage: 'אירעה תקלה בתקשורת עם השרת של Monday. אנא נסה שוב.',
        canRetry: true,
        actionRequired: 'נסה שוב בעוד כמה רגעים'
    },
    'API_TEMPORARILY_BLOCKED': {
        userMessage: 'השירות זמנית לא זמין. אנא נסה שוב בעוד כמה רגעים.',
        canRetry: true,
        actionRequired: 'נסה שוב בעוד כמה רגעים'
    },

    // שגיאות תעבורת רשת (transport) — הודעות הדפדפן הגולמיות ממופות לעברית.
    // 'Failed to fetch' (Chrome/Edge), 'NetworkError' (Firefox), 'Load failed' (Safari)
    'Failed to fetch': {
        userMessage: 'אין חיבור לרשת. אנא בדוק את החיבור ונסה שוב.',
        canRetry: true,
        actionRequired: 'בדוק את חיבור הרשת ונסה שוב'
    },
    'NetworkError': {
        userMessage: 'אין חיבור לרשת. אנא בדוק את החיבור ונסה שוב.',
        canRetry: true,
        actionRequired: 'בדוק את חיבור הרשת ונסה שוב'
    },
    'Load failed': {
        userMessage: 'אין חיבור לרשת. אנא בדוק את החיבור ונסה שוב.',
        canRetry: true,
        actionRequired: 'בדוק את חיבור הרשת ונסה שוב'
    },

    // לוח לא נמצא
    'InvalidBoardIdException': {
        userMessage: 'הלוח לא נמצא או שאין לך גישה אליו.',
        canRetry: false,
        actionRequired: 'בדוק את הגדרות הלוח'
    },

    // ארגומנט לא תקין
    'InvalidArgumentException': {
        userMessage: 'הנתונים שהוזנו אינם תקינים. אנא בדוק את הקלט.',
        canRetry: false,
        actionRequired: 'בדוק את הנתונים שהוזנו'
    },
    'INVALID_ARGUMENT_EXCEPTION': {
        userMessage: 'הנתונים שהוזנו אינם תקינים. אנא בדוק את הקלט.',
        canRetry: false,
        actionRequired: 'בדוק את הנתונים שהוזנו'
    },

    // Rate limiting
    'Rate Limit Exceeded': {
        userMessage: 'חרגת ממגבלת הבקשות. אנא המתן מספר שניות ונסה שנית.',
        canRetry: true,
        actionRequired: 'המתן מספר שניות ונסה שוב'
    },
    'maxConcurrencyExceeded': {
        userMessage: 'חרגת ממגבלת הבקשות המקבילות. אנא המתן מספר שניות ונסה שנית.',
        canRetry: true,
        actionRequired: 'המתן מספר שניות ונסה שוב'
    },
    'IP_RATE_LIMIT_EXCEEDED': {
        userMessage: 'חרגת ממגבלת הבקשות. אנא המתן מספר שניות ונסה שנית.',
        canRetry: true,
        actionRequired: 'המתן מספר שניות ונסה שוב'
    },

    // אימות ו-OAuth
    'Unauthorized': {
        userMessage: 'אין הרשאות לגשת לנתונים. יש לוודא שה-API token תקין.',
        canRetry: false,
        actionRequired: 'בדוק את ה-API token'
    },
    'Your ip is restricted': {
        userMessage: 'הגישה חסומה מכתובת ה-IP שלך. פנה לאדמין של החשבון.',
        canRetry: false,
        actionRequired: 'פנה לאדמין של החשבון'
    },
    'missingRequiredPermissions': {
        userMessage: 'לאפליקציה חסרות הרשאות OAuth נדרשות. פנה למפתח האפליקציה.',
        canRetry: false,
        actionRequired: 'יש לעדכן את הרשאות האפליקציה'
    },

    // ולידציה
    'JsonParseException': {
        userMessage: 'שגיאה בפורמט הנתונים שנשלחו. אנא נסה שוב.',
        canRetry: false,
        actionRequired: 'בדוק את הנתונים שהוזנו'
    },
    'InvalidUserIdException': {
        userMessage: 'המשתמש שנבחר אינו מוזמן ללוח זה — יש להוסיף אותו ללוח לפני הקצאה.',
        canRetry: false,
        actionRequired: 'הזמן את המשתמש ללוח המשימות'
    },
    'UserSubscriberNotFoundException': {
        userMessage: 'המשתמש שנבחר אינו מוזמן ללוח זה — יש להוסיף אותו ללוח לפני הקצאה.',
        canRetry: false,
        actionRequired: 'הזמן את המשתמש ללוח המשימות'
    },
    'not a subscriber of': {
        userMessage: 'המשתמש שנבחר אינו מוזמן ללוח זה — יש להוסיף אותו ללוח לפני הקצאה.',
        canRetry: false,
        actionRequired: 'הזמן את המשתמש ללוח המשימות'
    },
    'not subscribed to': {
        userMessage: 'המשתמש שנבחר אינו מוזמן ללוח זה — יש להוסיף אותו ללוח לפני הקצאה.',
        canRetry: false,
        actionRequired: 'הזמן את המשתמש ללוח המשימות'
    },
    'not a member of': {
        userMessage: 'המשתמש שנבחר אינו מוזמן ללוח זה — יש להוסיף אותו ללוח לפני הקצאה.',
        canRetry: false,
        actionRequired: 'הזמן את המשתמש ללוח המשימות'
    },
    'ItemNameTooLongException': {
        userMessage: 'שם הפריט ארוך מדי (מקסימום 255 תווים).',
        canRetry: false,
        actionRequired: 'קצר את שם הפריט'
    },
    'ItemsLimitationException': {
        userMessage: 'הלוח הגיע למגבלת 10,000 פריטים. יש למחוק או לארכב פריטים ישנים.',
        canRetry: false,
        actionRequired: 'מחק או ארכב פריטים ישנים מהלוח'
    },

    // קודי rate limiting רשמיים (API version 2026-01)
    'RATE_LIMIT_EXCEEDED': {
        userMessage: 'חרגת ממגבלת הבקשות. אנא המתן מספר שניות ונסה שנית.',
        canRetry: true,
        actionRequired: 'המתן מספר שניות ונסה שוב'
    },
    'FIELD_LIMIT_EXCEEDED': {
        userMessage: 'חרגה ממגבלת שדות. אנא המתן מספר שניות ונסה שנית.',
        canRetry: true,
        actionRequired: 'המתן מספר שניות ונסה שוב'
    },
    'REQUEST_MAX_COMPLEXITY_EXCEEDED': {
        userMessage: 'השאילתה מורכבת מדי. אנא נסה שוב בעוד כמה רגעים.',
        canRetry: true,
        actionRequired: 'נסה שוב בעוד כמה רגעים'
    },

    // Rate limiting נוסף
    'ComplexityException': {
        userMessage: 'העומס על המערכת גבוה מדי כרגע. אנא המתן מספר שניות ונסה שנית.',
        canRetry: true,
        actionRequired: 'המתן מספר שניות ונסה שוב'
    },
    'DAILY_LIMIT_EXCEEDED': {
        userMessage: 'חרגת ממגבלת הבקשות היומית. נסה שוב מחר.',
        canRetry: false,
        actionRequired: 'המתן עד מחר או שדרג את התוכנית'
    },
    'Minute limit rate exceeded': {
        userMessage: 'חרגת ממגבלת הבקשות לדקה. אנא המתן מספר שניות ונסה שנית.',
        canRetry: true,
        actionRequired: 'המתן מספר שניות ונסה שוב'
    },

    // נעילת משאב
    'Resource is currently locked, please try again later': {
        userMessage: 'הלוח נעול כרגע עקב עדכון מקביל. נסה שוב בעוד רגע.',
        canRetry: true,
        actionRequired: 'נסה שוב בעוד כמה שניות'
    }
};

/**
 * Mapping של HTTP status codes לקודי שגיאה
 */
const HTTP_STATUS_TO_ERROR_CODE = {
    400: 'InvalidArgumentException',
    401: 'USER_UNAUTHORIZED',
    403: 'UserUnauthorizedException',
    404: 'ResourceNotFoundException',
    409: 'InvalidArgumentException',
    422: 'InvalidArgumentException',
    423: 'API_TEMPORARILY_BLOCKED',
    429: 'Rate Limit Exceeded',
    500: 'InternalServerError',
    502: 'InternalServerError',
    503: 'InternalServerError',
    504: 'InternalServerError'
};

/**
 * חילוץ שם הפעולה מה-query
 */
export const extractOperationName = (query) => {
    if (!query) return null;
    
    // חיפוש אחר mutation או query עם שם
    const mutationMatch = query.match(/mutation\s+(\w+)/);
    if (mutationMatch) return mutationMatch[1];
    
    const queryMatch = query.match(/query\s+(\w+)/);
    if (queryMatch) return queryMatch[1];
    
    // חיפוש אחר שם הפעולה הראשון
    const firstOperationMatch = query.match(/(\w+)\s*\(/);
    if (firstOperationMatch) return firstOperationMatch[1];
    
    return null;
};

/**
 * פענוח שגיאת Monday API
 * 
 * @param {Error|Object} error - שגיאה או response עם errors
 * @param {Object} response - תשובת Monday API (אופציונלי)
 * @param {Object} apiRequest - פרטי השאילתה שנשלחה (אופציונלי)
 * @returns {Object} אובייקט עם פרטי השגיאה המפוענחים
 */
export const parseMondayError = (error, response = null, apiRequest = null) => {
    let errorCode = null;
    let errorMessage = null;
    let statusCode = null;
    let errorData = null;
    let requestId = null;
    let errorPath = null;
    let errorLocations = null;
    let stackTrace = null;
    let responseErrors = null;
    let responseData = null;
    let accountId = null;

    // טיפול ב-response.errors (GraphQL errors עם status 200)
    if (response && response.errors && Array.isArray(response.errors) && response.errors.length > 0) {
        responseErrors = response.errors;
        const firstError = response.errors[0];
        
        errorMessage = firstError.message || errorMessage;
        errorPath = firstError.path;
        errorLocations = firstError.locations;
        
        if (firstError.extensions) {
            errorCode = firstError.extensions.code || errorCode;
            statusCode = firstError.extensions.status_code || statusCode;
            errorData = firstError.extensions.error_data || null;
            requestId = firstError.extensions.request_id || null;
        }
        
        responseData = response.data || null;
        accountId = response.account_id || null;
    }
    
    // טיפול ב-error object
    if (error) {
        // אם זה Error object
        if (error instanceof Error) {
            errorMessage = error.message || errorMessage;
            stackTrace = error.stack || null;
            
            // אם יש response ב-error
            if (error.response) {
                response = error.response;
            }
            
            // אם יש errorCode ב-error (MondayApiError)
            if (error.errorCode) {
                errorCode = error.errorCode;
            }
            
            // אם יש response ב-error
            if (error.response) {
                responseErrors = error.response.errors || responseErrors;
                responseData = error.response.data || responseData;
                accountId = error.response.account_id || accountId;
            }
        }
        // אם זה אובייקט רגיל
        else if (typeof error === 'object') {
            errorMessage = error.message || errorMessage;
            errorCode = error.code || error.errorCode || errorCode;
            statusCode = error.status || error.statusCode || statusCode;
            stackTrace = error.stack || null;
        }
        // אם זה מחרוזת
        else if (typeof error === 'string') {
            errorMessage = error;
        }
    }
    
    // אם יש statusCode אבל אין errorCode, ננסה למפות
    if (statusCode && !errorCode) {
        errorCode = HTTP_STATUS_TO_ERROR_CODE[statusCode] || null;
    }
    
    // אם יש errorMessage אבל אין errorCode, ננסה למצוא בקוד
    if (errorMessage && !errorCode) {
        // חיפוש קוד שגיאה בהודעה
        for (const code of Object.keys(ERROR_MESSAGES)) {
            if (errorMessage.includes(code) || errorMessage.toLowerCase().includes(code.toLowerCase())) {
                errorCode = code;
                break;
            }
        }
    }
    
    // Fallback - אם אין קוד שגיאה, נשתמש בהודעה
    if (!errorCode) {
        errorCode = 'UNKNOWN_ERROR';
    }
    
    // קבלת הודעה ידידותית למשתמש
    const errorConfig = ERROR_MESSAGES[errorCode] || {
        userMessage: errorMessage || 'אירעה שגיאה לא צפויה. אנא נסה שוב.',
        canRetry: true,
        actionRequired: null
    };
    
    // חילוץ operationName מ-apiRequest אם לא קיים
    let operationName = null;
    if (apiRequest) {
        operationName = apiRequest.operationName || extractOperationName(apiRequest.query);
    }
    
    // בניית fullDetails
    const fullDetails = {
        errorCode,
        errorMessage: errorMessage || 'Unknown error',
        statusCode,
        errorData,
        requestId,
        errorPath,
        errorLocations,
        stackTrace,
        responseErrors,
        responseData,
        accountId
    };
    
    // בניית אובייקט התוצאה המלא
    const result = {
        userMessage: errorConfig.userMessage,
        errorCode,
        fullDetails,
        canRetry: errorConfig.canRetry,
        actionRequired: errorConfig.actionRequired,
        apiRequest: apiRequest ? {
            query: apiRequest.query || null,
            variables: apiRequest.variables || null,
            operationName: operationName
        } : null
    };
    
    return result;
};

/**
 * יצירת אובייקט שגיאה מלא להעתקה כ-JSON
 *
 * רשומה אחידה: timestamp ב-epoch (ms) + timestampISO (ISO-8601) + correlationId.
 * ה-correlationId מאפשר log-once — אותה שגיאה תזוהה כרשומה אחת לאורך כל נתיב הרישום
 * (safeApi → catch → showErrorWithDetails). ה-emit ב-logger מטביע/מכבד מזהה זה.
 *
 * @param {Object} parsedError - תוצאה מ-parseMondayError
 * @param {string} functionName - שם הפונקציה שביצעה את הקריאה (אופציונלי)
 * @param {number} timestamp - זמן השגיאה (אופציונלי)
 * @param {number} duration - משך זמן הבקשה במילישניות (אופציונלי)
 * @param {string} correlationId - מזהה קורלציה ל-log-once (אופציונלי)
 * @returns {Object} אובייקט JSON מלא עם כל הפרטים
 */
export const createFullErrorObject = (parsedError, functionName = null, timestamp = null, duration = null, correlationId = null) => {
    const ts = timestamp || Date.now();
    return {
        // פרטי שגיאה
        error: {
            ...parsedError.fullDetails,
            userMessage: parsedError.userMessage,
            canRetry: parsedError.canRetry,
            actionRequired: parsedError.actionRequired
        },

        // פרטי קריאת API
        apiRequest: parsedError.apiRequest,

        // פרטי בקשה — timestamp אחיד (epoch + ISO); correlationId ל-log-once
        request: {
            functionName: functionName || null,
            timestamp: ts,
            timestampISO: new Date(ts).toISOString(),
            duration: duration || null,
            correlationId: correlationId || null
        }
    };
};

const errorHandlerExports = {
    parseMondayError,
    createFullErrorObject,
    ERROR_MESSAGES,
    HTTP_STATUS_TO_ERROR_CODE
};
export default errorHandlerExports;

