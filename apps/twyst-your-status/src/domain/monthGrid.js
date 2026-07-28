/**
 * Calendar math for the date field's popover — the month grid, month stepping,
 * and local-date formatting. Pure: no React, no Date.now() baked in (the caller
 * passes "today"), so every case here is testable.
 *
 * Weeks run Sunday→Saturday, matching monday's own date picker.
 *
 * All dates are handled as LOCAL calendar days and formatted with local getters.
 * `toISOString()` is deliberately never used: it returns the UTC day, which is off
 * by one for any positive-offset timezone near midnight — the same class of bug the
 * date column's read/write path had.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function pad2(value) {
  return String(value).padStart(2, '0');
}

/**
 * Local calendar day as `YYYY-MM-DD`. Empty string for anything that is not a
 * usable Date, so a caller can bind the result straight into an input.
 */
export function toIsoDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Today as a local ISO day. `now` is injectable so tests need no clock. */
export function isoToday(now = new Date()) {
  return toIsoDate(now);
}

/**
 * Step a year/month pair by whole months, rolling the year over.
 * @returns {{year: number, month: number}} month is 1-12
 */
export function shiftMonth(year, month, step) {
  const zeroBased = (Number(year) * 12) + (Number(month) - 1) + Number(step);
  return {
    year: Math.floor(zeroBased / 12),
    month: (zeroBased % 12) + 1,
  };
}

/**
 * The month as whole Sunday→Saturday weeks, padded with the neighbouring months'
 * days so every row has 7 cells (that is what the greyed-out edges in monday's
 * picker are).
 *
 * @param {number} year
 * @param {number} month  1-12
 * @returns {{iso: string, day: number, inMonth: boolean}[][]}
 */
export function buildMonthGrid(year, month) {
  const monthIndex = Number(month) - 1;
  if (!Number.isInteger(Number(month)) || monthIndex < 0 || monthIndex > 11) {
    throw new Error(`month must be 1-12, got ${month}`);
  }

  const first = new Date(Number(year), monthIndex, 1);
  // Back up to the Sunday on or before the 1st.
  const start = new Date(first.getTime() - (first.getDay() * DAY_MS));
  // Whole weeks needed to cover the month from that Sunday.
  const daysInMonth = new Date(Number(year), monthIndex + 1, 0).getDate();
  const weeks = Math.ceil((first.getDay() + daysInMonth) / 7);

  const grid = [];
  for (let week = 0; week < weeks; week += 1) {
    const row = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
      // Build each cell from the year/month/day parts rather than adding
      // milliseconds, so a DST shift inside the month cannot skip or repeat a day.
      const cell = new Date(
        start.getFullYear(),
        start.getMonth(),
        start.getDate() + (week * 7) + weekday,
      );
      row.push({
        iso: toIsoDate(cell),
        day: cell.getDate(),
        inMonth: cell.getMonth() === monthIndex && cell.getFullYear() === Number(year),
      });
    }
    grid.push(row);
  }
  return grid;
}
