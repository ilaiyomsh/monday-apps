/*
 * round372 — filter-menu options for a custom STATUS dimension.
 *
 * The other value dims compare TEXT, so the option list is simply the distinct
 * values seen in the loaded rows. A status value is the label's stable ID instead,
 * so the raw scan yields ids ("2", "5") and the menu would read as numbers. This
 * resolves each id to its label text + colour through that column's own maps.
 *
 * Options are ordered by the column's DISPLAY order (orderById) when it is known —
 * the same order monday shows in the column itself, and the order the priority
 * column's meaning depends on — falling back to Hebrew label collation.
 *
 * An id with no label in the map is DROPPED, not rendered as a number: it means the
 * labels haven't loaded yet, or the label was deleted from the column while a task
 * still carries it. Neither is something to put in front of the user as "2".
 */
export function statusFilterOptions(ids, maps) {
  const labelById = maps?.labelById || {};
  const colorById = maps?.colorById || {};
  const orderById = maps?.orderById || null;
  const out = [];
  for (const raw of ids || []) {
    const id = String(raw);
    const label = labelById[id] ?? labelById[Number(id)];
    if (!label) continue;
    const order = orderById ? (orderById[id] ?? orderById[Number(id)]) : undefined;
    out.push({
      id,
      label,
      color: colorById[id] ?? colorById[Number(id)] ?? null,
      __order: typeof order === 'number' ? order : null,
    });
  }
  out.sort((a, b) => {
    if (a.__order != null && b.__order != null) return a.__order - b.__order;
    if (a.__order != null) return -1;
    if (b.__order != null) return 1;
    return a.label.localeCompare(b.label, 'he');
  });
  return out.map(({ __order, ...opt }) => opt);
}

export default statusFilterOptions;
