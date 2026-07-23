/*
 * round246 — group a permission tier's capabilities by their `group` field so
 * the matrix can render smart SUB-HEADINGS (owner request: settings that belong
 * to the same component sit together — discussion create/edit, topics & points,
 * tasks, decisions, …). Pure so it can be unit-tested.
 *
 * Order is first-seen: groups appear in the order their first capability appears
 * in the tier's capability list, and caps keep their order within a group.
 */

// Hebrew sub-heading label per capability group (a group with no entry falls
// back to its raw key so a newly-added group is still visible, just unlabeled).
export const CAP_GROUP_LABELS = {
  discussion: 'דיון — יצירה, עריכה ותוכן',
  topics: 'נושאים ונקודות',
  tasks: 'משימות',
  decisions: 'החלטות',
  decisionFields: 'שדות החלטה',
  system: 'מערכת',
};

/**
 * @param {Array<{id:string,label:string,group?:string}>} caps
 * @returns {Array<{group:string,label:string,caps:Array}>}
 */
export function groupCapabilities(caps) {
  const order = [];
  const byGroup = new Map();
  for (const c of Array.isArray(caps) ? caps : []) {
    const g = c.group || 'other';
    if (!byGroup.has(g)) { byGroup.set(g, []); order.push(g); }
    byGroup.get(g).push(c);
  }
  return order.map((g) => ({ group: g, label: CAP_GROUP_LABELS[g] || g, caps: byGroup.get(g) }));
}

export default groupCapabilities;
