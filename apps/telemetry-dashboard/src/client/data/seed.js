// Synthetic telemetry seed — the dev/demo fallback the dashboard renders when
// the server is in seed mode ({ seed:true }) or the fetch fails. It contains
// NO real account identifiers and NO real error data: everything here is
// generated from a fixed PRNG so the demo is stable in shape while its
// timestamps float relative to "now" (so the time-window filters stay
// meaningful whenever the page is opened).
//
// ~4000 records across the 7 apps, 8 fake accounts, and 3 kinds over 30 days.

// Deterministic PRNG (mulberry32) so panel shapes are reproducible.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(0x7e1e3e77);

function pick(rng, weightedList) {
  const total = weightedList.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [value, w] of weightedList) {
    r -= w;
    if (r <= 0) return value;
  }
  return weightedList[weightedList.length - 1][0];
}

// Apps with relative activity weights (drives bar-chart variety).
const APPS = [
  ['deadline-confirm', 22],
  ['sync-calender', 18],
  ['discussions', 15],
  ['team-people-column', 12],
  ['planner', 14],
  ['tracker', 11],
  ['day-off', 8],
];

// 8 fake accounts — synthetic names, never real monday account ids.
const ACCOUNTS = [
  ['Northwind', 20],
  ['Globex', 16],
  ['Initech', 14],
  ['Umbrella', 12],
  ['Hooli', 11],
  ['Soylent', 10],
  ['Vandelay', 9],
  ['Wonka', 8],
];

// Scrubbed error catalog: [name, message, code, weight].
const ERRORS = [
  ['RateLimitError', 'complexity budget exceeded on boards query', 429, 20],
  ['TimeoutError', 'monday api did not respond within 30s', 504, 14],
  ['GraphQLError', 'ColumnValueException: value mutation rejected', 400, 16],
  ['AuthError', 'sessionToken expired or signature mismatch', 401, 10],
  ['ValidationError', 'boardId missing from webhook payload', 422, 12],
  ['NetworkError', 'fetch failed: ECONNRESET', 502, 9],
  ['StorageError', 'secure storage read conflict (retry)', 500, 8],
  ['RenderError', 'admin view crashed on initial render', 500, 6],
];

// Usage events: [message, weight]. view_open* rows classify as view_open.
const USAGE_EVENTS = [
  ['view_open:dashboard', 26],
  ['view_open:settings', 18],
  ['view_open:board_view', 14],
  ['track:save_config', 12],
  ['track:button_click', 20],
  ['track:oauth_connect', 6],
  ['track:template_edit', 8],
  ['track:sync_run', 10],
  ['track:export', 5],
];

const LATENCY_BUCKETS = [
  ['fast', 40],
  ['ok', 30],
  ['slow', 18],
  ['very_slow', 8],
];

// Usage-dominated, like real product telemetry (error rate lands ~6–7%).
const KIND_MIX = [
  ['usage', 80],
  ['error', 7],
  ['health', 13],
];

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_MS = 30 * DAY_MS;
const NOW = Date.now();

function buildSeed(count) {
  const records = [];
  for (let i = 0; i < count; i++) {
    // Bias timestamps toward the recent past (square skew).
    const skew = rand() * rand();
    const t = NOW - Math.floor(skew * WINDOW_MS);
    const _time = new Date(t).toISOString();
    const app = pick(rand, APPS);
    const acc = pick(rand, ACCOUNTS);
    const kind = pick(rand, KIND_MIX);

    const base = { _time, kind, app, acc };

    if (kind === 'error') {
      const [name, msg, code] = pick(
        rand,
        ERRORS.map((e) => [e, e[3]])
      );
      records.push({ ...base, err_name: name, err_msg: msg, err_code: code, message: name });
    } else if (kind === 'usage') {
      const message = pick(rand, USAGE_EVENTS);
      records.push({ ...base, message });
    } else {
      // health: split between boot and api_latency
      if (rand() < 0.4) {
        const total_ms = Math.round(200 + rand() * rand() * 3200); // boot time
        records.push({ ...base, tag: 'boot', message: 'boot', total_ms });
      } else {
        const bucket = pick(rand, LATENCY_BUCKETS);
        const total_ms = Math.round(30 + rand() * 900);
        records.push({ ...base, tag: 'api', message: `api_latency bucket=${bucket}`, total_ms });
      }
    }
  }
  return records;
}

export const SEED_RECORDS = buildSeed(4000);
export const SEED_NOW = NOW;
