import '@testing-library/jest-dom/vitest';
import { vi, afterEach } from 'vitest';
import './i18n'; // אתחול i18next לכל הטסטים — מבטיח ש-useTranslation עובד

// jsdom לא מספק window.matchMedia. App.jsx:63 קורא לו בעת רינדור (resolve theme),
// ולכן כל טסטי integration שמרנדרים <App/> נופלים מראש על "window.matchMedia is not a function".
// stub סטנדרטי שמחזיר אובייקט MediaQueryList מינימלי (matches:false) עם כל ה-listeners ש-App משתמש בהם.
vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),    // deprecated, נשמר לתאימות
    removeListener: vi.fn(), // deprecated, נשמר לתאימות
    dispatchEvent: vi.fn(),
})));

// ה-mock הגלובלי של logger — חייב לחשוף את כל ה-API (כולל addSink/removeSink/emit/flush/getBuffer)
// כדי שקוד אפליקציה שקורא לאלה ב-import-time או ב-runtime לא ישבור את ~54 קבצי הבדיקה.
// הבדיקות שצריכות את ה-logger האמיתי (logger.test.js) עוקפות את ה-mock עם vi.unmock + importActual.
//
// מאז ה-UI sink (ui-sink-plan.md Phase 1) המוק מממש fan-out אמיתי: addSink שומר handlers,
// ו-error/apiError/warn/emit בונים record ומפזרים אליהם — כולל log-once (__loggedId) —
// כדי שטסטי אינטגרציה שמצפים לטוסט-שגיאה (שמוצג ע"י useUiErrorSink) ימשיכו לעבוד.
vi.mock('./utils/logger', () => {
    const sinks = new Set();
    const buffer = [];
    let loggedIdCounter = 0;

    // log-once מינימלי — תואם ל-emit האמיתי (logger.js): מטביע __loggedId על
    // record.error או record.data (כשהוא אובייקט), ומסמן duplicate במעבר חוזר.
    const stampLogOnce = (record) => {
        const target = record.error !== undefined
            ? record.error
            : (record.data && typeof record.data === 'object' ? record.data : undefined);
        if (target && typeof target === 'object') {
            if (target.__loggedId !== undefined) {
                record.duplicate = true;
                record.correlationId = target.__loggedId;
            } else {
                // כמו ה-emit האמיתי: מכבד correlationId קיים על האובייקט
                const id = target.correlationId || `log_${++loggedIdCounter}`;
                try {
                    Object.defineProperty(target, '__loggedId', {
                        value: id, enumerable: false, configurable: true, writable: true,
                    });
                } catch { /* אובייקט קפוא — לא חוסם */ }
                record.duplicate = false;
                record.correlationId = id;
            }
        }
    };

    const emit = vi.fn((record) => {
        record.timestamp = record.timestamp ?? Date.now();
        record.timestampISO = record.timestampISO ?? new Date(record.timestamp).toISOString();
        stampLogOnce(record);
        buffer.push(record);
        if (!record.duplicate) {
            for (const sink of sinks) {
                try { sink(record); } catch { /* sink כושל לא מפיל טסט */ }
            }
        }
    });

    // encodeDims replica (mirrors @axis/app-core encodeDims) so track()/health()
    // produce the same wire message shape the real logger does (sorted key=value;
    // only string/bool/finite-number). Inlined because vi.mock factories are hoisted
    // and cannot reference module-scope imports.
    const encodeDims = (base, dims) => {
        if (!dims) return base;
        const parts = [];
        for (const key of Object.keys(dims).sort()) {
            const v = dims[key];
            if (typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) {
                parts.push(`${key}=${v}`);
            }
        }
        return parts.length ? `${base} ${parts.join(' ')}` : base;
    };

    const mkSimple = (level) => vi.fn((module, message, data = null) => emit({
        kind: level === 'ERROR' ? 'error' : 'simple',
        level,
        module,
        message,
        error: data instanceof Error ? data : undefined,
        data: data instanceof Error ? undefined : data,
        consoleEnabled: false,
    }));

    return {
        default: {
            setLevel: vi.fn(),
            getLevel: vi.fn(),
            isDebug: vi.fn(),
            debug: vi.fn(),
            info: vi.fn(),
            warn: mkSimple('WARN'),
            error: mkSimple('ERROR'),
            track: vi.fn((event, dims = null) => emit({
                kind: 'simple',
                domainKind: 'usage',
                alwaysShip: true,
                level: 'INFO',
                module: 'usage',
                message: encodeDims(event, dims),
                consoleEnabled: false,
            })),
            health: vi.fn((signal, metrics = null) => emit({
                kind: 'simple',
                domainKind: 'health',
                alwaysShip: true,
                level: 'INFO',
                module: 'health',
                message: encodeDims(signal, metrics),
                consoleEnabled: false,
            })),
            api: vi.fn(),
            apiResponse: vi.fn(),
            apiError: vi.fn((functionName, error, context = null) => emit({
                kind: 'apiError',
                level: 'ERROR',
                module: 'API',
                message: functionName,
                error: error instanceof Error ? error : undefined,
                data: error instanceof Error ? undefined : error,
                context: context || undefined,
                consoleEnabled: false,
            })),
            functionStart: vi.fn(),
            functionEnd: vi.fn(),
            initDone: vi.fn(),
            initSummary: vi.fn(),
            addSink: vi.fn((fn) => {
                if (typeof fn !== 'function') return () => {};
                sinks.add(fn);
                return () => sinks.delete(fn);
            }),
            removeSink: vi.fn((fn) => sinks.delete(fn)),
            emit,
            flush: vi.fn(() => false),
            getBuffer: vi.fn(() => buffer.slice()),
            // איפוס מצב המוק בין טסטים (sinks/buffer) — מונע replay של רשומות
            // מטסט קודם בכל mount חדש של useUiErrorSink. קיים רק במוק.
            __resetMockState: () => { sinks.clear(); buffer.length = 0; },
        },
        LOG_LEVELS: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, NONE: 4 },
    };
});

// איפוס מצב מוק ה-logger אחרי כל טסט. בקבצים שעשו vi.unmock (logger אמיתי)
// הפונקציה לא קיימת — no-op.
afterEach(async () => {
    const { default: maybeMockedLogger } = await import('./utils/logger');
    maybeMockedLogger.__resetMockState?.();
});
