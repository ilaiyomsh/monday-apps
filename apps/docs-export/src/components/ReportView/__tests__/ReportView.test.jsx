/**
 * ReportView — the everyday surface: pick a range, pick committees, download a .docx.
 *
 * What is asserted here is what a user can lose:
 *   - a range with no rows must SAY so, not offer an empty dropdown that produces an
 *     empty document;
 *   - הפק דוח stays dead until at least one committee is chosen (the report is
 *     defined by the committee column, so "none" has no meaning);
 *   - the docx layer must receive EXACTLY the model the domain builds from the
 *     fetched rows, the resolved window and the user's picks — a wrong `range` or a
 *     dropped `selectedCommittees` still produces a plausible-looking document;
 *   - a failure produces ONE logged error and NO download (a half-written file is
 *     worse than none).
 *
 * The item/mirror/date fixtures are the probe captures of 2026-07-29 (scratch board
 * 18424252636). Faked at module boundaries only: the range query, board meta, the
 * .docx builder/downloader and the template store. The domain layer runs for real —
 * the point of the model assertion is the WIRING, so a fake model would prove nothing.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { harness } from 'monday-sdk-js';
import { MondayProvider } from '../../../contexts/MondayContext';
import { buildReportModel } from '../../../domain/reportModel';
import logger from '../../../utils/logger';
import { ReportView } from '../ReportView';

const mocks = vi.hoisted(() => ({
  fetchRangeItems: vi.fn(),
  fetchBoardMeta: vi.fn(),
  buildReportDocx: vi.fn(),
  downloadReport: vi.fn(),
  loadTemplate: vi.fn(),
}));

vi.mock('../../../services/itemsQuery.js', () => ({ fetchRangeItems: mocks.fetchRangeItems }));
vi.mock('../../../services/boardMeta.js', () => ({ fetchBoardMeta: mocks.fetchBoardMeta }));
vi.mock('../../../utils/docx/reportDoc.js', () => ({ buildReportDocx: mocks.buildReportDocx }));
vi.mock('../../../utils/docx/download.js', () => ({ downloadReport: mocks.downloadReport }));
vi.mock('../../../utils/assetsStore.js', () => ({ loadTemplate: mocks.loadTemplate }));

/* ------------------------------ probe fixtures ------------------------------ */

const mirror = (names) => ({
  id: 'wzmirror',
  type: 'mirror',
  text: null,
  value: null,
  display_value: names.join(', '),
  mirrored_items: names.map((name, i) => ({
    linked_board_id: '18424252630',
    linked_item: { id: `1266074797${i}`, name: `WZ-S${i}` },
    mirrored_value: { id: 'srctext', text: name, value: JSON.stringify(name) },
  })),
});

const row = (id, action, committees, report, date) => ({
  id,
  name: `WZ-R${id}`,
  cv: {
    wzaction: { id: 'wzaction', type: 'text', text: action, value: JSON.stringify(action) },
    wzmirror: mirror(committees),
    wzreport: { id: 'wzreport', type: 'long_text', text: report, value: null },
    wzdate: { id: 'wzdate', type: 'date', text: date, value: `{"date":"${date}"}`, date, time: '' },
  },
});

const ITEMS = [
  row('1', 'ביקור בשטח', ['שומרון'], 'סיור עם ראש המועצה', '2026-07-29'),
  row('2', 'ביקור בשטח', ['שומרון'], 'פגישת המשך', '2026-07-29'),
  row('3', 'ישיבה', ['גליל'], 'ישיבת ועדה', '2026-07-29'),
];

const BOARD = {
  id: '18424252636',
  name: 'דיווחי ועדות',
  columns: [
    { id: 'name', title: 'שם', type: 'name' },
    { id: 'wzaction', title: 'פעולה', type: 'text' },
    { id: 'wzmirror', title: 'ועדה אזורית', type: 'mirror' },
    { id: 'wzreport', title: 'דיווח', type: 'long_text' },
    { id: 'wzdate', title: 'תאריך דיווח', type: 'date' },
    { id: 'wzpeople', title: 'אחראי', type: 'people' },
  ],
};

