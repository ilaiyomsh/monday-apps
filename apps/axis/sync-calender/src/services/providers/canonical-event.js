// Provider-agnostic event shape that sync-engine, helpers/columns, and
// conditional-evaluator operate on. Each provider (Google, Microsoft) maps its
// raw API response into a CanonicalEvent before handing it off downstream.
//
// Goal: zero provider-specific field reads outside of providers/<name>/. If
// you find yourself adding `if (provider === 'microsoft')` in sync-engine,
// extend this shape instead.

export const STATUS = Object.freeze({
  CONFIRMED: 'confirmed',
  CANCELLED: 'cancelled',
});

export const RESPONSE = Object.freeze({
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
  TENTATIVE: 'tentative',
  NEEDS_ACTION: 'needsAction',
});

// Shape reference (no validation — JS-only project, runtime trust):
//
// CanonicalEvent = {
//   id:           string                — provider-stable event ID
//   iCalUID:      string                — cross-provider identity (optional)
//   title:        string                — Google summary | Microsoft subject
//   description:  string                — plain text
//   location:     string                — display name only
//   start:        { dateTime, timeZone } | null   — null on cancellations-from-delta
//   end:          { dateTime, timeZone } | null
//   isAllDay:     boolean
//   organizer:    { email, name, isSelf } | null
//   attendees:    Array<{ email, name, isSelf, response }>
//   externalUrl:  string                — Google htmlLink | Microsoft webLink
//   status:       'confirmed' | 'cancelled'
//   selfResponse: 'accepted' | 'declined' | 'tentative' | 'needsAction' | null
//   raw:          object                — original provider event (escape hatch only)
// }
//
// "Tombstone" form (delta delete marker): { id, status: 'cancelled' } only.
// All other fields may be undefined on a tombstone.

export function isTombstone(canonicalEvent) {
  return (
    canonicalEvent &&
    canonicalEvent.status === STATUS.CANCELLED &&
    canonicalEvent.start == null
  );
}
