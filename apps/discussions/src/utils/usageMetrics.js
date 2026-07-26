/*
 * Usage metrics — a LIGHTWEIGHT, account-wide usage tracker for the owner-only
 * "מדדי שימוש" tab (round265). Deliberately built to NOT touch the app's hot path:
 *
 *  - Data lives in the account-wide `monday.storage` (shared across every user of
 *    the app, like the rest of the app's storage). To avoid cross-user write
 *    contention (which would be a perf/stability risk with many concurrent
 *    users), EACH user writes ONLY their own document — never a shared counter.
 *    A tiny shared index lists the user ids so the owner's tab can fan-out-read
 *    and aggregate at view time (reads happen only while that tab is open).
 *
 *      index key   `discussions_usage_users`     -> { users: string[] }
 *      per-user    `discussions_usage_u_<uid>`   -> { days: { 'YYYY-MM-DD': { entered: 1, actions: N } } }
 *
 *  - An ENTRY is recorded at most once per user per UTC day (localStorage guard),
 *    so a user entering twice a day counts once.
 *  - ACTIONS accumulate in memory (noteAction) and are flushed on a throttle
 *    (~10s + on tab hide) into the user's OWN doc — a read-modify-write of one
 *    small key, never on every click.
 *
 * The aggregation/bucketing helpers below are PURE (no IO) so they're unit-tested
 * directly; the IO functions swallow failures (usage tracking must never surface
 * an error to the user or block anything).
 */
import { monday } from './mondayApi/monday-client.js';
import logger from './logger.js';

const INDEX_KEY = 'discussions_usage_users';
const userKey = (uid) => `discussions_usage_u_${uid}`;
const TIMEOUT_MS = 5000;
const RETAIN_DAYS = 180; // prune each user doc to the last ~6 months

function withTimeout(p) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS)),
  ]);
}

/** UTC 'YYYY-MM-DD' for a Date (defaults to now). Pure given its input. */
export function dayKeyUTC(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

// ---- storage IO (all failure-tolerant) ------------------------------------

async function readJson(key) {
  try {
    const res = await withTimeout(monday.storage.getItem(key));
    if (res?.data?.value) {
      const parsed = JSON.parse(res.data.value);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch (err) {
    // storage unavailable / parse error — usage tracking is best-effort, so we
    // treat it as empty, but log it so a persistent failure is still visible.
    logger.warn('usageMetrics', `קריאת ${key} נכשלה`, err);
  }
  return null;
}

async function writeJson(key, value) {
  try {
    await withTimeout(monday.storage.setItem(key, JSON.stringify(value)));
    return true;
  } catch (err) {
    logger.warn('usageMetrics', 'שמירת מדד שימוש נכשלה', err);
    return false;
  }
}

function pruneDays(days) {
  const keys = Object.keys(days || {});
  if (keys.length <= RETAIN_DAYS) return days;
  const keep = keys.sort().slice(-RETAIN_DAYS);
  const out = {};
  keep.forEach((k) => { out[k] = days[k]; });
  return out;
}

async function ensureIndexed(uid) {
  const idx = (await readJson(INDEX_KEY)) || {};
  const users = Array.isArray(idx.users) ? idx.users.map(String) : [];
  if (!users.includes(String(uid))) {
    users.push(String(uid));
    await writeJson(INDEX_KEY, { users });
  }
}

/** Record today's entry for this user — at most once per UTC day (guarded). */
export async function recordEntry(uid) {
  if (!uid) return;
  const today = dayKeyUTC();
  const guard = `discussions_usage_seen_${uid}_${today}`;
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem(guard)) return;
  } catch (err) {
    // localStorage blocked — fall through (at worst one extra idempotent write).
    logger.warn('usageMetrics', 'localStorage לא זמין (בדיקת guard כניסה)', err);
  }

  const doc = (await readJson(userKey(uid))) || { days: {} };
  const days = doc.days && typeof doc.days === 'object' ? doc.days : {};
  const day = days[today] || { entered: 0, actions: 0 };
  if (day.entered !== 1) {
    day.entered = 1;
    days[today] = day;
    await writeJson(userKey(uid), { days: pruneDays(days) });
  }
  await ensureIndexed(uid);
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(guard, '1');
  } catch (err) {
    logger.warn('usageMetrics', 'localStorage לא זמין (סימון guard כניסה)', err);
  }
}