const SETTINGS = {
  version: 1,
  boardId: '18424252636',
  columns: {
    action: 'wzaction',
    committee: 'wzmirror',
    report: 'wzreport',
    date: 'wzdate',
    person: 'wzpeople',
  },
  headers: { action: '', committee: '', report: '', date: '' },
  mergeAction: true,
  mergeCommittee: true,
  weekStartsOn: 0,
  blocks: [
    { id: 'b1', type: 'text', text: 'דוח פעילות שבועי' },
    { id: 'table', type: 'table' },
  ],
};

const BODY_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

function makeToast() {
  return {
    showLoading: vi.fn(() => 'loading-1'),
    showSuccess: vi.fn(),
    showInfo: vi.fn(),
    removeToast: vi.fn(),
  };
}

function renderView(props = {}) {
  const toast = props.toast || makeToast();
  const utils = render(
    <MondayProvider>
      <ReportView settings={SETTINGS} toast={toast} {...props} />
    </MondayProvider>
  );
  return { ...utils, toast };
}

/** Open the committee picker and tick one committee by name. */
async function pickCommittee(name) {
  fireEvent.click(await screen.findByRole('button', { name: /בחירת ועדות/ }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('checkbox', { name }));
}

const generateButton = () => screen.getByRole('button', { name: /הפק דוח/ });

beforeEach(() => {
  harness.reset();
  harness.failures.latencyMs = 0;
  mocks.fetchRangeItems.mockReset().mockResolvedValue(ITEMS);
  mocks.fetchBoardMeta.mockReset().mockResolvedValue(BOARD);
  mocks.buildReportDocx.mockReset().mockResolvedValue(BODY_BYTES);
  mocks.downloadReport.mockReset().mockResolvedValue(undefined);
  mocks.loadTemplate.mockReset().mockResolvedValue('QkFTRTY0');
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 6, 29, 12, 0, 0)); // Wednesday, local noon
});

afterEach(() => {
  // Unmount FIRST. RTL registers its auto-cleanup when this file imports
  // @testing-library/react, i.e. before this hook is registered, and vitest runs
  // afterEach hooks in reverse registration order ('stack') — so without an
  // explicit cleanup() here, restoreAllMocks() below strips the module mocks while
  // the tree is STILL MOUNTED. A board-meta response landing in that window drives
  // a fresh useRangeItems query against an implementation-less fetchRangeItems,
  // which returns undefined and throws inside the effect — failing a test whose
  // body has already passed. Product code is not implicated: fetchRangeItems is
  // async and cannot return a non-thenable.
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ReportView — range and committees', () => {
  it('shows the resolved daily window next to the range toggle', async () => {
    renderView();
    expect(await screen.findByText('29.07.2026')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'יומי' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'שבועי' })).toBeInTheDocument();
  });

  it('re-queries the Sunday..Saturday week and shows its label when שבועי is chosen', async () => {
    renderView();
    await waitFor(() => expect(mocks.fetchRangeItems).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'שבועי' }));

    await waitFor(() => expect(mocks.fetchRangeItems).toHaveBeenCalledTimes(2));
    expect(mocks.fetchRangeItems.mock.calls[1][0]).toMatchObject({
      from: '2026-07-26',
      to: '2026-08-01',
    });
    expect(await screen.findByText('26.07.2026 - 01.08.2026')).toBeInTheDocument();
  });

  it('says the range is empty instead of offering a committee dropdown', async () => {
    mocks.fetchRangeItems.mockResolvedValue([]);
    renderView();

    expect(await screen.findByText('לא נמצאו אייטמים בטווח הזה')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /בחירת ועדות/ })).not.toBeInTheDocument();
    expect(generateButton()).toBeDisabled();
  });

  it('keeps הפק דוח disabled until a committee is selected', async () => {
    renderView();
    await waitFor(() => expect(screen.getByRole('button', { name: /בחירת ועדות/ })).toBeEnabled());
    expect(generateButton()).toBeDisabled();

    await pickCommittee('שומרון');

    expect(generateButton()).toBeEnabled();
  });

  it('previews how many items the selected committees cover', async () => {
    renderView();
    await pickCommittee('שומרון');

    expect(await screen.findByText('2 אייטמים ב-1 ועדות')).toBeInTheDocument();
  });

  it('selects every committee at once with בחר הכול', async () => {
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: /בחירת ועדות/ }));
    const dialog = await screen.findByRole('dialog');

    fireEvent.click(within(dialog).getByRole('button', { name: 'בחר הכול' }));

    expect(within(dialog).getByRole('checkbox', { name: 'שומרון' })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: 'גליל' })).toBeChecked();
    expect(await screen.findByText('3 אייטמים ב-2 ועדות')).toBeInTheDocument();
  });

  it('renders the settings gear only for a board owner', async () => {
    const onOpenSettings = vi.fn();
    const { unmount } = renderView({ isOwner: false, onOpenSettings });
    await waitFor(() => expect(mocks.fetchRangeItems).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'הגדרות' })).not.toBeInTheDocument();
    unmount();

    renderView({ isOwner: true, onOpenSettings });
    fireEvent.click(await screen.findByRole('button', { name: 'הגדרות' }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});

