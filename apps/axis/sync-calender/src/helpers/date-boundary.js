// Whether a timed Google Calendar event straddles a local-day boundary in a
// given IANA time zone. We use this to skip multi-day events entirely —
// products that need per-day items can extend this later to emit multiple
// board rows. All-day events (no start.dateTime) are never considered here;
// shouldSync already filters them upstream.

function dateInTz(isoDateTime, tz) {
  const d = new Date(isoDateTime);
  if (Number.isNaN(d.getTime())) return null;
  // en-CA formats as YYYY-MM-DD which is directly comparable as strings.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function timeInTz(isoDateTime, tz) {
  const d = new Date(isoDateTime);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(d);
}

// YYYY-MM-DD string representing the day after the given YYYY-MM-DD.
function nextDay(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  const pad = (n) => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function crossesLocalDayBoundary(event, tz) {
  if (!tz) return false;
  const startIso = event?.start?.dateTime;
  const endIso = event?.end?.dateTime;
  if (!startIso || !endIso) return false;

  const startDate = dateInTz(startIso, tz);
  const endDate = dateInTz(endIso, tz);
  if (!startDate || !endDate) return false;
  if (startDate === endDate) return false;

  // An event whose end falls exactly on the start's next-day 00:00:00 local
  // is a single-day event expressed as 10:00–24:00 — don't drop it. Any
  // later midnight (e.g. Mon 10:00 → Wed 00:00) really does cross a day.
  if (endDate === nextDay(startDate) && timeInTz(endIso, tz) === '00:00:00') {
    return false;
  }

  return true;
}
