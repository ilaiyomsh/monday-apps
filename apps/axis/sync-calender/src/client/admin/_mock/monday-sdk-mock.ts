// Stand-in for `monday-sdk-js` used only in dev/mock mode. Aliased via
// vite.config.ts when VITE_MOCK='1'.
import { state } from './data';

type Handler = (res: { data: unknown }) => void;

interface GetResponse<T> { data: T }

function match(query: string, re: RegExp): RegExpMatchArray | null {
  return query.match(re);
}

async function mockApi(query: string, opts?: { variables?: Record<string, unknown> }) {
  const q = query.replace(/\s+/g, ' ').trim();
  const vars = opts?.variables ?? {};

  // query { me { ... } }
  if (/\bme\s*\{/.test(q)) {
    return {
      data: {
        me: {
          id: state.me.id,
          name: state.me.name,
          email: state.me.email,
          photo_thumb_small: null,
          account: { id: state.me.accountId, name: 'Mock Account', slug: 'mock' },
        },
      },
    };
  }

  // boards(ids) { id owners { id } }
  if (/boards\s*\(ids:\s*\$ids\)\s*\{\s*id\s+owners/.test(q)) {
    const ids = (vars.ids as string[]) || [];
    return {
      data: {
        boards: ids.map((id) => ({
          id,
          owners: state.owners.map((oid) => ({ id: oid })),
        })),
      },
    };
  }

  // boards(ids) { columns { id title type settings { ... } } }
  if (/boards\s*\(ids:\s*\$ids\)\s*\{\s*columns/.test(q)) {
    return { data: { boards: [{ columns: state.columns }] } };
  }

  // boards(ids) { id items_page(...) { items { id name } } }
  if (/items_page/.test(q)) {
    const ids = (vars.ids as string[]) || [];
    return {
      data: {
        boards: ids.map((id) => ({
          id,
          items_page: { items: state.linkedBoards[id] || [] },
        })),
      },
    };
  }

  // users(ids) { id name email photo_thumb_small }
  if (/users\s*\(ids:\s*\$ids\)/.test(q)) {
    const ids = (vars.ids as string[]) || [];
    return {
      data: {
        users: ids.map((id) =>
          id === state.me.id
            ? { id, name: state.me.name, email: state.me.email, photo_thumb_small: null }
            : { id, name: `User ${id}`, email: null, photo_thumb_small: null }
        ),
      },
    };
  }

  // boards listing (from useBoards) — return a single mock board for the picker
  if (match(q, /\bboards\s*\(/)) {
    return {
      data: {
        boards: [
          { id: state.boardId, name: 'Mock Calendar Board', kind: 'public', workspace_id: null },
        ],
      },
    };
  }

  console.warn('[mock monday.api] unhandled query', q, vars);
  return { data: null };
}

function createMockSdk() {
  const listeners: Record<string, Handler[]> = {};

  return {
    get<T = unknown>(key: string): Promise<GetResponse<T>> {
      if (key === 'context') {
        return Promise.resolve({
          data: {
            instanceId: state.objectId,
            appFeatureObjectId: state.objectId,
            boardId: state.boardId,
            user: { id: state.me.id, name: state.me.name, email: state.me.email },
            account: { id: state.me.accountId },
            theme: 'light',
          } as unknown as T,
        });
      }
      if (key === 'sessionToken') {
        return Promise.resolve({ data: 'mock-session-token' as unknown as T });
      }
      return Promise.resolve({ data: null as unknown as T });
    },

    listen(event: string, handler: Handler) {
      (listeners[event] ||= []).push(handler);
      if (event === 'sessionToken') {
        // Re-emit once for consumers that need it.
        setTimeout(() => handler({ data: 'mock-session-token' }), 0);
      }
      return () => {
        listeners[event] = (listeners[event] || []).filter((h) => h !== handler);
      };
    },

    api: mockApi,

    setToken() { /* no-op in mock */ },
    setApiVersion() { /* no-op */ },
    execute() { return Promise.resolve({ data: null }); },
  };
}

const mondaySdk = () => createMockSdk();
export default mondaySdk;
