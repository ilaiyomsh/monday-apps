/**
 * The monday-sdk-js singleton — ONE instance for the whole app.
 *
 * Everything that talks to monday goes through this module: the API boundary
 * (services/client.js → services/monday-client.js) and the storage stores
 * (utils/settingsStore.js, utils/assetsStore.js). Creating a second mondaySdk()
 * elsewhere would give it its own postMessage bridge and its own token state.
 *
 * Auth is SEAMLESS inside the monday iframe — no token needed; the parent window
 * executes the call with the viewing user's session. For local dev outside the
 * iframe, put a personal token in .env.local as VITE_MONDAY_TOKEN (never
 * committed). `pnpm dev:mock` needs no token at all: vite aliases the whole SDK
 * to src/dev-harness/monday-sdk-stub.js.
 */
import mondaySdk from 'monday-sdk-js';

export const monday = mondaySdk();

/**
 * Pinned API version. `.claude/skills/monday-api/references/versioning.md` is the
 * single source of truth for which version is current-and-supported.
 *
 * KNOWN PLATFORM QUIRK (recorded in apps/discussions/src/utils/mondayApi/monday-client.js):
 * the seamless iframe SDK does NOT honour setApiVersion() or a per-call
 * apiVersion for monday.api() — the PARENT monday window executes the query
 * against rolling-latest. Treat this pin as the intent and the contract for
 * probes/tests, not as a guarantee about what the iframe actually ran.
 */
export const API_VERSION = '2026-04';
monday.setApiVersion(API_VERSION);

// Local dev only (vite dev server outside the iframe). Unset in the iframe and
// in production builds → seamless session auth.
const DEV_TOKEN = import.meta.env?.VITE_MONDAY_TOKEN;
if (DEV_TOKEN) monday.setToken(DEV_TOKEN);

export default monday;
