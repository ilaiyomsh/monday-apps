/* eslint-disable no-console, no-restricted-syntax, no-empty */
/**
 * ⚠️ TEMPORARY DIAGNOSTIC — change #103 (חקירת ה-auto-reload, 2026-06-21).
 *
 * מתעד כל `window.location.reload` אוטומטי וכל boot של האפליקציה. שורד reloadים דרך
 * sessionStorage, ומדפיס בכל boot את כל ההיסטוריה כשורת JSON אחת — כדי שאפשר יהיה
 * פשוט "להעתיק את כל הקונסול" בלי להריץ שום פקודה.
 *
 * מדפיס ישירות ל-console (לא דרך logger) *בכוונה*: כך זה מופיע ב-production בלי
 * enableDebugLogs, ובלי לעבור דרך ה-UI sink (בלי טוסט).
 *
 * הדיסקרימינטור: אם בין שני BOOT אין רשומת RELOAD שלנו — הרענון הגיע מ*מחוץ* לקוד
 * שלנו (פלטפורמת monday / תוסף), והתיקון שלנו לא רלוונטי.
 *
 * ❌ להסיר אחרי איתור השורש.
 */
const KEY = 'reload-diag';
const MAX = 40;

const stamp = () => {
    try { return new Date().toISOString(); } catch (e) { return ''; }
};

const read = () => {
    try { return JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch (e) { return []; }
};

const write = (arr) => {
    try { sessionStorage.setItem(KEY, JSON.stringify(arr.slice(-MAX))); } catch (e) {}
};

/** נקרא רגע לפני כל window.location.reload אוטומטי. */
export const recordReload = (path, reason, detail) => {
    const arr = read();
    arr.push({
        t: stamp(),
        kind: 'RELOAD',
        path,
        reason: String(reason ?? ''),
        detail: String(detail ?? '').slice(0, 200),
    });
    write(arr);
    console.warn(`[RELOAD-DIAG] AUTO-RELOAD via "${path}" (${reason})`, detail || '');
};

/** נקרא בתחילת כל boot — מוסיף רשומת BOOT ומדפיס את כל ההיסטוריה כ-JSON להעתקה. */
export const bootDiag = () => {
    const arr = read();
    const n = arr.filter((e) => e.kind === 'BOOT').length + 1;
    arr.push({
        t: stamp(),
        kind: 'BOOT',
        n,
        // origin+pathname בלבד — בלי ה-query (מכיל sessionToken חי, אסור לדלוף ללוגים)
        path: (typeof window !== 'undefined' ? window.location.origin + window.location.pathname : ''),
        // האם רצים בתוך iframe (כדי לזהות אם monday מרעננת את ה-iframe מבחוץ)
        inIframe: (typeof window !== 'undefined' ? window.top !== window.self : null),
    });
    write(arr);
    console.warn(`[RELOAD-DIAG] BOOT #${n} — copy this whole line ↓`);
    console.warn('[RELOAD-DIAG] ' + JSON.stringify(arr));
};