// ---- action counting (in-memory + throttled flush) -------------------------

let pendingActions = 0;
export function noteAction(n = 1) { pendingActions += n; }
export function _pending() { return pendingActions; } // test seam

/** Flush accumulated actions into this user's own doc (read-modify-write). */
export async function flushActions(uid) {
  if (!uid || pendingActions <= 0) return;
  const n = pendingActions;
  pendingActions = 0; // reset up-front so concurrent clicks accumulate cleanly
  const today = dayKeyUTC();
  const doc = (await readJson(userKey(uid))) || { days: {} };
  const days = doc.days && typeof doc.days === 'object' ? doc.days : {};
  const day = days[today] || { entered: 0, actions: 0 };
  day.actions = (day.actions || 0) + n;
  days[today] = day;
  const ok = await writeJson(userKey(uid), { days: pruneDays(days) });
  if (!ok) pendingActions += n; // write failed — don't lose the delta
}

/** Read the whole per-user dataset: { [uid]: { 'YYYY-MM-DD': {entered, actions} } }. */
export async function loadUsageData() {
  const idx = (await readJson(INDEX_KEY)) || {};
  const users = Array.isArray(idx.users) ? idx.users.map(String) : [];
  const docs = await Promise.all(users.map(async (uid) => {
    const doc = await readJson(userKey(uid));
    return [uid, (doc && doc.days) || {}];
  }));
  const out = {};
  docs.forEach(([uid, days]) => { out[uid] = days; });
  return out;
}

// ---- PURE aggregation / bucketing (unit-tested) ----------------------------

/** Sunday-anchored week start ('YYYY-MM-DD') for a 'YYYY-MM-DD' day, in UTC. */
export function weekStartUTC(dayStr) {
  const d = new Date(`${dayStr}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0 = Sunday
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/** Bucket key for a day under a granularity: day => the day; week => its Sunday;
 *  month => 'YYYY-MM'. Pure. */
export function bucketKey(dayStr, granularity) {
  if (granularity === 'month') return dayStr.slice(0, 7);
  if (granularity === 'week') return weekStartUTC(dayStr);
  return dayStr;
}

/**
 * Build the trend series from the per-user dataset.
 *  - metric 'entries': DISTINCT users who entered within each bucket (a user who
 *    entered on several days of the bucket counts once for that bucket).
 *  - metric 'actions': SUM of actions across all users/days in each bucket.
 * Returns [{ bucket, value }] sorted ascending by bucket. Pure.
 */
export function buildSeries(userDocs, granularity = 'day', metric = 'entries') {
  const byBucket = new Map(); // bucket -> Set(uid) | number
  Object.entries(userDocs || {}).forEach(([uid, days]) => {
    Object.entries(days || {}).forEach(([day, rec]) => {
      const b = bucketKey(day, granularity);
      if (metric === 'actions') {
        byBucket.set(b, (byBucket.get(b) || 0) + (rec?.actions || 0));
      } else if (rec?.entered) {
        if (!byBucket.has(b)) byBucket.set(b, new Set());
        byBucket.get(b).add(String(uid));
      }
    });
  });
  return [...byBucket.entries()]
    .map(([bucket, v]) => ({ bucket, value: v instanceof Set ? v.size : v }))
    .sort((a, b) => (a.bucket < b.bucket ? -1 : a.bucket > b.bucket ? 1 : 0));
}

/** Average daily unique entrants over the ACTIVE days (days with ≥1 entry). Pure. */
export function averageDailyUsers(userDocs) {
  const perDay = new Map(); // day -> Set(uid)
  Object.entries(userDocs || {}).forEach(([uid, days]) => {
    Object.entries(days || {}).forEach(([day, rec]) => {
      if (rec?.entered) {
        if (!perDay.has(day)) perDay.set(day, new Set());
        perDay.get(day).add(String(uid));
      }
    });
  });
  if (perDay.size === 0) return 0;
  let total = 0;
  perDay.forEach((set) => { total += set.size; });
  return total / perDay.size;
}
