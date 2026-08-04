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
  // round212 — the triple-box writes are matrix caps (labels: כתיבת רקע/התייחסויות/סיכום).
  'writeBackground',
  'writeReferences',
  'editSummary',
  'exportDocs',
  'createTask',
  // Creating a decision lives in the DISCUSSION (its "החלטות" card), so it is a
  // disc-tier capability — like createTask.
  'createDecision',
  'addTopicOrPoint',
  // round340 — edit/delete of a topic or point each split into a BEFORE and an
  // AFTER-discussed capability (owner spec).
  'editTopicOrPoint',
  'deleteTopicOrPoint',
  'editTopicOrPointDiscussed',
  'deleteTopicOrPointDiscussed',
  'checkPoint',
];
const TASK_CAPS = [
  'editTaskStatus',
  'editTaskPriority',
  'editTaskDeadline',
  'editTaskAssignee',
  // round305 — the שותפים (partnersID) people column added to "המשימות שלי".
  'editTaskPartners',
  'editTaskName',
  'deleteTask',
];
// Decision-tier caps resolve from the DECISION's own people columns
// (decisionCreatorID / deciderID), mirroring the task tier.
const DECISION_CAPS = [
  'editDecisionStatus',
  // round340 — מעקב החלטה split off editDecisionStatus into its own capability.
  'editDecisionTracking',
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
    // round291 — createTask defaults to 'all' (anyone can create a task, in a
    // discussion too), mirroring createDiscussion.
    expect(CAPABILITY_DEFAULTS.createTask).toBe('all');
    // all discussion-content edits + task edits + decision edits = creatorLeadOwner
    const exempt = new Set(['viewDiscussion', 'viewReferencesBox', 'viewSummaryBox', 'createTask']);
    [...DISC_CAPS.filter((id) => !exempt.has(id)), ...TASK_CAPS, ...DECISION_CAPS].forEach((id) =>
      expect(CAPABILITY_DEFAULTS[id]).toBe('creatorLeadOwner')
    );
  });
});

describe('PERMISSION_ROLE_SOURCES', () => {
  it('lists the people-column role aliases per board', () => {
    expect(PERMISSION_ROLE_SOURCES).toEqual({
      discussions: ['discussionCreatorID', 'discussionLeadID', 'discussionCoordinatorID', 'participantsID'],
      // item 19 (2026-07-14): the tasks board gained יכולת עריכה (taskEditorsID),
      // auto-filled at task creation and acting as a first-class full-edit role.
      // round340 retired its read-only twin taskViewersID.
      tasks: ['taskCreatorID', 'responsibilityID', 'taskEditorsID'],
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

  it('participants: view/export/createTask/createDecision/addTopicOrPoint/checkPoint on; field/summary/edit/delete off', () => {
    const caps = DEFAULT_PERMISSION_SEED['discussions:participantsID'].capabilities;
    expect(caps.viewDiscussion).toBe(true);
    expect(caps.createTask).toBe(true);
    expect(caps.createDecision).toBe(true); // createDecision mirrors createTask per role
    expect(caps.addTopicOrPoint).toBe(true);
    expect(caps.checkPoint).toBe(true);
    expect(caps.editDiscussionFields).toBe(false);
    expect(caps.editSummary).toBe(false);
    // round340 (owner spec) — exporting the discussion to a document is a publishing
    // act, not a participation one, so it left the participant seed.
    expect(caps.exportDocs).toBe(false);
    /*
     * round340 (owner spec) — a participant may edit or delete a topic/point while it
     * is still only a plan, and may NOT once it has been discussed. Both halves are
     * asserted together on purpose: granting "before" without revoking "after" is the
     * failure mode that would silently hand participants edit rights over the record
     * of a meeting that already happened.
     */
    expect(caps.editTopicOrPoint).toBe(true);
    expect(caps.deleteTopicOrPoint).toBe(true);
    expect(caps.editTopicOrPointDiscussed).toBe(false);
    expect(caps.deleteTopicOrPointDiscussed).toBe(false);
  });

  it('task creator grants ALL task caps', () => {
    const caps = DEFAULT_PERMISSION_SEED['tasks:taskCreatorID'].capabilities;
    TASK_CAPS.forEach((id) => expect(caps[id]).toBe(true));
  });

  it('responsible: status + priority + partners on; deadline/assignee/name/delete off', () => {
    const caps = DEFAULT_PERMISSION_SEED['tasks:responsibilityID'].capabilities;
    expect(caps.editTaskStatus).toBe(true);
    expect(caps.editTaskPriority).toBe(true);
    expect(caps.editTaskDeadline).toBe(false);
    expect(caps.editTaskAssignee).toBe(false);
    // round305 (owner spec) — the task's responsible MAY edit שותפים, even though
    // they may not reassign אחריות itself.
    expect(caps.editTaskPartners).toBe(true);
    expect(caps.editTaskName).toBe(false);
    expect(caps.deleteTask).toBe(false);
  });

  it('task editors (יכולת עריכה) grant ALL task caps (item 19)', () => {
    const editors = DEFAULT_PERMISSION_SEED['tasks:taskEditorsID'].capabilities;
    TASK_CAPS.forEach((id) => expect(editors[id]).toBe(true));
  });

  // round340 — the retired viewers role must leave no seed entry behind. The
  // `is keyed by ${boardKey}:${alias}` test above already pins the key SET, but this
  // states the retirement itself so the reason survives the next refactor.
  it('the retired task viewers role has NO seed entry', () => {
    expect(DEFAULT_PERMISSION_SEED).not.toHaveProperty('tasks:taskViewersID');
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

  // round340 (owner spec) — "the decision creator and the decider get ALL the
  // permissions", delete included; the decider used to be barred from delete alone.
  it('decider (מחליט): grants EVERY decision cap, delete included', () => {
    const caps = DEFAULT_PERMISSION_SEED['decisions:deciderID'].capabilities;
    DECISION_CAPS.forEach((id) => expect(caps[id]).toBe(true));
  });

  /*
   * round340 (owner spec: "ולמושפעים אין שום הרשאה") — being listed as affected by a
   * decision is being told about it, not being given a say in it. The role used to
   * grant editDecisionStatus, which let any stakeholder mark someone else's decision
   * done; every cap is now an EXPLICIT false, which also vetoes the
   * 'creatorLeadOwner' default bucket so nothing leaks back in through the
   * item-tier self-role scan.
   */
  it('affected (מושפעים): grants NOTHING — every decision cap explicitly false', () => {
    const caps = DEFAULT_PERMISSION_SEED['decisions:affectedID'].capabilities;
    DECISION_CAPS.forEach((id) => expect(caps[id]).toBe(false));
  });

  it('seeded capability ids are all real catalog ids', () => {
    for (const role of Object.values(DEFAULT_PERMISSION_SEED)) {
      for (const capId of Object.keys(role.capabilities)) {
        expect(ALL_CAPS).toContain(capId);
      }
    }
  });
});
