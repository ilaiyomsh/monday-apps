/*
 * round367 §3 — the auto discussion name for template-mode creation:
 * "<template name> - <DD.MM.YYYY>", where the date mirrors the card's date
 * field. The sync contract (owner spec): a date change rewrites ONLY the
 * trailing date digits, and only while the name still ends with the date the
 * card last wrote — once the user removed or altered that suffix, the name is
 * never touched again (people who chose their own name must not have it
 * "corrected" under their hands).
 */

// 'yyyy-mm-dd' (the <input type="date"> value) → 'DD.MM.YYYY' for display.
export function formatNameDate(dateInput) {
  if (typeof dateInput !== 'string' || !dateInput) return '';
  const [y, m, d] = dateInput.split('-');
  if (!y || !m || !d) return '';
  return `${d}.${m}.${y}`;
}

export function buildAutoName(templateName, dateInput) {
  const dateStr = formatNameDate(dateInput);
  return dateStr ? `${templateName} - ${dateStr}` : String(templateName ?? '');
}

/*
 * Returns { name, dateStr } when the trailing date should be rewritten, or
 * null when the name must be left alone (suffix removed/changed, or no auto
 * date was ever written).
 */
export function syncTrailingDate(name, lastDateStr, newDateInput) {
  if (!lastDateStr || typeof name !== 'string') return null;
  if (!name.endsWith(lastDateStr)) return null;
  const dateStr = formatNameDate(newDateInput);
  if (!dateStr) return null;
  return {
    name: name.slice(0, name.length - lastDateStr.length) + dateStr,
    dateStr,
  };
}
