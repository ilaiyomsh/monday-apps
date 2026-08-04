/**
 * columnOwners — the column's own owner list (round322, owner decision):
 * the first user to configure a column becomes its first owner and its
 * PRIMARY owner automatically; owners may add/remove other owners and move
 * the primary crown; everyone else is not exposed to the settings at all.
 * The primary owner is also the identity the guard writes REVERTS as — which
 * is why exactly one primary must always exist while owners exist.
 *
 * Stored on the settings blob as:
 *   owners: { ownerIds: string[], primaryOwnerId: string }
 *
 * ABSENT owners (every blob from before this round, and a column configured
 * by nobody yet) mean "not adopted yet": access falls back to the legacy
 * board-owner gate, and the first save adopts the saver. Normalization keeps
 * absence absent — several suites pin blob shapes with toEqual.
 *
 * Invariants normalizeOwners enforces on a PRESENT record:
 *   - ids are trimmed non-empty strings, deduped, order preserved;
 *   - primaryOwnerId ∈ ownerIds — an unknown/missing primary falls back to
 *     the FIRST owner (the creator, by construction);
 *   - no owners at all ⇒ null (treated exactly like absent).
 */

function normalizeIdList(rawList) {
  const seen = new Set();
  const ids = [];
  (Array.isArray(rawList) ? rawList : []).forEach((raw) => {
    if (typeof raw !== 'string' && typeof raw !== 'number') return;
    const id = String(raw).trim();
    if (id === '' || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  });
  return ids;
}

/** @returns {{ ownerIds: string[], primaryOwnerId: string }|null} */
export function normalizeOwners(rawOwners) {
  if (!rawOwners || typeof rawOwners !== 'object' || Array.isArray(rawOwners)) return null;
  const ownerIds = normalizeIdList(rawOwners.ownerIds);
  if (ownerIds.length === 0) return null;
  const rawPrimary = rawOwners.primaryOwnerId == null ? '' : String(rawOwners.primaryOwnerId).trim();
  const primaryOwnerId = ownerIds.includes(rawPrimary) ? rawPrimary : ownerIds[0];
  return { ownerIds, primaryOwnerId };
}

export function hasOwners(rawOwners) {
  return normalizeOwners(rawOwners) !== null;
}

export function isColumnOwner(rawOwners, userId) {
  const owners = normalizeOwners(rawOwners);
  if (!owners) return false;
  const id = userId == null ? '' : String(userId).trim();
  return id !== '' && owners.ownerIds.includes(id);
}

export function isPrimaryOwner(rawOwners, userId) {
  const owners = normalizeOwners(rawOwners);
  if (!owners) return false;
  return userId != null && String(userId).trim() === owners.primaryOwnerId;
}

/** First save of an unadopted column: the saver becomes owner #1 and primary. */
export function bootstrapOwners(userId) {
  const id = String(userId ?? '').trim();
  if (id === '') throw new Error('bootstrapOwners requires a userId');
  return { ownerIds: [id], primaryOwnerId: id };
}

/**
 * Add an owner. New to the list → appended (never becomes primary just by being
 * added — the crown moves only by an explicit setPrimaryOwner). Already an
 * owner, or a blank id → returned unchanged. On an unadopted base the added
 * user becomes owner #1 AND primary (there must always be a primary).
 */
export function addOwner(rawOwners, userId) {
  const id = String(userId ?? '').trim();
  const owners = normalizeOwners(rawOwners);
  if (id === '') return owners;
  if (!owners) return bootstrapOwners(id);
  if (owners.ownerIds.includes(id)) return owners;
  return { ownerIds: [...owners.ownerIds, id], primaryOwnerId: owners.primaryOwnerId };
}

/**
 * Remove an owner. Removing the PRIMARY hands the crown to the first remaining
 * owner (there must always be exactly one primary while owners exist). Removing
 * the LAST owner is refused — a column may not be left owner-less by an edit
 * (it would silently re-open to the board-owner fallback); returned unchanged.
 * A non-owner id or a blank id → unchanged.
 */
export function removeOwner(rawOwners, userId) {
  const id = String(userId ?? '').trim();
  const owners = normalizeOwners(rawOwners);
  if (!owners || id === '' || !owners.ownerIds.includes(id)) return owners;
  if (owners.ownerIds.length === 1) return owners; // never leave it owner-less
  const ownerIds = owners.ownerIds.filter((ownerId) => ownerId !== id);
  const primaryOwnerId = owners.primaryOwnerId === id ? ownerIds[0] : owners.primaryOwnerId;
  return { ownerIds, primaryOwnerId };
}

/**
 * Move the primary crown to an existing owner. A non-owner target, a blank id,
 * or an unadopted base → unchanged (you cannot crown someone who is not an
 * owner; add them first).
 */
export function setPrimaryOwner(rawOwners, userId) {
  const id = String(userId ?? '').trim();
  const owners = normalizeOwners(rawOwners);
  if (!owners || !owners.ownerIds.includes(id)) return owners;
  return { ownerIds: owners.ownerIds, primaryOwnerId: id };
}
