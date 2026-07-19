/**
 * @axis/scale-fixtures — deterministic high-scale test data for the axis apps.
 * Contract: src/index.d.ts. Every generator is a pure function of its inputs —
 * same seed, same output (no Date.now / Math.random anywhere).
 *
 * monday response shapes (items_page/cursor, aggregate entries, column_values
 * fragments) mirror the captured fixtures already proven in the apps' existing
 * test suites (planner mondayService tests, day-off vacationService tests).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export function makeRng(seed) {
  // mulberry32 — small, fast, deterministic.
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function round2(x) {
  return Math.round(x * 100) / 100;
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

/** Seed-dependent short token so different seeds produce different names. */
function seedToken(rng) {
  return Math.floor(rng() * 1e6).toString(36);
}

export function genUsers(count, seed = 1) {
  const rng = makeRng(seed);
  const token = seedToken(rng);
  return Array.from({ length: count }, (_, i) => ({
    id: 1001 + i,
    name: `עובד ${i + 1} (${token})`,
  }));
}

export function genProjects(count, seed = 1) {
  const rng = makeRng(seed);
  const token = seedToken(rng);
  return Array.from({ length: count }, (_, i) => ({
    id: String(9000001 + i),
    name: `פרויקט ${i + 1} (${token})`,
  }));
}

const STAGE_LABELS = ['תכנון', 'ביצוע', 'פיקוח', 'מסירה'];
const STAGE_COLORS = ['#0086c0', '#9cd326', '#ffcb00', '#e2445c'];
const NON_BILLABLE_TYPES = ['ישיבת צוות', 'הדרכה', 'אדמיניסטרציה'];
const NON_BILLABLE_COLORS = ['#784bd1', '#ff642e', '#808080'];
const CATEGORIES = ['internalProject', 'externalProject', 'routine'];
const CATEGORY_COLORS = {
  internalProject: '#0073ea',
  externalProject: '#00ca72',
  routine: '#fdab3d',
};

/** Noon-UTC Date for a day offset inside [from..to] — safely inside the
 *  inclusive window under any test-side timezone interpretation. */
function noonUtc(fromKey, dayOffset) {
  const [y, m, d] = fromKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + dayOffset, 12, 0, 0, 0));
}

function daySpan(fromKey, toKey) {
  const from = Date.parse(`${fromKey}T00:00:00Z`);
  const to = Date.parse(`${toKey}T00:00:00Z`);
  return Math.floor((to - from) / DAY_MS) + 1;
}

export function genDashboardEvents(opts) {
  const {
    count, users, projects, from, to,
    seed = 1, includeEdgeCases = false,
  } = opts;
  const rng = makeRng(seed);
  const days = daySpan(from, to);
  const events = [];
  for (let i = 0; i < count; i++) {
    // Guarantee all three categories and both billable sides at any count ≥ 6.
    const category = i < CATEGORIES.length ? CATEGORIES[i] : pick(rng, CATEGORIES);
    const isBillable = category !== 'routine';
    const stageIdx = Math.floor(rng() * STAGE_LABELS.length);
    const hasStage = isBillable && rng() < 0.8;
    const nbIdx = Math.floor(rng() * NON_BILLABLE_TYPES.length);
    const hasNbType = !isBillable && rng() < 0.9;
    const project = pick(rng, projects);
    events.push({
      id: `ev-${i + 1}`,
      hours: 0.25 * (1 + Math.floor(rng() * 32)), // 0.25 .. 8.0
      isBillable,
      category,
      stageLabel: hasStage ? STAGE_LABELS[stageIdx] : null,
      stageColor: hasStage ? STAGE_COLORS[stageIdx] : null,
      nonBillableType: hasNbType ? NON_BILLABLE_TYPES[nbIdx] : null,
      nonBillableColor: hasNbType ? NON_BILLABLE_COLORS[nbIdx] : null,
      eventTypeLabel: isBillable ? 'שעתי' : 'לא לחיוב',
      eventTypeColor: CATEGORY_COLORS[category],
      reporterId: pick(rng, users).id,
      projectName: project.name,
      date: noonUtc(from, Math.floor(rng() * days)),
    });
  }
  if (includeEdgeCases) {
    const base = events[0] ?? {
      hours: 1, isBillable: true, category: 'internalProject',
      stageLabel: null, stageColor: null, nonBillableType: null,
      nonBillableColor: null, eventTypeLabel: 'שעתי', eventTypeColor: '#0073ea',
      reporterId: users[0]?.id ?? null, projectName: '', date: noonUtc(from, 0),
    };
    events.push(
      { ...base, id: 'edge-null-date', date: null },
      { ...base, id: 'edge-invalid-date', date: new Date('not-a-date') },
      { ...base, id: 'edge-null-reporter', reporterId: null },
      { ...base, id: 'edge-zero-hours', hours: 0 },
    );
  }
  return events;
}

