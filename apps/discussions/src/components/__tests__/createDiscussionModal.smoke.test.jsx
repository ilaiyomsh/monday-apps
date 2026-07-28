import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mock the heavy data layer so the modal mounts in jsdom ---------------

// usePermission reads MondayContext via useContext (soft), so the mock must
// export a real context (not just the hook) or useContext throws.
const mondayMock = vi.hoisted(() => ({ value: { currentUser: { id: '1', name: 'בדיקה' }, context: null } }));
vi.mock('@generated/contexts/MondayContext.jsx', async () => {
  const R = await import('react');
  return {
    useMondayContext: () => mondayMock.value,
    MondayContext: R.createContext(mondayMock.value),
  };
});

// usePermission also calls useSettings — return an always-on empty-roles blob so
// system caps resolve via CAPABILITY_DEFAULTS (addDiscussionTypes → owner-only).
vi.mock('@generated/contexts/SettingsContext.jsx', () => ({
  useSettings: () => ({
    settings: { preferences: {} },
    permissions: { enabled: true, version: 1, roles: {} },
    updateSettings: async () => {},
  }),
}));

const templatesValue = vi.hoisted(() => ({
  templates: [], participantTemplates: [], typeTemplates: [],
  typeColor: () => null,
  assignRandomTypeColor: vi.fn(),
}));
vi.mock('@generated/contexts/TemplatesContext.jsx', () => ({
  useTemplates: () => templatesValue,
}));

vi.mock('@generated/utils/mondayApi/hooks/use-users.js', () => ({
  useUsers: () => ({ users: [] }),
}));

vi.mock('@generated/hooks/useStatusOptions.js', () => ({
  useStatusOptions: () => ({ options: [], colorById: {} }),
}));

// The "סוג דיון" dropdown drives the TYPE template, which is the only way a
// template reaches the staged create (the manual template picker was removed in
// round147). One real label so the staging tests can actually pick a type.
vi.mock('@generated/hooks/useDropdownOptions.js', () => ({
  useDropdownOptions: () => ({ options: [{ id: 1, label: 'שבועי', index: 0 }], loading: false }),
  addDropdownLabel: vi.fn(async () => true),
}));

// BoardSDK — the modal news up a board on open to load previous-discussion
// options. Return an empty list so loadDiscussions resolves cleanly.
const boardApi = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@api/BoardSDK.js', () => {
  class Board {
    items() { return this; }
    withColumns() { return this; }
    orderBy() { return this; }
    withPagination() { return this; }
    async execute() { return { items: [], cursor: null }; }
    // The payload is forwarded into the spy (round301 asserts WHICH columns land in
    // the root create vs. the later people update).
    item(id = null) {
      return {
        create: (payload) => ({ execute: () => boardApi.create(payload, id) }),
        update: (payload) => ({ execute: () => boardApi.update(payload, id) }),
      };
    }
    async itemById() { return null; }
  }
  return { דיונים1Board: Board };
});

vi.mock('@generated/utils/mondayApi/monday-client.js', () => ({
  api: vi.fn(async () => ({ items: [] })),
  parseValue: vi.fn(() => null),
  cvSelection: () => '',
}));

vi.mock('@generated/utils/mondayApi/board-config-store.js', () => ({
  getColumns: () => ({}),
  // peopleColumns.ensurePeopleColumns reads this; null ⇒ it no-ops (no board id).
  getBoardId: () => null,
}));

const templateApi = vi.hoisted(() => ({
  createTopicsFromTemplate: vi.fn(),
  readDiscussionTopicsAsTemplate: vi.fn(),
}));

vi.mock('@generated/utils/templates.js', () => ({
  createTopicsFromTemplate: templateApi.createTopicsFromTemplate,
  countPoints: () => 0,
  readDiscussionTopicsAsTemplate: templateApi.readDiscussionTopicsAsTemplate,
}));

// DatePickerPopover wraps the @vibe DatePicker in a Dialog that can't open in
// jsdom — stub it with a controllable native input + a conditional clear so date
// selection/clear can still be driven in tests.
vi.mock('@generated/components/DatePickerPopover', () => ({
  DatePickerPopover: ({ value, onChange }) => {
    const ymd = value
      ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
      : '';
    return (
      <div data-testid="date-picker">
        <input
          type="date"
          value={ymd}
          onChange={(e) => onChange(e.target.value ? new Date(`${e.target.value}T00:00:00`) : null)}
        />
        {value && (
          <button type="button" aria-label="ניקוי תאריך" onClick={() => onChange(null)}>clear</button>
        )}
      </div>
    );
  },
}));

