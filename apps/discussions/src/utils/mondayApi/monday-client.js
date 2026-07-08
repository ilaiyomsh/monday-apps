/*
 * monday-sdk-js wrapper: seamless auth inside monday; token via
 * VITE_MONDAY_TOKEN for local dev. Also holds value (de)serialization that
 * turns monday column_values <-> the shapes the exported app expects.
 */
import mondaySdk from 'monday-sdk-js';
import { safeApi, MondayApiError } from './client.js';
import { assertNoGraphQLErrors } from './assertGraphQL.js';
import { extractOperationName } from '../errorHandler';
import logger from '../logger';
import { localYmd } from '../dateTime.js';

const monday = mondaySdk();
// API VERSION — the load-bearing truth (verified live against the API, 2026-07):
//   The monday iframe SDK (seamless auth, monday-sdk-js 0.5.8) does NOT honor
//   setApiVersion()/per-call apiVersion for `monday.api()` — the seamless call is
//   executed by the PARENT monday window, which uses monday's ROLLING-LATEST API
//   version. That version is currently >= 2026-10, where the flat user photo
//   scalars (photo_thumb/photo_small/…) were REMOVED in favor of the PhotoUrl
//   object `photo_url { small }`. So a `photo_thumb` query throws "Graphql
//   validation errors" IN-APP even though it validates fine at 2026-04.
//   => The photo field is chosen at RUNTIME per the detected version — see
//      ensureUserPhotoSelection() below. The forwarded per-call apiVersion here is
//      honored by LOCAL dev (token path) and forwarded to the seamless parent
//      (which may or may not honor it); detection reads whatever actually executes.
export const API_VERSION = "2026-07";
monday.setApiVersion(API_VERSION);

// ---- User photo field: PROBE the live schema, never assume -----------------
// monday deprecated the flat `photo_thumb` scalar (2026-07) and removed it at
// 2026-10, replacing it with the `photo_url { … }` object. BUT the SEAMLESS iframe
// `monday.api()` runs against the PARENT monday window's GraphQL, whose effective
// schema we CANNOT determine reliably: the apiVersion we pass isn't honored, and
// the `version` query's reported value does NOT match which fields actually
// validate (observed live — a photo_thumb query failed even though `version`
// reported < 2026-10, and a photo_url query failed too). Version-based selection
// is therefore impossible.
//
// So we PROBE: on first use, try each candidate photo selection on a 1-row `users`
// query via a RAW monday.api() call (bypassing api()/safeApi so probe failures
// never reach the error toast — seamless monday.api REJECTS on validation errors).
// The first candidate the API accepts is cached for the session; if NONE work we
// fall back to '' (no photo field) so the UI still loads with initials instead of
// crashing with "Graphql validation errors". normalizePhoto() reads whatever came
// back. This is correct no matter what schema the parent actually runs.
const PHOTO_CANDIDATES = [
  'photo_url { small }',  // 2026-10+ PhotoUrl object (150px)
  'photo_url { thumb }',  // 2026-10+ PhotoUrl object (100px) — in case `small` differs
  'photo_small',          // legacy scalar (may survive after photo_thumb removal)
  'photo_tiny',           // legacy scalar
  'photo_original',       // legacy scalar
  'photo_thumb',          // legacy scalar (removed at 2026-10)
  '',                     // no photo — initials only (guaranteed to validate)
];
let _photoSelection = null; // resolved selection string ('' = none); null = not probed
let _probePromise = null;   // in-flight probe (dedup concurrent callers)

// Resolve (once per session) a user-photo selection the live schema accepts.
// EVERY photo-bearing query awaits this first.
export async function ensureUserPhotoSelection() {
  if (_photoSelection !== null) return _photoSelection;
  if (!_probePromise) {
    _probePromise = (async () => {
      for (const cand of PHOTO_CANDIDATES) {
        if (cand === '') { _photoSelection = ''; break; }
        try {
          // RAW monday.api (not api()/safeApi): a rejected promise = the schema
          // rejected this candidate; a resolved promise = it's accepted. No toast.
          await monday.api(`query { users (limit: 1) { id ${cand} } }`, { apiVersion: API_VERSION });
          _photoSelection = cand;
          break;
        } catch (_e) {
          // candidate not in the live schema — try the next one
        }
      }
      if (_photoSelection === null) _photoSelection = '';
      logger.info('mondayApi', 'probed user photo field', { photoSelection: _photoSelection || '(none)' });
      return _photoSelection;
    })();
  }
  return _probePromise;
}

