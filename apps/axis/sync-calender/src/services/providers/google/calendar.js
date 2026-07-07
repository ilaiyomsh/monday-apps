import { google } from 'googleapis';
import logger from '../../logger.js';
import { STATUS, RESPONSE } from '../canonical-event.js';

const TAG = 'google_calendar';

// Optional override for testing — when set, all googleapis client requests are
// routed through this base URL instead of https://www.googleapis.com.
// Leave unset in production.
const GOOGLE_API_BASE_URL = process.env.GOOGLE_API_BASE_URL;

function clientOptions() {
  return GOOGLE_API_BASE_URL ? { rootUrl: GOOGLE_API_BASE_URL } : {};
}

function createCalendarClient(accessToken) {
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  return google.calendar({ version: 'v3', auth: oauth2Client, ...clientOptions() });
}

// Map a raw Google Calendar event into a CanonicalEvent. The userEmail is the
// authenticated user's address — used to populate the `isSelf` flags downstream
// callers don't otherwise have. Google sets `attendees[].self` directly so we
// honor that when present and only fall back to email comparison if missing.
export function mapEventToCanonical(googleEvent, userEmail) {
  if (!googleEvent) return null;

  const startDateTime = googleEvent.start?.dateTime || null;
  const startDate = googleEvent.start?.date || null;
  const endDateTime = googleEvent.end?.dateTime || null;
  const endDate = googleEvent.end?.date || null;
  const isAllDay = !startDateTime && !!startDate;

  const start = startDateTime
    ? { dateTime: startDateTime, timeZone: googleEvent.start?.timeZone || null }
    : startDate
    ? { dateTime: startDate, timeZone: null }
    : null;
  const end = endDateTime
    ? { dateTime: endDateTime, timeZone: googleEvent.end?.timeZone || null }
    : endDate
    ? { dateTime: endDate, timeZone: null }
    : null;

  const rawAttendees = Array.isArray(googleEvent.attendees) ? googleEvent.attendees : [];
  const userEmailLower = (userEmail || '').toLowerCase();
  const attendees = rawAttendees.map((a) => {
    const email = a?.email || '';
    const isSelf = a?.self === true || (userEmailLower && email.toLowerCase() === userEmailLower);
    return {
      email,
      name: a?.displayName || '',
      isSelf,
      response: a?.responseStatus || RESPONSE.NEEDS_ACTION,
    };
  });

  const selfAttendee = attendees.find((a) => a.isSelf);
  const organizerEmail = googleEvent.organizer?.email || '';
  const organizerIsSelf = googleEvent.organizer?.self === true ||
    (userEmailLower && organizerEmail.toLowerCase() === userEmailLower);

  // selfResponse: prefer the attendees[].self entry. If the user is the sole
  // organizer with no attendees collection, treat as accepted.
  let selfResponse = selfAttendee?.response || null;
  if (!selfResponse && attendees.length === 0 && organizerIsSelf) {
    selfResponse = RESPONSE.ACCEPTED;
  }

  return {
    id: googleEvent.id,
    iCalUID: googleEvent.iCalUID || googleEvent.id,
    title: googleEvent.summary || '',
    description: googleEvent.description || '',
    location: googleEvent.location || '',
    start,
    end,
    isAllDay,
    organizer: organizerEmail
      ? { email: organizerEmail, name: googleEvent.organizer?.displayName || '', isSelf: organizerIsSelf }
      : null,
    attendees,
    externalUrl: googleEvent.htmlLink || '',
    status: googleEvent.status === 'cancelled' ? STATUS.CANCELLED : STATUS.CONFIRMED,
    selfResponse,
    raw: googleEvent,
  };
}

// RSVP filter: which canonical events should trigger a monday item sync.
// Cancelled events are handled separately (caller deletes existing items); here
// we return false for cancelled so the caller can decide. Skip all-day events.
// If no attendees, the event is self-organized → sync. If there are attendees,
// only sync when the user accepted.
export function shouldSync(canonicalEvent) {
  if (!canonicalEvent) return false;
  if (canonicalEvent.status === STATUS.CANCELLED) return false;
  if (canonicalEvent.isAllDay) return false;
  if (!canonicalEvent.attendees?.length) return true;
  return canonicalEvent.selfResponse === RESPONSE.ACCEPTED;
}

