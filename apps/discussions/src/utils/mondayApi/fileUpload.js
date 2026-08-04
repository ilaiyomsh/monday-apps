/*
 * Upload a file into an item's FILE column via monday's add_file_to_column.
 *
 * File uploads can't go through the seamless monday.api / monday-sdk-js (which is
 * JSON-only and has no multipart path). They MUST be a multipart/form-data POST to
 * https://api.monday.com/v2/file with an API token in the Authorization header
 * (monday explicitly recommends a token/OAuth for uploads — seamless auth does not
 * cover them). The owner supplies the token in Settings.
 *
 * monday's multipart convention: form fields `query` (the mutation, with item_id /
 * column_id inlined and a $file: File! variable) and `variables[file]` (the Blob).
 * Do NOT set Content-Type — the browser adds the multipart boundary.
 */
import logger from '../logger.js';
import { api } from './monday-client.js';

const FILE_ENDPOINT = 'https://api.monday.com/v2/file';

// round244 — the JSON value monday documents for emptying a Files column.
const CLEAR_ALL_VALUE = JSON.stringify({ clear_all: true });

const CLEAR_FILE_MUTATION =
  `mutation ($board: ID!, $item: ID!, $col: String!, $val: JSON!) {
     change_column_value (board_id: $board, item_id: $item, column_id: $col, value: $val) { id }
   }`;

/**
 * Clear ALL files from a Files column (monday's documented `{"clear_all":true}`
 * value) via the seamless monday.api() — no token. round244: used before an
 * export upload so the summary column keeps only the LATEST file instead of
 * accumulating every past export.
 * @throws if ids are missing or on a GraphQL error (caller decides best-effort).
 */
export async function clearFileColumn({ itemId, columnId, boardId }) {
  if (!itemId || !columnId || !boardId) {
    throw new Error('clearFileColumn: itemId, columnId and boardId are required');
  }
  await api(
    CLEAR_FILE_MUTATION,
    { board: String(boardId), item: String(itemId), col: String(columnId), val: CLEAR_ALL_VALUE },
    'clearFileColumn',
  );
}

// A monday column identifier: lowercase alphanumerics + underscore (monday's own
// create_column contract for custom ids; auto-generated ids follow the same shape).
// Uppercase is tolerated for legacy boards. Anything else cannot be a real column id.
const COLUMN_ID_RE = /^[A-Za-z0-9_]+$/;

/**
 * F-1 (security scan 2026-08-04) — guard for the LEGACY multipart path only, which
 * inlines the mutation into a `query` form field and therefore cannot use a typed
 * variable for `column_id`. The seamless path below needs no guard: its ids travel
 * as GraphQL variables, so the document is a constant.
 * @throws if columnId is not a monday column identifier.
 */
function assertColumnId(columnId) {
  if (!COLUMN_ID_RE.test(String(columnId))) {
    throw new Error(`uploadFileToColumn: columnId is not a valid monday column id: ${columnId}`);
  }
}

// F-1 fix (security scan 2026-08-04): item_id and column_id were interpolated into the
// mutation DOCUMENT TEXT (column_id unescaped). Both are now typed variables, matching
// CLEAR_FILE_MUTATION above. Validated against the live schema:
// add_file_to_column(column_id: String!, file: File!, item_id: ID!).
const ADD_FILE_MUTATION =
  `mutation ($item: ID!, $col: String!, $file: File!) {
     add_file_to_column (item_id: $item, column_id: $col, file: $file) { id name url }
   }`;

/**
 * Upload via the SEAMLESS monday.api() (no token, no client-side secret). Passes
 * a File as the $file variable; whether monday's iframe bridge forwards it to the
 * multipart /v2/file endpoint is UNVERIFIED — this is the path we're testing. The
 * app's api() throws on a GraphQL/soft error (e.g. "requires a multipart request"),
 * which the caller catches to fall back / report.
 * @returns {Promise<{id:string}|null>}
 */
export async function uploadFileToColumnSeamless({ itemId, columnId, file }) {
  if (!itemId || !columnId) throw new Error('uploadFileToColumnSeamless: itemId and columnId are required');
  const data = await api(
    ADD_FILE_MUTATION,
    { item: String(itemId), col: String(columnId), file },
    'uploadFileToColumnSeamless',
  );
  return data?.add_file_to_column || null;
}

const ADD_FILE_TO_UPDATE_MUTATION = (updateId) =>
  `mutation ($file: File!) {
     add_file_to_update (update_id: ${Number(updateId)}, file: $file) { id name url }
   }`;

/**
 * round270 — upload a File onto an UPDATE via the SEAMLESS monday.api() (no
 * token, no client-side secret), the same proven path as the summary-export
 * column upload: the File is passed as the $file GraphQL variable, the SDK ships
 * it to the parent monday window over postMessage (structured-clone preserves
 * File/Blob), and the parent performs the multipart /v2/file upload with the
 * user's session. `add_file_to_update` takes the same $file variable as
 * `add_file_to_column`, so documents attach to the box's own update.
 * @returns {Promise<{id:string,name?:string,url?:string}|null>}
 * @throws if updateId is missing or on a GraphQL/soft error (caller reports it).
 */
export async function uploadFileToUpdateSeamless({ updateId, file }) {
  if (!updateId) throw new Error('uploadFileToUpdateSeamless: updateId is required');
  if (!file) throw new Error('uploadFileToUpdateSeamless: file is required');
  const data = await api(ADD_FILE_TO_UPDATE_MUTATION(updateId), { file }, 'uploadFileToUpdateSeamless');
  return data?.add_file_to_update || null;
}

/**
 * @returns {Promise<{id:string,name?:string,url?:string}>} the created asset
 * @throws if no token / column, on network/CORS failure, or on a GraphQL error.
 */
export async function uploadFileToColumn({ itemId, columnId, blob, filename, token }) {
  if (!token) throw new Error('uploadFileToColumn: API token is required');
  if (!itemId || !columnId) throw new Error('uploadFileToColumn: itemId and columnId are required');
  // This path inlines the mutation into a multipart `query` field, so column_id cannot
  // become a typed variable here — validate its shape instead (F-1).
  assertColumnId(columnId);

  const mutation =
    `mutation ($file: File!) {
       add_file_to_column (item_id: ${Number(itemId)}, column_id: "${columnId}", file: $file) { id name url }
     }`;

  const form = new FormData();
  form.append('query', mutation);
  // monday parses `variables[file]` into the $file variable.
  form.append('variables[file]', blob, filename || 'summary.docx');

  let res;
  try {
    res = await fetch(FILE_ENDPOINT, { method: 'POST', headers: { Authorization: token }, body: form });
  } catch (err) {
    // network / CORS
    logger.error('fileUpload', 'בקשת העלאת הקובץ ל-monday נכשלה (רשת/CORS)', err);
    throw err;
  }

  let json = null;
  try {
    json = await res.json();
  } catch (e) {
    // Non-JSON body (e.g. an HTML error page) — record it; the !json check below
    // then throws a clear error with the HTTP status.
    logger.warn('fileUpload', 'תגובת monday להעלאת קובץ אינה JSON', e);
  }

  if (!res.ok || !json || json.errors || json.error_message) {
    const detail = json?.errors?.[0]?.message || json?.error_message || `HTTP ${res.status}`;
    const err = new Error(`add_file_to_column failed: ${detail}`);
    logger.error('fileUpload', 'העלאת הקובץ לעמודה נכשלה', { detail, status: res.status });
    throw err;
  }
  return json?.data?.add_file_to_column || null;
}