// Flatten whichever photo shape the probe settled on into a plain URL string.
// Handles the PhotoUrl object and every legacy scalar; null when there is none.
export function normalizePhoto(u) {
  return (
    u?.photo_url?.small ??
    u?.photo_url?.thumb ??
    u?.photo_thumb ??
    u?.photo_small ??
    u?.photo_tiny ??
    u?.photo_original ??
    null
  );
}

// Local dev only: a personal API token from .env.local (VITE_MONDAY_TOKEN).
// Inside the monday iframe this is unset and seamless session auth is used.
const DEV_TOKEN = import.meta.env?.VITE_MONDAY_TOKEN;
if (DEV_TOKEN) monday.setToken(DEV_TOKEN);

// Every SDK call goes through safeApi: query validation, structured logging
// (logger.api/apiResponse/apiError), retry on transient errors, and hard
// errors wrapped in MondayApiError with full request context. safeApi does
// NOT throw on GraphQL soft-errors (it logs them), so we enforce them here
// with assertNoGraphQLErrors — preserving the previous "return data, throw on
// errors" contract the BoardSDK relies on.
export async function api(query, variables = {}, fnName) {
  const caller = fnName || extractOperationName(query) || 'api';
  const res = await safeApi(monday, caller, query, { variables, apiVersion: API_VERSION });
  if (!res) {
    // Happens outside the monday iframe with no token configured. safeApi
    // didn't see this as an error (it returned a falsy response), so log it
    // here once so it still reaches the UI error sink.
    const noResp = new MondayApiError(
      'monday.api returned no response. Set VITE_MONDAY_TOKEN in .env.local for local dev, ' +
        'or run inside monday (seamless auth).',
      { functionName: caller, apiRequest: { query, variables, operationName: caller } }
    );
    logger.apiError(caller, noResp, { query, variables });
    throw noResp;
  }
  assertNoGraphQLErrors(res, { functionName: caller, query, variables });
  return res.data;
}

/* ----------------------------------------------------------- cv selection */
// Shared GraphQL selection for any column_values { ... } block. Consumers
// interpolate this inside column_values(ids: $cols) { CV_FIELDS } and feed the
// resulting cv object to parseValue. monday API 2025-04+ returns NULL for
// value/text on board_relation/formula/mirror, so we read the TYPED fields.
// Typed inline-fragments per column type. status/dropdown/text/long_text read
// from the `text` interface field, so they need no fragment.
const TYPE_FRAGMENTS = {
  date: '... on DateValue { date time }',
  people: '... on PeopleValue { persons_and_teams { id } text }',
  person: '... on PeopleValue { persons_and_teams { id } text }',
  checkbox: '... on CheckboxValue { checked }',
  // Status: read the STABLE LABEL ID. monday's StatusValue.index field IS the
  // label id (the value JSON is {"index": <labelId>}) — NOT the display order.
  // We read/write status by this id; display order comes from the column's
  // settings (see useStatusOptions). `text` is kept for read-only label display.
  status: '... on StatusValue { index text }',
  board_relation: '... on BoardRelationValue { linked_item_ids linked_items { id name } }',
  formula: '... on FormulaValue { display_value }',
  mirror: '... on MirrorValue { display_value }',
};

// Build the LEANEST column_values selection for the given column types — only
// `id`, `text`, and the typed fragments actually needed. Keeps queries light.
export function cvSelection(types = []) {
  const frags = [...new Set(types)]
    .map((t) => TYPE_FRAGMENTS[t])
    .filter(Boolean);
  return ['id', 'text', ...frags].join(' ');
}

// Full selection (every supported type) — used where a query fetches a mix of
// columns whose types aren't narrowed ahead of time.
export const CV_FIELDS = cvSelection(Object.keys(TYPE_FRAGMENTS));

