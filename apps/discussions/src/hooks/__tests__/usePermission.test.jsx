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
// round341 — `coordinator` was missing from this fixture, so no test could exercise
// מרכז דיון even though the resolver has always read it (isCreatorOrLead, and now the
// decision-tier scan). Defaulting it to [] leaves every existing case unchanged:
// inPeople(undefined) and inPeople([]) are both false.
function disc({ creator = [], lead = [], coordinator = [], participants = [] } = {}) {
  return {
    id: 'D1',
    discussionCreatorID: creator,
    discussionLeadID: lead,
    discussionCoordinatorID: coordinator,
    participantsID: participants,
  };
}
// A discussion whose people columns have NOT loaded yet (lean list item).
const unloadedDisc = { id: 'D1' };

function task({ creator = [], responsible = [] } = {}) {
  return { id: 'T1', taskCreatorID: creator, responsibilityID: responsible };
}

// Every decision-tier capability id, for the round341 "can do every action" assertions.
// Spelled out rather than derived from CAPABILITIES so a catalog addition surfaces here
// as a decision to make, not as a silently-widened expectation.
const ALL_DECISION_CAPS = [
  'editDecisionStatus', 'editDecisionTracking', 'editDecisionPriority',
  'editDecisionDate', 'editDecisionAffected', 'editDecisionName', 'deleteDecision',
];

