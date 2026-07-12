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
const STORAGE_KEY = 'global:teamPeople:18421604809:multiple_person_mm562c71';

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

// Context for the columnPickers (on-click) placement. columnId is the column's
// OWN people column (multiple_person_mm562c71 on WZ-TeamPeople-source); itemId /
// boardId are that source item / board — all matching the captured probes.
const context = () => ({
  boardId: '18421604809',
  itemId: '12511436134',
  columnId: 'multiple_person_mm562c71',
  selectedItemIds: ['12511436134'],
});

// The exactly-3 seeded members of team "test ilai".
const MEMBER_NAMES = ['עידו פיוטרקובסקי', 'עילי שלם', 'רוני ארגמן'];

// User-facing Hebrew strings the dialog must show (asserted exactly, not by substring).
const UNCONFIGURED_TITLE = 'העמודה לא הוגדרה';
const API_ERROR_MSG = 'אירעה שגיאה בטעינת הנתונים מ-monday. נסו שוב מאוחר יותר.';
const NO_TEAM_MSG = 'לא נמצא צוות בפריט המקושר. ודאו שקיים פריט מקושר ושהוגדר בו צוות.';
// The dialog title must carry the resolved team's name (seeded team 1348990).
const TEAM_TITLE = 'צוות test ilai';

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

describe('OnClickDialog — configured & ready', () => {
  it('opens straight into the list (native-picker structure) with EXACTLY the 3 members of team "test ilai" and no foreign users', async () => {
    installAppApiHandlers(harness);
    harness.seedStorage(STORAGE_KEY, validV1());

    render(<OnClickDialog context={context()} />);

    // Native-like: NO extra trigger click — the list renders immediately.
    expect(await screen.findByText(MEMBER_NAMES[0])).toBeInTheDocument();

    // All three allowed members are offered...
    MEMBER_NAMES.forEach((name) => {
      expect(screen.getByText(name)).toBeInTheDocument();
    });
    // ...and nobody else: the roster is exactly the resolved allowed set.
    expect(screen.queryByText('משתמש חיצוני')).toBeNull();
    const memberRows = screen
      .getAllByRole('button')
      .filter((b) => /פיוטרקובסקי|עילי שלם|ארגמן/.test(b.textContent || ''));
    expect(memberRows).toHaveLength(3);
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

describe('OnClickDialog — save', () => {
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

    // Native-like: click a person in the immediately-rendered list — that IS
    // the save (no separate Save button exists anymore).
    const row = (await screen.findByText('עילי שלם')).closest('button');
    fireEvent.click(row);

    await waitFor(() => expect(captured).not.toBeNull());

    // The write payload is the native people format produced by formatCellValue:
    // integer id, kind "person" (ids become integers ONLY at this seam).
    expect(captured.boardId).toBe('18421604809');
    expect(captured.itemId).toBe('12511436134');
    expect(captured.columnId).toBe('multiple_person_mm562c71');
    expect(JSON.parse(captured.value)).toEqual({
      personsAndTeams: [{ id: 48274917, kind: 'person' }],
    });

    // Native-picker behavior: the dialog STAYS OPEN (user may pick more people
    // or close by clicking outside) — closeDialog must NOT have been executed.
    expect(harness.calls.some((c) => c.type === 'closeDialog')).toBe(false);
    // The pick is reflected as a selected chip (optimistic).
    expect(screen.getByLabelText('הסר עילי שלם')).toBeInTheDocument();
  });

  it('reverts the optimistic pick and shows the inline error strip when the write fails', async () => {
    installAppApiHandlers(harness, {
      UpdateColumnValue: {
        fn: () => {
          throw new Error('write refused');
        },
      },
    });
    harness.seedStorage(STORAGE_KEY, validV1());

    render(<OnClickDialog context={context()} />);

    const row = (await screen.findByText('עילי שלם')).closest('button');
    fireEvent.click(row);

    // The failed write reverts the selection (chip gone) and shows the strip.
    expect(await screen.findByText('שמירת הבחירה נכשלה. נסו שוב.')).toBeInTheDocument();
    expect(screen.queryByLabelText('הסר עילי שלם')).toBeNull();
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
    // The error state offers a single control: retry.
    expect(screen.getByRole('button')).toBeInTheDocument();
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