/* ---------------------------------------------------------------- parsing */
// Turn one monday column_value (selected with CV_FIELDS) into the app-facing
// shape. cv carries the TYPED fields, not a JSON-parsed `value`.
export function parseValue(type, cv) {
  if (!cv) {
    switch (type) {
      case 'people':
      case 'person':
        return [];
      case 'board_relation':
        return { linkedItems: [], ids: [], text: null };
      case 'checkbox':
        return false;
      default:
        return null;
    }
  }

  switch (type) {
    case 'date': {
      // monday stores the optional time part in UTC; convert to local on read.
      // The returned Date carries a `hasTime` flag (true only when a real time
      // exists) — note the flag is LOST on any `new Date(d)` clone, so readers
      // must take it off this original object (see toTimeInput/itemHasTime).
      const raw = cv.date || cv.text || null;
      if (!raw) return null;
      let d;
      if (cv.date && cv.time) {
        d = new Date(`${cv.date}T${cv.time}Z`);
        d.hasTime = true;
      } else {
        // Date-only: LOCAL midnight (not UTC) so calendar day-bucketing and
        // hour math agree with the user's timezone.
        const [y, m, day] = String(raw).slice(0, 10).split('-').map(Number);
        d = new Date(y, (m || 1) - 1, day || 1);
        d.hasTime = false;
      }
      return Number.isNaN(d.getTime()) ? null : d;
    }
    case 'status':
      // Stable label id (StatusValue.index). NOTE: id 0 is valid (a real label),
      // so test the type rather than truthiness.
      return typeof cv.index === 'number' ? cv.index : null;
    case 'dropdown':
      return cv.text || null;
    case 'checkbox':
      return cv.checked === true;
    case 'people':
    case 'person': {
      const ids = (cv.persons_and_teams || []).map((p) => String(p.id));
      const names = cv.text ? cv.text.split(',').map((s) => s.trim()) : [];
      return ids.map((id, i) => ({ id, name: names[i] || '' }));
    }
    case 'board_relation': {
      const ids = (cv.linked_item_ids || []).map(String);
      const items = (cv.linked_items || []).map((it) => ({ id: String(it.id), name: it.name }));
      return {
        linkedItems: items.length ? items : ids.map((id) => ({ id })),
        ids,
        text: cv.display_value || cv.text || null,
      };
    }
    case 'formula':
    case 'mirror':
      return cv.display_value ?? cv.text ?? null;
    case 'long_text':
    case 'text':
    default:
      return cv.text ?? null;
  }
}

/* -------------------------------------------------------------- formatting */
// Turn an app-supplied value into the monday column_values payload for write.
// Returns undefined to skip the column.
export function formatValue(type, input) {
  switch (type) {
    case 'date': {
      if (input == null || input === '') return {};
      if (input instanceof Date) {
        if (input.hasTime) {
          // monday expects the time part in UTC. BOTH parts must come from one
          // toISOString() — a 00:30 local time in Israel falls on the PREVIOUS
          // UTC date, so mixing a local date with a UTC time corrupts it.
          const iso = input.toISOString();
          return { date: iso.slice(0, 10), time: iso.slice(11, 19) };
        }
        return { date: localYmd(input) };
      }
      return { date: String(input) };
    }
    case 'status':
      // Write by the STABLE LABEL ID, never the text. The status value JSON is
      // { "index": <labelId> }. id 0 is valid, so guard on null/'' not falsiness.
      // Exception: when the caller passes { label: '<text>' }, write by label
      // TEXT instead — the only path that, paired with a mutation's
      // create_labels_if_missing, can CREATE a label that doesn't exist yet
      // (an index can only reference an existing label). Used to stamp a task's
      // taskTypeID with the parent discussion's type even when that label is
      // absent from the tasks board's column.
      if (input === null || input === undefined || input === '') return {};
      if (typeof input === 'object' && input.label != null) return { label: String(input.label) };
      return { index: Number(input) };
    case 'dropdown':
      if (input == null) return {};
      return { labels: Array.isArray(input) ? input.map(String) : [String(input)] };
    case 'checkbox':
      // null (not {}) is required to UNCHECK; {} does NOT uncheck.
      return input ? { checked: 'true' } : null;
    case 'people':
    case 'person': {
      // app passes an array of numeric/string ids, or [{id}]
      const arr = Array.isArray(input) ? input : input != null ? [input] : [];
      const ids = arr.map((p) => (typeof p === 'object' ? Number(p.id) : Number(p)));
      return { personsAndTeams: ids.map((id) => ({ id, kind: 'person' })) };
    }
    case 'board_relation': {
      // app passes { linkedItems: [{ id }] }
      const items = input?.linkedItems || [];
      return { item_ids: items.map((it) => Number(it.id)) };
    }
    case 'long_text':
      return { text: input == null ? '' : String(input) };
    case 'text':
      return String(input ?? '');
    default:
      return input;
  }
}

export { monday };
