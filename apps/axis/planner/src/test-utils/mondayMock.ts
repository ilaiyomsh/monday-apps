/**
 * In-memory replacement for the monday-sdk-js client used by tests.
 *
 * Tests opt in via:
 *   vi.mock('monday-sdk-js', () => ({ default: () => getMondayMock() }));
 *
 * Then drive behavior with `__seedContext`, `__seedStorage`, `mockApi`, and
 * `__emit('context', ...)` to simulate Monday SDK events.
 */

export type MondayApiHandler = (
  query: string,
  options?: { variables?: Record<string, unknown>; token?: string }
) => unknown | Promise<unknown>;

export interface MondayContextData {
  user?: {
    id?: string | number;
    currentLanguage?: 'he' | 'en' | string;
    [k: string]: unknown;
  };
  boardId?: string | number;
  boardIds?: Array<string | number>;
  account?: { id?: string | number };
  appFeature?: { type?: string };
  theme?: string;
  [k: string]: unknown;
}

export interface MondaySettingsData {
  [k: string]: unknown;
}

type Listener<T> = (payload: { data: T }) => void;

interface ListenerBag {
  context: Set<Listener<MondayContextData>>;
  settings: Set<Listener<MondaySettingsData>>;
  events: Set<Listener<unknown>>;
}

export interface MondayMock {
  /** SDK surface */
  get: (key: 'context' | 'settings' | string) => Promise<{ data: unknown }>;
  api: (
    query: string,
    options?: { variables?: Record<string, unknown>; token?: string }
  ) => Promise<unknown>;
  listen: (
    type: 'context' | 'settings' | 'events' | string,
    cb: (payload: { data: unknown }) => void
  ) => () => void;
  storage: {
    instance: {
      getItem: (key: string) => Promise<{ data: { value: string | null; success: boolean } }>;
      setItem: (key: string, value: string) => Promise<{ data: { success: boolean } }>;
      deleteItem: (key: string) => Promise<{ data: { success: boolean } }>;
    };
  };
  setApiVersion: (v: string) => void;
  setToken: (t: string) => void;

  /** Test helpers */
  __seedContext: (ctx: Partial<MondayContextData>) => void;
  __seedSettings: (s: Partial<MondaySettingsData>) => void;
  __seedStorage: (key: string, value: unknown) => void;
  __getStorage: (key: string) => string | null;
  __emit: <K extends keyof ListenerBag>(
    type: K,
    payload: K extends 'context' ? MondayContextData : K extends 'settings' ? MondaySettingsData : unknown
  ) => void;
  /** Register a query→handler mapping. Match is by substring on `query`. */
  mockApi: (substring: string, handler: MondayApiHandler) => void;
  /** Reset everything: context, settings, storage, listeners, handlers. */
  __reset: () => void;
}

export const createMondayMock = (): MondayMock => {
  let context: MondayContextData = { user: { currentLanguage: 'he' } };
  let settings: MondaySettingsData = {};
  const storage = new Map<string, string>();
  const listeners: ListenerBag = {
    context: new Set(),
    settings: new Set(),
    events: new Set(),
  };
  const apiHandlers: Array<{ substring: string; handler: MondayApiHandler }> = [];

  const get: MondayMock['get'] = async (key) => {
    if (key === 'context') return { data: structuredClone(context) };
    if (key === 'settings') return { data: structuredClone(settings) };
    return { data: null };
  };

  const api: MondayMock['api'] = async (query, options) => {
    const handler = apiHandlers.find((h) => query.includes(h.substring));
    if (!handler) {
      // Default: empty data shape that callers usually accept.
      return { data: {} };
    }
    return handler.handler(query, options);
  };

  const listen: MondayMock['listen'] = (type, cb) => {
    const bag = (listeners as unknown as Record<string, Set<Listener<unknown>> | undefined>)[type];
    if (!bag) return () => {};
    bag.add(cb as Listener<unknown>);
    return () => {
      bag.delete(cb as Listener<unknown>);
    };
  };

  const instanceStorage: MondayMock['storage']['instance'] = {
    async getItem(key) {
      const value = storage.has(key) ? storage.get(key)! : null;
      return { data: { value, success: true } };
    },
    async setItem(key, value) {
      storage.set(key, value);
      return { data: { success: true } };
    },
    async deleteItem(key) {
      storage.delete(key);
      return { data: { success: true } };
    },
  };

  return {
    get,
    api,
    listen,
    storage: { instance: instanceStorage },
    setApiVersion: () => {},
    setToken: () => {},
    __seedContext: (next) => {
      context = { ...context, ...next, user: { ...context.user, ...(next.user ?? {}) } };
    },
    __seedSettings: (next) => {
      settings = { ...settings, ...next };
    },
    __seedStorage: (key, value) => {
      storage.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    },
    __getStorage: (key) => (storage.has(key) ? storage.get(key)! : null),
    __emit: (type, payload) => {
      const bag = (listeners as unknown as Record<string, Set<Listener<unknown>> | undefined>)[type];
      bag?.forEach((cb) => cb({ data: payload as unknown }));
    },
    mockApi: (substring, handler) => {
      apiHandlers.push({ substring, handler });
    },
    __reset: () => {
      context = { user: { currentLanguage: 'he' } };
      settings = {};
      storage.clear();
      listeners.context.clear();
      listeners.settings.clear();
      listeners.events.clear();
      apiHandlers.length = 0;
    },
  };
};

/**
 * Singleton accessor used by `vi.mock('monday-sdk-js')` factories.
 * Each test that wants a fresh mock should call `__resetMondayMock()` in `beforeEach`.
 */
let activeMock: MondayMock = createMondayMock();

export const getMondayMock = (): MondayMock => activeMock;

export const resetMondayMock = (): MondayMock => {
  activeMock = createMondayMock();
  return activeMock;
};
