import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    isPortfolioMode,
    getProjectsBoardId,
    resolveTasksBoardId,
    clearTasksBoardCache,
    isPortfolioBoard,
} from '../portfolioResolver';
import { safeApi } from '../mondayApi/client.js';

// מוקים — vi.mock עובר hoist אוטומטית מעל ה-import-ים ע"י vitest,
// כך שהם עדיין נקבעים לפני שהקובץ הנבדק נטען בפועל.
vi.mock('../logger', () => ({
    default: {
        debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
        functionStart: vi.fn(), functionEnd: vi.fn(),
        api: vi.fn(), apiResponse: vi.fn(), apiError: vi.fn(),
    },
}));

vi.mock('../mondayApi/client.js', () => ({
    safeApi: vi.fn(),
}));

describe('portfolioResolver', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearTasksBoardCache();
    });

    describe('isPortfolioMode', () => {
        it('מחזיר true כאשר projectsSourceMode === "portfolio"', () => {
            expect(isPortfolioMode({ projectsSourceMode: 'portfolio' })).toBe(true);
        });

        it('מחזיר false כאשר projectsSourceMode === "board"', () => {
            expect(isPortfolioMode({ projectsSourceMode: 'board' })).toBe(false);
        });

        it('מחזיר false כאשר projectsSourceMode חסר (default board)', () => {
            expect(isPortfolioMode({})).toBe(false);
        });

        it('מחזיר false עבור settings נל/undefined', () => {
            expect(isPortfolioMode(null)).toBe(false);
            expect(isPortfolioMode(undefined)).toBe(false);
        });
    });

    describe('getProjectsBoardId', () => {
        it('מחזיר את connectedBoardId', () => {
            expect(getProjectsBoardId({ connectedBoardId: '12345' })).toBe('12345');
        });

        it('מחזיר null כאשר connectedBoardId חסר', () => {
            expect(getProjectsBoardId({})).toBe(null);
            expect(getProjectsBoardId(null)).toBe(null);
        });
    });

    describe('resolveTasksBoardId', () => {
        const mockMonday = {};

        it('מחזיר null עבור projectItemId ריק', async () => {
            expect(await resolveTasksBoardId(mockMonday, null)).toBe(null);
            expect(await resolveTasksBoardId(mockMonday, undefined)).toBe(null);
            expect(safeApi).not.toHaveBeenCalled();
        });

        it('שולף board id מ-portfolio_project_link.linked_items[0].board.id', async () => {
            safeApi.mockResolvedValueOnce({
                data: {
                    items: [{
                        column_values: [{
                            linked_items: [
                                { board: { id: '18412553513' } },
                                { board: { id: '18412553513' } },
                            ],
                        }],
                    }],
                },
            });

            const boardId = await resolveTasksBoardId(mockMonday, '11975493505');
            expect(boardId).toBe('18412553513');
            expect(safeApi).toHaveBeenCalledTimes(1);
        });

        it('ממזער קריאות API באמצעות מטמון לפי projectItemId', async () => {
            safeApi.mockResolvedValueOnce({
                data: {
                    items: [{
                        column_values: [{
                            linked_items: [{ board: { id: '99999' } }],
                        }],
                    }],
                },
            });

            const a = await resolveTasksBoardId(mockMonday, '111');
            const b = await resolveTasksBoardId(mockMonday, '111');
            expect(a).toBe('99999');
            expect(b).toBe('99999');
            expect(safeApi).toHaveBeenCalledTimes(1);
        });

        it('clearTasksBoardCache מאפס את המטמון', async () => {
            safeApi.mockResolvedValue({
                data: {
                    items: [{ column_values: [{ linked_items: [{ board: { id: 'X' } }] }] }],
                },
            });

            await resolveTasksBoardId(mockMonday, '222');
            clearTasksBoardCache();
            await resolveTasksBoardId(mockMonday, '222');
            expect(safeApi).toHaveBeenCalledTimes(2);
        });

        it('מחזיר null כשאין linked_items', async () => {
            safeApi.mockResolvedValueOnce({
                data: { items: [{ column_values: [{ linked_items: [] }] }] },
            });
            expect(await resolveTasksBoardId(mockMonday, '333')).toBe(null);
        });

        it('מחזיר null על שגיאת API ולא זורק', async () => {
            safeApi.mockRejectedValueOnce(new Error('API down'));
            expect(await resolveTasksBoardId(mockMonday, '444')).toBe(null);
        });
    });

    describe('isPortfolioBoard', () => {
        const mockMonday = {};

        it('מחזיר isPortfolio:false עבור boardId ריק', async () => {
            const result = await isPortfolioBoard(mockMonday, null);
            expect(result).toEqual({ isPortfolio: false, hasProjects: false, projectBoardIds: [] });
            expect(safeApi).not.toHaveBeenCalled();
        });

        it('מזהה לוח Portfolio תקין עם פרויקטים מחוברים', async () => {
            safeApi.mockResolvedValueOnce({
                data: {
                    boards: [{
                        columns: [{
                            id: 'portfolio_project_link',
                            type: 'board_relation',
                            settings: JSON.stringify({
                                type: 'hierarchy',
                                boardIds: [111, 222, 333],
                            }),
                        }],
                    }],
                },
            });

            const result = await isPortfolioBoard(mockMonday, '18412551958');
            expect(result.isPortfolio).toBe(true);
            expect(result.hasProjects).toBe(true);
            expect(result.projectBoardIds).toEqual([111, 222, 333]);
        });

        it('מזהה Portfolio ריק (אין פרויקטים מחוברים)', async () => {
            safeApi.mockResolvedValueOnce({
                data: {
                    boards: [{
                        columns: [{
                            id: 'portfolio_project_link',
                            type: 'board_relation',
                            settings: JSON.stringify({ type: 'hierarchy', boardIds: [] }),
                        }],
                    }],
                },
            });

            const result = await isPortfolioBoard(mockMonday, 'x');
            expect(result.isPortfolio).toBe(true);
            expect(result.hasProjects).toBe(false);
            expect(result.projectBoardIds).toEqual([]);
        });

        it('דוחה לוח שאינו Portfolio (אין portfolio_project_link)', async () => {
            safeApi.mockResolvedValueOnce({ data: { boards: [{ columns: [] }] } });
            const result = await isPortfolioBoard(mockMonday, 'x');
            expect(result.isPortfolio).toBe(false);
        });

        it('דוחה כאשר settings.type אינו "hierarchy"', async () => {
            safeApi.mockResolvedValueOnce({
                data: {
                    boards: [{
                        columns: [{
                            id: 'portfolio_project_link',
                            type: 'board_relation',
                            settings: JSON.stringify({ boardIds: [1] }),
                        }],
                    }],
                },
            });
            const result = await isPortfolioBoard(mockMonday, 'x');
            expect(result.isPortfolio).toBe(false);
        });

        it('מחזיר isPortfolio:false על שגיאת API ולא זורק', async () => {
            safeApi.mockRejectedValueOnce(new Error('boom'));
            const result = await isPortfolioBoard(mockMonday, 'x');
            expect(result).toEqual({ isPortfolio: false, hasProjects: false, projectBoardIds: [] });
        });
    });
});
