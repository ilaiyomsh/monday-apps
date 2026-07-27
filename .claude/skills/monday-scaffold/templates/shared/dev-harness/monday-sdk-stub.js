// SOURCE: dev-harness stub of monday-sdk-js, written for the monday-scaffold
// skill from failure modes observed live in apps/Axis (Planner storage
// "false-empty" first read, tracker reload diagnostics) and apps/discussions
// (SettingsGate blocking render outside the iframe). Copied verbatim into
// scaffolded apps (no template placeholders) so vite, vitest and plain `node`
// can import it directly.
//
// Drop-in replacement for `monday-sdk-js` when the app runs OUTSIDE the monday
// iframe (local dev, vitest, worktrees). Aliased in vite.config.js when
// VITE_MONDAY_MOCK is set — see README.md in this folder.
//
// Covered surface: get / listen / execute / api / storage (instance + global) /
// set / setToken / setApiVersion. Response ENVELOPES match the real SDK:
//   get(...)                → { data: ... }
//   api(...)                → { data: ..., account_id }  (or { errors: [...] })
//   storage.*.getItem(...)  → { data: { success, value, version } }
//
// Failure toggles (harness.failures):
//   storageFalseEmptyFirstRead — the FIRST getItem per key returns
//       success:true + value:null even when the key is seeded, reproducing the
//       monday.storage false-empty race that shipped a blank onboarding screen
//       to configured instances (Axis-Planner). Any settings-loading code MUST
//       survive this read.
//   apiErrorNext   — next api() resolves with { errors: [...] } (GraphQL
//       soft-error: the promise RESOLVES, it does not reject — same as live).
//   apiRejectNext  — next api() rejects (network/hard error).
//   storageErrorNext — next storage op resolves { data: { success:false } }.
//   latencyMs      — async latency added to every call (default 30).

import { CONTEXTS, THEMES, ROLES, API_FIXTURES, DEFAULT_SETTINGS, USERS } from './fixtures.js';

const FEATURE_TYPE = import.meta.env?.VITE_MONDAY_MOCK_CONTEXT
  || (typeof process !== 'undefined' && process.env && process.env.VITE_MONDAY_MOCK_CONTEXT)
  || 'board_view';

function clone(x) {
  return x == null ? x : JSON.parse(JSON.stringify(x));
}

function createHarness() {
  const listeners = new Map(); // type -> Set<fn>
  const storageMap = new Map(); // key -> string value
  const storageVersions = new Map(); // key -> version counter
  const firstReadDone = new Set(); // keys already read once (for the race toggle)

  const state = {
    context: clone(CONTEXTS[FEATURE_TYPE] || CONTEXTS.board_view),
    settings: clone(DEFAULT_SETTINGS),
    itemIds: [2222222222, 2222222223],
    sessionToken: 'dev-harness-session-token',
  };

  const harness = {
    // Observability for tests: every execute() call is recorded here.
    calls: [],
    // Extra api handlers installed by tests: [{ match, data | errors | fn }]
    apiHandlers: [],
    failures: {
      storageFalseEmptyFirstRead: false,
      apiErrorNext: false,
      apiRejectNext: false,
      storageErrorNext: false,
      latencyMs: 30,
    },

    get state() { return state; },

    emit(type, payload) {
      const subs = listeners.get(type);
      if (!subs) return;
      subs.forEach((fn) => fn({ data: clone(payload) }));
    },

    setContext(patch) {
      Object.assign(state.context, patch);
      this.emit('context', state.context);
    },
    /** theme: 'light' | 'dark' | 'night' | 'black' */
    setTheme(theme) {
      if (!THEMES.includes(theme)) throw new Error(`Unknown theme "${theme}" (use ${THEMES.join('/')})`);
      this.setContext({ theme });
    },
    /** role: 'admin' | 'member' | 'viewer' | 'guest' */
    setUser(role) {
      const flags = ROLES[role];
      if (!flags) throw new Error(`Unknown role "${role}" (use ${Object.keys(ROLES).join('/')})`);
      this.setContext({ user: { ...state.context.user, ...flags } });
    },
    setSettings(patch) {
      Object.assign(state.settings, patch);
      this.emit('settings', state.settings);
    },

    seedStorage(key, value) {
      storageMap.set(key, typeof value === 'string' ? value : JSON.stringify(value));
      storageVersions.set(key, (storageVersions.get(key) || 0) + 1);
    },
    readStorage(key) {
      return storageMap.has(key) ? storageMap.get(key) : null;
    },

    reset() {
      listeners.clear();
      storageMap.clear();
      storageVersions.clear();
      firstReadDone.clear();
      this.calls.length = 0;
      this.apiHandlers.length = 0;
      Object.assign(this.failures, {
        storageFalseEmptyFirstRead: false,
        apiErrorNext: false,
        apiRejectNext: false,
        storageErrorNext: false,
        latencyMs: 30,
      });
      state.context = clone(CONTEXTS[FEATURE_TYPE] || CONTEXTS.board_view);
      state.settings = clone(DEFAULT_SETTINGS);
    },

    _listeners: listeners,
    _storage: storageMap,
    _storageVersions: storageVersions,
    _firstReadDone: firstReadDone,
  };
  return harness;
}

