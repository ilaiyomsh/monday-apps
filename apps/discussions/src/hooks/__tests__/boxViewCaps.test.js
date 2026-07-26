import { describe, it, expect } from 'vitest';
import { resolveCan } from '../usePermission.js';
import {
  DEFAULT_PERMISSIONS,
  DEFAULT_PERMISSION_SEED,
} from '../../utils/mondayApi/boards.config.js';

/*
 * round209 — the per-role VIEW gates for the triple-box panes:
 * viewReferencesBox / viewSummaryBox. Pinned behaviors:
 *   · feature off → visible to everyone (today's behavior).
 *   · feature on + explicit false on a held role (owner unchecked participants)
 *     → HIDDEN for that participant; creator/lead/coordinator stay visible
 *     (content override); owner bypass always visible.
 *   · legacy stored role maps that LACK the new keys → still visible
 *     (default-'all' flows through the role scan as a default grant).
 *   · safety valves: unready discussion / unseeded roles map → visible.
 */
const ME = '101';
const OTHER = '202';
const person = (id) => ({ id });

function disc({ creator = [], lead = [], coordinator = [], participants = [] } = {}) {
  return {
    id: 'D1',
    discussionCreatorID: creator,
    discussionLeadID: lead,
    discussionCoordinatorID: coordinator,
    participantsID: participants,
  };
}

const CAPS = ['viewReferencesBox', 'viewSummaryBox'];

const seededWith = (participantOverrides) => ({
  enabled: true,
  version: 1,
  roles: {
    ...DEFAULT_PERMISSION_SEED,
    'discussions:participantsID': {
      capabilities: {
        ...DEFAULT_PERMISSION_SEED['discussions:participantsID'].capabilities,
        ...participantOverrides,
      },
    },
  },
});

describe('box-view caps (round209)', () => {
  it('feature OFF: every viewer sees both boxes', () => {
    const off = { permissions: DEFAULT_PERMISSIONS, canManageSettings: false };
    const ctx = { discussion: disc({ participants: [person(ME)] }), currentUserId: ME };
    CAPS.forEach((cap) => expect(resolveCan(cap, ctx, off)).toBe(true));
  });

  it('feature ON: unchecking participants hides the pane for a participant, not for creator/owner', () => {
    const perms = seededWith({ viewReferencesBox: false, viewSummaryBox: false });
    const participantCtx = { discussion: disc({ creator: [person(OTHER)], participants: [person(ME)] }), currentUserId: ME };
    const creatorCtx = { discussion: disc({ creator: [person(ME)], participants: [person(ME)] }), currentUserId: ME };
    CAPS.forEach((cap) => {
      expect(resolveCan(cap, participantCtx, { permissions: perms })).toBe(false);
      expect(resolveCan(cap, creatorCtx, { permissions: perms })).toBe(true);
      expect(resolveCan(cap, participantCtx, { permissions: perms, canManageSettings: true })).toBe(true);
    });
  });

  it('feature ON with the default seed (checked): participants see both boxes', () => {
    const perms = { enabled: true, version: 1, roles: DEFAULT_PERMISSION_SEED };
    const ctx = { discussion: disc({ creator: [person(OTHER)], participants: [person(ME)] }), currentUserId: ME };
    CAPS.forEach((cap) => expect(resolveCan(cap, ctx, { permissions: perms })).toBe(true));
  });

  it('LEGACY stored roles (keys absent): participants still see the boxes (default-all via the scan)', () => {
    const legacyParticipants = { capabilities: { viewDiscussion: true, editSummary: false } };
    const perms = {
      enabled: true,
      version: 1,
      roles: { 'discussions:participantsID': legacyParticipants },
    };
    const ctx = { discussion: disc({ creator: [person(OTHER)], participants: [person(ME)] }), currentUserId: ME };
    CAPS.forEach((cap) => expect(resolveCan(cap, ctx, { permissions: perms })).toBe(true));
  });

  it('safety valves: unready discussion / unseeded roles map → visible', () => {
    const perms = seededWith({ viewReferencesBox: false });
    // (a) people columns not loaded yet
    expect(resolveCan('viewReferencesBox', { discussion: { id: 'D1' }, currentUserId: ME }, { permissions: perms })).toBe(true);
    // (b) roles map has no discussions:* rows at all
    const noDiscRoles = { enabled: true, version: 1, roles: { 'tasks:taskCreatorID': { capabilities: {} } } };
    const ctx = { discussion: disc({ participants: [person(ME)] }), currentUserId: ME };
    expect(resolveCan('viewSummaryBox', ctx, { permissions: noDiscRoles })).toBe(true);
  });
});
