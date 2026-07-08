import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderHook } from '@testing-library/react';

import { resolveCan, usePermission, usePermissions } from '../usePermission.js';
import {
  DEFAULT_PERMISSIONS,
  DEFAULT_PERMISSION_SEED,
  CAPABILITIES,
  SYSTEM_ROLE_KEY,
} from '../../utils/mondayApi/boards.config.js';
import { MondayContext } from '../../contexts/MondayContext.jsx';
import { SettingsContext } from '../../contexts/SettingsContext.jsx';

// --- helpers ---------------------------------------------------------------
const ME = '101';
const OTHER = '202';
const person = (id) => ({ id });

// A discussion whose people columns have LOADED (arrays present) → ready.
function disc({ creator = [], lead = [], participants = [] } = {}) {
  return {
    id: 'D1',
    discussionCreatorID: creator,
    discussionLeadID: lead,
    participantsID: participants,
  };
}
// A discussion whose people columns have NOT loaded yet (lean list item).
const unloadedDisc = { id: 'D1' };

function task({ creator = [], responsible = [] } = {}) {
  return { id: 'T1', taskCreatorID: creator, responsibilityID: responsible };
}

// A DECISION item whose role people columns (creator/decider) have loaded.
function decision({ creator = [], decider = [] } = {}) {
  return { id: 'DC1', decisionCreatorID: creator, deciderID: decider };
}

// permissions blob with the feature ON and the LOCKED seed pre-filled.
const ENABLED_SEEDED = {
  enabled: true,
  version: 1,
  roles: DEFAULT_PERMISSION_SEED,
};

// ===========================================================================
// resolveCan — fail-open parity (feature OFF == today's gate)
// ===========================================================================
describe('resolveCan — fail-open (enabled:false) parity with the legacy gate', () => {
  const off = { permissions: DEFAULT_PERMISSIONS, canManageSettings: false, isAdmin: false };

  it('creator can edit discussion content; a stranger cannot', () => {
    const ctxCreator = { discussion: disc({ creator: [person(ME)] }), currentUserId: ME };
    const ctxStranger = { discussion: disc({ creator: [person(OTHER)] }), currentUserId: ME };
    for (const cap of ['editDiscussionFields', 'editSummary', 'addTopicOrPoint', 'checkPoint', 'createTask']) {
      expect(resolveCan(cap, ctxCreator, off)).toBe(true);
      expect(resolveCan(cap, ctxStranger, off)).toBe(false);
    }
  });

  it('lead can edit discussion content', () => {
    const ctx = { discussion: disc({ lead: [person(ME)] }), currentUserId: ME };
    expect(resolveCan('editDiscussionFields', ctx, off)).toBe(true);
  });

  it('participant (not creator/lead) CANNOT edit content while feature is off (today)', () => {
    const ctx = { discussion: disc({ participants: [person(ME)] }), currentUserId: ME };
    expect(resolveCan('editDiscussionFields', ctx, off)).toBe(false);
    expect(resolveCan('createTask', ctx, off)).toBe(false);
  });

  it('view is allow-all; createDiscussion + manageTemplates allow-all; reorderColumns owner-only', () => {
    const ctx = { discussion: disc(), currentUserId: ME };
    expect(resolveCan('viewDiscussion', ctx, off)).toBe(true);
    expect(resolveCan('createDiscussion', ctx, off)).toBe(true);
    expect(resolveCan('manageTemplates', ctx, off)).toBe(true);
    expect(resolveCan('reorderColumns', ctx, off)).toBe(false);
  });

  it('task edits follow the legacy creator/lead gate of the DISCUSSION (today threaded canEdit)', () => {
    const creatorCtx = { boardKey: 'tasks', discussion: disc({ creator: [person(ME)] }), item: task(), currentUserId: ME };
    const strangerCtx = { boardKey: 'tasks', discussion: disc({ creator: [person(OTHER)] }), item: task(), currentUserId: ME };
    expect(resolveCan('editTaskStatus', creatorCtx, off)).toBe(true);
    expect(resolveCan('deleteTask', strangerCtx, off)).toBe(false);
  });
});

// ===========================================================================
// resolveCan — owner / admin bypass
// ===========================================================================
describe('resolveCan — only the OWNER bypasses (admins do NOT)', () => {
  it('owner is allowed even with feature on and no role held', () => {
    const opts = { permissions: ENABLED_SEEDED, canManageSettings: true };
    const ctx = { discussion: disc({ creator: [person(OTHER)] }), currentUserId: ME };
    for (const cap of ['editDiscussionFields', 'deleteTopicOrPoint', 'reorderColumns', 'editTaskName']) {
      expect(resolveCan(cap, { ...ctx, boardKey: 'tasks', item: task() }, opts)).toBe(true);
    }
  });

  it('account admin does NOT bypass — subject to the matrix like anyone else', () => {
    // isAdmin is no longer honored by the resolver; only canManageSettings (owner) bypasses.
    const opts = { permissions: ENABLED_SEEDED, canManageSettings: false, isAdmin: true };
    const ctx = { discussion: disc({ creator: [person(OTHER)] }), currentUserId: ME };
    expect(resolveCan('editDiscussionFields', ctx, opts)).toBe(false);
    expect(resolveCan('reorderColumns', ctx, opts)).toBe(false);
  });

  it('owner bypass works even before the discussion has loaded (no ready gate)', () => {
    const opts = { permissions: ENABLED_SEEDED, canManageSettings: true, isAdmin: false };
    expect(resolveCan('editDiscussionFields', { discussion: unloadedDisc, currentUserId: ME }, opts)).toBe(true);
  });
});

