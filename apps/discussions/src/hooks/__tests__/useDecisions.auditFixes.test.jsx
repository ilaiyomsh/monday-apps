import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// Round-75 audit fix R2 for useDecisions: a create whose discussion-link write
// fails must NOT re-run create_item on retry (that duplicates the decision on
// the board); it resumes from the link write. Mocks ONLY api() so the real
// BoardSDK builds the create/update mutations.
const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../../utils/mondayApi/monday-client.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, api };
});

import { setActiveConfig } from '../../utils/mondayApi/board-config-store.js';
import { useDecisions } from '../useDecisions.js';

function configure() {
  setActiveConfig({
    boards: { discussions: { id: 'disc-board' }, decisions: { id: 'dec-board' } },
    columns: {
      discussions: { decisionsBoardLinkID: { id: 'disc_dec_link', type: 'board_relation' } },
      decisions: {
        decisionStatusID: { id: 'dstatus', type: 'status' },
        discussionLinkID: { id: 'dec_disc_link', type: 'board_relation' },
      },
    },
  });
}

beforeEach(() => { api.mockReset(); });

describe('useDecisions — R2: retry after a failed link write does not duplicate the item', () => {
  it('create_item runs ONCE across create + retry when the discussion-link write fails first', async () => {
    configure();
    let createCount = 0;
    let failLinkOnce = true;
    api.mockImplementation(async (query) => {
      // fetchDecisionsByDiscussion scan (board items_page) — return no rows.
      if (query.includes('items_page')) return { boards: [{ items_page: { items: [], cursor: null } }] };
      if (query.includes('create_item')) { createCount += 1; return { create_item: { id: `real-${createCount}` } }; }
      if (query.includes('change_multiple_column_values')) {
        if (failLinkOnce) { failLinkOnce = false; throw new Error('link write failed'); }
        return { change_multiple_column_values: { id: 'ok' } };
      }
      return {};
    });

    const { result } = renderHook(() => useDecisions('disc-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => { await result.current.createDecision('החלטה'); });
    const failedRow = result.current.items.find((i) => i._createFailed);
    expect(failedRow).toBeTruthy();
    expect(createCount).toBe(1);

    // Retry MUST resume from the link write, not create a second decision.
    await act(async () => { await result.current.retryCreate(failedRow.id); });
    expect(createCount).toBe(1);
    expect(result.current.items.some((i) => String(i.id) === 'real-1')).toBe(true);
  });
});
