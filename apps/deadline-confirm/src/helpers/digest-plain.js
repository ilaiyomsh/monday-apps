// V6 text/plain digest renderer (docs/v6-amp-only-decisions.md §5).
//
// AMP for Email requires a fallback part — "AMP-only" means the second part
// becomes NON-ACTIONABLE, not absent. This renders that part: the task list
// plus one line pointing the reader at monday.com. It must carry NO
// credential of any kind — no links, no signatures, no secret — leaving a
// /confirm-style link here would undo D2 and D3 entirely. No HTML either:
// this is the text/plain MIME part.

/** YYYY-MM-DD → DD/MM/YYYY (unset → ''). */
function formatDate(date) {
  if (!date) return '';
  const [y, m, d] = date.split('-');
  if (!y || !m || !d) return date;
  return `${d}/${m}/${y}`;
}

/**
 * Render one recipient's digest as plain text.
 * @param {{ name: string, sections: Array<{ title: string, dateColumnTitle?: string,
 *          tasks: Array<{ itemId: string, name: string, date: string|null, statusText?: string }> }> }} p.recipient
 * @returns {string}
 */
export function renderDigestPlain({ recipient }) {
  const lines = [`שלום ${recipient.name},`, 'אלו המשימות שממתינות לעדכון סטטוס:', ''];

  for (const section of recipient.sections) {
    if (section.tasks.length === 0) continue;
    lines.push(section.title);
    const dateHeader = section.dateColumnTitle && section.dateColumnTitle.length > 0 ? section.dateColumnTitle : 'תאריך';
    for (const task of section.tasks) {
      const parts = [`- ${task.name}`];
      const date = formatDate(task.date);
      if (date) parts.push(`${dateHeader}: ${date}`);
      if (task.statusText) parts.push(`סטטוס: ${task.statusText}`);
      lines.push(parts.join(' · '));
    }
    lines.push('');
  }

  lines.push('לעדכון המשימות היכנסו ל‑monday.com.');
  return lines.join('\n');
}