// ===========================================================================
// resolveCan — ready gate
// ===========================================================================
describe('resolveCan — ready gate (read-only until people cols load)', () => {
  const opts = { permissions: DEFAULT_PERMISSIONS, canManageSettings: false, isAdmin: false };

  it('a would-be creator gets read-only on EDIT caps until the discussion loads', () => {
    // unloadedDisc has no people arrays → not ready. Even though the user WOULD
    // be the creator once loaded, edit caps degrade to read-only.
    const ctx = { discussion: unloadedDisc, currentUserId: ME };
    expect(resolveCan('editDiscussionFields', ctx, opts)).toBe(false);
    expect(resolveCan('addTopicOrPoint', ctx, opts)).toBe(false);
  });

  it('view + system caps are NOT ready-gated', () => {
    const ctx = { discussion: unloadedDisc, currentUserId: ME };
    expect(resolveCan('viewDiscussion', ctx, opts)).toBe(true);
    expect(resolveCan('createDiscussion', ctx, opts)).toBe(true);
  });

  it('once loaded, the creator can edit', () => {
    const ctx = { discussion: disc({ creator: [person(ME)] }), currentUserId: ME };
    expect(resolveCan('editDiscussionFields', ctx, opts)).toBe(true);
  });
});

// ===========================================================================
// resolveCan — feature ON, role union (additive)
// ===========================================================================
describe('resolveCan — feature on, additive role union', () => {
  const opts = { permissions: ENABLED_SEEDED, canManageSettings: false, isAdmin: false };

  it('participant gets the seeded participant grants (createTask, checkPoint, editResponses, exportDocs, addTopicOrPoint)', () => {
    const ctx = { discussion: disc({ participants: [person(ME)] }), currentUserId: ME };
    expect(resolveCan('createTask', ctx, opts)).toBe(true);
    expect(resolveCan('checkPoint', ctx, opts)).toBe(true);
    expect(resolveCan('editResponses', ctx, opts)).toBe(true);
    expect(resolveCan('exportDocs', ctx, opts)).toBe(true);
    expect(resolveCan('addTopicOrPoint', ctx, opts)).toBe(true);
  });

  it('participant does NOT get the caps the seed leaves false (editSummary, deleteTopicOrPoint, editDiscussionFields)', () => {
    const ctx = { discussion: disc({ participants: [person(ME)] }), currentUserId: ME };
    expect(resolveCan('editSummary', ctx, opts)).toBe(false);
    expect(resolveCan('deleteTopicOrPoint', ctx, opts)).toBe(false);
    expect(resolveCan('editDiscussionFields', ctx, opts)).toBe(false);
  });

  it('explicit false on one role is NOT a revoke — another held role still grants (union)', () => {
    // User is BOTH a participant (editSummary:false in seed) AND the lead
    // (editSummary:true). The union must GRANT.
    const ctx = {
      discussion: disc({ participants: [person(ME)], lead: [person(ME)] }),
      currentUserId: ME,
    };
    expect(resolveCan('editSummary', ctx, opts)).toBe(true);
    expect(resolveCan('deleteTopicOrPoint', ctx, opts)).toBe(true);
  });

  it('creator/lead override grants ALL discussion content caps regardless of role map', () => {
    const ctx = { discussion: disc({ creator: [person(ME)] }), currentUserId: ME };
    expect(resolveCan('deleteTopicOrPoint', ctx, opts)).toBe(true);
    expect(resolveCan('editSummary', ctx, opts)).toBe(true);
  });

  it('task tier: responsible gets status+priority but NOT deadline/assignee/name/delete', () => {
    const ctx = { boardKey: 'tasks', discussion: disc(), item: task({ responsible: [person(ME)] }), currentUserId: ME };
    expect(resolveCan('editTaskStatus', ctx, opts)).toBe(true);
    expect(resolveCan('editTaskPriority', ctx, opts)).toBe(true);
    expect(resolveCan('editTaskDeadline', ctx, opts)).toBe(false);
    expect(resolveCan('editTaskAssignee', ctx, opts)).toBe(false);
    expect(resolveCan('editTaskName', ctx, opts)).toBe(false);
    expect(resolveCan('deleteTask', ctx, opts)).toBe(false);
  });

  it('task tier: task creator gets ALL task caps', () => {
    const ctx = { boardKey: 'tasks', discussion: disc(), item: task({ creator: [person(ME)] }), currentUserId: ME };
    for (const cap of ['editTaskStatus', 'editTaskPriority', 'editTaskDeadline', 'editTaskAssignee', 'editTaskName', 'deleteTask']) {
      expect(resolveCan(cap, ctx, opts)).toBe(true);
    }
  });

  it('a user who holds no role is denied edit (default-deny) but can still view', () => {
    const ctx = { discussion: disc({ creator: [person(OTHER)] }), currentUserId: ME };
    expect(resolveCan('editDiscussionFields', ctx, opts)).toBe(false);
    expect(resolveCan('viewDiscussion', ctx, opts)).toBe(true);
  });

  it('global manageTemplates is allow-all; reorderColumns owner-only even when feature on', () => {
    const ctx = { discussion: disc({ participants: [person(ME)] }), currentUserId: ME };
    expect(resolveCan('manageTemplates', ctx, opts)).toBe(true);
    expect(resolveCan('reorderColumns', ctx, opts)).toBe(false);
  });
});

