/*
 * round203 — "הורדת סיכום הרשאות" (owner request): a Word document summarizing
 * the app's WHOLE permission surface —
 *   1. who's on the board (owners / members) + the app's חברי-על,
 *   2. per tier (דיון/משימה/החלטה/כללי) and per role (the board's people
 *      columns — מנהל דיון, מרכז דיון, משתתפים, …): every capability's
 *      effective state (granted / revoked / inherits the catalog default),
 *   3. the FIXED rules that live outside the matrix (title rename, the
 *      summary/references boxes, hide topic/point, settings access, חברי-על).
 *
 * buildPermissionsSummaryModel is PURE (testable); the docx generation lazy-
 * loads `docx` like the discussion export does.
 */
import { CAPABILITIES, CAPABILITY_DEFAULTS } from './mondayApi/boards.config.js';

// Human labels for the capability-catalog fallbacks (CAPABILITY_DEFAULTS).
const DEFAULT_LABELS = {
  owner: 'בעלי הלוח בלבד',
  creatorLeadOwner: 'יוצר/מנהל/בעלים',
  all: 'כל חברי הלוח',
};

// The FIXED rules enforced outside the capability matrix (kept in sync with
// the code sites: DiscussionCard canEditTitle/canEditSummaryBox/canHide…,
// SettingsModal owner gate, the super-members feature).
export const FIXED_RULES = [
  'שינוי שם הדיון מתוך הכותרת — יוצר הדיון, מנהל הדיון, מרכז הדיון ובעלי הלוח בלבד.',
  'בחירת הרכיבים המוצגים באפליקציה (טאב העדפות) — בעלי הלוח בלבד.',
  'עריכת תיבת הסיכום ותיבת ההתייחסויות — מרכז הדיון, יוצר הדיון, מנהל הדיון ובעלי הלוח.',
  'הסתרת נושא או נקודה ("לא לדיון") — מנהל הדיון, מרכז הדיון ובעלי הלוח.',
  'פתיחת הגדרות האפליקציה (מיפוי, תבנית ייצוא, הרשאות) — בעלי הלוח בלבד.',
  'חברי-על — משתמשים רגילים עם שתי יכולות נוספות: הוספת סוגי דיון וניהול תבניות.',
];

/**
 * Build the pure summary model.
 * @param permissions the stored permissions blob ({ roles, superMembers, … })
 * @param roleGroups PermissionsTab's buildRoleGroups output:
 *        [{ tier: { id, label, boardLabel }, roles: [{ key, title }] }]
 */
export function buildPermissionsSummaryModel({ permissions, roleGroups }) {
  const tiers = (roleGroups || [])
    .map(({ tier, roles }) => ({
      id: tier.id,
      title: tier.label,
      boardLabel: tier.boardLabel,
      roles: (roles || []).map((role) => ({
        title: role.title,
        hidden: permissions?.roles?.[role.key]?.hidden === true,
        caps: CAPABILITIES.filter((c) => c.tier === tier.id).map((cap) => {
          const v = permissions?.roles?.[role.key]?.capabilities?.[cap.id];
          return {
            label: cap.label,
            state: v === true ? 'granted' : v === false ? 'denied' : 'default',
            defaultLabel: DEFAULT_LABELS[CAPABILITY_DEFAULTS[cap.id]] || '—',
          };
        }),
      })),
    }))
    .filter((t) => t.roles.length && t.roles.some((r) => r.caps.length));
  return {
    tiers,
    superMembers: Array.isArray(permissions?.superMembers) ? permissions.superMembers : [],
    fixedRules: FIXED_RULES,
  };
}

// One capability row's display state.
export function capStateText(cap) {
  if (cap.state === 'granted') return 'מוענק ✓';
  if (cap.state === 'denied') return 'נשלל ✗';
  return `ברירת מחדל (${cap.defaultLabel})`;
}

/**
 * Generate the .docx and hand it to the browser as a download.
 * @param model buildPermissionsSummaryModel output
 * @param boardPeople { owners: [{name}], subscribers: [{name}] } | null
 */
export async function downloadPermissionsSummary(model, boardPeople) {
  const docx = await import('docx');
  const {
    Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
    Table, TableRow, TableCell, WidthType,
  } = docx;

  const run = (text, opts = {}) => new TextRun({ text, rightToLeft: true, ...opts });
  const para = (text, opts = {}) => new Paragraph({ bidirectional: true, children: [run(text)], ...opts });
  const heading = (text, level) => new Paragraph({ bidirectional: true, heading: level, children: [run(text)] });

  const children = [
    new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.CENTER,
      heading: HeadingLevel.HEADING_1,
      children: [run('סיכום הרשאות — ניהול דיונים')],
    }),
    para(`הופק בתאריך ${new Date().toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' })}`, { alignment: AlignmentType.CENTER }),
  ];

  // ---- board membership ----
  children.push(heading('אנשים בלוח', HeadingLevel.HEADING_2));
  const owners = boardPeople?.owners || [];
  const ownerIds = new Set(owners.map((p) => String(p.id)));
  const members = (boardPeople?.subscribers || []).filter((p) => !ownerIds.has(String(p.id)));
  const names = (list) => (list.length ? list.map((p) => p.name).join(', ') : '—');
  children.push(para(`בעלי הלוח (owners): ${names(owners)}`));
  children.push(para(`חברי הלוח (members): ${names(members)}`));
  children.push(para(`חברי-על (super members): ${names(model.superMembers)}`));

  // ---- fixed rules ----
  children.push(heading('כללים קבועים (מחוץ למטריצה)', HeadingLevel.HEADING_2));
  model.fixedRules.forEach((rule) => children.push(para(`• ${rule}`)));

  // ---- per tier / role matrices ----
  for (const tier of model.tiers) {
    children.push(heading(
      tier.boardLabel ? `${tier.title} (${tier.boardLabel})` : tier.title,
      HeadingLevel.HEADING_2
    ));
    for (const role of tier.roles) {
      children.push(heading(role.hidden ? `${role.title} (מוסתר — לא נאכף)` : role.title, HeadingLevel.HEADING_3));
      const cell = (text, bold = false) => new TableCell({
        width: { size: 50, type: WidthType.PERCENTAGE },
        children: [new Paragraph({ bidirectional: true, children: [run(text, bold ? { bold: true } : {})] })],
      });
      children.push(new Table({
        visuallyRightToLeft: true,
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({ children: [cell('יכולת', true), cell('מצב', true)] }),
          ...role.caps.map((cap) => new TableRow({ children: [cell(cap.label), cell(capStateText(cap))] })),
        ],
      }));
    }
  }

  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'סיכום-הרשאות.docx';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
