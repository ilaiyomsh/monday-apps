import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

import { harness } from '../../dev-harness/monday-sdk-stub.js';
import { installAppApiHandlers } from '../../test-utils/probeFixtures.js';
import logger from '../../utils/logger.js';
import getColumnValueCapture from '../../test-utils/probes/GetColumnValue.json';
import OnClickDialog from './OnClickDialog.jsx';

// Column config lives in GLOBAL storage keyed teamPeople:<boardId>:<columnId>
// (matching the context() fixture below); the stub scopes global storage under
// `global:<key>` and harness.seedStorage does NOT re-scope, so we seed under the
// already-scoped key (same as the hook tests).
const STORAGE_KEY = 'global:teamPeople:18421604809:multiple_person_mm563xsw';

// A complete, valid v1 settings object referencing the REAL seeded ids
// (probes/MANIFEST.md): relation board_relation_mm56dy57 -> target board
// 18421604791, people column multiple_person_mm5694pg -> team 1348990 ("test ilai").
const validV1 = () => ({
  version: 1,
  relationColumnId: 'board_relation_mm56dy57',
  linkedBoardId: '18421604791',
  peopleColumnId: 'multiple_person_mm5694pg',
  policy: { selectionMode: 'multi', aggregation: 'union', includeListedPersons: true },
});

// Same settings in single-assignee mode (the auto-close flow).
const singleV1 = () => ({
  ...validV1(),
  policy: { selectionMode: 'single', aggregation: 'union', includeListedPersons: true },
});

// Context for the columnPickers (on-click) placement. columnId is the column's
// OWN people column (multiple_person_mm563xsw on WZ-TeamPeople-source); itemId /
// boardId are that source item / board — all matching the captured probes.
const context = () => ({
  boardId: '18421604809',
  itemId: '12511436134',
  columnId: 'multiple_person_mm563xsw',
  selectedItemIds: ['12511436134'],
});

// The exactly-3 seeded members of team "test ilai" (ids per GetTeamsAndUsers.json).
const MEMBER_NAMES = ['עידו פיוטרקובסקי', 'עילי שלם', 'רוני ארגמן'];
const ILAI_ID = 48274917; // עילי שלם
const RONI_ID = 96863017; // רוני ארגמן

// User-facing Hebrew strings the dialog must show (asserted exactly, not by substring).
const UNCONFIGURED_TITLE = 'העמודה לא הוגדרה';
const API_ERROR_MSG = 'אירעה שגיאה בטעינת הנתונים מ-monday. נסו שוב מאוחר יותר.';
const NO_TEAM_MSG = 'לא נמצא צוות בפריט המקושר. ודאו שקיים פריט מקושר ושהוגדר בו צוות.';
// The dialog title must carry the resolved team's name (seeded team 1348990).
const TEAM_TITLE = 'צוות test ilai';
// Search-first UX: the ONLY thing the user sees on open besides the title.
const SEARCH_PLACEHOLDER = 'הקלד שם אחראי...';

const searchInput = () => screen.getByLabelText('חיפוש שם');
const typeSearch = (value) => fireEvent.change(searchInput(), { target: { value } });

const closeDialogCalls = () => harness.calls.filter((c) => c.type === 'closeDialog').length;

beforeEach(() => {
  harness.reset();
  harness.failures.latencyMs = 0;
  vi.restoreAllMocks();
  // The chain / hook log errors on the failure-path tests; keep them silent but
  // observable. Individual tests re-spy when they assert call counts.
  vi.spyOn(logger, 'error').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  harness.reset();
});