// ===========================================================================
// resolveCan — graceful degradation (stale / unmapped aliases)
// ===========================================================================
describe('resolveCan — degrades gracefully on missing/stale data', () => {
  it('does not throw and denies edit when discussion is null', () => {
    const opts = { permissions: ENABLED_SEEDED, canManageSettings: false, isAdmin: false };
    expect(() => resolveCan('editDiscussionFields', { discussion: null, currentUserId: ME }, opts)).not.toThrow();
    expect(resolveCan('editDiscussionFields', { discussion: null, currentUserId: ME }, opts)).toBe(false);
  });

  it('does not throw when a role alias is mapped but absent in the seed (inherits default)', () => {
    // permissions enabled, but roles map is EMPTY → participant inherits
    // CAPABILITY_DEFAULTS. createTask default = creatorLeadOwner → participant
    // (not creator/lead) is denied; viewDiscussion default = all → allowed.
    const opts = { permissions: { enabled: true, version: 1, roles: {} }, canManageSettings: false, isAdmin: false };
    const ctx = { discussion: disc({ participants: [person(ME)] }), currentUserId: ME };
    expect(() => resolveCan('createTask', ctx, opts)).not.toThrow();
    expect(resolveCan('createTask', ctx, opts)).toBe(false);
    expect(resolveCan('viewDiscussion', ctx, opts)).toBe(true);
  });

  it('handles undefined currentUserId without throwing (anonymous → no roles)', () => {
    const opts = { permissions: ENABLED_SEEDED, canManageSettings: false, isAdmin: false };
    const ctx = { discussion: disc({ creator: [person(ME)] }) };
    expect(() => resolveCan('editDiscussionFields', ctx, opts)).not.toThrow();
    expect(resolveCan('editDiscussionFields', ctx, opts)).toBe(false);
  });

  it('handles a people column that is a non-array (stale shape) without throwing', () => {
    const opts = { permissions: ENABLED_SEEDED, canManageSettings: false, isAdmin: false };
    const ctx = { discussion: { id: 'D1', discussionCreatorID: 'oops-not-an-array', discussionLeadID: [] }, currentUserId: ME };
    expect(() => resolveCan('editDiscussionFields', ctx, opts)).not.toThrow();
  });

  it('defaults to inert DEFAULT_PERMISSIONS when opts omits permissions (fail-open)', () => {
    const ctx = { discussion: disc({ creator: [person(ME)] }), currentUserId: ME };
    expect(resolveCan('editDiscussionFields', ctx, {})).toBe(true);
    expect(resolveCan('editDiscussionFields', { discussion: disc({ creator: [person(OTHER)] }), currentUserId: ME }, {})).toBe(false);
  });
});

// ===========================================================================
// STAGE 1 — resolver-only "dark" change (§5.1 cases A–F)
// ===========================================================================

// Build a single-role permissions blob (feature on) for veto tests.
function enabledRoles(roles, extra = {}) {
  return { enabled: true, version: 1, roles, ...extra };
}

// --- A. Fail-open invariant: enabled:false is byte-for-byte unchanged --------
describe('A. fail-open (enabled:false) snapshot — unchanged after Stage 1', () => {
  const off = { permissions: DEFAULT_PERMISSIONS, canManageSettings: false };
  const readyD = disc({ creator: [person('C')], lead: [person('L')], participants: [person('P')] });
  const users = { owner: null, creator: 'C', lead: 'L', participant: 'P', stranger: 'Z' };

  it('every cap × {creator,lead,participant,stranger} × {ready,not-ready} matches the legacy gate', () => {
    for (const cap of CAPABILITIES.map((c) => c.id)) {
      for (const [, uid] of Object.entries(users)) {
        if (uid == null) continue;
        for (const d of [readyD, unloadedDisc]) {
          const ctx = { boardKey: 'tasks', discussion: d, item: task({ creator: [person(uid)] }), currentUserId: uid };
          // Recompute the EXPECTED legacy value independently of the resolver.
          const isView = cap === 'viewDiscussion';
          const isSystem = ['createDiscussion', 'reorderColumns', 'manageTemplates', 'addDiscussionTypes', 'saveViewDefaults'].includes(cap);
          const isReadyGated = !isSystem && !isView;
          const ready = isSystem ? true : (d === readyD);
          let expected;
          if (isReadyGated && !ready) expected = false;
          else if (isView) expected = true;
          // DOCS-export ran UNGATED today (allow-all), so the fail-open path
          // resolves it true for everyone once the discussion is ready.
          else if (cap === 'exportDocs') expected = true;
          // reorderColumns + addDiscussionTypes + saveViewDefaults are owner-only
          // in fail-open; the other two system caps are allow-all.
          else if (isSystem) expected = cap === 'createDiscussion' || cap === 'manageTemplates';
          else {
            // legacy: creator/lead of the discussion (owner bypassed elsewhere)
            expected = uid === 'C' || uid === 'L';
          }
          expect(resolveCan(cap, ctx, off)).toBe(expected);
        }
      }
    }
  });
});

