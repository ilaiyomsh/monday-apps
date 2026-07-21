import { describe, it, expect } from 'vitest';
import { buildPermissionsSummaryModel, capStateText, FIXED_RULES } from '../permissionsSummaryDoc.js';

// round203 — pins the PURE model behind "הורדת סיכום הרשאות": effective
// capability states (explicit grant / explicit revoke / catalog default),
// role/tier structure and the fixed-rules block. The docx rendering itself is
// a lazy thin mapping over this model.

const roleGroups = [
  {
    tier: { id: 'disc', label: 'דיון', boardLabel: 'לוח דיונים' },
    roles: [
      { key: 'discussions:discussionLeadID', title: 'מנהל דיון' },
      { key: 'discussions:participantsID', title: 'משתתפים' },
    ],
  },
  {
    tier: { id: 'system', label: 'כללי', boardLabel: null },
    roles: [{ key: 'system:system', title: 'כללי' }],
  },
];

const permissions = {
  roles: {
    'discussions:discussionLeadID': {
      capabilities: { viewDiscussion: true, editSummary: true },
    },
    'discussions:participantsID': {
      hidden: true,
      capabilities: { viewDiscussion: true, editSummary: false },
    },
  },
  superMembers: [{ id: '9', name: 'דנה כהן' }],
};

describe('buildPermissionsSummaryModel', () => {
  it('maps explicit grant / explicit revoke / untouched-default per role', () => {
    const model = buildPermissionsSummaryModel({ permissions, roleGroups });
    const disc = model.tiers.find((t) => t.id === 'disc');
    const lead = disc.roles.find((r) => r.title === 'מנהל דיון');
    const participants = disc.roles.find((r) => r.title === 'משתתפים');

    expect(lead.caps.find((c) => c.label === 'עריכת סיכום').state).toBe('granted');
    expect(participants.caps.find((c) => c.label === 'עריכת סיכום').state).toBe('denied');
    // Untouched cap → inherits the catalog default (exportDocs: creatorLeadOwner).
    const untouched = lead.caps.find((c) => c.label === 'ייצוא');
    expect(untouched.state).toBe('default');
    expect(untouched.defaultLabel).toBe('יוצר/מנהל/בעלים');
  });

  it('carries hidden flags, super members and the fixed rules', () => {
    const model = buildPermissionsSummaryModel({ permissions, roleGroups });
    const disc = model.tiers.find((t) => t.id === 'disc');
    expect(disc.roles.find((r) => r.title === 'משתתפים').hidden).toBe(true);
    expect(disc.roles.find((r) => r.title === 'מנהל דיון').hidden).toBe(false);
    expect(model.superMembers).toEqual([{ id: '9', name: 'דנה כהן' }]);
    expect(model.fixedRules).toBe(FIXED_RULES);
    expect(model.fixedRules.some((r) => r.includes('שינוי שם הדיון'))).toBe(true);
  });

  it('keeps only capabilities of the role tier (system tier gets system caps only)', () => {
    const model = buildPermissionsSummaryModel({ permissions, roleGroups });
    const system = model.tiers.find((t) => t.id === 'system');
    const labels = system.roles[0].caps.map((c) => c.label);
    expect(labels).toContain('יצירת דיון');
    expect(labels.every((l) => l !== 'עריכת סיכום')).toBe(true);
  });
});

describe('capStateText', () => {
  it('renders the three states', () => {
    expect(capStateText({ state: 'granted' })).toBe('מוענק ✓');
    expect(capStateText({ state: 'denied' })).toBe('נשלל ✗');
    expect(capStateText({ state: 'default', defaultLabel: 'כל חברי הלוח' })).toBe('ברירת מחדל (כל חברי הלוח)');
  });
});
