import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isEventLocked, EDIT_LOCK_MODES } from '../../../utils/editLockUtils';

/**
 * בדיקות lockAfterApproval
 * הלוגיקה נמצאת ב-MondayCalendar.jsx (enrichedEvents useMemo).
 * כאן מדמים את אותה לוגיקה בנפרד לבדיקה.
 */

// שחזור הלוגיקה מ-MondayCalendar.jsx enrichedEvents
function computeEventLock(event, settings, isManager) {
    const lockMode = settings.editLockMode || 'none';
    const managerBypass = isManager;
    const isApprovalEnabled = !!settings.enableApproval;
    const lockAfterApproval = !!settings.lockAfterApproval;

    let lockResult = (!managerBypass && lockMode !== 'none')
        ? isEventLocked(event, lockMode, settings.editLockDays)
        : { locked: false, reasonKey: '' };

    // נעילה לאחר אישור מנהל — רק אירועים במצב "ממתין" ניתנים לעריכה
    if (!lockResult.locked && lockAfterApproval && isApprovalEnabled && !managerBypass) {
        if (!event.isPending) {
            lockResult = { locked: true, reasonKey: 'approval.lockReason' };
        }
    }

    return lockResult;
}

describe('lockAfterApproval', () => {

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 1, 15, 12, 0, 0));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    const approvedEvent = {
        start: new Date(2026, 1, 15, 9, 0),
        isApproved: true,
        isPending: false
    };

    const pendingEvent = {
        start: new Date(2026, 1, 15, 9, 0),
        isApproved: false,
        isPending: true
    };

    const rejectedEvent = {
        start: new Date(2026, 1, 15, 9, 0),
        isApproved: false,
        isPending: false,
        isRejected: true
    };

    const regularEvent = {
        start: new Date(2026, 1, 15, 9, 0),
        isApproved: false,
        isPending: false
    };

    // L1: enableApproval=true, lockAfterApproval=true, אירוע מאושר
    it('אירוע מאושר נעול כש-lockAfterApproval פעיל', () => {
        const settings = { enableApproval: true, lockAfterApproval: true, editLockMode: 'none' };
        const result = computeEventLock(approvedEvent, settings, false);
        expect(result.locked).toBe(true);
        expect(result.reasonKey).toBe('approval.lockReason');
    });

    // אירוע נדחה — נעול גם כן (רק pending ניתן לעריכה)
    it('אירוע נדחה נעול כש-lockAfterApproval פעיל', () => {
        const settings = { enableApproval: true, lockAfterApproval: true, editLockMode: 'none' };
        const result = computeEventLock(rejectedEvent, settings, false);
        expect(result.locked).toBe(true);
    });

    // L2: enableApproval=true, lockAfterApproval=true, אירוע ממתין
    it('אירוע ממתין לא נעול גם כש-lockAfterApproval פעיל', () => {
        const settings = { enableApproval: true, lockAfterApproval: true, editLockMode: 'none' };
        const result = computeEventLock(pendingEvent, settings, false);
        expect(result.locked).toBe(false);
    });

    // L3: enableApproval=true, lockAfterApproval=false, אירוע מאושר
    it('אירוע מאושר לא נעול כש-lockAfterApproval כבוי', () => {
        const settings = { enableApproval: true, lockAfterApproval: false, editLockMode: 'none' };
        const result = computeEventLock(approvedEvent, settings, false);
        expect(result.locked).toBe(false);
    });

    // L4: enableApproval=false, lockAfterApproval=true
    it('lockAfterApproval מתעלם כש-enableApproval כבוי', () => {
        const settings = { enableApproval: false, lockAfterApproval: true, editLockMode: 'none' };
        const result = computeEventLock(approvedEvent, settings, false);
        expect(result.locked).toBe(false);
    });

    // L5: מנהל מורשה — bypass
    it('מנהל מורשה לא נעול גם כש-lockAfterApproval פעיל', () => {
        const settings = { enableApproval: true, lockAfterApproval: true, editLockMode: 'none' };
        const result = computeEventLock(approvedEvent, settings, true);
        expect(result.locked).toBe(false);
    });

    // L6: lockAfterApproval + editLockMode=days_after + אירוע ישן מאושר
    it('editLockMode קודם ל-lockAfterApproval (אירוע ישן מאושר)', () => {
        const oldApprovedEvent = {
            start: new Date(2026, 1, 1, 9, 0), // 14 ימים אחורה
            isApproved: true
        };
        const settings = {
            enableApproval: true,
            lockAfterApproval: true,
            editLockMode: EDIT_LOCK_MODES.DAYS_AFTER,
            editLockDays: 7
        };
        const result = computeEventLock(oldApprovedEvent, settings, false);
        expect(result.locked).toBe(true);
        // הסיבה צריכה להיות מ-editLockMode (days_after), לא מ-lockAfterApproval
        expect(result.reasonKey).toBe('settings.additional.editLock.reasons.days_after');
    });

    // L7: משתמש קיים שלא הגדיר lockAfterApproval (undefined)
    it('lockAfterApproval undefined — ברירת מחדל false, לא נועל', () => {
        const settings = { enableApproval: true, editLockMode: 'none' };
        // lockAfterApproval אינו מוגדר כלל
        const result = computeEventLock(approvedEvent, settings, false);
        expect(result.locked).toBe(false);
    });

    // אירוע רגיל (לא מאושר, לא ממתין) — נעול כי הוא לא pending
    it('אירוע רגיל (לא pending) נעול כש-lockAfterApproval פעיל', () => {
        const settings = { enableApproval: true, lockAfterApproval: true, editLockMode: 'none' };
        const result = computeEventLock(regularEvent, settings, false);
        expect(result.locked).toBe(true);
    });

    // lockAfterApproval + editLockMode=none + אירוע מאושר בלוח = נעול
    it('lockAfterApproval פועל גם כש-editLockMode=none', () => {
        const settings = {
            enableApproval: true,
            lockAfterApproval: true,
            editLockMode: EDIT_LOCK_MODES.NONE
        };
        const result = computeEventLock(approvedEvent, settings, false);
        expect(result.locked).toBe(true);
        expect(result.reasonKey).toBe('approval.lockReason');
    });
});
