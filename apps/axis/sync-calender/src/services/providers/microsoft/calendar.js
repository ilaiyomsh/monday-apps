// Microsoft Graph calendar adapter — delta query for incremental sync,
// calendarView for backfill page fetches, and the canonical event mapper.
//
// Graph endpoint reference:
//   - Delta:  GET /v1.0/me/calendarView/delta?startDateTime=…&endDateTime=…
//             (or follow @odata.deltaLink directly on subsequent rounds)
//   - Page:   GET /v1.0/me/calendarView?startDateTime=…&endDateTime=…&$top=…
//
// Personal-account caveat (tenant=common): mail field on /me may be null;
// the provider falls back to userPrincipalName at OAuth-callback time.
// See docs/16-microsoft-graph-integration-plan.md.

import logger from '../../logger.js';
import { STATUS, RESPONSE } from '../canonical-event.js';

const TAG = 'microsoft_calendar';
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

// Default delta window when no deltaLink is stored yet. Mirrors backfill
// (now → +6 months) so a fresh user pulls the same range as backfill,
// and the Graph delta token captures changes after that.
const DEFAULT_DELTA_MONTHS_AHEAD = 6;

function isoMonthsAhead(months) {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

// Map Microsoft's responseStatus.response enum to our canonical RESPONSE enum.
//   organizer → accepted (the user owns the calendar; they trivially "accepted")
//   accepted/declined/tentativelyAccepted → matching canonical value
//   notResponded / none → needsAction
function mapResponseStatus(graphResponse) {
  switch (graphResponse) {
    case 'accepted':
    case 'organizer':
      return RESPONSE.ACCEPTED;
    case 'declined':
      return RESPONSE.DECLINED;
    case 'tentativelyAccepted':
      return RESPONSE.TENTATIVE;
    case 'notResponded':
    case 'none':
    default:
      return RESPONSE.NEEDS_ACTION;
  }
}

// Microsoft Graph Event → CanonicalEvent. userEmail is the calendar owner's
// primary identity (mail || userPrincipalName) — used to mark attendees as
// isSelf and to compute the top-level selfResponse.
//
// Tombstones from delta have shape { id, '@removed': { reason: 'deleted' } }
// — we emit a CanonicalEvent with status=cancelled and only id populated.
export function mapEventToCanonical(graphEvent, userEmail) {
  if (!graphEvent || !graphEvent.id) return null;

  const userEmailLower = (userEmail || '').toLowerCase();

  // Delta tombstone — sync-engine will treat as a delete.
  if (graphEvent['@removed']) {
    return {
      id: graphEvent.id,
      iCalUID: null,
      title: '',
      description: '',
      location: '',
      start: null,
      end: null,
      isAllDay: false,
      organizer: null,
      attendees: [],
      externalUrl: '',
      status: STATUS.CANCELLED,
      selfResponse: null,
      raw: graphEvent,
    };
  }

  const isAllDay = Boolean(graphEvent.isAllDay);
  // Graph times are { dateTime: 'YYYY-MM-DDTHH:MM:SS.fffffff', timeZone: '…' }
  // without timezone offset. For all-day events Graph still returns dateTime
  // strings (midnight). Preserve them as-is; downstream date-boundary helpers
  // already understand both formats.
  const start = graphEvent.start?.dateTime
    ? { dateTime: graphEvent.start.dateTime, timeZone: graphEvent.start.timeZone || null }
    : null;
  const end = graphEvent.end?.dateTime
    ? { dateTime: graphEvent.end.dateTime, timeZone: graphEvent.end.timeZone || null }
    : null;

  const rawAttendees = Array.isArray(graphEvent.attendees) ? graphEvent.attendees : [];
  const attendees = rawAttendees.map((a) => {
    const email = a?.emailAddress?.address || '';
    const isSelf = userEmailLower && email.toLowerCase() === userEmailLower;
    return {
      email,
      name: a?.emailAddress?.name || '',
      isSelf,
      response: mapResponseStatus(a?.status?.response),
    };
  });

  const organizerEmail = graphEvent.organizer?.emailAddress?.address || '';
  const organizerIsSelf = Boolean(graphEvent.isOrganizer) ||
    (userEmailLower && organizerEmail.toLowerCase() === userEmailLower);

  // selfResponse: prefer the top-level event.responseStatus.response (Graph's
  // canonical view of "what did the calendar owner answer"), then the matching
  // attendee, then 'accepted' if the user is the organizer.
  let selfResponse = null;
  if (graphEvent.responseStatus?.response) {
    selfResponse = mapResponseStatus(graphEvent.responseStatus.response);
  }
  if (!selfResponse) {
    const selfAttendee = attendees.find((a) => a.isSelf);
    if (selfAttendee) selfResponse = selfAttendee.response;
  }
  if (!selfResponse && organizerIsSelf) {
    selfResponse = RESPONSE.ACCEPTED;
  }

  // Plain-text description from Graph's body.content. Graph stores HTML or
  // text per body.contentType — we strip HTML tags conservatively rather than
  // parse, since downstream uses are conditional matching + monday text columns.
  let description = '';
  if (graphEvent.bodyPreview) {
    description = graphEvent.bodyPreview;
  } else if (graphEvent.body?.content) {
    description = graphEvent.body.contentType === 'html'
      ? graphEvent.body.content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
      : graphEvent.body.content;
  }

  return {
    id: graphEvent.id,
    iCalUID: graphEvent.iCalUId || null,
    title: graphEvent.subject || '',
    description,
    location: graphEvent.location?.displayName || '',
    start,
    end,
    isAllDay,
    organizer: organizerEmail
      ? {
          email: organizerEmail,
          name: graphEvent.organizer?.emailAddress?.name || '',
          isSelf: organizerIsSelf,
        }
      : null,
    attendees,
    externalUrl: graphEvent.webLink || '',
    status: graphEvent.isCancelled ? STATUS.CANCELLED : STATUS.CONFIRMED,
    selfResponse,
    raw: graphEvent,
  };
}

// Same RSVP/all-day filter logic the canonical sync-engine uses, expressed
// here so the provider object satisfies its shouldSync contract. The canonical
// fields make this provider-agnostic in practice.
export function shouldSync(canonicalEvent) {
  if (!canonicalEvent) return false;
  if (canonicalEvent.status === STATUS.CANCELLED) return false;
  if (canonicalEvent.isAllDay) return false;
  if (!canonicalEvent.attendees?.length) return true;
  return canonicalEvent.selfResponse === RESPONSE.ACCEPTED;
}

export function buildEventUrl(canonicalEvent) {
  return canonicalEvent?.externalUrl || '';
}

async function graphGet(accessToken, urlOrPath, label) {
  const url = urlOrPath.startsWith('http')
    ? urlOrPath
    : `${GRAPH_BASE}${urlOrPath.startsWith('/') ? '' : '/'}${urlOrPath}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      Prefer: 'odata.maxpagesize=100',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    // 410 is expected (delta token expired) and handled by the caller —
    // surface as DEBUG so it doesn't pollute the error stream.
    const level = res.status === 410 ? logger.debug : logger.error;
    level(`graph ${label} failed`, TAG, {
      status: res.status,
      body: text.slice(0, 200),
    });
    const err = new Error(`microsoft_graph_${label}_failed: ${res.status}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }
  return res.json();
}