// --- B. Revoke — deny-wins per-role veto -------------------------------------
describe('B. revoke (feature on) — explicit false vetoes grants from other held roles', () => {
  it('role A grants editSummary, user holds only A → ALLOW', () => {
    const opts = { permissions: enabledRoles({ 'discussions:participantsID': { capabilities: { editSummary: true } } }) };
    const ctx = { discussion: disc({ participants: [person(ME)] }), currentUserId: ME };
    expect(resolveCan('editSummary', ctx, opts)).toBe(true);
  });

  it('role A grants + role B denies (both held) → DENY (deny-wins veto)', () => {
    // participants grants editSummary, lead denies it, user holds BOTH. The user
    // is the lead, so the creator/lead override would normally win — set
    // strictCreatorLead:true to push the override below the veto and isolate the
    // deny-wins scan.
    const opts = {
      permissions: enabledRoles(
        {
          'discussions:participantsID': { capabilities: { editSummary: true } },
          'discussions:discussionLeadID': { capabilities: { editSummary: false } },
        },
        { strictCreatorLead: true }
      ),
    };
    const ctx = { discussion: disc({ participants: [person(ME)], lead: [person(ME)] }), currentUserId: ME };
    expect(resolveCan('editSummary', ctx, opts)).toBe(false);
  });

  it('role A grants + role B undefined→default → ALLOW (no explicit false present)', () => {
    const opts = {
      permissions: enabledRoles({
        'discussions:participantsID': { capabilities: { editSummary: true } },
        'discussions:discussionLeadID': { capabilities: {} },
      }),
    };
    // user holds participants only → single grant, no veto.
    const ctx = { discussion: disc({ participants: [person(ME)] }), currentUserId: ME };
    expect(resolveCan('editSummary', ctx, opts)).toBe(true);
  });

  it('role with explicit false, user holds only it, not creator/lead → DENY', () => {
    const opts = { permissions: enabledRoles({ 'discussions:participantsID': { capabilities: { addTopicOrPoint: false } } }) };
    const ctx = { discussion: disc({ participants: [person(ME)] }), currentUserId: ME };
    expect(resolveCan('addTopicOrPoint', ctx, opts)).toBe(false);
  });
});

// --- C. Creator/lead override vs revoke, strictCreatorLead both values -------
describe('C. creator/lead override vs revoke — strictCreatorLead flag', () => {
  const rolesLeadDenies = { 'discussions:discussionLeadID': { capabilities: { editDiscussionFields: false } } };

  it('strictCreatorLead=false (default): lead with editDiscussionFields:false → ALLOW (override wins)', () => {
    const opts = { permissions: enabledRoles(rolesLeadDenies) };
    const ctx = { discussion: disc({ lead: [person(ME)] }), currentUserId: ME };
    expect(resolveCan('editDiscussionFields', ctx, opts)).toBe(true);
  });

  it('strictCreatorLead=true: same setup → DENY (override below veto)', () => {
    const opts = { permissions: enabledRoles(rolesLeadDenies, { strictCreatorLead: true }) };
    const ctx = { discussion: disc({ lead: [person(ME)] }), currentUserId: ME };
    expect(resolveCan('editDiscussionFields', ctx, opts)).toBe(false);
  });

  it('strictCreatorLead=true but no held role vetoes → creator still ALLOW', () => {
    const opts = { permissions: enabledRoles({}, { strictCreatorLead: true }) };
    const ctx = { discussion: disc({ creator: [person(ME)] }), currentUserId: ME };
    expect(resolveCan('editDiscussionFields', ctx, opts)).toBe(true);
  });

  it('task cap editTaskStatus:false on a role the creator holds → DENY regardless of override', () => {
    // Task caps are excluded from the creator/lead override entirely.
    const opts = {
      permissions: enabledRoles({ 'tasks:taskCreatorID': { capabilities: { editTaskStatus: false } } }),
    };
    const ctx = {
      boardKey: 'tasks',
      discussion: disc({ creator: [person(ME)] }),
      item: task({ creator: [person(ME)] }),
      currentUserId: ME,
    };
    expect(resolveCan('editTaskStatus', ctx, opts)).toBe(false);
  });
});

