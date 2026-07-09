import { useEffect, useState } from 'react';
import { getBoardId } from '../utils/mondayApi/board-config-store.js';
import { getBoardPeople } from '../utils/mondayApi/subscribers.js';
import { ingestUsers } from '../utils/usersStore.js';
import logger from '../utils/logger.js';

/*
 * useBoardSubscribers — a PersonPicker source restricted to a BOARD'S members
 * (owners + subscribers), i.e. exactly the people monday will let you assign to
 * that board. Assigning a NON-member throws monday's invalidPersonAssignment
 * (ColumnValueException) — sourcing the picker from real board membership
 * prevents the rejection at its source (round 32). Does NOT auto-subscribe anyone.
 *
 * Fetched once per board id and cached module-level (shared across rows/tabs,
 * mirrors useStatusOptions). `boardKey` null → inert ({ users: [], loading: false }).
 */
const cache = new Map();    // boardId -> [{ id, name, photo_thumb }]
const inflight = new Map(); // boardId -> Promise<users>

async function load(boardId) {
  const { owners, subscribers } = await getBoardPeople(boardId);
  // An owner is implicitly a member and CAN be assigned → union owners ∪ subscribers.
  const byId = new Map();
  [...(owners || []), ...(subscribers || [])].forEach((p) => {
    if (p && p.id != null) {
      byId.set(String(p.id), { id: String(p.id), name: p.name, photo_thumb: p.photoUrl || null });
    }
  });
  const users = Array.from(byId.values());
  ingestUsers(users); // populate the shared name/avatar cache too
  return users;
}

export function useBoardSubscribers(boardKey) {
  const boardId = boardKey ? getBoardId(boardKey) : null;
  const [state, setState] = useState(() =>
    boardId && cache.has(boardId)
      ? { users: cache.get(boardId), loading: false }
      : { users: [], loading: !!boardId }
  );

  useEffect(() => {
    let cancelled = false;
    if (!boardId) { setState({ users: [], loading: false }); return undefined; }
    if (cache.has(boardId)) { setState({ users: cache.get(boardId), loading: false }); return undefined; }
    setState((s) => ({ ...s, loading: true }));
    let p = inflight.get(boardId);
    if (!p) {
      p = load(boardId)
        .catch((err) => {
          logger.warn('useBoardSubscribers', 'טעינת חברי הלוח נכשלה', { boardId, error: err?.message });
          return [];
        })
        .finally(() => { inflight.delete(boardId); });
      inflight.set(boardId, p);
    }
    p.then((users) => {
      cache.set(boardId, users);
      if (!cancelled) setState({ users, loading: false });
    });
    return () => { cancelled = true; };
  }, [boardId]);

  return state;
}

export default useBoardSubscribers;