describe('OnClickDialog — search-first shell', () => {
  it('renders the search input IMMEDIATELY on open, before the resolve chain settles', async () => {
    installAppApiHandlers(harness);
    harness.seedStorage(STORAGE_KEY, validV1());

    render(<OnClickDialog context={context()} />);

    // Synchronous assertions — no await: the shell must not wait for storage
    // or the API chain. This is the whole point of the search-first UX.
    expect(searchInput()).toBeInTheDocument();
    expect(screen.getByPlaceholderText(SEARCH_PLACEHOLDER)).toBeInTheDocument();
    MEMBER_NAMES.forEach((name) => expect(screen.queryByText(name)).toBeNull());

    // Let the background chain settle so the test ends in a stable state.
    await screen.findByRole('heading', { name: TEAM_TITLE });
  });

  it('keeps the box clean: NO member list until the user types, even after the chain is ready', async () => {
    installAppApiHandlers(harness);
    harness.seedStorage(STORAGE_KEY, validV1());

    render(<OnClickDialog context={context()} />);

    // Chain fully resolved (team title is up) — and still no list.
    await screen.findByRole('heading', { name: TEAM_TITLE });
    MEMBER_NAMES.forEach((name) => expect(screen.queryByText(name)).toBeNull());
  });

  it('filters from the FIRST typed letter: "ע" shows the two matching members only', async () => {
    installAppApiHandlers(harness);
    harness.seedStorage(STORAGE_KEY, validV1());

    render(<OnClickDialog context={context()} />);
    await screen.findByRole('heading', { name: TEAM_TITLE });

    typeSearch('ע');

    expect(await screen.findByText('עידו פיוטרקובסקי')).toBeInTheDocument();
    expect(screen.getByText('עילי שלם')).toBeInTheDocument();
    // "רוני ארגמן" contains no ע — must not be offered.
    expect(screen.queryByText('רוני ארגמן')).toBeNull();
  });

  it('typing while the chain is still loading shows the loading hint, then the matches (typing masks load)', async () => {
    installAppApiHandlers(harness);
    harness.seedStorage(STORAGE_KEY, validV1());
    harness.failures.latencyMs = 60;

    render(<OnClickDialog context={context()} />);

    // Type before the chain settles — the shell is already interactive.
    typeSearch('עילי');
    expect(screen.getByText('טוען...')).toBeInTheDocument();

    // When the background chain lands, the typed query resolves to its match.
    expect(await screen.findByText('עילי שלם')).toBeInTheDocument();
  });

  it('shows the resolved team name in the dialog title', async () => {
    installAppApiHandlers(harness);
    harness.seedStorage(STORAGE_KEY, validV1());

    render(<OnClickDialog context={context()} />);

    expect(
      await screen.findByRole('heading', { name: TEAM_TITLE })
    ).toBeInTheDocument();
  });
});

describe('OnClickDialog — unconfigured', () => {
  it('shows the Hebrew "open column settings" instruction and no picker when storage has no settings', async () => {
    installAppApiHandlers(harness);
    // No storage seed -> useColumnSettings resolves to null (unconfigured).

    render(<OnClickDialog context={context()} />);

    expect(await screen.findByText(UNCONFIGURED_TITLE)).toBeInTheDocument();
    // No picker list is rendered in the unconfigured state.
    expect(screen.queryByText('עילי שלם')).toBeNull();
  });
});

describe('OnClickDialog — save, multi mode (dialog stays open)', () => {
  it('saves immediately on person click: writes JSON.stringify(formatCellValue(selection)) via change_column_value and keeps the dialog open', async () => {
    let captured = null;
    installAppApiHandlers(harness, {
      // Capture the mutation variables the dialog sends; still answer with the
      // real captured write response so the success path completes.
      UpdateColumnValue: {
        fn: (_query, variables) => {
          captured = variables;
          return { change_column_value: { id: '12511436134' } };
        },
      },
    });
    harness.seedStorage(STORAGE_KEY, validV1());

    render(<OnClickDialog context={context()} />);
    await screen.findByRole('heading', { name: TEAM_TITLE });

    // Search-first: the row exists only after typing; clicking it IS the save
    // (no separate Save button exists).
    typeSearch('עילי');
    const row = (await screen.findByText('עילי שלם')).closest('button');
    fireEvent.click(row);

    await waitFor(() => expect(captured).not.toBeNull());

    // The write payload is the native people format produced by formatCellValue:
    // integer id, kind "person" (ids become integers ONLY at this seam).
    expect(captured.boardId).toBe('18421604809');
    expect(captured.itemId).toBe('12511436134');
    expect(captured.columnId).toBe('multiple_person_mm563xsw');
    expect(JSON.parse(captured.value)).toEqual({
      personsAndTeams: [{ id: ILAI_ID, kind: 'person' }],
    });

    // Multi mode: the dialog STAYS OPEN (user may pick more people or close by
    // clicking outside) — closeDialog must NOT have been executed.
    expect(closeDialogCalls()).toBe(0);
    // The pick is reflected on the row itself (optimistic).
    expect(row.className).toMatch(/rowSelected/);
  });
});

