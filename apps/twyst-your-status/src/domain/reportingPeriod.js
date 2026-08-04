/**
 * reportingPeriod — the week/month/year/custom presets behind the bypass
 * monitor's period selector (round323). PURE date math: given a "now" and a
 * period key, resolve the inclusive [fromMs, toMs] window the client sends to
 * the guard's query endpoint, plus a Hebrew label for the UI.
 *
 * Conventions (owner decision): "week" is the CURRENT calendar week that
 * contains `now`, Sunday→Saturday (monday.com's week start). "month"/"year"
 * are the current calendar month/year. Custom takes two day-strings and is
 * inclusive of both endpoints; reversed inputs are swapped rather than rejected.
 *
 * Bounds are whole days in LOCAL time — the monitor reports by calendar day,
 * so the window runs from 00:00:00.000 of the first day to 23:59:59.999 of the
 * last. (toISOString/UTC would shift the day across a timezone; local getters
 * are used throughout, same rule as monthGrid.js.)
 */

const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const MONTHS_SHORT = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}
function endOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}
function shortLabel(d) {
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

/**
 * @param {'week'|'month'|'year'|'custom'} period
 * @param {number} nowMs - epoch ms treated as "now"
 * @param {{ from?: string, to?: string }} [custom] - YYYY-MM-DD day strings
 * @returns {{ fromMs: number, toMs: number, label: string }}
 */
export function periodRange(period, nowMs, custom = {}) {
  const now = new Date(nowMs);

  if (period === 'week') {
    const sunday = startOfDay(now);
    sunday.setDate(now.getDate() - now.getDay()); // getDay 0=Sunday
    const saturday = endOfDay(new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate() + 6));
    return {
      fromMs: sunday.getTime(),
      toMs: saturday.getTime(),
      label: `${shortLabel(sunday)} – ${shortLabel(saturday)} ${saturday.getFullYear()}`,
    };
  }

  if (period === 'month') {
    const first = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
    const last = endOfDay(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    return { fromMs: first.getTime(), toMs: last.getTime(), label: `${MONTHS[now.getMonth()]} ${now.getFullYear()}` };
  }

  if (period === 'year') {
    const first = startOfDay(new Date(now.getFullYear(), 0, 1));
    const last = endOfDay(new Date(now.getFullYear(), 11, 31));
    return { fromMs: first.getTime(), toMs: last.getTime(), label: `${now.getFullYear()}` };
  }

  if (period === 'custom') {
    // Fall back to the current month when an endpoint is missing, so the
    // selector always yields a usable window.
    const fromD = custom.from ? startOfDay(parseDayString(custom.from)) : startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
    const toD = custom.to ? endOfDay(parseDayString(custom.to)) : endOfDay(now);
    let lo = fromD;
    let hi = toD;
    if (lo.getTime() > hi.getTime()) {
      lo = startOfDay(toD);
      hi = endOfDay(fromD);
    }
    return { fromMs: lo.getTime(), toMs: hi.getTime(), label: `${shortLabel(lo)} – ${shortLabel(hi)} ${hi.getFullYear()}` };
  }

  throw new Error(`unknown period: ${period}`);
}

/** Parse a YYYY-MM-DD day string into a LOCAL Date (no UTC shift). */
function parseDayString(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/**
 * The immediately-preceding window of the same size, for the trend delta.
 * Week→prior 7 days; month→prior calendar month; year→prior calendar year;
 * custom→the equal-length span ending the day before `from`.
 */
export function previousRange(period, range) {
  if (period === 'week') {
    return { fromMs: range.fromMs - 7 * 86400000, toMs: range.toMs - 7 * 86400000 };
  }
  if (period === 'month') {
    const from = new Date(range.fromMs);
    const first = startOfDay(new Date(from.getFullYear(), from.getMonth() - 1, 1));
    const last = endOfDay(new Date(from.getFullYear(), from.getMonth(), 0));
    return { fromMs: first.getTime(), toMs: last.getTime() };
  }
  if (period === 'year') {
    const y = new Date(range.fromMs).getFullYear() - 1;
    return { fromMs: startOfDay(new Date(y, 0, 1)).getTime(), toMs: endOfDay(new Date(y, 11, 31)).getTime() };
  }
  const span = range.toMs - range.fromMs;
  return { fromMs: range.fromMs - span - 1, toMs: range.fromMs - 1 };
}
