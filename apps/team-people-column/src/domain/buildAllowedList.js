// buildAllowedList — pure domain aggregation of the allowed-user set for a
// team-people column. No React / SDK / service imports (contract: pure).
//
// See MODULE CONTRACTS. Inputs are already-transformed domain structures
// (not raw monday API envelopes):
//   perItemEntries = [{ itemId:string, entries:[{ id:string, kind:'person'|'team' }] }]
//   teamsMap       = { [teamId:string]: { id, name, picture?, users:[{ id, name, photo_thumb }] } }
//   policy         = { aggregation:'union'|'strict', includeListedPersons:boolean, ... }
//   usersById      = { [userId:string]: { id, name, photo_thumb } }
//
// Returns { users, teams, emptyChain, missingTeamIds }.

export function buildAllowedList(perItemEntries, teamsMap, policy, usersById) {
  const aggregation = policy?.aggregation === 'strict' ? 'strict' : 'union';
  // Matches DEFAULT_POLICY.includeListedPersons = true; only an explicit false disables.
  const includeListedPersons = policy?.includeListedPersons !== false;

  const teamsById = teamsMap || {};
  const users = usersById || {};
  const items = Array.isArray(perItemEntries) ? perItemEntries : [];

  const missingTeamIds = [];
  const missingSeen = new Set();
  const resolvedTeams = [];
  const resolvedTeamSeen = new Set();

  // Per-item allowed sets: Map(stringId -> {id,name,photo_thumb}).
  const perItemSets = items.map((item) => {
    const set = new Map();
    const entries = Array.isArray(item?.entries) ? item.entries : [];

    for (const entry of entries) {
      if (!entry) continue;

      if (entry.kind === 'team') {
        const teamId = String(entry.id);
        const team = teamsById[teamId];
        if (!team) {
          if (!missingSeen.has(teamId)) {
            missingSeen.add(teamId);
            missingTeamIds.push(teamId);
          }
          continue; // absent team contributes no members
        }
        if (!resolvedTeamSeen.has(teamId)) {
          resolvedTeamSeen.add(teamId);
          // picture rides along for the dialog-title team avatar.
          resolvedTeams.push({ id: String(team.id), name: team.name, picture: team.picture ?? null });
        }
        const teamUsers = Array.isArray(team.users) ? team.users : [];
        for (const u of teamUsers) {
          const uid = String(u.id);
          if (!set.has(uid)) {
            set.set(uid, { id: uid, name: u.name, photo_thumb: u.photo_thumb });
          }
        }
      } else if (entry.kind === 'person') {
        if (!includeListedPersons) continue;
        const pid = String(entry.id);
        const u = users[pid];
        if (!u) continue; // unresolved listed person is ignored
        if (!set.has(pid)) {
          set.set(pid, { id: pid, name: u.name, photo_thumb: u.photo_thumb });
        }
      }
    }

    return set;
  });

  // Aggregate across items.
  let combined = new Map();
  if (perItemSets.length !== 0) {
    if (aggregation === 'strict') {
      combined = new Map(perItemSets[0]);
      for (let i = 1; i < perItemSets.length; i += 1) {
        const next = perItemSets[i];
        for (const key of [...combined.keys()]) {
          if (!next.has(key)) combined.delete(key);
        }
      }
    } else {
      for (const set of perItemSets) {
        for (const [k, v] of set) {
          if (!combined.has(k)) combined.set(k, v);
        }
      }
    }
  }

  const usersOut = [...combined.values()].sort((a, b) =>
    String(a.name).localeCompare(String(b.name), 'he'),
  );

  return {
    users: usersOut,
    teams: resolvedTeams,
    emptyChain: usersOut.length === 0,
    missingTeamIds,
  };
}
