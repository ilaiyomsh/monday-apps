import { describe, it, expect, vi } from 'vitest';

// TDD: Increment 1 — חוזה של test-utils לפני שהמודולים נכתבים.
// מבטיח שכלי הטסט עצמם יהיו אמינים, אחרת כל יתר הטסטים יהיו חסרי ערך.
import { createMondayMock } from '../mondayMock';
import { renderWithProviders } from '../renderWithProviders';
import { createApiPayloadCapture } from '../apiPayloadCapture';

describe('test-utils contracts (Increment 1)', () => {

    describe('createMondayMock', () => {
        it('מחזיר אובייקט עם get/listen/api/storage', () => {
            const monday = createMondayMock();
            expect(typeof monday.get).toBe('function');
            expect(typeof monday.listen).toBe('function');
            expect(typeof monday.api).toBe('function');
            expect(typeof monday.storage.getItem).toBe('function');
            expect(typeof monday.storage.setItem).toBe('function');
            expect(typeof monday.storage.instance.getItem).toBe('function');
        });

        it('get("context") מחזיר את הקונטקסט שסופק', async () => {
            const monday = createMondayMock({ context: { boardId: 999, user: { id: '7' } } });
            const res = await monday.get('context');
            expect(res.data.boardId).toBe(999);
            expect(res.data.user.id).toBe('7');
        });

        it('listen("context") מאפשר ירייה ידנית של אירוע', () => {
            const monday = createMondayMock({ context: { boardId: 1 } });
            const cb = vi.fn();
            monday.listen('context', cb);
            monday.__emitContext({ boardId: 2 });
            expect(cb).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ boardId: 2 })
            }));
        });

        it('api() מחזיר response שניתן לשליטה', async () => {
            const monday = createMondayMock({
                apiResponses: { 'me': { data: { me: { id: '42', name: 'A' } } } }
            });
            const res = await monday.api('query { me { id name } }');
            expect(res.data.me.id).toBe('42');
        });

        it('storage שומר ומחזיר ערכים', async () => {
            const monday = createMondayMock();
            await monday.storage.setItem('key1', 'value1');
            const res = await monday.storage.getItem('key1');
            expect(res.data.value).toBe('value1');
        });
    });

    describe('renderWithProviders', () => {
        it('עוטף ב-MondayProvider ו-SettingsProvider עם defaults', () => {
            const monday = createMondayMock();
            const { container } = renderWithProviders(<div data-testid="x">hi</div>, { monday });
            expect(container.querySelector('[data-testid="x"]')).toBeTruthy();
        });

        it('מקבל initialSettings ו-initialContext להזרקה ישירה', () => {
            const monday = createMondayMock();
            const result = renderWithProviders(<div />, {
                monday,
                initialContext: { user: { currentLanguage: 'en' } },
                initialSettings: { languageOverride: 'en' }
            });
            // לפחות לא קרס ויש container
            expect(result.container).toBeTruthy();
        });

        it('מאפשר העברת language ישירות (קיצור דרך)', () => {
            const monday = createMondayMock();
            expect(() => renderWithProviders(<div />, { monday, language: 'en' })).not.toThrow();
        });
    });

    describe('createApiPayloadCapture', () => {
        it('תופס את כל הקריאות ל-monday.api', async () => {
            const monday = createMondayMock();
            const capture = createApiPayloadCapture(monday);
            await monday.api('mutation X', { foo: 1 });
            await monday.api('query Y');

            expect(capture.calls).toHaveLength(2);
            expect(capture.calls[0]).toEqual({ query: 'mutation X', variables: { foo: 1 } });
            expect(capture.calls[1].query).toBe('query Y');
        });

        it('מספק find() למציאת קריאה לפי טקסט בשאילתה', async () => {
            const monday = createMondayMock();
            const capture = createApiPayloadCapture(monday);
            await monday.api('mutation create_item ($a: 1)', {});
            const call = capture.find(/create_item/);
            expect(call).toBeDefined();
        });

        it('reset() מנקה את ההיסטוריה', async () => {
            const monday = createMondayMock();
            const capture = createApiPayloadCapture(monday);
            await monday.api('q');
            capture.reset();
            expect(capture.calls).toHaveLength(0);
        });
    });
});