// A DECISION item whose role people columns (creator/decider/affected) have loaded.
function decision({ creator = [], decider = [], affected = [] } = {}) {
  return { id: 'DC1', decisionCreatorID: creator, deciderID: decider, affectedID: affected };
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

  it('participant gets the seeded participant grants (createTask, checkPoint, addTopicOrPoint)', () => {
    const ctx = { discussion: disc({ participants: [person(ME)] }), currentUserId: ME };
    expect(resolveCan('createTask', ctx, opts)).toBe(true);
    expect(resolveCan('checkPoint', ctx, opts)).toBe(true);
    expect(resolveCan('addTopicOrPoint', ctx, opts)).toBe(true);
    // round340 (owner spec) — and the BEFORE-discussed halves of topic/point edit.
    expect(resolveCan('editTopicOrPoint', ctx, opts)).toBe(true);
    expect(resolveCan('deleteTopicOrPoint', ctx, opts)).toBe(true);
  });

  it('participant does NOT get the caps the seed leaves false (editSummary, editDiscussionFields, exportDocs, *Discussed)', () => {
    const ctx = { discussion: disc({ participants: [person(ME)] }), currentUserId: ME };
    expect(resolveCan('editSummary', ctx, opts)).toBe(false);
    expect(resolveCan('editDiscussionFields', ctx, opts)).toBe(false);
    // round340 (owner spec) — no export, and no touching a topic/point that was
    // already discussed. Resolving the AFTER halves to false is what makes the
    // per-row gate in TopicsTab mean anything.
    expect(resolveCan('exportDocs', ctx, opts)).toBe(false);
    expect(resolveCan('editTopicOrPointDiscussed', ctx, opts)).toBe(false);
    expect(resolveCan('deleteTopicOrPointDiscussed', ctx, opts)).toBe(false);
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

  it('decision tier: creator/decider who are ALSO listed as affected keep editing decider+affected (union over the affected deny)', () => {
    // The reported bug: the seed's affectedID role carries editDecisionAffected:false,
    // and a decision's creator/decider are usually also in the affected column —
    // deny-wins stripped the ability their own roles explicitly grant.
    const asCreator = {
      boardKey: 'decisions',
      item: decision({ creator: [person(ME)], decider: [person(OTHER)], affected: [person(ME)] }),
      currentUserId: ME,
    };
    const asDecider = {
      boardKey: 'decisions',
      item: decision({ creator: [person(OTHER)], decider: [person(ME)], affected: [person(ME)] }),
      currentUserId: ME,
    };
    expect(resolveCan('editDecisionAffected', asCreator, opts)).toBe(true);
    expect(resolveCan('editDecisionAffected', asDecider, opts)).toBe(true);
  });

  it('decision tier: an affected-only user still cannot edit decider+affected', () => {
    const ctx = {
      boardKey: 'decisions',
      item: decision({ creator: [person(OTHER)], decider: [person(OTHER)], affected: [person(ME)] }),
      currentUserId: ME,
    };
    expect(resolveCan('editDecisionAffected', ctx, opts)).toBe(false);
  });

  it('round212 (supersedes item 13): editSummary matrix-granted to participants COUNTS — the ✓-table gives owners full per-role control', () => {
    const grantedToParticipants = {
      permissions: {
        enabled: true,
        version: 1,
        roles: { 'discussions:participantsID': { capabilities: { editSummary: true } } },
      },
      canManageSettings: false,
    };
    const ctx = { discussion: disc({ participants: [person(ME)] }), currentUserId: ME };
    expect(resolveCan('editSummary', ctx, grantedToParticipants)).toBe(true);
    // An explicit false on the held role still denies (a plain participant).
    const revokedFromParticipants = {
      permissions: {
        enabled: true,
        version: 1,
        roles: { 'discussions:participantsID': { capabilities: { editSummary: false } } },
      },
      canManageSettings: false,
    };
    expect(resolveCan('editSummary', ctx, revokedFromParticipants)).toBe(false);
    // The lead-role grant keeps working, as before.
    const grantedToLead = {
      permissions: {
        enabled: true,
        version: 1,
        roles: { 'discussions:discussionLeadID': { capabilities: { editSummary: true } } },
      },
      canManageSettings: false,
    };
    expect(resolveCan('editSummary', { discussion: disc({ lead: [person(ME)] }), currentUserId: ME }, grantedToLead)).toBe(true);
  });

  /*
   * round341 (owner request) — item 21 GREW. The discussion's three manager roles are now
   * equal in power to the decider on any decision of their discussion, delete included:
   * "כשווי כוח למחליט וככאלה שיכולים לבצע כל פעולה על כל החלטה".
   *
   * The mechanism changed too, and that is the more important half: this used to be a
   * hardcoded override that no checkbox could revoke (so the matrix's decision cells were
   * partly decorative for these roles). It now runs through the ordinary role scan via
   * TIER_EXTRA_ROLE_SOURCES + the seed, which is why the revoke case below is meaningful.
   */
  it('item 21 (round341): a discussion manager can do EVERY action on any decision of their discussion', () => {
    for (const role of ['lead', 'coordinator', 'creator']) {
      const ctx = {
        item: decision({ creator: [person(OTHER)], decider: [person(OTHER)], affected: [] }),
        discussion: disc({ [role]: [person(ME)] }),
        currentUserId: ME,
      };
      for (const cap of ALL_DECISION_CAPS) {
        expect(resolveCan(cap, ctx, opts)).toBe(true);
      }
    }
  });

  // …and the owner can take it back. Being part of the union rather than an early return
  // is what makes an unchecked box actually revoke, in both directions.
  it('item 21 (round341): an explicit false on the discussion role revokes it', () => {
    const perms = {
      enabled: true,
      version: 1,
      roles: { 'discussions:discussionLeadID': { capabilities: { deleteDecision: false } } },
    };
    const ctx = {
      item: decision({ creator: [person(OTHER)], decider: [person(OTHER)], affected: [] }),
      discussion: disc({ lead: [person(ME)] }),
      currentUserId: ME,
    };
    expect(resolveCan('deleteDecision', ctx, { permissions: perms, canManageSettings: false })).toBe(false);
  });

  // A stranger to BOTH the decision and the discussion still gets nothing — the new scan
  // widened who is entitled, not whether entitlement is checked at all.
  it('item 21 (round341): a user in no role of either board is still denied', () => {
    const ctx = {
      item: decision({ creator: [person(OTHER)], decider: [person(OTHER)], affected: [] }),
      discussion: disc({ lead: [person(OTHER)] }),
      currentUserId: ME,
    };
    expect(resolveCan('editDecisionName', ctx, opts)).toBe(false);
    expect(resolveCan('deleteDecision', ctx, opts)).toBe(false);
  });

  it('item 20: viewDiscussion is role-gated — participants and role-holders view, a stranger is denied', () => {
    expect(resolveCan('viewDiscussion', { discussion: disc({ participants: [person(ME)] }), currentUserId: ME }, opts)).toBe(true);
    expect(resolveCan('viewDiscussion', { discussion: disc({ lead: [person(ME)] }), currentUserId: ME }, opts)).toBe(true);
    expect(resolveCan('viewDiscussion', { discussion: disc({ creator: [person(OTHER)] }), currentUserId: ME }, opts)).toBe(false);
  });

  it('item 20 safety valves: an UNREADY discussion and an UNSEEDED roles map both keep view allow-all', () => {
    // unready — people columns not loaded yet: never flash a "no access" state
    expect(resolveCan('viewDiscussion', { discussion: unloadedDisc, currentUserId: ME }, opts)).toBe(true);
    // roles map with no discussions:* rows (owner never opened the permissions
    // tab): keep today's allow-all rather than locking everyone out
    const unseeded = { permissions: { enabled: true, version: 1, roles: {} }, canManageSettings: false };
    expect(resolveCan('viewDiscussion', { discussion: disc({ creator: [person(OTHER)] }), currentUserId: ME }, unseeded)).toBe(true);
  });

  it('a user who holds no role is denied edit (default-deny) AND — item 20 — denied view on a seeded instance', () => {
    const ctx = { discussion: disc({ creator: [person(OTHER)] }), currentUserId: ME };
    expect(resolveCan('editDiscussionFields', ctx, opts)).toBe(false);
    expect(resolveCan('viewDiscussion', ctx, opts)).toBe(false);
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
    // permissions enabled, but roles map is EMPTY → caps inherit CAPABILITY_DEFAULTS.
    // A creatorLeadOwner-default cap (editDiscussionFields) denies a non-creator/lead
    // participant; createTask default = 'all' (round291) → allowed for everyone;
    // viewDiscussion → allowed via the unseeded-roles safety valve.
    const opts = { permissions: { enabled: true, version: 1, roles: {} }, canManageSettings: false, isAdmin: false };
    const ctx = { discussion: disc({ participants: [person(ME)] }), currentUserId: ME };
    expect(() => resolveCan('editDiscussionFields', ctx, opts)).not.toThrow();
    expect(resolveCan('editDiscussionFields', ctx, opts)).toBe(false);
    expect(resolveCan('createTask', ctx, opts)).toBe(true);
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
          // round209 — the box-view caps are view-LIKE: allow-all in fail-open
          // and never ready-gated (the panes were visible to every viewer today).
          const isView = cap === 'viewDiscussion'
            || cap === 'viewReferencesBox' || cap === 'viewSummaryBox';
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

// --- B. Revoke — union semantics (owner decision 2026-07-14): an explicit
// grant from ANY held role WINS; an explicit false only revokes inherited
// defaults. Rationale: PermissionsTab writes explicit false for every
// UNCHECKED box, so deny-wins collapsed multi-role users to the INTERSECTION
// of their roles' checkboxes (e.g. a decision creator who is also listed as
// affected lost editDecisionAffected). Union restores "roles add abilities".
describe('B. revoke (feature on) — explicit grant wins; explicit false only kills defaults', () => {
  it('role A grants addTopicOrPoint, user holds only A → ALLOW', () => {
    const opts = { permissions: enabledRoles({ 'discussions:participantsID': { capabilities: { addTopicOrPoint: true } } }) };
    const ctx = { discussion: disc({ participants: [person(ME)] }), currentUserId: ME };
    expect(resolveCan('addTopicOrPoint', ctx, opts)).toBe(true);
  });

  it('role A grants + role B denies (both held) → ALLOW (union: the grant survives)', () => {
    // participants grants editSummary, lead denies it, user holds BOTH.
    // strictCreatorLead:true removes the creator/lead override from the
    // picture and isolates the role scan itself.
    const opts = {
      permissions: enabledRoles(
        {
          'discussions:participantsID': { capabilities: { addTopicOrPoint: true } },
          'discussions:discussionLeadID': { capabilities: { addTopicOrPoint: false } },
        },
        { strictCreatorLead: true }
      ),
    };
    const ctx = { discussion: disc({ participants: [person(ME)], lead: [person(ME)] }), currentUserId: ME };
    expect(resolveCan('addTopicOrPoint', ctx, opts)).toBe(true);
  });

  it('explicit false on a held role still kills an INHERITED default from another held role', () => {
    // Neither role explicitly grants; the creator role would inherit the
    // creatorLeadOwner default (grant), but participants carries an explicit
    // false → the default-grant is vetoed. strict mode isolates the scan.
    const opts = {
      permissions: enabledRoles(
        {
          'discussions:participantsID': { capabilities: { addTopicOrPoint: false } },
          'discussions:discussionCreatorID': { capabilities: {} },
        },
        { strictCreatorLead: true }
      ),
    };
    const ctx = { discussion: disc({ creator: [person(ME)], participants: [person(ME)] }), currentUserId: ME };
    expect(resolveCan('addTopicOrPoint', ctx, opts)).toBe(false);
  });

  it('role A grants + role B undefined→default → ALLOW (no explicit false present)', () => {
    const opts = {
      permissions: enabledRoles({
        'discussions:participantsID': { capabilities: { addTopicOrPoint: true } },
        'discussions:discussionLeadID': { capabilities: {} },
      }),
    };
    // user holds participants only → single grant, no veto.
    const ctx = { discussion: disc({ participants: [person(ME)] }), currentUserId: ME };
    expect(resolveCan('addTopicOrPoint', ctx, opts)).toBe(true);
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

  it('task cap editTaskStatus:false on a task role the user holds → DENY (discussion-role override does NOT apply to a task-only user)', () => {
    // Task caps are excluded from the DISCUSSION creator/lead CONTENT override
    // (that override is discussion-tier only). round249 added a SEPARATE override
    // for the discussion's creator/lead/coordinator on in-discussion tasks — but
    // here ME holds NO discussion role (creator/lead are OTHER), only the task
    // creator role with an explicit false, so that override doesn't fire and the
    // explicit revoke denies.
    const opts = {
      permissions: enabledRoles({ 'tasks:taskCreatorID': { capabilities: { editTaskStatus: false } } }),
    };
    const ctx = {
      boardKey: 'tasks',
      discussion: disc({ creator: [person(OTHER)], lead: [person(OTHER)] }),
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

  it('feature on: an explicit grant on one held role survives an explicit false on another (union)', () => {
    const perms = {
      enabled: true,
      version: 1,
      roles: {
        'tasks:taskCreatorID': { capabilities: { editTaskDeadline: true } },
        'tasks:responsibilityID': { capabilities: { editTaskDeadline: false } },
      },
    };
    const ctx = { item: task({ creator: [person(ME)], responsible: [person(ME)] }), currentUserId: ME };
    expect(resolveCan('editTaskDeadline', ctx, { permissions: perms, canManageSettings: false })).toBe(true);
    // the explicit false still fully denies a user who holds ONLY that role
    const onlyResponsible = { item: task({ creator: [person(OTHER)], responsible: [person(ME)] }), currentUserId: ME };
    expect(resolveCan('editTaskDeadline', onlyResponsible, { permissions: perms, canManageSettings: false })).toBe(false);
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

  // round340 (owner spec) — the decider now gets deleteDecision too.
  it('feature on + seed: the decider gets EVERY decision cap, delete included', () => {
    const ctx = { item: decision({ decider: [person(ME)] }), currentUserId: ME };
    for (const cap of [...DECISION_EDIT_CAPS, 'deleteDecision']) {
      expect(resolveCan(cap, ctx, on)).toBe(true);
    }
  });

  /*
   * round341 — the discussion CREATOR now DOES reach decision caps, which is a deliberate
   * reversal of what this test used to pin. It is not the old content override leaking
   * into the item tier, though: it arrives through the seeded
   * `discussions:discussionCreatorID` role that TIER_EXTRA_ROLE_SOURCES makes the decision
   * tier scan. The distinction is visible in the second half — a discussion role that is
   * NOT declared as a decision role source (משתתפים) still gets nothing.
   */
  it('feature on: a discussion MANAGER reaches decision caps; a participant does not', () => {
    const managerCtx = {
      discussion: disc({ creator: [person(ME)] }),
      item: decision({ creator: [person(OTHER)], decider: [person(OTHER)] }),
      currentUserId: ME,
    };
    expect(resolveCan('editDecisionStatus', managerCtx, on)).toBe(true);
    expect(resolveCan('deleteDecision', managerCtx, on)).toBe(true);

    const participantCtx = {
      discussion: disc({ participants: [person(ME)] }),
      item: decision({ creator: [person(OTHER)], decider: [person(OTHER)] }),
      currentUserId: ME,
    };
    expect(resolveCan('editDecisionStatus', participantCtx, on)).toBe(false);
    expect(resolveCan('deleteDecision', participantCtx, on)).toBe(false);
  });

  /*
   * The personal "ההחלטות שלי" surface has NO discussion in ctx, so the same grant has to
   * come off the row's own `__discussionRoles` stamp. Asserting it here is what stops the
   * two decision surfaces from disagreeing — a manager who can act in the החלטות tab and
   * silently cannot in their personal list.
   */
  it('feature on: the manager grant also arrives via __discussionRoles (no discussion in ctx)', () => {
    const row = {
      ...decision({ creator: [person(OTHER)], decider: [person(OTHER)] }),
      __discussionRoles: {
        discussionCreatorID: [], discussionCoordinatorID: [], discussionLeadID: [person(ME)],
      },
    };
    expect(resolveCan('editDecisionStatus', { item: row, currentUserId: ME }, on)).toBe(true);
    expect(resolveCan('deleteDecision', { item: row, currentUserId: ME }, on)).toBe(true);
  });

  it('feature on: an explicit grant on one held decision role survives an explicit false on another (union)', () => {
    const perms = {
      enabled: true,
      version: 1,
      roles: {
        'decisions:decisionCreatorID': { capabilities: { editDecisionDate: true } },
        'decisions:deciderID': { capabilities: { editDecisionDate: false } },
      },
    };
    const ctx = { item: decision({ creator: [person(ME)], decider: [person(ME)] }), currentUserId: ME };
    expect(resolveCan('editDecisionDate', ctx, { permissions: perms, canManageSettings: false })).toBe(true);
    // the explicit false still fully denies a user who holds ONLY the decider role
    const onlyDecider = { item: decision({ creator: [person(OTHER)], decider: [person(ME)] }), currentUserId: ME };
    expect(resolveCan('editDecisionDate', onlyDecider, { permissions: perms, canManageSettings: false })).toBe(false);
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

// ===========================================================================
// resolveCan — task tier: the discussion's creator/lead/coordinator may EDIT
// any in-discussion task (round249, owner approval) — mirrors the decision
// override; delete stays with the matrix / task owner.
// ===========================================================================
describe('resolveCan — task tier: discussion manager edits in-discussion tasks (round249)', () => {
  const on = { permissions: ENABLED_SEEDED, canManageSettings: false };
  const TASK_EDIT_CAPS = ['editTaskStatus', 'editTaskPriority', 'editTaskDeadline', 'editTaskAssignee', 'editTaskName'];

  it('the discussion LEAD (manager) may edit any task of the discussion, but NOT delete it', () => {
    // ME leads the discussion but is neither the task creator nor its responsible.
    const ctx = {
      discussion: disc({ lead: [person(ME)] }),
      item: task({ creator: [person(OTHER)], responsible: [person(OTHER)] }),
      currentUserId: ME,
    };
    for (const cap of TASK_EDIT_CAPS) expect(resolveCan(cap, ctx, on)).toBe(true);
    expect(resolveCan('deleteTask', ctx, on)).toBe(false);
  });

  it('a user who is neither a discussion role nor the task owner cannot edit the task', () => {
    const ctx = {
      discussion: disc({ lead: [person(OTHER)] }),
      item: task({ creator: [person(OTHER)], responsible: [person(OTHER)] }),
      currentUserId: ME,
    };
    for (const cap of TASK_EDIT_CAPS) expect(resolveCan(cap, ctx, on)).toBe(false);
  });
});

// ===========================================================================
// resolveCan — decision "מושפעים" (affected) role. affectedID is a role source
// (PERMISSION_ROLE_SOURCES.decisions), so a user in the affected people column
// is recognized as the least-privileged decision role: STATUS edit only.
// ===========================================================================
describe('resolveCan — decision "affected" (מושפעים) role', () => {
  const on = { permissions: ENABLED_SEEDED, canManageSettings: false };

  /*
   * round340 (owner spec: "ולמושפעים אין שום הרשאה") — the affected role grants
   * NOTHING now, status included. It used to grant editDecisionStatus, which let any
   * stakeholder mark someone else's decision done.
   */
  it('feature on + seed: an affected user may edit NOTHING at all', () => {
    const ctx = { item: decision({ affected: [person(ME)] }), currentUserId: ME };
    for (const cap of ['editDecisionStatus', 'editDecisionTracking', 'editDecisionPriority', 'editDecisionDate', 'editDecisionAffected', 'editDecisionName', 'deleteDecision']) {
      expect(resolveCan(cap, ctx, on)).toBe(false);
    }
  });

  /*
   * The explicit `false`s are not the same as "no seed entry": they VETO the
   * 'creatorLeadOwner' default bucket. Without them an affected user would reach
   * isItemSelfRole, which scans every decisions role source — including affectedID —
   * and would hand back exactly the grant the owner asked to remove.
   */
  it('affected-only stays denied even though affectedID is itself a scanned self-role', () => {
    const ctx = { item: decision({ affected: [person(ME)] }), currentUserId: ME };
    const strangerCtx = { item: decision({ affected: [person(OTHER)] }), currentUserId: ME };
    expect(resolveCan('editDecisionStatus', ctx, on)).toBe(false);
    expect(resolveCan('editDecisionStatus', strangerCtx, on)).toBe(false);
  });

  it('union: the decider grant (editDecisionName:true) survives the affected revoke when a user holds BOTH', () => {
    // The reported bug (item 5, 2026-07-14): decider/creator are usually also
    // listed as affected; the old deny-wins veto stripped their own grants.
    const ctx = { item: decision({ decider: [person(ME)], affected: [person(ME)] }), currentUserId: ME };
    expect(resolveCan('editDecisionName', ctx, on)).toBe(true);
    // status is granted by BOTH roles → allowed either way.
    expect(resolveCan('editDecisionStatus', ctx, on)).toBe(true);
    // affected-only user: the seed's explicit false still denies.
    const onlyAffected = { item: decision({ decider: [person(OTHER)], affected: [person(ME)] }), currentUserId: ME };
    expect(resolveCan('editDecisionName', onlyAffected, on)).toBe(false);
  });
});
