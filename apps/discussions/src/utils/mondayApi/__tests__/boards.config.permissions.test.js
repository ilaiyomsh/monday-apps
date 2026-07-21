import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PERMISSIONS,
  CAPABILITY_DEFAULTS,
  CAPABILITIES,
  PERMISSION_ROLE_SOURCES,
  DEFAULT_PERMISSION_SEED,
  COLUMN_SCHEMA,
} from '../boards.config.js';

// Capability ids from the spec catalog (single source of truth for this test).
const DISC_CAPS = [
  'viewDiscussion',
  // round209 — per-role view gates for the triple-box panes (owner spec).
  'viewReferencesBox',
  'viewSummaryBox',
  'editDiscussionFields',
  'editSummary',
  'exportDocs',
  'createTask',
  // Creating a decision lives in the DISCUSSION (its "החלטות" card), so it is a
  // disc-tier capability — like createTask.
  'createDecision',
  'addTopicOrPoint',
  'editTopicOrPoint',
  'deleteTopicOrPoint',
  'checkPoint',
  'editResponses',
];
const TASK_CAPS = [
  'editTaskStatus',
  'editTaskPriority',
  'editTaskDeadline',
  'editTaskAssignee',
  'editTaskName',
  'deleteTask',
];
// Decision-tier caps resolve from the DECISION's own people columns
// (decisionCreatorID / deciderID), mirroring the task tier.
const DECISION_CAPS = [
  'editDecisionStatus',
  'editDecisionPriority',
  'editDecisionDate',
  'editDecisionAffected',
  'editDecisionName',
  'deleteDecision',
];
const SYSTEM_CAPS = ['createDiscussion', 'reorderColumns', 'manageTemplates', 'addDiscussionTypes', 'saveViewDefaults'];
const ALL_CAPS = [...DISC_CAPS, ...TASK_CAPS, ...DECISION_CAPS, ...SYSTEM_CAPS];

describe('DEFAULT_PERMISSIONS', () => {
  it('is the inert fail-open blob (enabled:false, version 1, empty roles)', () => {
    expect(DEFAULT_PERMISSIONS).toEqual({ enabled: false, version: 1, roles: {} });
  });
});

describe('CAPABILITIES catalog', () => {
  it('covers EVERY capability id in the spec, exactly once', () => {
    const ids = CAPABILITIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length); // no dupes
    expect(ids.sort()).toEqual([...ALL_CAPS].sort());
  });

  it('every entry has id/tier/group/label of the right shape', () => {
    for (const c of CAPABILITIES) {
      expect(typeof c.id).toBe('string');
      expect(['disc', 'task', 'decision', 'system']).toContain(c.tier);
      expect(typeof c.group).toBe('string');
      expect(c.group.length).toBeGreaterThan(0);
      expect(typeof c.label).toBe('string');
      expect(c.label.length).toBeGreaterThan(0);
    }
  });

  it('assigns the correct tier per capability', () => {
    const tierOf = Object.fromEntries(CAPABILITIES.map((c) => [c.id, c.tier]));
    DISC_CAPS.forEach((id) => expect(tierOf[id]).toBe('disc'));
    TASK_CAPS.forEach((id) => expect(tierOf[id]).toBe('task'));
    DECISION_CAPS.forEach((id) => expect(tierOf[id]).toBe('decision'));
    SYSTEM_CAPS.forEach((id) => expect(tierOf[id]).toBe('system'));
  });

  it('does NOT include openSettings (hard-locked outside the matrix)', () => {
    expect(CAPABILITIES.map((c) => c.id)).not.toContain('openSettings');
  });
});

