/**
 * SettingsPanel — the WIRING, not the pixels.
 *
 * What this file is for: the panel is the only writer of the settings blob, and the
 * ways it can be wrong are all invisible in a screenshot —
 *
 *   - saving a patch that is missing a key (the owner's edit silently does nothing),
 *   - saving before `validateSettings` is satisfied (an unusable blob reaches storage
 *     and the whole app is gated off by `isConfigured`),
 *   - a draft that does not re-seed when a new blob arrives (the panel keeps editing
 *     stale values and overwrites the newer ones on save),
 *   - the mapped columns coming from the wrong board.
 *
 * It also serves as the mount check for the Vibe surface: a required prop the v4
 * Modal/ModalFooter contract needs (`id`, `show`, `primaryButton`) would throw or
 * render nothing here.
 *
 * The layers below are mocked at their module boundary: `services/boardMeta` (so the
 * board's columns are a fixture, not a network call), `utils/assetsStore` (so the
 * template section settles without storage) and `contexts/MondayContext` (so there is
 * a board_view context without an iframe). `domain/settingsSchema`, `blockOps` and
 * `roleTypes` stay REAL — they are the logic being wired.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fetchBoardMeta } from '../../../services/boardMeta';
import { loadTemplate, saveTemplate } from '../../../utils/assetsStore';
import { useMonday } from '../../../contexts/MondayContext';
import { DEFAULT_SETTINGS } from '../../../domain/settingsSchema';
import { SettingsPanel } from '../SettingsPanel.jsx';

// Vibe's Modal drags in focus-lock, scroll-lock and a portal, so a single mount is
// ~1s in jsdom and a userEvent-driven test can brush the 5s default under load.
// Raised for this file only — it buys nothing anywhere else.
vi.setConfig({ testTimeout: 20000 });

vi.mock('../../../services/boardMeta', () => ({ fetchBoardMeta: vi.fn() }));
vi.mock('../../../utils/assetsStore', () => ({
  loadTemplate: vi.fn(),
  saveTemplate: vi.fn(),
  TEMPLATE_MAX_BYTES: 6 * 1024 * 1024,
}));
vi.mock('../../../contexts/MondayContext', () => ({ useMonday: vi.fn() }));
vi.mock('../../../utils/logger', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const TARGET_BOARD = '18424252636';
const CONTEXT_BOARD = 1234567890;

/** Captured from a real board_meta response (shape per services/boardMeta). */
const BOARD_META = {
  id: TARGET_BOARD,
  name: 'דיווחי ועדות אזוריות',
  columns: [
    { id: 'name', title: 'שם הפריט', type: 'name' },
    { id: 'text_action', title: 'פעולה', type: 'text' },
    { id: 'mirror_committee', title: 'ועדה אזורית', type: 'mirror' },
    { id: 'long_text_report', title: 'תוכן הדיווח', type: 'long_text' },
    { id: 'date_report', title: 'תאריך הדיווח', type: 'date' },
    { id: 'people_owner', title: 'אחראי', type: 'people' },
  ],
};

const CONFIGURED = {
  ...DEFAULT_SETTINGS,
  boardId: TARGET_BOARD,
  columns: {
    action: 'text_action',
    committee: 'mirror_committee',
    report: 'long_text_report',
    date: 'date_report',
    person: 'people_owner',
  },
  headers: { action: '', committee: '', report: '', date: '' },
  blocks: [
    { id: 'block-1', type: 'text', text: 'פתיח הדוח' },
    { id: 'table', type: 'table' },
  ],
};

/**
 * The role dropdown's TRIGGER for a Hebrew role label.
 *
 * `{ selector: 'button' }` on purpose: several controls in this panel legitimately
 * mention the same role name, and this pins the query to the actual dropdown. It is a
 * button rather than a `<select>` because the picker is now a body-portal Popover —
 * see `openRole` below.
 */
const roleSelect = (label) => screen.getByLabelText(label, { selector: 'button' });

/**
 * Open a role's menu and hand back its listbox.
 *
 * The picker is a body-portal Popover with a `role="listbox"` of `role="option"`
 * buttons, not a native `<select>` — a native menu is drawn by the OS and cannot be
 * themed, so it looked like a different application next to the Vibe inputs. These
 * helpers exist so each test still reads as "pick this column for this role" rather
 * than as popover mechanics.
 */
const openRole = async (user, label) => {
  await user.click(roleSelect(label));
  return screen.findByRole('listbox', { name: label });
};

/** Every option in a role's menu, as column ids, in render order. */
const optionIds = (listbox) =>
  [...listbox.querySelectorAll('[data-column-id]')].map((node) =>
    node.getAttribute('data-column-id')
  );

