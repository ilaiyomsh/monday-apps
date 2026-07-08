/*
 * useUsers — resolves monday user objects ({ id, name, photo_thumb }) for the
 * given ids from the shared in-memory usersStore (cache-first, synchronous).
 * Any ids not already cached are fetched on demand via ensureUsers(); the store
 * notifies subscribers when they arrive, so the component re-renders with photos.
 * The roster is normally pre-warmed (hydrateFromStorage on boot + an admin's
 * silent ensureRoster sync), so avatars usually paint immediately.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { subscribe, getVersion, getUser, ensureUsers } from '../../usersStore.js';

export function useUsers(ids = []) {
  const key = (ids || []).map(String).join(',');

  // Re-render whenever the shared store changes (snapshot is a stable version int).
  useSyncExternalStore(subscribe, getVersion, getVersion);

  useEffect(() => {
    const idList = key ? key.split(',') : [];
    if (idList.length) ensureUsers(idList);
  }, [key]);

  const idList = key ? key.split(',') : [];
  const users = idList.map((id) => getUser(id)).filter(Boolean);
  return { users, loading: false };
}