describe('CAPABILITY_DEFAULTS', () => {
  it('has a fallback for every capability and no extras', () => {
    expect(Object.keys(CAPABILITY_DEFAULTS).sort()).toEqual([...ALL_CAPS].sort());
  });

  it('uses only valid scopes', () => {
    for (const v of Object.values(CAPABILITY_DEFAULTS)) {
      expect(['owner', 'creatorLeadOwner', 'all']).toContain(v);
    }
  });

  it('matches the spec fallbacks', () => {
    // item 20 (2026-07-14): view is now ROLE-GATED (participants view via the
    // seed; strangers are denied) — no longer 'all'.
    expect(CAPABILITY_DEFAULTS.viewDiscussion).toBe('creatorLeadOwner');
    // round209 — the box-view caps default 'all' (existing stored role maps
    // lack these keys and must keep today's everyone-sees behavior); the
    // resolver deliberately routes them through the role scan so an explicit
    // false still hides (see usePermission BOX_VIEW_CAPS).
    expect(CAPABILITY_DEFAULTS.viewReferencesBox).toBe('all');
    expect(CAPABILITY_DEFAULTS.viewSummaryBox).toBe('all');
    // createDiscussion + manageTemplates = all
    expect(CAPABILITY_DEFAULTS.createDiscussion).toBe('all');
    expect(CAPABILITY_DEFAULTS.manageTemplates).toBe('all');
    // reorderColumns + addDiscussionTypes + saveViewDefaults = owner
    expect(CAPABILITY_DEFAULTS.reorderColumns).toBe('owner');
    expect(CAPABILITY_DEFAULTS.addDiscussionTypes).toBe('owner');
    expect(CAPABILITY_DEFAULTS.saveViewDefaults).toBe('owner');
    // all discussion-content edits + task edits + decision edits = creatorLeadOwner
    const viewLike = new Set(['viewDiscussion', 'viewReferencesBox', 'viewSummaryBox']);
    [...DISC_CAPS.filter((id) => !viewLike.has(id)), ...TASK_CAPS, ...DECISION_CAPS].forEach((id) =>
      expect(CAPABILITY_DEFAULTS[id]).toBe('creatorLeadOwner')
    );
  });
});

describe('PERMISSION_ROLE_SOURCES', () => {
  it('lists the people-column role aliases per board', () => {
    expect(PERMISSION_ROLE_SOURCES).toEqual({
      discussions: ['discussionCreatorID', 'discussionLeadID', 'discussionCoordinatorID', 'participantsID'],
      // item 19 (2026-07-14): the tasks board gained יכולת צפייה (viewers) +
      // יכולת עריכה (editors) people columns, auto-filled at task creation and
      // acting as first-class roles (viewers = read-only, editors = full edit).
      tasks: ['taskCreatorID', 'responsibilityID', 'taskViewersID', 'taskEditorsID'],
      // decisions now includes affectedID ("מושפעים") as a first-class role source.
      decisions: ['decisionCreatorID', 'deciderID', 'affectedID'],
    });
  });

  it('every role alias is a real people column in COLUMN_SCHEMA', () => {
    for (const [boardKey, aliases] of Object.entries(PERMISSION_ROLE_SOURCES)) {
      for (const alias of aliases) {
        expect(COLUMN_SCHEMA[boardKey]?.[alias]?.type).toBe('people');
      }
    }
  });
});