/** The column id a role currently shows, the way a native select's `value` read. */
const roleValue = (label) => roleSelect(label).getAttribute('data-value');

/**
 * Column ids listed under one named group heading of a role's OPEN menu.
 * Returns null when the heading is absent — a lone group renders flat, with no
 * headings at all, which is a meaningful state (see ColumnSelect.jsx).
 */
const groupedIds = (listbox, groupLabel) => {
  const nodes = [...listbox.querySelectorAll('li')];
  const start = nodes.findIndex(
    (li) => li.getAttribute('role') === 'presentation' && li.textContent === groupLabel
  );
  if (start < 0) return null;
  const ids = [];
  for (const li of nodes.slice(start + 1)) {
    const option = li.querySelector('[data-column-id]');
    if (!option) break; // the next heading ends this group
    ids.push(option.getAttribute('data-column-id'));
  }
  return ids;
};

/** How many group headings a role's open menu renders (0 = one flat list). */
const headingCount = (listbox) =>
  [...listbox.querySelectorAll('li[role="presentation"]')].filter(
    (li) => !li.querySelector('[data-column-id]')
  ).length;

/**
 * Pick a column by ID rather than by visible label: the label is "title (type)" and
 * titles are owner-authored, so an id is the only hook a rename cannot break.
 */
const pickColumn = async (user, label, columnId) => {
  const listbox = await openRole(user, label);
  const option = listbox.querySelector(`[data-column-id="${columnId}"]`);
  if (!option) {
    throw new Error(
      `option "${columnId}" is not offered for role "${label}" — offered: ${optionIds(listbox).join(', ')}`
    );
  }
  await user.click(option);
};

/**
 * Vibe v4 renders a disabled Button with `aria-disabled` + `tabindex=-1` + a class,
 * and NEVER the native `disabled` attribute — so `toBeDisabled()` does not apply.
 * (Its onClick is genuinely guarded, which the save tests below verify.)
 */
const expectSaveBlocked = (blocked) =>
  expect(screen.getByTestId('save-settings')).toHaveAttribute(
    'aria-disabled',
    blocked ? 'true' : 'false'
  );

const renderPanel = (props = {}) => {
  const updateSettings = props.updateSettings ?? vi.fn().mockResolvedValue({});
  const utils = render(
    <SettingsPanel settings={props.settings ?? CONFIGURED} updateSettings={updateSettings} {...props} />
  );
  return { ...utils, updateSettings };
};

beforeEach(() => {
  vi.clearAllMocks();
  useMonday.mockReturnValue({
    context: { instanceId: 55555555, boardId: CONTEXT_BOARD, user: { id: '11111111' } },
    currentUser: { id: '11111111' },
    isMobile: false,
  });
  fetchBoardMeta.mockResolvedValue(BOARD_META);
  loadTemplate.mockResolvedValue(null);
  saveTemplate.mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
});

