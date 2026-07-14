// ColumnSettings — component tests (test-guard TDD, red-first).
//
// Placement = column_view_settings (NO itemId). The pane reads persisted settings
// from global storage (keyed by boardId+columnId), fetches the source board's columns, offers a relation
// (board_relation) dropdown, resolves the linked board, offers a people-column
// dropdown over the linked board's people columns, then persists a v1 settings
// object.
//
// Fixtures are the REAL captured probe responses (installAppApiHandlers, see
// probes/MANIFEST.md); nothing is hand-built. The GetBoardColumns capture holds
// BOTH seeded boards, so the pane is pointed at the real source board id and must
// select the correct board out of the returned array (that selection is what the
// "lists only" assertions actually pin).

import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';

import { harness } from '../../dev-harness/monday-sdk-stub.js';
import { CONTEXTS } from '../../dev-harness/fixtures.js';
import { installAppApiHandlers } from '../../test-utils/probeFixtures.js';
import ColumnSettings from './ColumnSettings.jsx';

// Real seeded ids/titles from probes/MANIFEST.md + GetBoardColumns.json.
const SOURCE_BOARD_ID = '18421604809';
const RELATION_COL_ID = 'board_relation_mm56dy57'; // "פרויקט" — the ONLY board_relation on the source board
const RELATION_COL_TITLE = 'פרויקט';
const SOURCE_PEOPLE_TITLE = 'אחראי'; // multiple_person_mm562c71 — a people column on the SOURCE board (must NOT appear as a relation option)
const LINKED_BOARD_ID = '18421604791';
const PEOPLE_COL_ID = 'multiple_person_mm5694pg'; // "צוות אחראי" — the people column on the linked board
const PEOPLE_COL_TITLE = 'צוות אחראי';
const LINKED_RELATION_TITLE = 'link to WZ-TeamPeople-source'; // board_relation on the linked board (must NOT appear as a people option)

// Column config lives in GLOBAL storage keyed teamPeople:<boardId>:<columnId>
// (the settings context fixture's columnId is 'status'); the stub scopes global
// storage under `global:<key>`. setColumnConfig writes JSON.stringify(value) there.
const STORAGE_KEY = `global:teamPeople:${SOURCE_BOARD_ID}:status`;

// Settings placement, pointed at the real seeded source board so the capture's
// source board is the one the pane resolves. (Production settings placement has
// no itemId — the fixture already omits it.)
const settingsContext = () => ({ ...CONTEXTS.column_view_settings, boardId: SOURCE_BOARD_ID });

// Accessible names of the two select triggers + the action buttons.
const RELATION_TRIGGER = 'עמודת חיבור לוחות';
const PEOPLE_TRIGGER = 'עמודת אנשים בלוח המקושר';
const SAVE_BTN = 'שמירה';

beforeEach(() => {
  harness.reset();
  harness.failures.latencyMs = 0;
  installAppApiHandlers(harness);
});

afterEach(() => {
  // vite.config.js's test block does not set globals:true, so RTL's auto
  // afterEach(cleanup) never registers — unmount explicitly or renders leak.
  cleanup();
  harness.reset();
});

async function pickRelation() {
  fireEvent.click(await screen.findByRole('button', { name: RELATION_TRIGGER }, { timeout: 3000 }));
  fireEvent.click(await screen.findByRole('option', { name: RELATION_COL_TITLE }));
}

async function pickPeople() {
  const peopleBtn = await screen.findByRole('button', { name: PEOPLE_TRIGGER });
  await waitFor(() => expect(peopleBtn).toBeEnabled());
  fireEvent.click(peopleBtn);
  fireEvent.click(await screen.findByRole('option', { name: PEOPLE_COL_TITLE }));
}

describe('ColumnSettings — unconfigured first open', () => {
  it('keeps Save disabled until BOTH a relation column and a people column are chosen, then enables it', async () => {
    render(<ColumnSettings context={settingsContext()} />);

    const save = await screen.findByRole('button', { name: SAVE_BTN }, { timeout: 3000 });
    expect(save).toBeDisabled();

    await pickRelation();
    // relation chosen, people not yet → still disabled
    expect(screen.getByRole('button', { name: SAVE_BTN })).toBeDisabled();

    await pickPeople();
    await waitFor(() => expect(screen.getByRole('button', { name: SAVE_BTN })).toBeEnabled());
  });
});

describe('ColumnSettings — relation dropdown', () => {
  it('lists exactly the source board\'s board_relation column(s) and none of its other columns', async () => {
    render(<ColumnSettings context={settingsContext()} />);

    fireEvent.click(await screen.findByRole('button', { name: RELATION_TRIGGER }, { timeout: 3000 }));

    const listbox = await screen.findByRole('listbox');
    const options = within(listbox).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([RELATION_COL_TITLE]);
    // explicit negatives — the people column and the name column are NOT relation options
    expect(within(listbox).queryByText(SOURCE_PEOPLE_TITLE)).not.toBeInTheDocument();
    expect(within(listbox).queryByText('Name')).not.toBeInTheDocument();
  });
});

describe('ColumnSettings — linked-board resolution', () => {
  it('fetches the linked board on relation pick and lists exactly its people column(s) in the people dropdown', async () => {
    render(<ColumnSettings context={settingsContext()} />);

    await pickRelation();

    const peopleBtn = await screen.findByRole('button', { name: PEOPLE_TRIGGER });
    await waitFor(() => expect(peopleBtn).toBeEnabled());
    fireEvent.click(peopleBtn);

    const listbox = await screen.findByRole('listbox');
    const options = within(listbox).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([PEOPLE_COL_TITLE]);
    // the linked board's board_relation column is NOT a people option
    expect(within(listbox).queryByText(LINKED_RELATION_TITLE)).not.toBeInTheDocument();
  });
});

describe('ColumnSettings — save flow', () => {
  it('persists the exact v1 settings object to global column-config storage and closes the dialog', async () => {
    render(<ColumnSettings context={settingsContext()} />);

    await pickRelation();
    await pickPeople();

    const save = await screen.findByRole('button', { name: SAVE_BTN });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);

    await waitFor(() => expect(harness.readStorage(STORAGE_KEY)).toBeTruthy());

    const stored = JSON.parse(harness.readStorage(STORAGE_KEY));
    // Policy is FIXED now (no UI controls): always single / union / include-listed.
    expect(stored).toEqual({
      version: 1,
      relationColumnId: RELATION_COL_ID,
      linkedBoardId: LINKED_BOARD_ID,
      peopleColumnId: PEOPLE_COL_ID,
      policy: { selectionMode: 'single', aggregation: 'union', includeListedPersons: true },
    });

    await waitFor(() => expect(harness.calls.some((c) => c.type === 'closeDialog')).toBe(true));
  });
});
