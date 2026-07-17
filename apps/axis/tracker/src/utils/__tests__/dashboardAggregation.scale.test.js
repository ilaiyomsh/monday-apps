/**
 * Contract tests for aggregateAll / consolidateBarData — small hand-computed
 * anchors plus 5,000-event scale runs compared against an INDEPENDENT
 * single-pass reference implemented here from the documented contract.
 *
 * Scale data comes from the workspace package @axis/scale-fixtures. It is
 * loaded via dynamic import so that if the package is missing or still a
 * NOT_IMPLEMENTED stub, only the scale tests fail — the anchor tests stand
 * on their own hand-built data and must pass regardless.
 */
import { describe, it, test, expect } from 'vitest';
import { aggregateAll, consolidateBarData } from '../dashboardAggregation';

// ---------------------------------------------------------------------------
// Independent reference helpers (contract-derived; no product imports).
// ---------------------------------------------------------------------------

const round2 = (x) => Math.round(x * 100) / 100;
const pad2 = (n) => String(n).padStart(2, '0');
const isValidDate = (d) =>
  Boolean(d) && d instanceof Date && !Number.isNaN(d.getTime());

const FALLBACK = {
  internal: '#0073ea',
  external: '#00ca72',
  routine: '#fdab3d',
};

function granKey(d, granularity) {
  const y = d.getFullYear();
  if (granularity === 'year') return String(y);
  if (granularity === 'month') return `${y}-${pad2(d.getMonth() + 1)}`;
  // 'day' (week keys are never asserted textually — see contract)
  return `${y}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Naive single-pass reference for aggregateAll. Only computes the fields the
 * scale tests compare (pies as {name,value,color}, employees as named rows,
 * barData as {key,hours} for day/month/year granularities).
 */
function refAggregate(events, granularity, enableDistinction = false, reporters = []) {
  let total = 0;
  let billable = 0;
  let nonBillable = 0;
  const catHours = { internalProject: 0, externalProject: 0, routine: 0 };
  const catColors = { internalProject: null, externalProject: null, routine: null };

  const billableGroups = new Map();
  const nonBillableGroups = new Map();
  const internalGroups = new Map();
  const externalGroups = new Map();
  const routineGroups = new Map();
  const employees = new Map();
  const bars = new Map();

  const addGroup = (map, name, hours, colorFactory) => {
    let g = map.get(name);
    if (!g) {
      g = { name, value: 0, color: colorFactory() };
      map.set(name, g);
    }
    g.value += hours;
  };

  for (const e of events) {
    const hours = e.hours || 0;
    total += hours;
    if (e.isBillable) billable += hours;
    else nonBillable += hours;

    if (enableDistinction) {
      if (Object.prototype.hasOwnProperty.call(catHours, e.category)) {
        catHours[e.category] += hours;
        if (!catColors[e.category] && e.eventTypeColor) {
          catColors[e.category] = e.eventTypeColor;
        }
      }
    }

    if (e.isBillable) {
      addGroup(
        billableGroups,
        e.stageLabel || e.eventTypeLabel || 'פרויקטים',
        hours,
        () => e.stageColor || e.eventTypeColor || '#0073ea'
      );
    } else {
      addGroup(
        nonBillableGroups,
        e.nonBillableType || 'אחר',
        hours,
        () => e.nonBillableColor || e.eventTypeColor || '#0073ea'
      );
    }

    if (enableDistinction) {
      if (e.category === 'internalProject') {
        addGroup(internalGroups, e.stageLabel || 'פנימי', hours,
          () => e.stageColor || e.eventTypeColor || '#0073ea');
      } else if (e.category === 'externalProject') {
        addGroup(externalGroups, e.stageLabel || 'חיצוני', hours,
          () => e.stageColor || e.eventTypeColor || '#00ca72');
      } else if (e.category === 'routine') {
        addGroup(routineGroups, e.nonBillableType || 'אחר', hours,
          () => e.nonBillableColor || e.eventTypeColor || '#fdab3d');
      }
    }

    if (e.reporterId != null) {
      const key = String(e.reporterId);
      let row = employees.get(key);
      if (!row) {
        row = {
          key,
          total: 0,
          billable: 0,
          nonBillable: 0,
          internalProject: 0,
          externalProject: 0,
          routine: 0,
        };
        employees.set(key, row);
      }
      row.total += hours;
      if (e.isBillable) row.billable += hours;
      else row.nonBillable += hours;
      if (Object.prototype.hasOwnProperty.call(catHours, e.category)) {
        row[e.category] += hours;
      }
    }

    if (isValidDate(e.date)) {
      const key = granKey(e.date, granularity);
      bars.set(key, (bars.get(key) || 0) + hours);
    }
  }

  const finishPie = (map) =>
    [...map.values()].map((g) => ({
      name: g.name,
      value: round2(g.value),
      color: g.color,
    }));

  const employeeBarData = [...employees.values()].map((row) => {
    const match = reporters.find((r) => String(r.id) === row.key);
    const name = match ? match.name : `עובד ${row.key}`;
    return enableDistinction
      ? {
          name,
          total: round2(row.total),
          internalProject: round2(row.internalProject),
          externalProject: round2(row.externalProject),
          routine: round2(row.routine),
        }
      : {
          name,
          total: round2(row.total),
          billable: round2(row.billable),
          nonBillable: round2(row.nonBillable),
        };
  });

  const barData = [...bars.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, h]) => ({ key, hours: round2(h) }));

  return {
    stats: {
      totalHours: round2(total),
      billableHours: round2(billable),
      nonBillableHours: round2(nonBillable),
      billablePercent: total === 0 ? 0 : Math.round((billable / total) * 100),
      internalHours: enableDistinction ? round2(catHours.internalProject) : 0,
      externalHours: enableDistinction ? round2(catHours.externalProject) : 0,
      routineHours: enableDistinction ? round2(catHours.routine) : 0,
      internalColor:
        (enableDistinction && catColors.internalProject) || FALLBACK.internal,
      externalColor:
        (enableDistinction && catColors.externalProject) || FALLBACK.external,
      routineColor: (enableDistinction && catColors.routine) || FALLBACK.routine,
    },
    billablePieData: finishPie(billableGroups),
    nonBillablePieData: finishPie(nonBillableGroups),
    internalPieData: finishPie(internalGroups),
    externalPieData: finishPie(externalGroups),
    routinePieData: finishPie(routineGroups),
    employeeBarData,
    barData,
  };
}

// --- comparison normalizers (contract does not pin tie order) ---------------

const pickPie = (rows) =>
  rows.map(({ name, value, color }) => ({ name, value, color }));

const sortPie = (rows) =>
  [...rows].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));

const sortEmployees = (rows) =>
  [...rows].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

function expectNonIncreasing(values) {
  for (let i = 1; i < values.length; i++) {
    expect(values[i]).toBeLessThanOrEqual(values[i - 1]);
  }
}

function expectStrictlyAscendingKeys(rows) {
  for (let i = 1; i < rows.length; i++) {
    expect(rows[i].key > rows[i - 1].key).toBe(true);
  }
}

function comparePies(actual, expected) {
  const act = pickPie(actual);
  expectNonIncreasing(act.map((g) => g.value));
  expect(sortPie(act)).toEqual(sortPie(expected));
}

// ---------------------------------------------------------------------------
// Scale fixtures — dynamic import so anchor tests survive a missing/stubbed
// @axis/scale-fixtures. Do not inline a generator here.
// ---------------------------------------------------------------------------

let datasetPromise = null;
function loadDataset() {
  if (!datasetPromise) {
    datasetPromise = import('@axis/scale-fixtures').then(
      ({ genUsers, genProjects, genDashboardEvents }) => {
        const users = genUsers(30, 7);
        const projects = genProjects(40, 7);
        const events = genDashboardEvents({
          count: 5000,
          users,
          projects,
          from: '2026-01-01',
          to: '2026-03-31',
          seed: 42,
          includeEdgeCases: true,
        });
        const reporters = users.map((u) => ({ id: u.id, name: u.name }));
        return { events, reporters };
      }
    );
  }
  return datasetPromise;
}

// ---------------------------------------------------------------------------
// Hand-computed anchor dataset (8 events).
//   totals: all=13.5, billable=7 (e1,e2,e3,e4,e8), nonBillable=6.5 (e5,e6,e7)
//   e4: null date + null reporter; e6: Invalid Date; e7: zero hours;
//   e8: missing hours. Invalid/null-date hours = 0.5 + 2.5 = 3.
// ---------------------------------------------------------------------------

function makeAnchorEvents() {
  return [
    { id: 'e1', hours: 2, isBillable: true, category: 'externalProject', stageLabel: 'אפיון', stageColor: '#ff0000', nonBillableType: null, nonBillableColor: null, eventTypeLabel: 'פרויקט חיצוני', eventTypeColor: '#111111', reporterId: 7, date: new Date(2026, 0, 5) },
    { id: 'e2', hours: 1.5, isBillable: true, category: 'externalProject', stageLabel: 'אפיון', stageColor: '#00ff00', nonBillableType: null, nonBillableColor: null, eventTypeLabel: 'פרויקט חיצוני', eventTypeColor: '#111111', reporterId: 8, date: new Date(2026, 0, 5) },
    { id: 'e3', hours: 3, isBillable: true, category: 'internalProject', stageLabel: null, stageColor: null, nonBillableType: null, nonBillableColor: null, eventTypeLabel: 'ייעוץ', eventTypeColor: '#222222', reporterId: 7, date: new Date(2026, 0, 6) },
    { id: 'e4', hours: 0.5, isBillable: true, category: 'internalProject', stageLabel: null, stageColor: null, nonBillableType: null, nonBillableColor: null, eventTypeLabel: '', eventTypeColor: '', reporterId: null, date: null },
    { id: 'e5', hours: 4, isBillable: false, category: 'routine', stageLabel: null, stageColor: null, nonBillableType: 'חופשה', nonBillableColor: '#333333', eventTypeLabel: 'לא לחיוב', eventTypeColor: '#666666', reporterId: 8, date: new Date(2026, 0, 6) },
    { id: 'e6', hours: 2.5, isBillable: false, category: 'routine', stageLabel: null, stageColor: null, nonBillableType: null, nonBillableColor: null, eventTypeLabel: 'לא לחיוב', eventTypeColor: '#444444', reporterId: 7, date: new Date('nope') },
    { id: 'e7', hours: 0, isBillable: false, category: 'routine', stageLabel: null, stageColor: null, nonBillableType: 'חופשה', nonBillableColor: '#999999', eventTypeLabel: 'לא לחיוב', eventTypeColor: '#666666', reporterId: 8, date: new Date(2026, 0, 7) },
    { id: 'e8', isBillable: true, category: 'externalProject', stageLabel: 'פיתוח', stageColor: '#555555', nonBillableType: null, nonBillableColor: null, eventTypeLabel: 'פרויקט', eventTypeColor: '#123456', reporterId: 7, date: new Date(2026, 0, 7) },
  ];
}

const ANCHOR_REPORTERS = [{ id: 7, name: 'דנה לוי' }]; // id 8 intentionally absent

describe('aggregateAll — hand-computed anchor (day granularity)', () => {
  it('computes exact stats including null-date, Invalid-Date and zero-hour events', () => {
    const { stats } = aggregateAll(makeAnchorEvents(), 'day', false, ANCHOR_REPORTERS);
    expect(stats).toMatchObject({
      totalHours: 13.5,
      billableHours: 7,
      nonBillableHours: 6.5,
      billablePercent: 52, // Math.round(7 / 13.5 * 100)
      internalHours: 0,
      externalHours: 0,
      routineHours: 0,
      internalColor: '#0073ea',
      externalColor: '#00ca72',
      routineColor: '#fdab3d',
    });
  });

  it('groups billable hours by stage label with event-type and פרויקטים fallbacks and keeps the first-seen group color', () => {
    const { billablePieData } = aggregateAll(makeAnchorEvents(), 'day', false, ANCHOR_REPORTERS);
    // e2 shares group 'אפיון' with e1 but has a different stageColor —
    // the group must keep e1's color (first event that created the group).
    expect(pickPie(billablePieData)).toEqual([
      { name: 'אפיון', value: 3.5, color: '#ff0000' },
      { name: 'ייעוץ', value: 3, color: '#222222' },
      { name: 'פרויקטים', value: 0.5, color: '#0073ea' },
      { name: 'פיתוח', value: 0, color: '#555555' },
    ]);
  });

  it('groups non-billable hours by non-billable type with אחר fallback and first-seen colors', () => {
    const { nonBillablePieData } = aggregateAll(makeAnchorEvents(), 'day', false, ANCHOR_REPORTERS);
    // e7 shares 'חופשה' with e5 but carries '#999999' — group keeps e5's '#333333'.
    expect(pickPie(nonBillablePieData)).toEqual([
      { name: 'חופשה', value: 4, color: '#333333' },
      { name: 'אחר', value: 2.5, color: '#444444' },
    ]);
  });

  it('builds employee rows joining reporter names, falling back to עובד <id>, sorted by total desc', () => {
    const { employeeBarData } = aggregateAll(makeAnchorEvents(), 'day', false, ANCHOR_REPORTERS);
    expect(
      employeeBarData.map(({ name, total, billable, nonBillable }) => ({ name, total, billable, nonBillable }))
    ).toEqual([
      { name: 'דנה לוי', total: 7.5, billable: 5, nonBillable: 2.5 },
      { name: 'עובד 8', total: 5.5, billable: 1.5, nonBillable: 4 },
    ]);
  });

  it('buckets only valid-dated events into day bars while stats keep the null/invalid-date hours', () => {
    const result = aggregateAll(makeAnchorEvents(), 'day', false, ANCHOR_REPORTERS);
    expect(result.barData.map(({ key, hours }) => ({ key, hours }))).toEqual([
      { key: '2026-01-05', hours: 3.5 },
      { key: '2026-01-06', hours: 7 },
      { key: '2026-01-07', hours: 0 },
    ]);
    result.barData.forEach((bar) => {
      expect(typeof bar.label).toBe('string');
      expect(bar.label.length).toBeGreaterThan(0);
    });
    const barSum = result.barData.reduce((s, b) => s + b.hours, 0);
    // e4 (0.5h, null date) + e6 (2.5h, Invalid Date) are in stats but not bars.
    expect(round2(result.stats.totalHours - barSum)).toBe(3);
  });

  it('splits category hours, captures first-seen category colors and fills distinction pies when enableDistinction is true', () => {
    const result = aggregateAll(makeAnchorEvents(), 'day', true, ANCHOR_REPORTERS);
    expect(result.stats).toMatchObject({
      totalHours: 13.5,
      billableHours: 7,
      nonBillableHours: 6.5,
      billablePercent: 52,
      internalHours: 3.5, // e3 + e4
      externalHours: 3.5, // e1 + e2 + e8(0)
      routineHours: 6.5, // e5 + e6 + e7(0)
      internalColor: '#222222', // first internal event (e3)
      externalColor: '#111111', // first external event (e1)
      routineColor: '#666666', // first routine event (e5)
    });
    expect(pickPie(result.internalPieData)).toEqual([
      { name: 'פנימי', value: 3.5, color: '#222222' },
    ]);
    expect(pickPie(result.externalPieData)).toEqual([
      { name: 'אפיון', value: 3.5, color: '#ff0000' },
      { name: 'פיתוח', value: 0, color: '#555555' },
    ]);
    expect(pickPie(result.routinePieData)).toEqual([
      { name: 'חופשה', value: 4, color: '#333333' },
      { name: 'אחר', value: 2.5, color: '#444444' },
    ]);
    expect(
      result.employeeBarData.map(
        ({ name, total, internalProject, externalProject, routine }) =>
          ({ name, total, internalProject, externalProject, routine })
      )
    ).toEqual([
      { name: 'דנה לוי', total: 7.5, internalProject: 3, externalProject: 2, routine: 2.5 },
      { name: 'עובד 8', total: 5.5, internalProject: 0, externalProject: 1.5, routine: 4 },
    ]);
  });

  it('groups week bars by the week containing the date and re-buckets boundary days when weekStartsOn changes', () => {
    // 2026-01-04 is a Sunday, 2026-01-10 a Saturday, 2026-01-11 a Sunday.
    const events = [
      { id: 'w1', hours: 1, isBillable: true, category: 'externalProject', stageLabel: null, stageColor: null, nonBillableType: null, nonBillableColor: null, eventTypeLabel: 'א', eventTypeColor: '#111111', reporterId: 1, date: new Date(2026, 0, 4) },
      { id: 'w2', hours: 2, isBillable: true, category: 'externalProject', stageLabel: null, stageColor: null, nonBillableType: null, nonBillableColor: null, eventTypeLabel: 'א', eventTypeColor: '#111111', reporterId: 1, date: new Date(2026, 0, 10) },
      { id: 'w3', hours: 4, isBillable: true, category: 'externalProject', stageLabel: null, stageColor: null, nonBillableType: null, nonBillableColor: null, eventTypeLabel: 'א', eventTypeColor: '#111111', reporterId: 1, date: new Date(2026, 0, 11) },
    ];
    // weekStartsOn=0 (Sunday): {Jan4, Jan10} together, {Jan11} alone.
    const sunday = aggregateAll(events, 'week', false, [], 0);
    expect(sunday.barData).toHaveLength(2);
    expect(sunday.barData.map((b) => b.hours).sort((a, b) => a - b)).toEqual([3, 4]);
    expect(round2(sunday.barData.reduce((s, b) => s + b.hours, 0))).toBe(7);
    // weekStartsOn=1 (Monday): {Jan4} alone, {Jan10, Jan11} together.
    const monday = aggregateAll(events, 'week', false, [], 1);
    expect(monday.barData).toHaveLength(2);
    expect(monday.barData.map((b) => b.hours).sort((a, b) => a - b)).toEqual([1, 6]);
    expect(round2(monday.barData.reduce((s, b) => s + b.hours, 0))).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Scale — 5,000 generated events vs the independent reference.
// ---------------------------------------------------------------------------

describe('aggregateAll — 5,000-event scale vs independent reference', () => {
  it('matches the reference on stats, pies, employees and day bars with enableDistinction=false', async () => {
    const { events, reporters } = await loadDataset();
    const actual = aggregateAll(events, 'day', false, reporters);
    const expected = refAggregate(events, 'day', false, reporters);

    expect(actual.stats).toMatchObject(expected.stats);
    comparePies(actual.billablePieData, expected.billablePieData);
    comparePies(actual.nonBillablePieData, expected.nonBillablePieData);
    expect(actual.internalPieData).toEqual([]);
    expect(actual.externalPieData).toEqual([]);
    expect(actual.routinePieData).toEqual([]);

    const actEmployees = actual.employeeBarData.map(
      ({ name, total, billable, nonBillable }) => ({ name, total, billable, nonBillable })
    );
    expectNonIncreasing(actEmployees.map((r) => r.total));
    expect(sortEmployees(actEmployees)).toEqual(sortEmployees(expected.employeeBarData));

    expect(actual.barData.map(({ key, hours }) => ({ key, hours }))).toEqual(expected.barData);
    expectStrictlyAscendingKeys(actual.barData);
  });

  it('matches the reference on category stats, distinction pies and category employee splits with enableDistinction=true', async () => {
    const { events, reporters } = await loadDataset();
    const actual = aggregateAll(events, 'day', true, reporters);
    const expected = refAggregate(events, 'day', true, reporters);

    expect(actual.stats).toMatchObject(expected.stats);
    comparePies(actual.billablePieData, expected.billablePieData);
    comparePies(actual.nonBillablePieData, expected.nonBillablePieData);
    comparePies(actual.internalPieData, expected.internalPieData);
    comparePies(actual.externalPieData, expected.externalPieData);
    comparePies(actual.routinePieData, expected.routinePieData);

    const actEmployees = actual.employeeBarData.map(
      ({ name, total, internalProject, externalProject, routine }) =>
        ({ name, total, internalProject, externalProject, routine })
    );
    expectNonIncreasing(actEmployees.map((r) => r.total));
    expect(sortEmployees(actEmployees)).toEqual(sortEmployees(expected.employeeBarData));

    expect(actual.barData.map(({ key, hours }) => ({ key, hours }))).toEqual(expected.barData);
    expectStrictlyAscendingKeys(actual.barData);
  });
});

describe('aggregateAll — granularity conservation at scale', () => {
  test.each(['day', 'week', 'month', 'year'])(
    'preserves valid-dated hours in %s bars with strictly ascending keys',
    async (granularity) => {
      const { events } = await loadDataset();
      const expectedSum = events
        .filter((e) => isValidDate(e.date))
        .reduce((s, e) => s + (e.hours || 0), 0);
      const { barData } = aggregateAll(events, granularity);
      const actualSum = barData.reduce((s, b) => s + b.hours, 0);
      expect(actualSum).toBeCloseTo(expectedSum, 1);
      expectStrictlyAscendingKeys(barData);
    }
  );

  it('produces sane group counts across granularities (day >= month >= year, year <= week <= day)', async () => {
    const { events } = await loadDataset();
    const counts = {};
    for (const g of ['day', 'week', 'month', 'year']) {
      counts[g] = aggregateAll(events, g).barData.length;
    }
    expect(counts.day).toBeGreaterThanOrEqual(counts.month);
    expect(counts.month).toBeGreaterThanOrEqual(counts.year);
    expect(counts.week).toBeGreaterThanOrEqual(counts.year);
    expect(counts.week).toBeLessThanOrEqual(counts.day);
    expect(counts.year).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// consolidateBarData
// ---------------------------------------------------------------------------

function makeDayBars(count) {
  return Array.from({ length: count }, (_, i) => ({
    key: `2026-${String(i).padStart(3, '0')}`,
    label: 'x',
    hours: i % 8,
    startDate: new Date(2026, 0, 1 + i),
    endDate: new Date(2026, 0, 1 + i),
  }));
}

function expectedChunks(bars, maxBars) {
  const chunkSize = Math.ceil(bars.length / maxBars);
  const out = [];
  for (let i = 0; i < bars.length; i += chunkSize) {
    const chunk = bars.slice(i, i + chunkSize);
    out.push({
      key: chunk[0].key,
      hours: round2(chunk.reduce((s, b) => s + b.hours, 0) / chunk.length),
      startDate: chunk[0].startDate,
      endDate: chunk[chunk.length - 1].endDate,
    });
  }
  return out;
}

describe('consolidateBarData', () => {
  it('returns the same reference for null, short, and exactly-maxBars-long input', () => {
    expect(consolidateBarData(null)).toBe(null);
    const short = makeDayBars(3);
    expect(consolidateBarData(short)).toBe(short);
    const exact = makeDayBars(25);
    expect(consolidateBarData(exact)).toBe(exact);
  });

  it('caps 365 day bars at 25 chunk-averaged bars keeping the first key and last end date', () => {
    const bars = makeDayBars(365);
    const expected = expectedChunks(bars, 25); // chunkSize = ceil(365/25) = 15
    const out = consolidateBarData(bars);

    expect(out.length).toBeLessThanOrEqual(25);
    expect(out.length).toBe(expected.length);
    out.forEach((bar, i) => {
      expect(bar.key).toBe(expected[i].key);
      expect(bar.hours).toBe(expected[i].hours);
      expect(bar.startDate).toEqual(expected[i].startDate);
      expect(bar.endDate).toEqual(expected[i].endDate);
      expect(typeof bar.label).toBe('string');
      expect(bar.label.length).toBeGreaterThan(0);
    });
    expect(out[0].key).toBe(bars[0].key);
    expect(out[out.length - 1].endDate).toEqual(bars[bars.length - 1].endDate);
  });

  it('averages hours per chunk with an explicit maxBars', () => {
    // hours 1..10, maxBars 3 => chunkSize 4 => averages 2.5, 6.5, 9.5
    const bars = makeDayBars(10).map((b, i) => ({ ...b, hours: i + 1 }));
    const out = consolidateBarData(bars, 3);
    expect(out.map((b) => b.hours)).toEqual([2.5, 6.5, 9.5]);
    expect(out.map((b) => b.key)).toEqual([bars[0].key, bars[4].key, bars[8].key]);
    expect(out[2].endDate).toEqual(bars[9].endDate);
  });
});

// ---------------------------------------------------------------------------
// Empty input
// ---------------------------------------------------------------------------

describe('aggregateAll — empty input', () => {
  const ZERO_STATS = {
    totalHours: 0,
    billableHours: 0,
    nonBillableHours: 0,
    billablePercent: 0,
    internalHours: 0,
    externalHours: 0,
    routineHours: 0,
  };

  it.each([
    ['empty array', []],
    ['null', null],
  ])('returns the zero stats shape (no color fields) and empty arrays for %s events', (_label, input) => {
    const result = aggregateAll(input, 'day');
    expect(result.stats).toEqual(ZERO_STATS);
    expect(result.barData).toEqual([]);
    expect(result.billablePieData).toEqual([]);
    expect(result.nonBillablePieData).toEqual([]);
    expect(result.internalPieData).toEqual([]);
    expect(result.externalPieData).toEqual([]);
    expect(result.routinePieData).toEqual([]);
    expect(result.employeeBarData).toEqual([]);
  });
});