describe('mounting', () => {
  it('renders the five role dropdowns populated from the TARGET board', async () => {
    renderPanel();

    await waitFor(() => expect(screen.getByTestId('board-name')).toHaveTextContent(BOARD_META.name));
    expect(fetchBoardMeta).toHaveBeenCalledWith(TARGET_BOARD);

    for (const label of ['פעולה', 'שם הועדה האזורית', 'דיווח', 'תאריך דיווח', 'עמודת האחראי']) {
      expect(roleSelect(label)).toBeInTheDocument();
    }
    // Each dropdown offers every board column plus the empty choice.
    const user = userEvent.setup();
    const listbox = await openRole(user, 'דיווח');
    expect(optionIds(listbox)).toHaveLength(BOARD_META.columns.length + 1);
  });

  it('groups each dropdown by the types that suit ITS OWN role', async () => {
    const user = userEvent.setup();
    renderPanel();
    await waitFor(() => expect(screen.getByTestId('board-name')).toBeInTheDocument());

    /** Open one role and read the ids under a named heading. Closes again after. */
    const grouped = async (label, groupLabel) => {
      const listbox = await openRole(user, label);
      const ids = groupedIds(listbox, groupLabel);
      await user.keyboard('{Escape}');
      return ids;
    };

    // committee wants a mirror; report wants text/long_text; date wants a date.
    expect(await grouped('שם הועדה האזורית', 'עמודות מתאימות')).toEqual(['mirror_committee']);
    // report accepts text AND long_text, so both suitable columns land first.
    expect(await grouped('דיווח', 'עמודות מתאימות')).toEqual(['text_action', 'long_text_report']);
    expect(await grouped('תאריך דיווח', 'עמודות מתאימות')).toEqual(['date_report']);
    expect(await grouped('עמודת האחראי', 'עמודות מתאימות')).toEqual(['people_owner']);
    // Nothing is hidden — the unsuitable columns are still offered, just second.
    expect(await grouped('דיווח', 'עמודות נוספות')).toEqual([
      'name',
      'mirror_committee',
      'date_report',
      'people_owner',
    ]);

    // `action` accepts any type, so its menu is a single flat list with NO headings —
    // a heading reading "suitable columns" above literally everything would be noise.
    const actionList = await openRole(user, 'פעולה');
    expect(headingCount(actionList)).toBe(0);
  });

  it('shows each stored mapping as the selected option', async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByTestId('board-name')).toBeInTheDocument());

    expect(roleValue('פעולה')).toBe('text_action');
    expect(roleValue('שם הועדה האזורית')).toBe('mirror_committee');
    expect(roleValue('עמודת האחראי')).toBe('people_owner');
    // The TRIGGER has to show it too, not just carry it — an owner who cannot read the
    // current mapping off the closed control would re-map it blind.
    expect(roleSelect('פעולה')).toHaveTextContent('(text)');
  });

  it('renders the version label in the footer', () => {
    renderPanel();
    expect(screen.getByTestId('version-label')).toBeInTheDocument();
  });

  it('shows the table block as a non-editable placeholder', () => {
    renderPanel();

    const tableBlock = screen.getByTestId('block-table');
    expect(tableBlock).toHaveTextContent('כאן תופיע הטבלה');
    expect(tableBlock.querySelector('textarea')).toBeNull();
  });
});

describe('the header override placeholders', () => {
  it("offers the mapped board column's title as the placeholder", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByTestId('board-name')).toBeInTheDocument());

    expect(screen.getByLabelText('כותרת לעמודת דיווח')).toHaveAttribute(
      'placeholder',
      'תוכן הדיווח'
    );
  });
});

describe('saving', () => {
  it('sends every owned key in one patch, with the edits applied', async () => {
    const user = userEvent.setup();
    const { updateSettings } = renderPanel();
    await waitFor(() => expect(screen.getByTestId('board-name')).toBeInTheDocument());

    await user.type(screen.getByLabelText('כותרת לעמודת פעולה'), 'הפעולה');
    await user.click(screen.getByTestId('save-settings'));

    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1));
    const patch = updateSettings.mock.calls[0][0];
    expect(Object.keys(patch).sort()).toEqual([
      'blocks',
      'boardId',
      'columns',
      'headers',
      'mergeAction',
      'mergeCommittee',
      'weekStartsOn',
    ]);
    expect(patch.boardId).toBe(TARGET_BOARD);
    expect(patch.columns).toEqual(CONFIGURED.columns);
    expect(patch.headers.action).toBe('הפעולה');
    expect(patch.blocks).toEqual(CONFIGURED.blocks);
  });

  it('closes on a successful save when it is dismissible', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderPanel({ onClose });
    await waitFor(() => expect(screen.getByTestId('board-name')).toBeInTheDocument());

    await user.click(screen.getByTestId('save-settings'));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('stays open and explains itself when the save fails', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const updateSettings = vi.fn().mockRejectedValue(new Error('write did not persist'));
    renderPanel({ onClose, updateSettings });
    await waitFor(() => expect(screen.getByTestId('board-name')).toBeInTheDocument());

    await user.click(screen.getByTestId('save-settings'));

    await waitFor(() => expect(screen.getByTestId('save-error')).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('refuses to save an unconfigured blob and lists what is missing', async () => {
    const user = userEvent.setup();
    const { updateSettings } = renderPanel({ settings: DEFAULT_SETTINGS, forced: true });

    expectSaveBlocked(true);
    // Blocked for real, not just visually. fireEvent rather than userEvent on
    // purpose: Vibe's disabled class also sets `pointer-events: none`, so
    // userEvent refuses to click at all — fireEvent dispatches the click anyway and
    // proves the component's own onClick guard, not just the CSS.
    fireEvent.click(screen.getByTestId('save-settings'));
    expect(updateSettings).not.toHaveBeenCalled();

    const errors = screen.getByTestId('settings-errors');
    expect(errors).toHaveTextContent('לא נבחר לוח יעד');
    expect(errors).toHaveTextContent('לא מופתה עמודה לתפקיד פעולה');
  });

  it('re-enables saving once the last missing role is mapped', async () => {
    const user = userEvent.setup();
    renderPanel({
      settings: { ...CONFIGURED, columns: { ...CONFIGURED.columns, person: '' } },
    });
    await waitFor(() => expect(screen.getByTestId('board-name')).toBeInTheDocument());

    expectSaveBlocked(true);

    await pickColumn(user, 'עמודת האחראי', 'people_owner');

    expectSaveBlocked(false);
  });
});

describe('the board picker', () => {
  it('offers the board the view sits on as a one-click default', async () => {
    const user = userEvent.setup();
    renderPanel();
    await waitFor(() => expect(screen.getByTestId('board-name')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: `השתמשו בלוח הנוכחי (${CONTEXT_BOARD})` }));

    await waitFor(() => expect(fetchBoardMeta).toHaveBeenCalledWith(String(CONTEXT_BOARD)));
    // The FIELD has to show it too. Vibe v4's TextField is uncontrolled unless it is
    // told otherwise, so a programmatic value change is exactly what silently fails
    // to display — and the owner would then save a board id they cannot see.
    expect(screen.getByLabelText('מזהה הלוח')).toHaveValue(String(CONTEXT_BOARD));
  });

  it('displays a Hebrew failure next to the field for an id that does not resolve', async () => {
    fetchBoardMeta.mockRejectedValue(new Error('board 999 was not found'));
    renderPanel({ settings: { ...CONFIGURED, boardId: '999' } });

    await waitFor(() =>
      expect(screen.getByText('הלוח לא נמצא או שאין לכם הרשאה אליו. בדקו את המזהה.')).toBeInTheDocument()
    );
  });
});