// --- D. System caps read system:system (true / false / undefined) ------------
describe('D. system caps — driven by the system:system role', () => {
  it('system:system absent → createDiscussion+manageTemplates ALLOW, reorderColumns DENY (non-owner), ALLOW (owner)', () => {
    const opts = { permissions: enabledRoles({}) };
    const ctx = { discussion: disc({ participants: [person(ME)] }), currentUserId: ME };
    expect(resolveCan('createDiscussion', ctx, opts)).toBe(true);
    expect(resolveCan('manageTemplates', ctx, opts)).toBe(true);
    expect(resolveCan('reorderColumns', ctx, opts)).toBe(false);
    expect(resolveCan('reorderColumns', ctx, { ...opts, canManageSettings: true })).toBe(true);
  });

  it('addDiscussionTypes: default owner-only → DENY member, ALLOW owner; explicit true → ALLOW all', () => {
    const ctx = { discussion: disc({ participants: [person(ME)] }), currentUserId: ME };
    const off = { permissions: enabledRoles({}) };
    expect(resolveCan('addDiscussionTypes', ctx, off)).toBe(false); // member, default owner-only
    expect(resolveCan('addDiscussionTypes', ctx, { ...off, canManageSettings: true })).toBe(true); // owner bypass
    const on = { permissions: enabledRoles({ [SYSTEM_ROLE_KEY]: { capabilities: { addDiscussionTypes: true } } }) };
    expect(resolveCan('addDiscussionTypes', ctx, on)).toBe(true); // opened to all members
    const revoked = { permissions: enabledRoles({ [SYSTEM_ROLE_KEY]: { capabilities: { addDiscussionTypes: false } } }) };
    expect(resolveCan('addDiscussionTypes', ctx, revoked)).toBe(false);
    expect(resolveCan('addDiscussionTypes', ctx, { ...revoked, canManageSettings: true })).toBe(true);
  });

  it('saveViewDefaults: default owner-only → DENY member, ALLOW owner; explicit true → ALLOW all; false → revoke', () => {
    const ctx = { discussion: disc({ participants: [person(ME)] }), currentUserId: ME };
    const off = { permissions: enabledRoles({}) };
    expect(resolveCan('saveViewDefaults', ctx, off)).toBe(false); // member, default owner-only
    expect(resolveCan('saveViewDefaults', ctx, { ...off, canManageSettings: true })).toBe(true); // owner bypass
    const on = { permissions: enabledRoles({ [SYSTEM_ROLE_KEY]: { capabilities: { saveViewDefaults: true } } }) };
    expect(resolveCan('saveViewDefaults', ctx, on)).toBe(true); // checkbox opened it to all members
    const revoked = { permissions: enabledRoles({ [SYSTEM_ROLE_KEY]: { capabilities: { saveViewDefaults: false } } }) };
    expect(resolveCan('saveViewDefaults', ctx, revoked)).toBe(false);
    expect(resolveCan('saveViewDefaults', ctx, { ...revoked, canManageSettings: true })).toBe(true);
  });

  it('createDiscussion:false → DENY non-owner; owner still ALLOW (bypass)', () => {
    const opts = { permissions: enabledRoles({ [SYSTEM_ROLE_KEY]: { capabilities: { createDiscussion: false } } }) };
    const ctx = { discussion: disc(), currentUserId: ME };
    expect(resolveCan('createDiscussion', ctx, opts)).toBe(false);
    expect(resolveCan('createDiscussion', ctx, { ...opts, canManageSettings: true })).toBe(true);
  });

  it('manageTemplates:false → DENY', () => {
    const opts = { permissions: enabledRoles({ [SYSTEM_ROLE_KEY]: { capabilities: { manageTemplates: false } } }) };
    const ctx = { discussion: disc(), currentUserId: ME };
    expect(resolveCan('manageTemplates', ctx, opts)).toBe(false);
  });

  it('createDiscussion:true (explicit) → ALLOW', () => {
    const opts = { permissions: enabledRoles({ [SYSTEM_ROLE_KEY]: { capabilities: { createDiscussion: true } } }) };
    const ctx = { discussion: disc(), currentUserId: ME };
    expect(resolveCan('createDiscussion', ctx, opts)).toBe(true);
  });

  it('reorderColumns:true → ALLOW when user holds a non-hidden discussion role; DENY when they hold none', () => {
    const opts = { permissions: enabledRoles({ [SYSTEM_ROLE_KEY]: { capabilities: { reorderColumns: true } } }) };
    const member = { discussion: disc({ participants: [person(ME)] }), currentUserId: ME };
    const nonMember = { discussion: disc({ participants: [person(OTHER)] }), currentUserId: ME };
    expect(resolveCan('reorderColumns', member, opts)).toBe(true);
    expect(resolveCan('reorderColumns', nonMember, opts)).toBe(false);
  });

  it('reorderColumns:false → DENY for members; owner still bypasses', () => {
    const opts = { permissions: enabledRoles({ [SYSTEM_ROLE_KEY]: { capabilities: { reorderColumns: false } } }) };
    const ctx = { discussion: disc({ participants: [person(ME)] }), currentUserId: ME };
    expect(resolveCan('reorderColumns', ctx, opts)).toBe(false);
    expect(resolveCan('reorderColumns', ctx, { ...opts, canManageSettings: true })).toBe(true);
  });

  it('hidden system:system → all system caps fall to defaults', () => {
    const opts = {
      permissions: enabledRoles({
        [SYSTEM_ROLE_KEY]: { hidden: true, capabilities: { createDiscussion: false, reorderColumns: true } },
      }),
    };
    const ctx = { discussion: disc({ participants: [person(ME)] }), currentUserId: ME };
    // createDiscussion:false ignored → default all → ALLOW
    expect(resolveCan('createDiscussion', ctx, opts)).toBe(true);
    // reorderColumns:true ignored → default owner → DENY non-owner
    expect(resolveCan('reorderColumns', ctx, opts)).toBe(false);
  });
});