describe('OnClickDialog — save, single mode (pick = save + close, second pick replaces)', () => {
  it('picking a person saves the native payload and closes the dialog', async () => {
    let captured = null;
    installAppApiHandlers(harness, {
      UpdateColumnValue: {
        fn: (_query, variables) => {
          captured = variables;
          return { change_column_value: { id: '12511436134' } };
        },
      },
    });
    harness.seedStorage(STORAGE_KEY, singleV1());

    render(<OnClickDialog context={context()} />);
    await screen.findByRole('heading', { name: TEAM_TITLE });

    typeSearch('עילי');
    fireEvent.click((await screen.findByText('עילי שלם')).closest('button'));

    await waitFor(() => expect(closeDialogCalls()).toBe(1));
    expect(JSON.parse(captured.value)).toEqual({
      personsAndTeams: [{ id: ILAI_ID, kind: 'person' }],
    });
  });

  it('picking ANOTHER person replaces the current assignee instead of blocking', async () => {
    const payloads = [];
    installAppApiHandlers(harness, {
      UpdateColumnValue: {
        fn: (_query, variables) => {
          payloads.push(JSON.parse(variables.value));
          return { change_column_value: { id: '12511436134' } };
        },
      },
    });
    harness.seedStorage(STORAGE_KEY, singleV1());

    render(<OnClickDialog context={context()} />);
    await screen.findByRole('heading', { name: TEAM_TITLE });

    typeSearch('עילי');
    fireEvent.click((await screen.findByText('עילי שלם')).closest('button'));
    await waitFor(() => expect(payloads).toHaveLength(1));

    // Second pick of a DIFFERENT person: not blocked, no "one assignee only"
    // notice — the new person simply replaces the old one.
    typeSearch('רוני');
    fireEvent.click((await screen.findByText('רוני ארגמן')).closest('button'));
    await waitFor(() => expect(payloads).toHaveLength(2));

    expect(payloads[1]).toEqual({
      personsAndTeams: [{ id: RONI_ID, kind: 'person' }],
    });
  });

  it('a failed write keeps the dialog OPEN, reverts the optimistic pick, and shows the inline strip', async () => {
    installAppApiHandlers(harness, {
      UpdateColumnValue: {
        fn: () => {
          throw new Error('write refused');
        },
      },
    });
    harness.seedStorage(STORAGE_KEY, singleV1());

    render(<OnClickDialog context={context()} />);
    await screen.findByRole('heading', { name: TEAM_TITLE });

    typeSearch('עילי');
    const row = (await screen.findByText('עילי שלם')).closest('button');
    fireEvent.click(row);

    // The failed write reverts the selection and shows the strip; the dialog
    // must NOT close on failure — the user has to see what happened.
    expect(await screen.findByText('שמירת הבחירה נכשלה. נסו שוב.')).toBeInTheDocument();
    expect(closeDialogCalls()).toBe(0);
    expect(row.className).not.toMatch(/rowSelected/);
  });
});

describe('OnClickDialog — chain error', () => {
  it('shows the API-error message with a retry control when the resolve chain errors', async () => {
    installAppApiHandlers(harness);
    harness.seedStorage(STORAGE_KEY, validV1());
    // First api() call (q1) returns a GraphQL soft error -> service wraps it into
    // AppError(API_ERROR) -> the hook flips to status "error".
    harness.failures.apiErrorNext = true;

    render(<OnClickDialog context={context()} />);

    expect(await screen.findByText(API_ERROR_MSG)).toBeInTheDocument();
    // The error state offers a retry control.
    expect(screen.getByRole('button', { name: /נסו שוב|נסה שוב|רענון|retry/i })).toBeInTheDocument();
  });
});

describe('OnClickDialog — locked empty state', () => {
  it('shows a locked "no team" message and renders NO picker when the chain is empty (no linked item)', async () => {
    // Derive a no-linked-items variant from the REAL GetColumnValue capture:
    // same envelope, but the board_relation column carries no linked_item_ids.
    const src = getColumnValueCapture.data.items[0];
    const emptyLinked = {
      items: [
        {
          ...src,
          column_values: src.column_values.map((cv) =>
            cv.type === 'board_relation' ? { ...cv, linked_item_ids: [] } : cv,
          ),
        },
      ],
    };
    installAppApiHandlers(harness, { GetColumnValue: { data: emptyLinked } });
    harness.seedStorage(STORAGE_KEY, validV1());

    render(<OnClickDialog context={context()} />);

    expect(await screen.findByText(NO_TEAM_MSG)).toBeInTheDocument();
    // Locked: no allowed users, so no picker rows at all.
    expect(screen.queryByText('עידו פיוטרקובסקי')).toBeNull();
  });
});