describe('the type warning', () => {
  it('warns without blocking when a role is mapped to an unsuitable column type', async () => {
    const user = userEvent.setup();
    renderPanel();
    await waitFor(() => expect(screen.getByTestId('board-name')).toBeInTheDocument());

    // The item-name column in the committee (mirror) role: allowed, but flagged.
    // Deliberately a column no other role uses — a reused column is a DIFFERENT
    // (hard) error from validateSettings and would mask the soft type warning.
    await pickColumn(user, 'שם הועדה האזורית', 'name');

    expect(screen.getByTestId('warning-docs-export-role-committee')).toHaveTextContent(
      'היא מסוג name'
    );
    // Soft filter: saving is still possible, the owner has the last word.
    expectSaveBlocked(false);
  });
});

describe('the block editor', () => {
  it('adds a text block after the existing ones and saves it', async () => {
    const user = userEvent.setup();
    const { updateSettings } = renderPanel();
    await waitFor(() => expect(screen.getByTestId('board-name')).toBeInTheDocument());

    await user.click(screen.getByTestId('add-text-block'));
    await user.click(screen.getByTestId('save-settings'));

    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1));
    expect(updateSettings.mock.calls[0][0].blocks).toEqual([
      { id: 'block-1', type: 'text', text: 'פתיח הדוח' },
      { id: 'table', type: 'table' },
      { id: 'block-2', type: 'text', text: '' },
    ]);
  });

  it('moves the table block without deleting it, and offers it no delete control', async () => {
    const user = userEvent.setup();
    const { updateSettings } = renderPanel();
    await waitFor(() => expect(screen.getByTestId('board-name')).toBeInTheDocument());

    const tableBlock = screen.getByTestId('block-table');
    expect(tableBlock.querySelectorAll('button')).toHaveLength(2); // up + down only

    await user.click(screen.getByRole('button', { name: 'העלו את בלוק 2' }));
    await user.click(screen.getByTestId('save-settings'));

    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1));
    expect(updateSettings.mock.calls[0][0].blocks).toEqual([
      { id: 'table', type: 'table' },
      { id: 'block-1', type: 'text', text: 'פתיח הדוח' },
    ]);
  });

  it('deletes a text block', async () => {
    const user = userEvent.setup();
    const { updateSettings } = renderPanel();
    await waitFor(() => expect(screen.getByTestId('board-name')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'מחקו את בלוק 1' }));
    await user.click(screen.getByTestId('save-settings'));

    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1));
    expect(updateSettings.mock.calls[0][0].blocks).toEqual([{ id: 'table', type: 'table' }]);
  });
});

