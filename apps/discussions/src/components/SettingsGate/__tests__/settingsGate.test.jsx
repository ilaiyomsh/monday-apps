import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * round337 — the boot gate's failure semantics (audit finding #1, the severe one):
 *
 * Until this round, a FAILED settings load (network hiccup, monday.storage
 * outage) was indistinguishable from "no settings stored": both landed on
 * isConfigured=false, so a fully-configured user hitting a transient failure was
 * shown the FIRST-RUN SetupWizard — whose "צור לוחות אוטומטית" button would
 * happily create duplicate boards. Meanwhile NetworkErrorScreen, built exactly
 * for this case (Hebrew copy + a retry button), was mounted by nothing.
 *
 * What this file pins:
 *   1. load FAILURE → NetworkErrorScreen ("בעיית רשת"), NOT the wizard.
 *   2. its retry button re-runs the load; a now-healthy storage renders the app.
 *   3. load SUCCESS with nothing stored → the wizard (first-run path unchanged).
 *   4. the manual-mapping screen is RTL, lists ALL FOUR boards (audit #3 — the
 *      copy said three, omitting לוח ההחלטות), and mounts the modal with NO
 *      onClose so the forced surface shows no dead X (audit #2).
 *   5. load SUCCESS with a full mapping → children render.
 *
 * SetupWizard and SettingsModal are mocked: this file tests the GATE's branching,
 * not their internals (each has its own suite). The modal mock records its props
 * so the no-onClose contract is asserted at the seam where it is decided.
 */

const storage = { getItem: vi.fn(), setItem: vi.fn(async () => ({})) };
vi.mock('../../../utils/mondayApi/monday-client.js', () => ({
  monday: {
    storage: { getItem: (...a) => storage.getItem(...a), setItem: (...a) => storage.setItem(...a) },
    api: vi.fn(async () => ({ data: {} })),
  },
  api: vi.fn(async () => ({})),
  API_VERSION: '2026-07',
  ensureUserPhotoSelection: async () => 'photo_url { small }',
  normalizePhoto: () => null,
}));
vi.mock('../../../utils/mondayApi/board-config-store.js', () => ({
  setActiveConfig: vi.fn(),
  getBoardId: () => null,
  getColumns: () => ({}),
}));
vi.mock('../../SetupWizard', () => ({
  SetupWizard: ({ onManual }) => (
    <div data-testid="wizard-mock">
      <button type="button" onClick={onManual}>מיפוי ידני</button>
    </div>
  ),
}));
const modalProps = [];
vi.mock('../../SettingsModal', () => ({
  SettingsModal: (props) => {
    modalProps.push(props);
    return <div data-testid="settings-modal-mock" />;
  },
}));

import { SettingsGate } from '../SettingsGate.jsx';
import { SettingsProvider } from '../../../contexts/SettingsContext.jsx';
import { MondayContext } from '../../../contexts/MondayContext.jsx';

const FULL_CONFIG = JSON.stringify({
  boards: {
    discussions: { id: 'B1' }, tasks: { id: 'B2' }, topics: { id: 'B3' }, decisions: { id: 'B4' },
  },
  columns: { discussions: {}, tasks: {}, topics: {}, decisions: {} },
});

function Host() {
  const ctxValue = { context: { instanceId: 'inst1', boardId: 'b1' }, currentUser: null, isMobile: false };
  return (
    <MondayContext.Provider value={ctxValue}>
      <SettingsProvider>
        <SettingsGate>
          <div data-testid="app-content">APP</div>
        </SettingsGate>
      </SettingsProvider>
    </MondayContext.Provider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  modalProps.length = 0;
});

describe('round337 — SettingsGate failure vs first-run branching', () => {
  it('shows the NETWORK ERROR screen (not the wizard) when the settings load fails', async () => {
    storage.getItem.mockRejectedValue(new Error('network down'));
    await act(async () => { render(<Host />); });
    expect(screen.getByText('בעיית רשת')).toBeInTheDocument();
    expect(screen.queryByTestId('wizard-mock')).toBeNull();
    expect(screen.queryByTestId('app-content')).toBeNull();
  });

  it('retries from the error screen and renders the app once storage recovers', async () => {
    storage.getItem.mockRejectedValueOnce(new Error('network down'));
    await act(async () => { render(<Host />); });
    expect(screen.getByText('בעיית רשת')).toBeInTheDocument();
    storage.getItem.mockResolvedValue({ data: { value: FULL_CONFIG } });
    await act(async () => { fireEvent.click(screen.getByText('נסה שוב')); });
    expect(screen.getByTestId('app-content')).toBeInTheDocument();
    expect(screen.queryByText('בעיית רשת')).toBeNull();
  });

  it('still shows the first-run wizard when the load SUCCEEDS with nothing stored', async () => {
    storage.getItem.mockResolvedValue({ data: { value: null } });
    await act(async () => { render(<Host />); });
    expect(screen.getByTestId('wizard-mock')).toBeInTheDocument();
    expect(screen.queryByText('בעיית רשת')).toBeNull();
  });

  it('renders the manual-mapping screen RTL and lists all FOUR boards', async () => {
    storage.getItem.mockResolvedValue({ data: { value: null } });
    await act(async () => { render(<Host />); });
    await act(async () => { fireEvent.click(screen.getByText('מיפוי ידני')); });
    const heading = screen.getByText('הגדרת האפליקציה');
    expect(heading.closest('[dir="rtl"]')).not.toBeNull();
    const copy = screen.getByText(/בחרו את לוח הדיונים/).textContent;
    for (const board of ['לוח הדיונים', 'לוח המשימות', 'לוח הנושאים', 'לוח ההחלטות']) {
      expect(copy).toContain(board);
    }
  });

  it('mounts the forced settings modal with NO onClose (the surface is not dismissable)', async () => {
    storage.getItem.mockResolvedValue({ data: { value: null } });
    await act(async () => { render(<Host />); });
    await act(async () => { fireEvent.click(screen.getByText('מיפוי ידני')); });
    expect(modalProps.length).toBeGreaterThan(0);
    expect(modalProps.at(-1).onClose).toBeUndefined();
  });

  it('renders the app straight away when a full mapping is stored', async () => {
    storage.getItem.mockResolvedValue({ data: { value: FULL_CONFIG } });
    await act(async () => { render(<Host />); });
    expect(screen.getByTestId('app-content')).toBeInTheDocument();
  });
});
