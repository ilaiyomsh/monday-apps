// Factories for building Google Calendar event objects matching the shape
// returned by `events.list`. Scenarios feed these to POST /admin/seed-events.

const DEFAULT_ORGANIZER_EMAIL = 'e2e-tester@example.com';

function toBase64Url(s) {
  return Buffer.from(s, 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function buildGoogleEvent({
  id,
  status = 'confirmed',
  summary = '',
  description = '',
  location,
  start,         // ISO "YYYY-MM-DDTHH:MM:SS±HH:MM" or "YYYY-MM-DDTHH:MM:SSZ"
  end,
  attendees,     // optional array of {email, self?, organizer?, responseStatus?}
  organizer = { email: DEFAULT_ORGANIZER_EMAIL, self: true },
  allDay = false,
}) {
  const htmlLink = `https://www.google.com/calendar/event?eid=${toBase64Url(`${id} ${organizer.email}`)}`;

  const startField = allDay
    ? { date: start } // expect YYYY-MM-DD
    : { dateTime: start };
  const endField = allDay
    ? { date: end }
    : { dateTime: end };

  const event = {
    kind: 'calendar#event',
    etag: `"mock-etag-${id}-${Date.now()}"`,
    id,
    status,
    htmlLink,
    summary,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    organizer,
    creator: organizer,
    start: startField,
    end: endField,
    iCalUID: `${id}@google.com`,
    sequence: 0,
    reminders: { useDefault: true },
    eventType: 'default',
  };
  if (description) event.description = description;
  if (location) event.location = location;
  if (attendees) event.attendees = attendees;
  return event;
}

// Convenience — an event owned by the current user, no attendees.
export function selfOrganized(opts) {
  return buildGoogleEvent({ ...opts });
}

// Accepted invitation (user is not organizer; self marked accepted).
export function acceptedInvite(opts, selfEmail = 'self@twyst.co.il') {
  return buildGoogleEvent({
    ...opts,
    organizer: { email: 'inviter@example.com', self: false },
    attendees: [
      { email: 'inviter@example.com', organizer: true, responseStatus: 'accepted' },
      { email: selfEmail, self: true, responseStatus: 'accepted' },
    ],
  });
}

// Invited but not responded yet (needsAction).
export function needsActionInvite(opts, selfEmail = 'self@twyst.co.il') {
  return buildGoogleEvent({
    ...opts,
    organizer: { email: 'inviter@example.com', self: false },
    attendees: [
      { email: 'inviter@example.com', organizer: true, responseStatus: 'accepted' },
      { email: selfEmail, self: true, responseStatus: 'needsAction' },
    ],
  });
}

// Declined invitation (after previously being something else).
export function declinedInvite(opts, selfEmail = 'self@twyst.co.il') {
  return buildGoogleEvent({
    ...opts,
    organizer: { email: 'inviter@example.com', self: false },
    attendees: [
      { email: 'inviter@example.com', organizer: true, responseStatus: 'accepted' },
      { email: selfEmail, self: true, responseStatus: 'declined' },
    ],
  });
}
