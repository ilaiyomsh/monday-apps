// Digest core (v4 phase 1, owner decisions 2026-07-19) — PURE functions.
// Matching model: a dedicated USERS BOARD (people column + email column) maps
// person ids -> recipient email; tasks come from the configured tasks board,
// matched by person-id intersection with config.peopleColumnId.
//
// Pending semantics (per section, owner decision 2026-07-20):
//   date set AND date <= today (a past date INCLUDES today) AND the task's
//   status (on the section button's status column) is one of the section's
//   includeStatusLabelIds ("show by status" — only listed statuses enter).
// Label id 0 is valid — never truthy-check. An unset status (null) matches
// nothing, so it is excluded unless the board uses a real "not started" label.

/**
 * Column ids the tasks-board read needs (people + every section date +
 * every referenced button's status column), deduped.
 * @param {object} config
 * @returns {string[]}
 */
export function digestTaskColumnIds(config) {
  const buttonsById = new Map((config.buttons ?? []).map((b) => [b.id, b]));
  const ids = new Set([config.peopleColumnId]);
  for (const section of config.digest?.sections ?? []) {
    ids.add(section.dateColumnId);
    const button = buttonsById.get(section.buttonId);
    if (button) ids.add(button.statusColumnId);
  }
  ids.delete(null);
  ids.delete(undefined);
  return [...ids];
}

function col(item, columnId) {
  return item.columns?.[columnId] ?? { text: '', statusLabelId: null, date: null, personIds: [] };
}

/**
 * @param {object} p
 * @param {object} p.config - full app config (digest + buttons + peopleColumnId)
 * @param {Array<object>} p.tasks - normalized items of the tasks board
 * @param {Array<object>} p.users - normalized items of the users board
 * @param {string} p.today - YYYY-MM-DD
 * @returns {{ recipients: Array<object>, skippedUsers: Array<object> }}
 */
export function buildDigest({ config, tasks, users, today }) {
  const { digest } = config;
  const buttonsById = new Map((config.buttons ?? []).map((b) => [b.id, b]));

  // --- users board -> recipients (deduped by email, person ids united) -----
  /** @type {Map<string, { email: string, name: string, personIds: string[] }>} */
  const byEmail = new Map();
  const skippedUsers = [];
  for (const row of users) {
    const personIds = col(row, digest.usersPeopleColumnId).personIds ?? [];
    const email = (col(row, digest.usersEmailColumnId).text ?? '').trim();
    if (!email) {
      skippedUsers.push({ itemId: row.id, name: row.name, reason: 'no_email' });
      continue;
    }
    if (personIds.length === 0) {
      skippedUsers.push({ itemId: row.id, name: row.name, reason: 'no_person' });
      continue;
    }
    const existing = byEmail.get(email);
    if (existing) {
      for (const id of personIds) if (!existing.personIds.includes(id)) existing.personIds.push(id);
    } else {
      byEmail.set(email, { email, name: row.name, personIds: [...personIds] });
    }
  }

  // --- classify every task once per section ---------------------------------
  // pendingBySection: sectionId -> [{ task, personIds }]
  const pendingBySection = new Map();
  for (const section of digest.sections) {
    const button = buttonsById.get(section.buttonId);
    if (!button) continue; // config validation prevents this; defensive skip
    const includeSet = new Set(section.includeStatusLabelIds ?? []);
    const pending = [];
    for (const task of tasks) {
      const date = col(task, section.dateColumnId).date;
      if (!date || date > today) continue; // future only — today counts as passed
      const statusLabelId = col(task, button.statusColumnId).statusLabelId;
      // "show by status": only statuses the section lists enter the digest
      // (label id 0 is valid — Set membership, never truthy-check).
      if (statusLabelId === null || !includeSet.has(statusLabelId)) continue;
      pending.push({
        itemId: task.id,
        name: task.name,
        date,
        statusText: col(task, button.statusColumnId).text ?? '',
        personIds: col(task, config.peopleColumnId).personIds ?? [],
      });
    }
    pendingBySection.set(section.id, pending);
  }

  // --- assemble per-recipient digests ---------------------------------------
  const recipients = [];
  for (const r of byEmail.values()) {
    const personSet = new Set(r.personIds);
    const sections = [];
    let taskCount = 0;
    for (const section of digest.sections) {
      const mine = (pendingBySection.get(section.id) ?? []).filter((t) =>
        t.personIds.some((id) => personSet.has(id))
      );
      if (mine.length === 0) continue;
      taskCount += mine.length;
      sections.push({
        sectionId: section.id,
        title: section.title,
        dateColumnTitle: section.dateColumnTitle ?? '',
        buttonId: section.buttonId,
        tasks: mine.map(({ itemId, name, date, statusText }) => ({ itemId, name, date, statusText })),
      });
    }
    if (taskCount === 0) continue;
    recipients.push({ email: r.email, name: r.name, personIds: r.personIds, taskCount, sections });
  }

  return { recipients, skippedUsers };
}
