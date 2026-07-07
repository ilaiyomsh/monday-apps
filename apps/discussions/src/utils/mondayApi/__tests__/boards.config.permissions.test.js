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
  'editDiscussionFields',
  'editSummary',
  'exportDocs',
  'createTask',
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
const SYSTEM_CAPS = ['createDiscussion', 'reorderColumns', 'manageTemplates', 'addDiscussionTypes', 'saveViewDefaults'];
const ALL_CAPS = [...DISC_CAPS, ...TASK_CAPS, ...SYSTEM_CAPS];

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
      expect(['disc', 'task', 'system']).toContain(c.tier);
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
    // view + createDiscussion + manageTemplates = all
    expect(CAPABILITY_DEFAULTS.viewDiscussion).toBe('all');
    expect(CAPABILITY_DEFAULTS.createDiscussion).toBe('all');
    expect(CAPABILITY_DEFAULTS.manageTemplates).toBe('all');
    // reorderColumns + addDiscussionTypes + saveViewDefaults = owner
    expect(CAPABILITY_DEFAULTS.reorderColumns).toBe('owner');
    expect(CAPABILITY_DEFAULTS.addDiscussionTypes).toBe('owner');
    expect(CAPABILITY_DEFAULTS.saveViewDefaults).toBe('owner');
    // all discussion-content edits + task edits = creatorLeadOwner
    [...DISC_CAPS.filter((id) => id !== 'viewDiscussion'), ...TASK_CAPS].forEach((id) =>
      expect(CAPABILITY_DEFAULTS[id]).toBe('creatorLeadOwner')
    );
  });
});

describe('PERMISSION_ROLE_SOURCES', () => {
  it('lists the people-column role aliases per board', () => {
    expect(PERMISSION_ROLE_SOURCES).toEqual({
      discussions: ['discussionCreatorID', 'discussionLeadID', 'discussionCoordinatorID', 'participantsID'],
      tasks: ['taskCreatorID', 'responsibilityID'],
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

  it('participants: view/export/createTask/addTopicOrPoint/checkPoint/editResponses on; field/summary/edit/delete off', () => {
    const caps = DEFAULT_PERMISSION_SEED['discussions:participantsID'].capabilities;
    expect(caps.viewDiscussion).toBe(true);
    expect(caps.exportDocs).toBe(true);
    expect(caps.createTask).toBe(true);
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

  it('seeded capability ids are all real catalog ids', () => {
    for (const role of Object.values(DEFAULT_PERMISSION_SEED)) {
      for (const capId of Object.keys(role.capabilities)) {
        expect(ALL_CAPS).toContain(capId);
      }
    }
  });
});
