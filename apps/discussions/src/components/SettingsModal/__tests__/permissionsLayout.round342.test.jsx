import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * round342 (owner request) — two layout rules in the הרשאות tab:
 *   · "שים את שדות החלטה יהיו מעל שדות משימה"
 *   · "בשדות החלטה שים את עמודת מושפעים הכי משמאל"
 *
 * The second one is the interesting one. The matrix is RTL, so LEFTMOST is the LAST column,
 * and מושפעים has to stay last even after round341's borrowed discussion-manager columns are
 * appended — ROLE_ALIAS_ORDER alone only orders a board's OWN roles, so מושפעים would land
 * before them. Asserting its position RELATIVE to a borrowed role is what makes this test
 * about the pinning rule rather than about the plain sort.
 */

const boards = { discussions: { id: '1' }, tasks: { id: '2' }, topics: { id: '3' }, decisions: { id: '4' } };
// Both boards' people columns are mapped, so the decisions card gets its own three roles
// PLUS the three borrowed discussion-manager roles.
const storedColumns = {
  discussions: {
    discussionCreatorID: { id: 'd_creator', type: 'people', title: 'יוצר דיון' },
    discussionLeadID: { id: 'd_lead', type: 'people', title: 'מוביל דיון' },
    discussionCoordinatorID: { id: 'd_coord', type: 'people', title: 'מרכז דיון' },
    participantsID: { id: 'd_parts', type: 'people', title: 'משתתפים' },
  },
  decisions: {
    decisionCreatorID: { id: 'dec_creator', type: 'people', title: 'יוצר החלטה' },
    deciderID: { id: 'dec_decider', type: 'people', title: 'מחליט' },
    affectedID: { id: 'dec_affected', type: 'people', title: 'מושפעים' },
  },
};

const storage = {
  getItem: vi.fn(async (key) => (
    String(key).startsWith('discussions_settings')
      ? { data: { value: JSON.stringify({ boards, columns: storedColumns }) } }
      : { data: { value: null } }
  )),
  setItem: vi.fn(async () => ({})),
};
vi.mock('../../../utils/mondayApi/monday-client.js', () => ({
  monday: {
    storage: { getItem: (...a) => storage.getItem(...a), setItem: (...a) => storage.setItem(...a) },
    api: vi.fn(async () => ({ data: {} })),
  },
  api: vi.fn(async (_q, vars) => {
    const id = String(vars?.boardId?.[0] ?? vars?.boardId ?? '');
    if (id === '1') {
      return { boards: [{ columns: Object.values(storedColumns.discussions).map((c) => ({ ...c })) }] };
    }
    if (id === '4') {
      return { boards: [{ columns: Object.values(storedColumns.decisions).map((c) => ({ ...c })) }] };
    }
    return { boards: [{ columns: [] }] };
  }),
  API_VERSION: '2026-07',
  ensureUserPhotoSelection: async () => 'photo_url { small }',
  normalizePhoto: () => null,
}));
vi.mock('../../../utils/mondayApi/board-config-store.js', () => ({
  setActiveConfig: vi.fn(), getBoardId: () => null, getColumns: () => ({}),
}));
vi.mock('../../../utils/mondayApi/subscribers.js', () => ({ getBoardPeople: async () => [] }));

import { SettingsModal } from '../SettingsModal.jsx';
import { pinRolesLast } from '../PermissionsTab.jsx';
import { SettingsProvider } from '../../../contexts/SettingsContext.jsx';
import { MondayContext } from '../../../contexts/MondayContext.jsx';

const Host = () => (
  <MondayContext.Provider value={{ context: { instanceId: 'i1', boardId: '1' }, user: null }}>
    <SettingsProvider>
      <SettingsModal isOpen onClose={() => {}} templatesOnly={false} />
    </SettingsProvider>
  </MondayContext.Provider>
);

const openPermissions = async () => {
  await waitFor(() => expect(screen.getByText('הרשאות')).toBeTruthy());
  fireEvent.click(screen.getByText('הרשאות'));
  await waitFor(() => expect(screen.getByText('שדות החלטה')).toBeTruthy());
};

// The tier card titles, in the order they appear in the document.
const cardTitles = () => ['דיון ונושאים', 'שדות החלטה', 'שדות משימה']
  .map((t) => ({ t, el: [...document.querySelectorAll('*')].find((n) => n.textContent?.trim() === t) }))
  .filter((x) => x.el)
  .sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
  .map((x) => x.t);

beforeEach(() => { vi.clearAllMocks(); });

describe('round342 — הרשאות tab layout', () => {
  it('puts שדות החלטה ABOVE שדות משימה', async () => {
    render(<Host />);
    await openPermissions();
    const order = cardTitles();
    expect(order.indexOf('שדות החלטה')).toBeLessThan(order.indexOf('שדות משימה'));
  });

  /*
   * מושפעים must be the LAST role column of the decisions card — leftmost in RTL — and
   * specifically AFTER round341's borrowed discussion-manager columns. Comparing it against
   * a borrowed role is the whole point: ROLE_ALIAS_ORDER already sorts a board's OWN roles,
   * so a same-board-only assertion would pass without the pinning rule existing at all.
   */
  it('pins מושפעים after the borrowed discussion roles', () => {
    const roles = [
      { key: 'decisions:decisionCreatorID' },
      { key: 'decisions:deciderID' },
      { key: 'decisions:affectedID' },
      { key: 'discussions:discussionCreatorID' },
      { key: 'discussions:discussionLeadID' },
      { key: 'discussions:discussionCoordinatorID' },
    ];
    const out = pinRolesLast(roles).map((r) => r.key);
    expect(out[out.length - 1]).toBe('decisions:affectedID');
    expect(out.indexOf('decisions:affectedID')).toBeGreaterThan(out.indexOf('discussions:discussionLeadID'));
    // and nothing else moved
    expect(out.slice(0, -1)).toEqual([
      'decisions:decisionCreatorID', 'decisions:deciderID',
      'discussions:discussionCreatorID', 'discussions:discussionLeadID', 'discussions:discussionCoordinatorID',
    ]);
  });

  // The tasks tier has no pinned role, so its list must come back UNTOUCHED — by identity,
  // which also documents that the helper does not churn React state for other tiers.
  it('returns the SAME array for a tier with nothing pinned', () => {
    const roles = [{ key: 'tasks:taskCreatorID' }, { key: 'tasks:responsibilityID' }];
    expect(pinRolesLast(roles)).toBe(roles);
  });
});