// PersonPicker is portal/store heavy — stub it with a controllable shim.
vi.mock('@generated/components/PersonPicker', () => ({
  PersonPicker: ({ selected = [], onChange }) => (
    <div data-testid="person-picker">
      <button type="button" onClick={() => onChange([{ id: 'p1', name: 'איש', kind: 'person' }])}>
        add-person ({selected.length})
      </button>
    </div>
  ),
}));

import { CreateDiscussionModal } from '../CreateDiscussionModal';

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

async function renderOpen(props = {}) {
  let utils;
  await act(async () => {
    utils = render(<CreateDiscussionModal open onClose={() => {}} onCreated={() => {}} {...props} />);
  });
  await flush();
  return utils;
}

beforeEach(() => {
  vi.clearAllMocks();
  templatesValue.templates = [];
  templatesValue.participantTemplates = [];
  templatesValue.typeTemplates = [];
  boardApi.create.mockResolvedValue({ id: '99' });
  boardApi.update.mockResolvedValue({});
  // The real helper reports a checkpoint as it goes; stage 2 resumes from it, so the
  // default mock must emit one or the staged tail would silently never run.
  templateApi.createTopicsFromTemplate.mockImplementation(async (_id, _template, options) => {
    options?.onCheckpoint?.({
      templateKey: 'k', topicResults: [], pointResults: [], linkedTopicSourceIndexes: [],
    });
    return { topics: 0, points: 0, topicIds: [] };
  });
  // Stage 1's readiness poll reads the topics back before handing off; return them as
  // readable so the poll exits on its first attempt instead of burning its budget.
  templateApi.readDiscussionTopicsAsTemplate.mockResolvedValue({
    topics: [{ name: 'נושא א', points: ['א1'] }, { name: 'נושא ב', points: ['ב1'] }],
  });
});

afterEach(() => { vi.restoreAllMocks(); });