export const harness = createHarness();

function delay() {
  const ms = harness.failures.latencyMs;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function storageGuard() {
  await delay();
  if (harness.failures.storageErrorNext) {
    harness.failures.storageErrorNext = false;
    return { data: { success: false, error: 'dev-harness: simulated storage failure' } };
  }
  return null;
}

function makeStorage(scopePrefix) {
  const scoped = (key) => `${scopePrefix}:${key}`;
  return {
    async getItem(key) {
      const failed = await storageGuard();
      if (failed) return failed;
      const k = scoped(key);
      // The false-empty first-read race: storage transiently answers
      // success:true + value:null for a key that IS populated. Real incident:
      // configured instances saw the onboarding wizard because settings code
      // trusted the first null. Toggle harness.failures.storageFalseEmptyFirstRead
      // to make sure your load path retries / distinguishes "empty" from "not yet".
      if (harness.failures.storageFalseEmptyFirstRead && !harness._firstReadDone.has(k)) {
        harness._firstReadDone.add(k);
        return { data: { success: true, value: null, version: null } };
      }
      harness._firstReadDone.add(k);
      const value = harness._storage.has(k) ? harness._storage.get(k) : null;
      return { data: { success: true, value, version: harness._storageVersions.get(k) || null } };
    },
    async setItem(key, value) {
      const failed = await storageGuard();
      if (failed) return failed;
      const k = scoped(key);
      harness._storage.set(k, value);
      harness._storageVersions.set(k, (harness._storageVersions.get(k) || 0) + 1);
      return { data: { success: true, version: harness._storageVersions.get(k) } };
    },
    async deleteItem(key) {
      const failed = await storageGuard();
      if (failed) return failed;
      harness._storage.delete(scoped(key));
      return { data: { success: true } };
    },
  };
}

function resolveApi(query) {
  for (const h of harness.apiHandlers) {
    if (query.includes(h.match)) return h;
  }
  for (const f of API_FIXTURES) {
    if (query.includes(f.match)) return f;
  }
  return null;
}

function createClient() {
  const client = {
    async get(type) {
      await delay();
      switch (type) {
        case 'context': return { data: clone(harness.state.context) };
        case 'settings': return { data: clone(harness.state.settings) };
        case 'itemIds': return { data: clone(harness.state.itemIds) };
        case 'sessionToken': return { data: harness.state.sessionToken };
        case 'location': return { data: { href: 'https://dev.local/', search: '' } };
        case 'filter': return { data: { term: '', rules: [], operator: null } };
        default: return { data: null };
      }
    },

    listen(typeOrTypes, callback) {
      const types = Array.isArray(typeOrTypes) ? typeOrTypes : [typeOrTypes];
      types.forEach((type) => {
        if (!harness._listeners.has(type)) harness._listeners.set(type, new Set());
        harness._listeners.get(type).add(callback);
        // Like the real SDK, fire immediately with the current value.
        const current = type === 'context' ? harness.state.context
          : type === 'settings' ? harness.state.settings
            : type === 'itemIds' ? harness.state.itemIds
              : null;
        if (current != null) callback({ data: clone(current) });
      });
      return () => {
        types.forEach((type) => harness._listeners.get(type)?.delete(callback));
      };
    },

    async execute(type, args) {
      await delay();
      harness.calls.push({ type, args });
      if (type === 'notice' && typeof console !== 'undefined') {
        // Visible feedback in local dev; harmless in tests.
        console.info(`[dev-harness notice:${args?.type || 'info'}]`, args?.message);
      }
      if (type === 'confirm') return { data: { confirm: true } };
      return { data: {} };
    },

    async api(query, options = {}) {
      await delay();
      if (harness.failures.apiRejectNext) {
        harness.failures.apiRejectNext = false;
        throw new Error('dev-harness: simulated network failure');
      }
      if (harness.failures.apiErrorNext) {
        harness.failures.apiErrorNext = false;
        return { errors: [{ message: 'dev-harness: simulated GraphQL error', extensions: { code: 'SIMULATED' } }] };
      }
      const handler = resolveApi(String(query));
      if (!handler) {
        return { errors: [{ message: `dev-harness: no fixture matches this query — add one via harness.apiHandlers.push({ match, data }). Query was: ${String(query).slice(0, 120)}` }] };
      }
      if (handler.errors) return { errors: clone(handler.errors) };
      const data = typeof handler.fn === 'function' ? handler.fn(query, options.variables) : handler.data;
      return { data: clone(data), account_id: Number(harness.state.context.account.id) };
    },

    setApiVersion() { return client; },
    setToken() { return client; },
    set() { return client; },

    storage: {
      ...makeStorage('global'),
      instance: makeStorage('instance'),
    },

    // Test hook: reach the harness from code that only imports the SDK.
    _harness: harness,
  };
  return client;
}

// Real monday-sdk-js exports a factory as its default export: mondaySdk(opts).
// Every call returns a client bound to the SAME shared harness state, matching
// how separate mondaySdk() singletons in an app still share one iframe.
export default function mondaySdk() {
  return createClient();
}

export { USERS };