// --- E. Owner bypass is absolute --------------------------------------------
describe('E. owner bypass is absolute (even with explicit false on every role)', () => {
  it('canManageSettings:true → ALLOW for every cap, even fully revoked', () => {
    const denyAll = (caps) => ({ capabilities: Object.fromEntries(caps.map((c) => [c, false])) });
    const allCaps = CAPABILITIES.map((c) => c.id);
    const opts = {
      permissions: enabledRoles(
        {
          'discussions:discussionCreatorID': denyAll(allCaps),
          'discussions:discussionLeadID': denyAll(allCaps),
          'discussions:participantsID': denyAll(allCaps),
          'tasks:taskCreatorID': denyAll(allCaps),
          'tasks:responsibilityID': denyAll(allCaps),
          [SYSTEM_ROLE_KEY]: denyAll(allCaps),
        },
        { strictCreatorLead: true }
      ),
      canManageSettings: true,
    };
    const ctx = {
      boardKey: 'tasks',
      discussion: disc({ creator: [person(ME)], lead: [person(ME)], participants: [person(ME)] }),
      item: task({ creator: [person(ME)], responsible: [person(ME)] }),
      currentUserId: ME,
    };
    for (const cap of allCaps) {
      expect(resolveCan(cap, ctx, opts)).toBe(true);
    }
  });
});

// --- F. Hidden role contributes nothing (no veto) ----------------------------
describe('F. hidden role — no grant, no veto', () => {
  it('hidden role with false does NOT veto a grant from another held role', () => {
    const opts = {
      permissions: enabledRoles({
        'discussions:participantsID': { hidden: true, capabilities: { addTopicOrPoint: false } },
        'discussions:discussionLeadID': { capabilities: { addTopicOrPoint: true } },
      }),
    };
    // Hold BOTH, but suppress the creator/lead override to isolate the scan by
    // using strictCreatorLead — with a grant present and the hidden false ignored,
    // no veto exists → ALLOW.
    const ctx = { discussion: disc({ participants: [person(ME)], lead: [person(ME)] }), currentUserId: ME };
    expect(resolveCan('addTopicOrPoint', ctx, { ...opts, permissions: { ...opts.permissions, strictCreatorLead: true } })).toBe(true);
  });

  it('hidden role with a grant contributes nothing → user with only that role is DENIED', () => {
    const opts = {
      permissions: enabledRoles({
        'discussions:participantsID': { hidden: true, capabilities: { addTopicOrPoint: true } },
      }),
    };
    const ctx = { discussion: disc({ participants: [person(ME)] }), currentUserId: ME };
    expect(resolveCan('addTopicOrPoint', ctx, opts)).toBe(false);
  });
});

// ===========================================================================
// React hooks — usePermission / usePermissions wiring
// ===========================================================================
function wrapper({ permissions = DEFAULT_PERMISSIONS, isAdmin = false, userId = ME } = {}) {
  const settingsValue = { settings: null, permissions, isConfigured: true, isLoading: false, updateSettings: async () => null };
  const mondayValue = { context: { user: { id: userId, isAdmin } }, currentUser: { id: userId }, isMobile: false };
  return ({ children }) => (
    <MondayContext.Provider value={mondayValue}>
      <SettingsContext.Provider value={settingsValue}>{children}</SettingsContext.Provider>
    </MondayContext.Provider>
  );
}

describe('usePermission (React) — reads from contexts', () => {
  it('admin from context does NOT bypass (must be an owner)', () => {
    const { result } = renderHook(() => usePermission(), { wrapper: wrapper({ permissions: ENABLED_SEEDED, isAdmin: true }) });
    expect(result.current('editDiscussionFields', { discussion: disc({ creator: [person(OTHER)] }) })).toBe(false);
  });

  it('non-admin participant follows the role map', () => {
    const { result } = renderHook(() => usePermission(), { wrapper: wrapper({ permissions: ENABLED_SEEDED }) });
    expect(result.current('createTask', { discussion: disc({ participants: [person(ME)] }) })).toBe(true);
    expect(result.current('editSummary', { discussion: disc({ participants: [person(ME)] }) })).toBe(false);
  });

  it('explicit canManageSettings extra overrides context (owner bypass)', () => {
    const { result } = renderHook(() => usePermission({ canManageSettings: true }), { wrapper: wrapper({ permissions: ENABLED_SEEDED }) });
    expect(result.current('reorderColumns', { discussion: disc() })).toBe(true);
  });
});