function dayKey(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function genDayOffRequests(opts) {
  const { employeeIds, types, year, count, seed = 1 } = opts;
  const rng = makeRng(seed);
  const statuses = ['pending', 'approved', 'rejected'];
  const requests = [];
  for (let i = 0; i < count; i++) {
    const month = 1 + Math.floor(rng() * 12);
    const day = 1 + Math.floor(rng() * 28);
    const span = Math.floor(rng() * 10); // 0..9 extra days → 1..10 total
    const start = dayKey(year, month, day);
    const end = new Date(Date.parse(`${start}T00:00:00Z`) + span * DAY_MS);
    requests.push({
      id: `req-${i + 1}`,
      employeeId: pick(rng, employeeIds),
      type: pick(rng, types),
      start,
      end: dayKey(end.getUTCFullYear(), end.getUTCMonth() + 1, end.getUTCDate()),
      status: statuses[i % statuses.length],
      submittedAt: start,
    });
  }
  return requests;
}

export function genEntitlements(opts) {
  const { employeeIds, types, year, seed = 1 } = opts;
  const rng = makeRng(seed);
  const rows = [];
  for (const employeeId of employeeIds) {
    for (const type of types) {
      rows.push({ employeeId, type, year, entitled: 5 + Math.floor(rng() * 26) });
    }
  }
  return rows;
}

export function genAllocationItems(opts) {
  const { count, projects, users, projectColumnId, employeeColumnId, seed = 1 } = opts;
  const rng = makeRng(seed);
  return Array.from({ length: count }, (_, i) => {
    const project = pick(rng, projects);
    const user = pick(rng, users);
    return {
      id: `alloc-item-${i + 1}`,
      name: `${user.name} — ${project.name}`,
      column_values: [
        { id: projectColumnId, text: project.name, linked_item_ids: [project.id] },
        { id: employeeColumnId, text: user.name, persons_and_teams: [{ id: user.id }] },
      ],
    };
  });
}

export function genAggregateGroups(opts) {
  const {
    ids, seed = 1, idAlias = 'alloc_id', valueAlias = 'hrs', nullGroupHours,
  } = opts;
  const rng = makeRng(seed);
  const group = (id, hours) => ({
    entries: [
      { alias: idAlias, value: { value: id } },
      { alias: valueAlias, value: { result: hours } },
    ],
  });
  const groups = ids.map((id) => group(id, round2(1 + rng() * 199)));
  if (nullGroupHours !== undefined) groups.unshift(group(null, nullGroupHours));
  return groups;
}

export function paginate(items, pageSize) {
  if (items.length === 0) return [{ cursor: null, items: [] }];
  const pages = [];
  for (let i = 0; i < items.length; i += pageSize) {
    pages.push({ cursor: null, items: items.slice(i, i + pageSize) });
  }
  pages.forEach((page, i) => {
    page.cursor = i < pages.length - 1 ? `cursor-${i + 1}` : null;
  });
  return pages;
}