describe('DEFAULT_PERMISSION_SEED (LOCKED defaults)', () => {
  it('is keyed by ${boardKey}:${alias} for every role source', () => {
    const expectedKeys = Object.entries(PERMISSION_ROLE_SOURCES)
      .flatMap(([board, aliases]) => aliases.map((a) => `${board}:${a}`))
      .sort();
    expect(Object.keys(DEFAULT_PERMISSION_SEED).sort()).toEqual(expectedKeys);
  });

  it('discussion creator + lead + coordinator grant ALL discussion caps', () => {
    for (const key of ['discussions:discussionCreatorID', 'discussions:discussionLeadID', 'discussions:discussionCoordinatorID']) {
      const caps = DEFAULT_PERMISSION_SEED[key].capabilities;
      DISC_CAPS.forEach((id) => expect(caps[id]).toBe(true));
    }
  });

  it('participants: view/export/createTask/createDecision/addTopicOrPoint/checkPoint/editResponses on; field/summary/edit/delete off', () => {
    const caps = DEFAULT_PERMISSION_SEED['discussions:participantsID'].capabilities;
    expect(caps.viewDiscussion).toBe(true);
    expect(caps.exportDocs).toBe(true);
    expect(caps.createTask).toBe(true);
    expect(caps.createDecision).toBe(true); // createDecision mirrors createTask per role
    expect(caps.addTopicOrPoint).toBe(true);
    expect(caps.checkPoint).toBe(true);
    expect(caps.editResponses).toBe(true);
    expect(caps.editDiscussionFields).toBe(false);
    expect(caps.editSummary).toBe(false);
    expect(caps.editTopicOrPoint).toBe(false);
    expect(caps.deleteTopicOrPoint).toBe(false);
  });

  it('task creator grants ALL task caps', () => {
    const caps = DEFAULT_PERMISSION_SEED['tasks:taskCreatorID'].capabilities;
    TASK_CAPS.forEach((id) => expect(caps[id]).toBe(true));
  });

  it('responsible: status + priority on; deadline/assignee/name/delete off', () => {
    const caps = DEFAULT_PERMISSION_SEED['tasks:responsibilityID'].capabilities;
    expect(caps.editTaskStatus).toBe(true);
    expect(caps.editTaskPriority).toBe(true);
    expect(caps.editTaskDeadline).toBe(false);
    expect(caps.editTaskAssignee).toBe(false);
    expect(caps.editTaskName).toBe(false);
    expect(caps.deleteTask).toBe(false);
  });

  it('task editors (יכולת עריכה) grant ALL task caps; task viewers (יכולת צפייה) grant NONE (item 19)', () => {
    const editors = DEFAULT_PERMISSION_SEED['tasks:taskEditorsID'].capabilities;
    TASK_CAPS.forEach((id) => expect(editors[id]).toBe(true));
    const viewers = DEFAULT_PERMISSION_SEED['tasks:taskViewersID'].capabilities;
    TASK_CAPS.forEach((id) => expect(viewers[id]).toBe(false));
  });

  it('discussion creator + lead + coordinator + participants may create decisions', () => {
    for (const key of [
      'discussions:discussionCreatorID',
      'discussions:discussionLeadID',
      'discussions:discussionCoordinatorID',
      'discussions:participantsID',
    ]) {
      expect(DEFAULT_PERMISSION_SEED[key].capabilities.createDecision).toBe(true);
    }
  });

  it('decision creator grants ALL decision caps (incl. deleteDecision)', () => {
    const caps = DEFAULT_PERMISSION_SEED['decisions:decisionCreatorID'].capabilities;
    DECISION_CAPS.forEach((id) => expect(caps[id]).toBe(true));
  });

  it('decider (מחליט): edits everything; NOT delete', () => {
    const caps = DEFAULT_PERMISSION_SEED['decisions:deciderID'].capabilities;
    expect(caps.editDecisionStatus).toBe(true);
    expect(caps.editDecisionPriority).toBe(true);
    expect(caps.editDecisionDate).toBe(true);
    expect(caps.editDecisionAffected).toBe(true);
    expect(caps.editDecisionName).toBe(true);
    expect(caps.deleteDecision).toBe(false);
  });

  it('affected (מושפעים): the least-privileged decision role — status edit on; priority/date/affected/name/delete off', () => {
    const caps = DEFAULT_PERMISSION_SEED['decisions:affectedID'].capabilities;
    expect(caps.editDecisionStatus).toBe(true);
    expect(caps.editDecisionPriority).toBe(false);
    expect(caps.editDecisionDate).toBe(false);
    expect(caps.editDecisionAffected).toBe(false);
    expect(caps.editDecisionName).toBe(false);
    expect(caps.deleteDecision).toBe(false);
  });

  it('seeded capability ids are all real catalog ids', () => {
    for (const role of Object.values(DEFAULT_PERMISSION_SEED)) {
      for (const capId of Object.keys(role.capabilities)) {
        expect(ALL_CAPS).toContain(capId);
      }
    }
  });
});