// Build the public Google Calendar URL for an event. Google encodes the eid as
// base64url(eventId + " " + ownerEmail). This reproduces event.htmlLink exactly.
export function buildEventUrl(eventId, userEmail) {
  if (!eventId || !userEmail) return '';
  const eid = Buffer.from(`${eventId} ${userEmail}`, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `https://www.google.com/calendar/event?eid=${eid}`;
}

export async function fetchUserEmail(accessToken) {
  try {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client, ...clientOptions() });
    const res = await oauth2.userinfo.get();
    return res.data?.email || null;
  } catch (err) {
    logger.warn('userEmail fetch failed', TAG, { provider: 'google', error: err.message });
    return null;
  }
}

export async function watchCalendar(accessToken, { channelId, baseUrl }) {
  const calendar = createCalendarClient(accessToken);
  const address = baseUrl + '/webhook/calendar';
  logger.debug('events.watch request', TAG, { channelId });

  const response = await calendar.events.watch({
    calendarId: 'primary',
    requestBody: { id: channelId, type: 'web_hook', address, token: channelId },
  });

  return {
    resourceId: response.data.resourceId,
    expiration: response.data.expiration,
  };
}

// Establish a starting syncToken without pulling any existing events. We set
// timeMin to the far future so no events match, and Google still returns a
// fresh nextSyncToken on the (empty) last page. Subsequent pushes deliver
// deltas from that point onward.
export async function getSyncTokenOnly(accessToken) {
  const calendar = createCalendarClient(accessToken);
  const timeMin = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000).toISOString();

  let pageToken;
  let pageCount = 0;

  do {
    const res = await calendar.events.list({
      calendarId: 'primary',
      singleEvents: true,
      timeMin,
      pageToken,
    });

    pageCount++;
    pageToken = res.data.nextPageToken;

    if (!pageToken) {
      logger.debug('events.list cold-start', TAG, { pages: pageCount });
      return { syncToken: res.data.nextSyncToken };
    }
  } while (pageToken);
}

// Incremental delta. Returns canonical events only.
export async function listChanges(accessToken, syncToken, userEmail) {
  const calendar = createCalendarClient(accessToken);

  const allEvents = [];
  let pageToken;
  let newSyncToken;
  let pageCount = 0;

  try {
    do {
      const res = await calendar.events.list({
        calendarId: 'primary',
        syncToken,
        pageToken,
      });

      pageCount++;
      const items = res.data.items || [];
      allEvents.push(...items);

      pageToken = res.data.nextPageToken;
      if (!pageToken) newSyncToken = res.data.nextSyncToken;
    } while (pageToken);
  } catch (err) {
    if (err.code === 410) throw new Error('SYNC_TOKEN_EXPIRED');
    logger.error('events.list error', TAG, { code: err.code, message: err.message });
    throw err;
  }

  const canonical = allEvents.map((e) => mapEventToCanonical(e, userEmail));
  logger.debug('events.list delta', TAG, { pages: pageCount, count: canonical.length });
  return { events: canonical, newSyncToken };
}

// One page of events in a time window. Used by backfill. Returns canonical events.
export async function listUpcomingPage(accessToken, { timeMin, timeMax, pageToken, pageSize = 100, userEmail }) {
  const calendar = createCalendarClient(accessToken);
  const res = await calendar.events.list({
    calendarId: 'primary',
    singleEvents: true,
    orderBy: 'startTime',
    timeMin,
    timeMax,
    pageToken,
    maxResults: pageSize,
  });
  const events = (res.data.items || []).map((e) => mapEventToCanonical(e, userEmail));
  return {
    events,
    nextPageToken: res.data.nextPageToken || null,
  };
}

export async function stopChannel(accessToken, channelId, resourceId) {
  const calendar = createCalendarClient(accessToken);
  await calendar.channels.stop({
    requestBody: { id: channelId, resourceId },
  });
  logger.debug('channels.stop ok', TAG, { channelId });
}
