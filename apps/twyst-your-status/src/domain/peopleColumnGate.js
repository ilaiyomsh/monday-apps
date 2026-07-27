/**
 * Parse / match monday People column assignments for picker gates.
 * Write JSON uses personsAndTeams; GraphQL PeopleValue uses persons_and_teams.
 * @see monday-api references/column-formats.md
 */

import logger from '../utils/logger.js';

function pushUnique(list, seen, rawId) {
  if (rawId == null) return;
  const id = String(rawId).trim();
  if (!id || seen.has(id)) return;
  seen.add(id);
  list.push(id);
}

function assignmentsFromEntries(entries) {
  const personIds = [];
  const teamIds = [];
  const seenPeople = new Set();
  const seenTeams = new Set();
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    const kind = String(entry.kind || '').toLowerCase();
    if (kind === 'team') {
      pushUnique(teamIds, seenTeams, entry.id);
      return;
    }
    // person + agent (and unknown kinds) count as person ids for the actor gate
    if (kind === 'person' || kind === 'agent' || !kind) {
      pushUnique(personIds, seenPeople, entry.id);
    }
  });
  return { personIds, teamIds };
}

function parseJsonObject(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    logger.error('peopleColumnGate', 'Malformed people column JSON; treating as empty', err);
    return null;
  }
}

/**
 * @param {string|object|null|undefined} raw
 *   - JSON string `{ personsAndTeams: [...] }`
 *   - column_values row `{ value, persons_and_teams }`
 *   - typed payload `{ persons_and_teams: [...] }`
 * @returns {{ personIds: string[], teamIds: string[] }}
 */
export function parsePeopleColumnAssignments(raw) {
  if (raw == null || raw === '') {
    return { personIds: [], teamIds: [] };
  }

  // Prefer typed GraphQL field when present on a column_values row / payload.
  if (typeof raw === 'object' && !Array.isArray(raw) && Array.isArray(raw.persons_and_teams)) {
    return assignmentsFromEntries(raw.persons_and_teams);
  }

  const fromValueField = typeof raw === 'object' && !Array.isArray(raw)
    ? parseJsonObject(raw.value)
    : null;
  const parsed = fromValueField || parseJsonObject(raw);
  if (!parsed) return { personIds: [], teamIds: [] };

  if (Array.isArray(parsed.personsAndTeams)) {
    return assignmentsFromEntries(parsed.personsAndTeams);
  }
  if (Array.isArray(parsed.persons_and_teams)) {
    return assignmentsFromEntries(parsed.persons_and_teams);
  }
  return { personIds: [], teamIds: [] };
}

/**
 * @param {{ userId?: string|number, teamIds?: Array<string|number> }} actor
 * @param {{ personIds?: string[], teamIds?: string[] }|null|undefined} assignments
 */
export function actorMatchesPeopleAssignments(actor, assignments) {
  if (!assignments || typeof assignments !== 'object') return false;
  const personIds = new Set((assignments.personIds ?? []).map(String));
  const teamIds = new Set((assignments.teamIds ?? []).map(String));
  if (personIds.size === 0 && teamIds.size === 0) return false;

  const userId = actor?.userId == null ? '' : String(actor.userId).trim();
  if (userId && personIds.has(userId)) return true;

  const actorTeams = (Array.isArray(actor?.teamIds) ? actor.teamIds : [])
    .map((id) => String(id).trim())
    .filter(Boolean);
  return actorTeams.some((teamId) => teamIds.has(teamId));
}