describe('usePermissions (React) — coarse canEdit + ready', () => {
  it('canEdit true for creator, false for stranger (fail-open parity)', () => {
    const w1 = wrapper({});
    const { result: r1 } = renderHook(() => usePermissions(disc({ creator: [person(ME)] })), { wrapper: w1 });
    expect(r1.current.canEdit).toBe(true);
    expect(r1.current.ready).toBe(true);

    const { result: r2 } = renderHook(() => usePermissions(disc({ creator: [person(OTHER)] })), { wrapper: wrapper({}) });
    expect(r2.current.canEdit).toBe(false);
  });

  it('ready=false (and canEdit=false) before the discussion details load', () => {
    const { result } = renderHook(() => usePermissions(unloadedDisc), { wrapper: wrapper({}) });
    expect(result.current.ready).toBe(false);
    expect(result.current.canEdit).toBe(false);
  });

  it('bound can() defaults discussion to the passed one', () => {
    const { result } = renderHook(() => usePermissions(disc({ creator: [person(ME)] })), { wrapper: wrapper({}) });
    expect(result.current.can('editDiscussionFields')).toBe(true);
  });
});

// ===========================================================================
// resolveCan — task ctx WITHOUT a discussion (the My Tasks surface).
// My Tasks rows carry no parent discussion, so task caps must resolve from the
// TASK's own people columns: readiness from the task (not discussionReady), and
// the fail-open path from the task's creator/responsible (not creator/lead).
// ===========================================================================
describe('resolveCan — task ctx without a discussion (My Tasks)', () => {
  const off = { permissions: DEFAULT_PERMISSIONS, canManageSettings: false };
  const on = { permissions: ENABLED_SEEDED, canManageSettings: false };

  it('fail-open: the task creator / responsible can edit; a stranger cannot', () => {
    const asCreator = { item: task({ creator: [person(ME)] }), currentUserId: ME };
    const asResponsible = { item: task({ responsible: [person(ME)] }), currentUserId: ME };
    const asStranger = { item: task({ creator: [person(OTHER)], responsible: [person(OTHER)] }), currentUserId: ME };
    for (const cap of ['editTaskStatus', 'editTaskPriority', 'editTaskDeadline', 'editTaskName']) {
      expect(resolveCan(cap, asCreator, off)).toBe(true);
      expect(resolveCan(cap, asResponsible, off)).toBe(true);
      expect(resolveCan(cap, asStranger, off)).toBe(false);
    }
  });

  it('ready gate: a task whose people columns have not loaded is read-only', () => {
    expect(resolveCan('editTaskStatus', { item: { id: 'T1' }, currentUserId: ME }, on)).toBe(false);
    expect(resolveCan('editTaskStatus', { item: null, currentUserId: ME }, on)).toBe(false);
    // one loaded role column (even empty) is enough to resolve
    expect(resolveCan('editTaskStatus', { item: { id: 'T1', responsibilityID: [] }, currentUserId: ME }, on)).toBe(false);
  });

  it('feature on + seed: responsible gets status+priority but NOT deadline/name/delete', () => {
    const ctx = { item: task({ responsible: [person(ME)] }), currentUserId: ME };
    expect(resolveCan('editTaskStatus', ctx, on)).toBe(true);
    expect(resolveCan('editTaskPriority', ctx, on)).toBe(true);
    expect(resolveCan('editTaskDeadline', ctx, on)).toBe(false);
    expect(resolveCan('editTaskName', ctx, on)).toBe(false);
    expect(resolveCan('deleteTask', ctx, on)).toBe(false);
  });

  it('feature on + seed: the task creator gets ALL task caps (incl. deadline+name)', () => {
    const ctx = { item: task({ creator: [person(ME)] }), currentUserId: ME };
    for (const cap of ['editTaskStatus', 'editTaskPriority', 'editTaskDeadline', 'editTaskName', 'deleteTask']) {
      expect(resolveCan(cap, ctx, on)).toBe(true);
    }
  });

  it('feature on: an explicit false on a held role vetoes a grant from another held role', () => {
    const perms = {
      enabled: true,
      version: 1,
      roles: {
        'tasks:taskCreatorID': { capabilities: { editTaskDeadline: true } },
        'tasks:responsibilityID': { capabilities: { editTaskDeadline: false } },
      },
    };
    const ctx = { item: task({ creator: [person(ME)], responsible: [person(ME)] }), currentUserId: ME };
    expect(resolveCan('editTaskDeadline', ctx, { permissions: perms, canManageSettings: false })).toBe(false);
  });
});