// Pull all changes since the last sync. Returns canonical events + the next
// deltaLink (which encodes the time window + opaque cursor). On 410 returns
// syncTokenExpired:true so the caller can reset and retry from a fresh window.
export async function listChanges(accessToken, deltaLink, userEmail) {
  let nextLink = deltaLink;
  let coldStart = false;
  if (!nextLink) {
    const startDateTime = new Date().toISOString();
    const endDateTime = isoMonthsAhead(DEFAULT_DELTA_MONTHS_AHEAD);
    nextLink = `${GRAPH_BASE}/me/calendarView/delta?startDateTime=${encodeURIComponent(startDateTime)}&endDateTime=${encodeURIComponent(endDateTime)}`;
    coldStart = true;
  }

  const allCanonical = [];
  let pageCount = 0;
  let finalDeltaLink = null;

  try {
    let url = nextLink;
    while (url) {
      const data = await graphGet(accessToken, url, 'delta');
      pageCount++;
      const items = data.value || [];
      for (const item of items) {
        const c = mapEventToCanonical(item, userEmail);
        if (c) allCanonical.push(c);
      }
      if (data['@odata.nextLink']) {
        url = data['@odata.nextLink'];
      } else {
        finalDeltaLink = data['@odata.deltaLink'] || null;
        url = null;
      }
    }
  } catch (err) {
    if (err.status === 410) throw new Error('SYNC_TOKEN_EXPIRED');
    throw err;
  }

  logger.debug('delta', TAG, {
    pages: pageCount, count: allCanonical.length, coldStart, hasDeltaLink: Boolean(finalDeltaLink),
  });

  return { events: allCanonical, deltaLink: finalDeltaLink };
}

// One page of events in a time window. Used by backfill. Returns canonical events.
export async function listUpcomingPage(accessToken, { timeMin, timeMax, pageToken, pageSize = 100, userEmail }) {
  // pageToken = full @odata.nextLink URL when paginating.
  let url;
  if (pageToken && pageToken.startsWith('http')) {
    url = pageToken;
  } else {
    const params = new URLSearchParams({
      startDateTime: timeMin,
      endDateTime: timeMax,
      $top: String(pageSize),
      $orderby: 'start/dateTime',
    });
    url = `${GRAPH_BASE}/me/calendarView?${params}`;
  }

  const data = await graphGet(accessToken, url, 'calendarView');
  const events = (data.value || [])
    .map((e) => mapEventToCanonical(e, userEmail))
    .filter(Boolean);
  return {
    events,
    nextPageToken: data['@odata.nextLink'] || null,
  };
}
