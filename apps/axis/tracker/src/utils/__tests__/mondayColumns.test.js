import { describe, it, expect} from 'vitest';


import {
    getColumnIds,
    parseDateColumn,
    parseHourColumn,
    parseBoardRelationColumn,
    mapItemToEvent,
    buildColumnValues,
    buildFetchEventsQuery
} from '../mondayColumns';

describe('mondayColumns', () => {

    // === getColumnIds ===

    describe('getColumnIds', () => {
        it('מחלץ את כל מזהי העמודות מהגדרות', () => {
            const settings = {
                start_date: { 'date_col': {} },
                daurtion: { 'duration_col': {} }, // איות מקורי!
                perent_item_board: { 'connect_col': {} },
                status: { 'status_col': {} },
                event_type_status: { 'event_type_col': {} },
                notes: { 'notes_col': {} }
            };
            const result = getColumnIds(settings);
            expect(result.startDate).toBe('date_col');
            expect(result.duration).toBe('duration_col');
            expect(result.connectedItem).toBe('connect_col');
            expect(result.status).toBe('status_col');
            expect(result.eventTypeStatus).toBe('event_type_col');
            expect(result.notes).toBe('notes_col');
        });

        it('מחזיר null לעמודות חסרות', () => {
            const settings = { start_date: { 'date_col': {} } };
            const result = getColumnIds(settings);
            expect(result.startDate).toBe('date_col');
            expect(result.duration).toBeNull();
            expect(result.connectedItem).toBeNull();
        });

        it('מחזיר null עם settings null', () => {
            expect(getColumnIds(null)).toBeNull();
        });
    });

    // === parseDateColumn ===

    describe('parseDateColumn', () => {
        it('מפרסר JSON עם תאריך ושעה', () => {
            const json = JSON.stringify({ date: '2026-02-15', time: '14:30:00' });
            const result = parseDateColumn(json);
            expect(result).toBeInstanceOf(Date);
            expect(result.getFullYear()).toBe(2026);
            expect(result.getMonth()).toBe(1); // February
            expect(result.getDate()).toBe(15);
            expect(result.getHours()).toBe(14);
            expect(result.getMinutes()).toBe(30);
        });

        it('מפרסר JSON עם תאריך בלבד (00:00:00)', () => {
            const json = JSON.stringify({ date: '2026-02-15' });
            const result = parseDateColumn(json);
            expect(result.getHours()).toBe(0);
            expect(result.getMinutes()).toBe(0);
        });

        it('מחזיר null עם ערך ריק', () => {
            expect(parseDateColumn('')).toBeNull();
            expect(parseDateColumn(null)).toBeNull();
            expect(parseDateColumn(undefined)).toBeNull();
        });

        it('מחזיר null עם JSON לא תקין', () => {
            expect(parseDateColumn('{invalid}')).toBeNull();
        });

        it('מחזיר null כשאין date ב-JSON', () => {
            expect(parseDateColumn(JSON.stringify({ time: '10:00:00' }))).toBeNull();
        });
    });

    // === parseHourColumn ===

    describe('parseHourColumn', () => {
        it('מפרסר שעות ודקות לדקות', () => {
            const json = JSON.stringify({ hour: 2, minute: 30 });
            expect(parseHourColumn(json)).toBe(150); // 2*60 + 30
        });

        it('מפרסר שעות בלבד', () => {
            const json = JSON.stringify({ hour: 3 });
            expect(parseHourColumn(json)).toBe(180);
        });

        it('מפרסר דקות בלבד', () => {
            const json = JSON.stringify({ minute: 45 });
            expect(parseHourColumn(json)).toBe(45);
        });

        it('מפרסר אפס', () => {
            const json = JSON.stringify({ hour: 0, minute: 0 });
            expect(parseHourColumn(json)).toBe(0);
        });

        it('מחזיר 60 (ברירת מחדל) עם ערך ריק', () => {
            expect(parseHourColumn('')).toBe(60);
            expect(parseHourColumn(null)).toBe(60);
            expect(parseHourColumn(undefined)).toBe(60);
        });

        it('מחזיר 60 עם JSON לא תקין', () => {
            expect(parseHourColumn('{broken')).toBe(60);
        });
    });

    // === parseBoardRelationColumn ===

    describe('parseBoardRelationColumn', () => {
        it('מפרסר linkedPulseIds', () => {
            const json = JSON.stringify({ linkedPulseIds: [123, 456] });
            expect(parseBoardRelationColumn(json)).toEqual([123, 456]);
        });

        it('מחזיר מערך ריק ללא linkedPulseIds', () => {
            const json = JSON.stringify({ other: 'data' });
            expect(parseBoardRelationColumn(json)).toEqual([]);
        });

        it('מחזיר מערך ריק עם ערך ריק', () => {
            expect(parseBoardRelationColumn('')).toEqual([]);
            expect(parseBoardRelationColumn(null)).toEqual([]);
        });

        it('מחזיר מערך ריק עם JSON לא תקין', () => {
            expect(parseBoardRelationColumn('{bad')).toEqual([]);
        });
    });

    // === mapItemToEvent ===

    describe('mapItemToEvent', () => {
        const columnIds = {
            startDate: 'date_col',
            duration: 'dur_col',
            eventTypeStatus: 'type_col',
            notes: 'notes_col'
        };

        const makeItem = (overrides = {}) => ({
            id: '100',
            name: 'אירוע טסט',
            column_values: [
                {
                    id: 'date_col',
                    value: JSON.stringify({ date: '2026-02-15', time: '10:00:00' })
                },
                {
                    id: 'dur_col',
                    value: JSON.stringify({ hour: 2, minute: 0 })
                },
                {
                    id: 'type_col',
                    text: 'שעתי',
                    value: '{}'
                },
                {
                    id: 'notes_col',
                    text: 'הערה לדוגמה',
                    value: '{}'
                }
            ],
            ...overrides
        });

        it('ממיר item לאירוע שעתי עם כל השדות', () => {
            const event = mapItemToEvent(makeItem(), columnIds);
            expect(event).not.toBeNull();
            expect(event.id).toBe('100');
            expect(event.title).toBe('אירוע טסט');
            expect(event.allDay).toBe(false);
            expect(event.eventType).toBe('שעתי');
            expect(event.notes).toBe('הערה לדוגמה');
            expect(event.durationDays).toBeNull();
        });

        it('מחשב תאריך סיום נכון (start + duration)', () => {
            const event = mapItemToEvent(makeItem(), columnIds);
            // 10:00 + 2 שעות = 12:00
            expect(event.start.getHours()).toBe(10);
            expect(event.end.getHours()).toBe(12);
        });

        it('מחזיר null ללא עמודת תאריך', () => {
            const item = makeItem();
            item.column_values = item.column_values.filter(c => c.id !== 'date_col');
            expect(mapItemToEvent(item, columnIds)).toBeNull();
        });

        it('מחזיר null עם item null', () => {
            expect(mapItemToEvent(null, columnIds)).toBeNull();
        });

        it('מחזיר null עם columnIds null', () => {
            expect(mapItemToEvent(makeItem(), null)).toBeNull();
        });

        it('duration ברירת מחדל (1 שעה) כשאין עמודת duration', () => {
            const item = makeItem();
            item.column_values = item.column_values.filter(c => c.id !== 'dur_col');
            const event = mapItemToEvent(item, columnIds);
            // duration 0 → effectiveDurationMinutes = 60
            const diffMinutes = (event.end - event.start) / 60000;
            expect(diffMinutes).toBe(60);
        });

        it('notes ריקות כשאין עמודת הערות', () => {
            const item = makeItem();
            item.column_values = item.column_values.filter(c => c.id !== 'notes_col');
            const event = mapItemToEvent(item, columnIds);
            expect(event.notes).toBe('');
        });
    });

    // === buildColumnValues ===

    describe('buildColumnValues', () => {
        const columnIds = { startDate: 'date_col', duration: 'dur_col' };

        it('בונה JSON עם תאריך ו-duration', () => {
            const start = new Date(2026, 1, 15, 10, 0, 0);
            const end = new Date(2026, 1, 15, 12, 30, 0);
            const result = JSON.parse(buildColumnValues(start, end, columnIds));

            expect(result['date_col'].date).toBe('2026-02-15');
            expect(result['date_col'].time).toBe('10:00:00');
            expect(result['dur_col'].hour).toBe(2);
            expect(result['dur_col'].minute).toBe(30);
        });

        it('זורק שגיאה ללא פרמטרים', () => {
            expect(() => buildColumnValues(null, new Date(), columnIds))
                .toThrow('Missing required parameters');
            expect(() => buildColumnValues(new Date(), null, columnIds))
                .toThrow('Missing required parameters');
            expect(() => buildColumnValues(new Date(), new Date(), null))
                .toThrow('Missing required parameters');
        });

        it('duration של 45 דקות', () => {
            const start = new Date(2026, 1, 15, 10, 0, 0);
            const end = new Date(2026, 1, 15, 10, 45, 0);
            const result = JSON.parse(buildColumnValues(start, end, columnIds));
            expect(result['dur_col'].hour).toBe(0);
            expect(result['dur_col'].minute).toBe(45);
        });
    });

    // === buildFetchEventsQuery ===

    describe('buildFetchEventsQuery', () => {
        it('בונה query עם boardId ותאריכים', () => {
            const query = buildFetchEventsQuery(
                123,
                new Date(2026, 1, 1),
                new Date(2026, 1, 28),
                'date_col'
            );

            expect(query).toContain('boards(ids: [123])');
            expect(query).toContain('2026-02-01');
            expect(query).toContain('2026-02-28');
            expect(query).toContain('"date_col"');
            expect(query).toContain('operator: between');
            expect(query).toContain('limit: 500');
        });
    });
});