describe('CreateDiscussionModal', () => {
  it('renders the title input and date field when open', async () => {
    await renderOpen();
    expect(screen.getByLabelText('שם הדיון')).toBeTruthy();
    // native date input
    const date = document.querySelector('input[type="date"]');
    expect(date).toBeTruthy();
  });

  // round182 — the standalone "בחר תבנית" topic-template dropdown was REMOVED in
  // round147: templates are now TYPE-driven (picking a discussion type auto-applies
  // its topic template; there is no manual template picker anymore). The old test
  // that guarded that dropdown's "ללא תבנית" option is therefore retired — the
  // feature it targeted no longer exists. The previous-discussion dropdown below
  // still exists and keeps its own "no explicit none option" guard.

  it('does not render a "ללא דיון קודם" option in the previous-discussion dropdown', async () => {
    await renderOpen();
    expect(screen.queryByText('ללא דיון קודם')).toBeNull();
    // placeholder shown for unset previous discussion
    expect(screen.getByText('בחר דיון קודם')).toBeTruthy();
  });

  it('does not render a "ללא סוג" option and shows the placeholder when type unset', async () => {
    await renderOpen();
    expect(screen.queryByText('ללא סוג')).toBeNull();
    expect(screen.getByText('בחר סוג דיון')).toBeTruthy();
  });

  it('shows a clear (X) button on the title only when a name is present, and clears it', async () => {
    // A new discussion is prefilled with the default name, so the clear shows.
    await renderOpen();
    const input = screen.getByLabelText('שם הדיון');
    expect(input.value).toBeTruthy();
    const clear = screen.getByLabelText('ניקוי שם');
    fireEvent.click(clear);
    expect(input.value).toBe('');
    // empty -> no clear
    expect(screen.queryByLabelText('ניקוי שם')).toBeNull();
    // typing brings it back
    fireEvent.change(input, { target: { value: 'דיון' } });
    expect(screen.getByLabelText('ניקוי שם')).toBeTruthy();
  });

  it('shows a clear button on the date field (preset since round148) and clears it', async () => {
    await renderOpen();
    const date = document.querySelector('input[type="date"]');
    // round148: the card opens with today's date already set, so the clear
    // affordance is present from the start.
    expect(date.value).not.toBe('');
    const clear = screen.getByLabelText('ניקוי תאריך');
    fireEvent.click(clear);
    expect(date.value).toBe('');
    expect(screen.queryByLabelText('ניקוי תאריך')).toBeNull();
  });

  it('selecting a date updates the field (via the shared DatePickerPopover)', async () => {
    await renderOpen();
    const date = document.querySelector('input[type="date"]');
    expect(date).toBeTruthy();
    fireEvent.change(date, { target: { value: '2026-07-01' } });
    expect(date.value).toBe('2026-07-01');
  });

  it('hides the "+ add type" affordance for a non-owner without the permission', async () => {
    await renderOpen();
    fireEvent.click(screen.getByText('בחר סוג דיון'));
    expect(screen.queryByText('+ הוסף סוג דיון חדש')).toBeNull();
  });

  it('shows the "+ add type" affordance for an owner (canManageSettings)', async () => {
    await renderOpen({ canManageSettings: true });
    fireEvent.click(screen.getByText('בחר סוג דיון'));
    expect(screen.getByText('+ הוסף סוג דיון חדש')).toBeTruthy();
  });

  it('disables the submit button when the (preset) date is cleared', async () => {
    await renderOpen();
    const submit = screen.getByText('צור דיון').closest('button');
    // round148: name, date AND time are all preset on open -> submit enabled.
    // @vibe/core Button reflects disabled via aria-disabled (not the DOM attr).
    expect(submit.getAttribute('aria-disabled')).toBe('false');
    // clearing the required date disables it again.
    fireEvent.click(screen.getByLabelText('ניקוי תאריך'));
    expect(submit.getAttribute('aria-disabled')).toBe('true');
  });

  it('keeps the saved root and template checkpoint when source props get a new object identity', async () => {
    const checkpoint = {
      templateKey: 'checkpoint',
      topicResults: [{ sourceIndex: 0, id: 'T1' }],
      pointResults: [],
      linkedTopicSourceIndexes: [],
    };
    templateApi.readDiscussionTopicsAsTemplate.mockResolvedValue({
      topics: [{ name: 'נושא מקור', points: [] }],
    });
    templateApi.createTopicsFromTemplate
      .mockImplementationOnce(async (_id, _template, options) => {
        options.onCheckpoint(checkpoint);
        throw new Error('seed failed');
      })
      .mockResolvedValueOnce({ topics: 1, points: 0, topicIds: ['T1'] });
    const onCreated = vi.fn();
    const onClose = vi.fn();
    const source = { id: 'SOURCE_1', name: 'דיון מקור' };
    const utils = await renderOpen({ duplicateFrom: source, onCreated, onClose });
    const submit = screen.getByText('צור דיון').closest('button');

    fireEvent.click(submit);
    await waitFor(() => expect(templateApi.createTopicsFromTemplate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(
      screen.getByText('צור דיון').closest('button').getAttribute('aria-disabled')
    ).toBe('false'));
    expect(boardApi.create).toHaveBeenCalledTimes(1);

    await act(async () => {
      utils.rerender(
        <CreateDiscussionModal
          open
          duplicateFrom={{ ...source }}
          onClose={onClose}
          onCreated={onCreated}
        />
      );
    });
    await flush();

    fireEvent.click(screen.getByText('צור דיון').closest('button'));
    await waitFor(() => expect(templateApi.createTopicsFromTemplate).toHaveBeenCalledTimes(2));
    expect(boardApi.create).toHaveBeenCalledTimes(1);
    expect(templateApi.createTopicsFromTemplate.mock.calls[1][2].resumeState).toBe(checkpoint);
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1), { timeout: 2000 });
  });

  it('round301 — staged create: hands the card off with the REAL id once stage 1 is on the board', async () => {
    const onOptimisticCreate = vi.fn();
    const onCreated = vi.fn();
    await renderOpen({ onOptimisticCreate, onCreated });
    const submit = screen.getByText('צור דיון').closest('button');
    await act(async () => { fireEvent.click(submit); });
    await waitFor(() => expect(onOptimisticCreate).toHaveBeenCalledTimes(1));
    // round301 replaced round300's id-less instant hand-off: the card now opens
    // only after the root item exists, so it carries the real monday id (its data
    // hooks can fetch immediately) — never a null id.
    const shape = onOptimisticCreate.mock.calls[0][0];
    expect(shape.id).toBe('99');
    expect(shape.name.length).toBeGreaterThan(0);
    // The people the user picked ride along as PENDING until stage 3 writes them,
    // so the card header does not blank them out mid-creation.
    expect(shape.__pendingPeople).toBeTruthy();
    await flush();
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onCreated.mock.calls[0][0].id).toBe('99');
    expect(onCreated.mock.calls[0][1]).toMatchObject({ isEdit: false, isDuplicate: false });
  });

  it('round301 — the root create defers the PEOPLE columns to stage 3 (a follow-up update)', async () => {
    const onOptimisticCreate = vi.fn();
    await renderOpen({ onOptimisticCreate, onCreated: vi.fn() });
    // Pick a lead so there is something for stage 3 to write.
    fireEvent.click(screen.getAllByText(/add-person/)[0]);
    const submit = screen.getByText('צור דיון').closest('button');
    await act(async () => { fireEvent.click(submit); });
    await waitFor(() => expect(onOptimisticCreate).toHaveBeenCalledTimes(1));
    await flush();
    // Stage 1's create_item must NOT carry people — that is what stage 3 is for.
    const rootPayload = boardApi.create.mock.calls[0]?.[0] ?? {};
    expect(rootPayload.discussionLeadID).toBeUndefined();
    expect(rootPayload.participantsID).toBeUndefined();
    expect(rootPayload.name).toBeTruthy();
    // …and the people arrive in a later update() on the created item.
    await waitFor(() => expect(boardApi.update).toHaveBeenCalled());
    const peoplePayload = boardApi.update.mock.calls.at(-1)[0];
    expect(peoplePayload.discussionLeadID).toBeTruthy();
  });

  it('round303 — the template never blocks the hand-off; the agenda builds in one background pass with linkLast', async () => {
    const TOPICS = [{ name: 'נושא א', points: ['א1'] }, { name: 'נושא ב', points: ['ב1'] }];
    templatesValue.typeTemplates = [{ discussionType: 'שבועי', topics: TOPICS }];
    // Sampled INSIDE the hand-off, so the ordering assertion is deterministic: with
    // instantly-resolving mocks the deferred pass can otherwise land before a
    // waitFor() gets to look.
    let stagedCallsAtHandoff = null;
    const onOptimisticCreate = vi.fn(() => {
      stagedCallsAtHandoff = templateApi.createTopicsFromTemplate.mock.calls.length;
    });
    const onStageAdvance = vi.fn();
    await renderOpen({ onOptimisticCreate, onCreated: vi.fn(), onStageAdvance });
    // Actually PICK the type, so its template really is attached — without this the
    // assertions below would vacuously pass with zero staged calls.
    fireEvent.click(screen.getByText('בחר סוג דיון'));
    await act(async () => { fireEvent.click(screen.getByText('שבועי')); });
    const submit = screen.getByText('צור דיון').closest('button');
    await act(async () => { fireEvent.click(submit); });
    await waitFor(() => expect(onOptimisticCreate).toHaveBeenCalledTimes(1));

    // round303 — NOTHING of the template blocks the hand-off: the modal closes
    // after just the item save, so ZERO template passes had run at that moment.
    expect(stagedCallsAtHandoff).toBe(0);
    // The card is told it is still being built, so ניהול דיון shows the loader.
    expect(onOptimisticCreate.mock.calls[0][0].__building).toBe(true);

    // The whole agenda is built in the BACKGROUND, in one pass, and connected to
    // the discussion only at the END (linkLast) — so the card's relation-based
    // read pops it in complete on one fetch.
    await waitFor(() => expect(templateApi.createTopicsFromTemplate).toHaveBeenCalledTimes(1));
    const bg = templateApi.createTopicsFromTemplate.mock.calls[0];
    expect(bg[1].topics).toHaveLength(2);
    expect(bg[2].linkLast).toBe(true);
    expect(bg[2].pointTopicIndexes).toBeUndefined();
    await waitFor(() => expect(onStageAdvance).toHaveBeenCalled());
  });

  it('round303 — a background template failure reports through onStageError with the id; the hand-off already happened', async () => {
    // The template now runs entirely AFTER the hand-off (round303), so its failure
    // is a card-side event: onStageError (which drops __building so the loader
    // cannot spin forever) — never a form error, and never a second root item.
    const TOPICS = [{ name: 'נושא א', points: ['א1'] }, { name: 'נושא ב', points: ['ב1'] }];
    templatesValue.typeTemplates = [{ discussionType: 'שבועי', topics: TOPICS }];
    templateApi.createTopicsFromTemplate.mockImplementationOnce(async () => {
      throw new Error('background template failed');
    });
    const onOptimisticCreate = vi.fn();
    const onStageError = vi.fn();
    await renderOpen({ onOptimisticCreate, onCreated: vi.fn(), onStageError });
    fireEvent.click(screen.getByText('בחר סוג דיון'));
    await act(async () => { fireEvent.click(screen.getByText('שבועי')); });
    const submit = screen.getByText('צור דיון').closest('button');
    await act(async () => { fireEvent.click(submit); });

    // The card WAS handed off (the failure came later, in the background)…
    await waitFor(() => expect(onOptimisticCreate).toHaveBeenCalledTimes(1));
    // …and the failure surfaces on the card, carrying the discussion's real id.
    await waitFor(() => expect(onStageError).toHaveBeenCalledWith(expect.objectContaining({ id: '99' })));
    // One root item only — a background failure must never duplicate the discussion.
    expect(boardApi.create).toHaveBeenCalledTimes(1);
  });

  it('round300 — without onOptimisticCreate it keeps the awaited path (id via onCreated only)', async () => {
    const onCreated = vi.fn();
    await renderOpen({ onCreated }); // no onOptimisticCreate
    const submit = screen.getByText('צור דיון').closest('button');
    await act(async () => { fireEvent.click(submit); });
    await flush();
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onCreated.mock.calls[0][0].id).toBe('99');
  });
});