describe('ReportView — generating the document', () => {
  it('hands the docx builder the model built from the fetched rows, the window and the picks', async () => {
    const { toast } = renderView();
    await pickCommittee('שומרון');

    fireEvent.click(generateButton());

    await waitFor(() => expect(mocks.downloadReport).toHaveBeenCalledTimes(1));

    const expectedModel = buildReportModel({
      items: ITEMS,
      settings: SETTINGS,
      columns: BOARD.columns,
      range: { kind: 'daily', from: '2026-07-29', to: '2026-07-29', label: '29.07.2026' },
      selectedCommittees: ['שומרון'],
    });
    expect(mocks.buildReportDocx).toHaveBeenCalledTimes(1);
    expect(mocks.buildReportDocx).toHaveBeenCalledWith(expectedModel);

    // Guards on the fixture: the model really does narrow to שומרון and merge.
    const model = mocks.buildReportDocx.mock.calls[0][0];
    expect(model.title).toBe('דוח יומי 29.07.2026');
    expect(model.table.headers).toEqual(['פעולה', 'ועדה אזורית', 'דיווח', 'תאריך דיווח']);
    expect(model.table.rows).toHaveLength(2);
    expect(model.table.rows[0].cells[0]).toEqual({ text: 'ביקור בשטח', rowSpan: 2 });
    expect(model.table.rows[1].cells[0]).toBeNull();
    expect(model.blocks).toEqual([
      { type: 'text', text: 'דוח פעילות שבועי' },
      { type: 'table' },
    ]);

    expect(mocks.downloadReport).toHaveBeenCalledWith({
      bodyBytes: BODY_BYTES,
      templateBase64: 'QkFTRTY0',
      filename: 'דיווחי ועדות - יומי 29.07.2026.docx',
    });
    expect(toast.showLoading).toHaveBeenCalledTimes(1);
    expect(toast.removeToast).toHaveBeenCalledWith('loading-1');
    expect(toast.showSuccess).toHaveBeenCalledTimes(1);
  });

  it('names the file after the weekly window when שבועי is chosen', async () => {
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: 'שבועי' }));
    await waitFor(() => expect(mocks.fetchRangeItems).toHaveBeenCalledTimes(2));
    await pickCommittee('גליל');

    fireEvent.click(generateButton());

    await waitFor(() => expect(mocks.downloadReport).toHaveBeenCalledTimes(1));
    expect(mocks.downloadReport.mock.calls[0][0].filename).toBe(
      'דיווחי ועדות - שבועי 26.07.2026 - 01.08.2026.docx'
    );
  });

  it('produces no document and no error when the picked committees hold no items', async () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    // The rows disappear (someone edited the board) after the committee was picked.
    const { toast } = renderView();
    await pickCommittee('שומרון');
    mocks.fetchRangeItems.mockResolvedValue([]);
    fireEvent.click(screen.getByRole('button', { name: 'שבועי' }));
    await waitFor(() => expect(screen.getByText('לא נמצאו אייטמים בטווח הזה')).toBeInTheDocument());

    expect(mocks.buildReportDocx).not.toHaveBeenCalled();
    expect(mocks.downloadReport).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(toast.showSuccess).not.toHaveBeenCalled();
  });

  it('drops a committee from the selection when the new window no longer offers it', async () => {
    // Reason 2 in the component header. The daily window has גליל; the weekly one the
    // user flips to does not. A pick left behind would narrow the report to a committee
    // that is no longer on screen — filterByCommittees answers zero rows for a
    // selection that still LOOKS non-empty, so הפק דוח stays enabled and produces
    // nothing.
    mocks.fetchRangeItems.mockImplementation(({ from, to }) =>
      Promise.resolve(from === to ? ITEMS : ITEMS.filter((item) => item.id !== '3'))
    );
    renderView();
    await pickCommittee('גליל');
    expect(await screen.findByText('1 אייטמים ב-1 ועדות')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'שבועי' }));

    // גליל is gone from the options, so it must be gone from the selection too.
    await waitFor(() =>
      expect(screen.getByText('יש לבחור לפחות ועדה אחת כדי להפיק דוח')).toBeInTheDocument()
    );
    expect(generateButton()).toBeDisabled();
    fireEvent.click(await screen.findByRole('button', { name: /בחירת ועדות/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('checkbox', { name: 'גליל' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('checkbox', { name: 'שומרון' })).not.toBeChecked();
  });

  it('logs exactly one error and downloads nothing when the docx build fails', async () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const boom = new Error('docx build failed');
    mocks.buildReportDocx.mockRejectedValue(boom);

    const { toast } = renderView();
    await pickCommittee('שומרון');
    fireEvent.click(generateButton());

    await waitFor(() => expect(errorSpy).toHaveBeenCalledTimes(1));
    expect(errorSpy.mock.calls[0][0]).toBe('ReportView');
    expect(errorSpy.mock.calls[0][2]).toBe(boom);
    expect(mocks.downloadReport).not.toHaveBeenCalled();
    expect(toast.showSuccess).not.toHaveBeenCalled();
    // The "working…" toast must not be left hanging on the screen.
    expect(toast.removeToast).toHaveBeenCalledWith('loading-1');
    // …and the button comes back, so the user can retry.
    await waitFor(() => expect(generateButton()).toBeEnabled());
  });

  it('still downloads the report when no template was uploaded', async () => {
    mocks.loadTemplate.mockResolvedValue(null);
    renderView();
    await pickCommittee('שומרון');

    fireEvent.click(generateButton());

    await waitFor(() => expect(mocks.downloadReport).toHaveBeenCalledTimes(1));
    expect(mocks.downloadReport.mock.calls[0][0].templateBase64).toBeNull();
  });

  it('surfaces the range-query failure and retries it on the retry affordance', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    mocks.fetchRangeItems.mockRejectedValueOnce(new Error('InvalidColumnTypeException'));

    renderView();

    const retry = await screen.findByRole('button', { name: 'נסה שוב' });
    mocks.fetchRangeItems.mockResolvedValue(ITEMS);
    fireEvent.click(retry);

    await waitFor(() => expect(mocks.fetchRangeItems).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('button', { name: /בחירת ועדות/ })).toBeEnabled();
  });
});
