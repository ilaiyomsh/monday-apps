/*
 * round220 — pure helpers for the triple-box @-mention (RichTextEditor popup).
 * Kept framework-free so the caret-token detection and roster shaping are unit
 * tested without TipTap/jsdom.
 */

// The discussion people columns offered by the mention popup, in priority order:
// lead → coordinator → participants (round218 owner spec).
export const MENTION_ROLE_ALIASES = ['discussionLeadID', 'discussionCoordinatorID', 'participantsID'];

/**
 * Build the mention roster from a discussion's people columns: ordered by
 * MENTION_ROLE_ALIASES and deduped by id (names only). A person with no id is
 * keyed by name so duplicates still collapse. Returns [{ id, name }].
 */
export function buildMentionRoster(discussion, aliases = MENTION_ROLE_ALIASES) {
  const byId = new Map();
  for (const alias of aliases) {
    const list = Array.isArray(discussion?.[alias]) ? discussion[alias] : [];
    for (const p of list) {
      const name = p?.name;
      if (!name) continue;
      const id = p?.id != null ? String(p.id) : null;
      const key = id || `name:${name}`;
      if (!byId.has(key)) byId.set(key, { id: id || key, name });
    }
  }
  return [...byId.values()];
}

/**
 * Detect an active "@query" token at the END of the text before the caret: the
 * "@" must start the line or follow whitespace, and the query is the run of
 * non-whitespace after it. Returns { query } (query may be '') or null when the
 * caret isn't in a mention token.
 */
export function matchMentionQuery(textBefore) {
  const m = /(?:^|\s)@(\S*)$/.exec(String(textBefore || ''));
  return m ? { query: m[1] } : null;
}

/** Case-insensitive substring filter of a roster by the mention query, capped. */
export function filterMentionRoster(people, query, limit = 8) {
  const q = String(query || '').toLowerCase();
  return (Array.isArray(people) ? people : [])
    .filter((p) => (p?.name || '').toLowerCase().includes(q))
    .slice(0, limit);
}