describe('the template section', () => {
  it('reports that no template is stored, under the instance context', async () => {
    renderPanel();

    await waitFor(() => expect(screen.getByTestId('template-absent')).toBeInTheDocument());
    expect(loadTemplate).toHaveBeenCalledWith({
      instanceId: 55555555,
      boardId: CONTEXT_BOARD,
      user: { id: '11111111' },
    });
  });

  it('reports a stored template and offers to remove it', async () => {
    const user = userEvent.setup();
    loadTemplate.mockResolvedValue('QUJDRA=='.repeat(400));
    renderPanel();

    await waitFor(() => expect(screen.getByTestId('template-present')).toBeInTheDocument());

    await user.click(screen.getByTestId('template-remove'));

    await waitFor(() => expect(saveTemplate).toHaveBeenCalledWith(expect.anything(), null));
    await waitFor(() => expect(screen.getByTestId('template-absent')).toBeInTheDocument());
  });

  it('rejects a file that is not a .docx at pick time, with the reason on screen', async () => {
    const user = userEvent.setup();
    renderPanel();
    await waitFor(() => expect(screen.getByTestId('template-absent')).toBeInTheDocument());

    const notADocx = new File(['%PDF-1.7 not a zip at all'], 'תבנית.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    await user.upload(screen.getByTestId('template-input'), notADocx);

    await waitFor(() => expect(screen.getByTestId('template-error')).toBeInTheDocument());
    expect(screen.getByTestId('template-error')).toHaveTextContent('אינו קובץ Word תקין');
    // Nothing may reach storage — the previous template must survive a bad pick.
    expect(saveTemplate).not.toHaveBeenCalled();
  });

  it('stores a real .docx and shows it as present', async () => {
    const user = userEvent.setup();
    const { zipSync } = await import('fflate');
    // The narrowest thing that IS a valid template: a zip carrying the one entry
    // `spliceBodyIntoTemplate` needs.
    const docx = zipSync({
      'word/document.xml': new TextEncoder().encode('<w:document><w:body/></w:document>'),
    });
    renderPanel();
    await waitFor(() => expect(screen.getByTestId('template-absent')).toBeInTheDocument());

    await user.upload(
      screen.getByTestId('template-input'),
      new File([docx], 'template.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
    );

    await waitFor(() => expect(screen.getByTestId('template-present')).toBeInTheDocument());
    expect(saveTemplate).toHaveBeenCalledTimes(1);
    expect(typeof saveTemplate.mock.calls[0][1]).toBe('string');
  });

  it('surfaces the storage-budget message verbatim', async () => {
    const user = userEvent.setup();
    const quota = new Error('קובץ התבנית חורג ממגבלת האחסון (7.2MB מתוך 6MB). הקטינו את הקובץ');
    quota.code = 'quota';
    saveTemplate.mockRejectedValue(quota);

    const { zipSync } = await import('fflate');
    const docx = zipSync({ 'word/document.xml': new TextEncoder().encode('<w:document/>') });
    renderPanel();
    await waitFor(() => expect(screen.getByTestId('template-absent')).toBeInTheDocument());

    await user.upload(
      screen.getByTestId('template-input'),
      new File([docx], 'big.docx', { type: 'application/octet-stream' })
    );

    await waitFor(() => expect(screen.getByTestId('template-error')).toHaveTextContent('7.2MB מתוך 6MB'));
  });
});

describe('the forced mode', () => {
  it('offers no cancel affordance when the instance is unconfigured', () => {
    renderPanel({ settings: DEFAULT_SETTINGS, forced: true });

    expect(screen.queryByRole('button', { name: 'ביטול' })).toBeNull();
  });

  it('keeps cancel available in the normal mode', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderPanel({ onClose });

    await user.click(screen.getByRole('button', { name: 'ביטול' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('a newer blob arriving while the panel is open', () => {
  it('re-seeds the draft instead of holding stale values', async () => {
    const { rerender } = renderPanel();
    await waitFor(() => expect(roleValue('פעולה')).toBe('text_action'));

    // A different object — what a reload under a new instanceId produces.
    rerender(
      <SettingsPanel
        settings={{ ...CONFIGURED, columns: { ...CONFIGURED.columns, action: 'name' } }}
        updateSettings={vi.fn()}
      />
    );

    await waitFor(() => expect(roleValue('פעולה')).toBe('name'));
  });

  it('re-seeds the header override TEXT FIELDS too, not just the dropdowns', async () => {
    const { rerender } = renderPanel();
    await waitFor(() => expect(screen.getByLabelText('כותרת לעמודת דיווח')).toHaveValue(''));

    rerender(
      <SettingsPanel
        settings={{ ...CONFIGURED, headers: { ...CONFIGURED.headers, report: 'הדיווח שלנו' } }}
        updateSettings={vi.fn()}
      />
    );

    await waitFor(() =>
      expect(screen.getByLabelText('כותרת לעמודת דיווח')).toHaveValue('הדיווח שלנו')
    );
  });
});