// ===========================================================================
// resolveCan — DECISION tier. Mirrors the task tier: decision caps resolve from
// the DECISION item's own people columns (PERMISSION_ROLE_SOURCES.decisions:
// decisionCreatorID/deciderID). createDecision resolves at the DISCUSSION tier
// like createTask.
// ===========================================================================
describe('resolveCan — decision tier', () => {
  const off = { permissions: DEFAULT_PERMISSIONS, canManageSettings: false };
  const on = { permissions: ENABLED_SEEDED, canManageSettings: false };
  const DECISION_EDIT_CAPS = ['editDecisionStatus', 'editDecisionPriority', 'editDecisionDate', 'editDecisionAffected', 'editDecisionName'];

  it('fail-open, no discussion in ctx (My Decisions): decision creator / decider edit their own decisions; a stranger cannot', () => {
    const asCreator = { item: decision({ creator: [person(ME)] }), currentUserId: ME };
    const asDecider = { item: decision({ decider: [person(ME)] }), currentUserId: ME };
    const asStranger = { item: decision({ creator: [person(OTHER)], decider: [person(OTHER)] }), currentUserId: ME };
    for (const cap of [...DECISION_EDIT_CAPS, 'deleteDecision']) {
      expect(resolveCan(cap, asCreator, off)).toBe(true);
      expect(resolveCan(cap, asDecider, off)).toBe(true);
      expect(resolveCan(cap, asStranger, off)).toBe(false);
    }
  });

  it('fail-open, WITH a discussion in ctx: decision caps follow the legacy creator/lead gate of the DISCUSSION (like task caps)', () => {
    const creatorCtx = { discussion: disc({ creator: [person(ME)] }), item: decision(), currentUserId: ME };
    const strangerCtx = { discussion: disc({ creator: [person(OTHER)] }), item: decision(), currentUserId: ME };
    expect(resolveCan('editDecisionStatus', creatorCtx, off)).toBe(true);
    expect(resolveCan('deleteDecision', strangerCtx, off)).toBe(false);
  });

  it('ready gate: a decision whose people columns have not loaded is read-only', () => {
    expect(resolveCan('editDecisionStatus', { item: { id: 'DC1' }, currentUserId: ME }, on)).toBe(false);
    expect(resolveCan('editDecisionStatus', { item: null, currentUserId: ME }, on)).toBe(false);
    // one loaded role column (even empty) is enough to resolve
    expect(resolveCan('editDecisionStatus', { item: { id: 'DC1', deciderID: [] }, currentUserId: ME }, on)).toBe(false);
  });

  it('feature on + seed: the decision creator gets ALL decision caps (incl. delete)', () => {
    const ctx = { item: decision({ creator: [person(ME)] }), currentUserId: ME };
    for (const cap of [...DECISION_EDIT_CAPS, 'deleteDecision']) {
      expect(resolveCan(cap, ctx, on)).toBe(true);
    }
  });

  it('feature on + seed: the decider gets every edit cap but NOT deleteDecision', () => {
    const ctx = { item: decision({ decider: [person(ME)] }), currentUserId: ME };
    for (const cap of DECISION_EDIT_CAPS) {
      expect(resolveCan(cap, ctx, on)).toBe(true);
    }
    expect(resolveCan('deleteDecision', ctx, on)).toBe(false);
  });

  it('feature on: the discussion creator/lead content override does NOT extend to decision caps (item tier excluded)', () => {
    const ctx = {
      discussion: disc({ creator: [person(ME)] }),
      item: decision({ creator: [person(OTHER)], decider: [person(OTHER)] }),
      currentUserId: ME,
    };
    expect(resolveCan('editDecisionStatus', ctx, on)).toBe(false);
    expect(resolveCan('deleteDecision', ctx, on)).toBe(false);
  });

  it('feature on: an explicit false on a held decision role vetoes a grant from another held role', () => {
    const perms = {
      enabled: true,
      version: 1,
      roles: {
        'decisions:decisionCreatorID': { capabilities: { editDecisionDate: true } },
        'decisions:deciderID': { capabilities: { editDecisionDate: false } },
      },
    };
    const ctx = { item: decision({ creator: [person(ME)], decider: [person(ME)] }), currentUserId: ME };
    expect(resolveCan('editDecisionDate', ctx, { permissions: perms, canManageSettings: false })).toBe(false);
  });

  it('createDecision resolves at the DISCUSSION tier like createTask (seed grants it to participants)', () => {
    const participant = { discussion: disc({ participants: [person(ME)] }), currentUserId: ME };
    const stranger = { discussion: disc({ participants: [person(OTHER)] }), currentUserId: ME };
    expect(resolveCan('createDecision', participant, on)).toBe(true);
    expect(resolveCan('createDecision', stranger, on)).toBe(false);
    // fail-open: legacy creator/lead gate (participants cannot create)
    expect(resolveCan('createDecision', participant, off)).toBe(false);
    expect(resolveCan('createDecision', { discussion: disc({ creator: [person(ME)] }), currentUserId: ME }, off)).toBe(true);
    // ready-gated by the DISCUSSION (not the item)
    expect(resolveCan('createDecision', { discussion: unloadedDisc, currentUserId: ME }, on)).toBe(false);
  });

  it('owner bypass is absolute for decision caps too, even with every decision role revoked', () => {
    const denyAll = { capabilities: Object.fromEntries([...DECISION_EDIT_CAPS, 'deleteDecision', 'createDecision'].map((c) => [c, false])) };
    const opts = {
      permissions: enabledRoles({ 'decisions:decisionCreatorID': denyAll, 'decisions:deciderID': denyAll }),
      canManageSettings: true,
    };
    const ctx = { item: decision({ creator: [person(ME)], decider: [person(ME)] }), currentUserId: ME };
    for (const cap of [...DECISION_EDIT_CAPS, 'deleteDecision']) {
      expect(resolveCan(cap, ctx, opts)).toBe(true);
    }
  });
});
