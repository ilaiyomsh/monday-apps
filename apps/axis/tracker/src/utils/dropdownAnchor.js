/**
 * dropdownAnchor — חישוב מיקום dropdown מעוגן לטריגר, בלתי-תלוי בכיוון השפה.
 *
 * 5 רכיבי dropdown באפליקציה (SearchableSelect, MultiSelect, TimeSelect,
 * TaskSelect, DatePickerInput) חזרו על אותה לוגיקה ועיגנו את ה-dropdown
 * לצדדים פיזיים (`left`/`right`) — שגוי כש-`dir` מתחלף. כאן מרכזים את
 * החישוב, ומחזירים מאפייני CSS לוגיים (`top`/`bottom` + `left`/`right`
 * שנבחרים לפי `dir`) כך שהמיקום מצמיד את קצה ה-`inline-start` של
 * ה-dropdown לקצה ה-`inline-start` של הטריגר.
 *
 * שימוש:
 *
 *     const position = computeDropdownPosition({
 *         triggerRect: containerRef.current.getBoundingClientRect(),
 *         dir,                  // 'rtl' | 'ltr' מ-useLocale()
 *         width: rect.width,    // אופציונלי — ברירת מחדל לרוחב הטריגר
 *         dropdownHeight: 240,  // אופציונלי — ל-flip up/down
 *     });
 *     // → { top, bottom, left | right, width }
 *
 * המאפיין האופקי מוחזר רק עבור הצד הרלוונטי לפי dir; הצד השני נשמט,
 * כך ש-`position: fixed` יכול להישאר. אם מרצים גם לאפס את הצד הנגדי
 * בסגנון inline, לקרוא ל-resetOpposite(position, dir).
 *
 * הפונקציה טהורה, ללא תלות ב-React, ניתנת לבדיקה.
 */

const DEFAULT_DROPDOWN_HEIGHT = 240;
const VIEWPORT_OFFSET = 4;

/**
 * @param {object} args
 * @param {DOMRect} args.triggerRect — תוצאה של getBoundingClientRect()
 * @param {'rtl' | 'ltr'} args.dir
 * @param {number} [args.width] — רוחב ה-dropdown. ברירת מחדל: רוחב הטריגר.
 * @param {number} [args.dropdownHeight=240] — לחישוב flip אנכי.
 * @param {number} [args.viewportHeight] — ברירת מחדל window.innerHeight.
 * @param {number} [args.viewportWidth]  — ברירת מחדל window.innerWidth.
 * @returns {{ top: string|number, bottom: string|number, width: string|number,
 *             left?: string|number, right?: string|number }}
 */
export function computeDropdownPosition({
    triggerRect,
    dir = 'ltr',
    width,
    dropdownHeight = DEFAULT_DROPDOWN_HEIGHT,
    viewportHeight,
    viewportWidth,
}) {
    if (!triggerRect) {
        return { top: 'auto', bottom: 'auto', width: 'auto' };
    }

    const vh = typeof viewportHeight === 'number'
        ? viewportHeight
        : (typeof window !== 'undefined' ? window.innerHeight : 0);
    const vw = typeof viewportWidth === 'number'
        ? viewportWidth
        : (typeof window !== 'undefined' ? window.innerWidth : 0);

    const spaceBelow = vh - triggerRect.bottom;
    const spaceAbove = triggerRect.top;
    const openAbove = spaceBelow < dropdownHeight && spaceAbove > spaceBelow;

    const vertical = openAbove
        ? { bottom: `${vh - triggerRect.top + VIEWPORT_OFFSET}px`, top: 'auto' }
        : { top: `${triggerRect.bottom + VIEWPORT_OFFSET}px`, bottom: 'auto' };

    const resolvedWidth = typeof width === 'number' ? `${width}px` : `${triggerRect.width}px`;

    // עיגון לקצה ה-inline-start של הטריגר:
    //   LTR → start = left
    //   RTL → start = right (במונחי viewport: innerWidth - rect.right)
    const horizontal = dir === 'rtl'
        ? { right: `${Math.max(0, vw - triggerRect.right)}px` }
        : { left: `${Math.max(0, triggerRect.left)}px` };

    return { ...vertical, ...horizontal, width: resolvedWidth };
}

/**
 * varianten עבור DatePickerInput שלא משתמש ב-position:fixed אלא ב-portal לבדי.
 * מחזיר { top, [left|right] } בלי width.
 *
 * @param {object} args
 * @param {DOMRect} args.triggerRect
 * @param {'rtl' | 'ltr'} args.dir
 * @param {number} args.popupHeight — גובה הפופאפ (לקלאמפ אנכי).
 * @param {number} [args.viewportMargin=4]
 */
export function computePortalAnchor({
    triggerRect,
    dir = 'ltr',
    popupHeight,
    viewportMargin = VIEWPORT_OFFSET,
}) {
    if (!triggerRect) return { top: 0 };

    const vh = typeof window !== 'undefined' ? window.innerHeight : 0;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 0;

    const spaceBelow = vh - triggerRect.bottom;
    const openBelow = spaceBelow >= popupHeight;
    let top = openBelow
        ? triggerRect.bottom + viewportMargin
        : triggerRect.top - popupHeight - viewportMargin;
    top = Math.max(viewportMargin, Math.min(top, vh - popupHeight - viewportMargin));

    if (dir === 'rtl') {
        // עיגון לקצה הימני של הטריגר (start ב-RTL)
        let right = vw - triggerRect.right;
        right = Math.max(viewportMargin, right);
        return { top, right };
    }
    // LTR: עיגון לקצה השמאלי של הטריגר (start ב-LTR)
    let left = triggerRect.left;
    left = Math.max(viewportMargin, left);
    return { top, left };
}
