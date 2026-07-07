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

const ADD_FILE_MUTATION = (itemId, columnId) =>
  `mutation ($file: File!) {
     add_file_to_column (item_id: ${Number(itemId)}, column_id: "${columnId}", file: $file) { id name url }
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
  const data = await api(ADD_FILE_MUTATION(itemId, columnId), { file }, 'uploadFileToColumnSeamless');
  return data?.add_file_to_column || null;
}

/**
 * @returns {Promise<{id:string,name?:string,url?:string}>} the created asset
 * @throws if no token / column, on network/CORS failure, or on a GraphQL error.
 */
export async function uploadFileToColumn({ itemId, columnId, blob, filename, token }) {
  if (!token) throw new Error('uploadFileToColumn: API token is required');
  if (!itemId || !columnId) throw new Error('uploadFileToColumn: itemId and columnId are required');

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
  try { json = await res.json(); } catch { /* non-JSON (e.g. HTML error page) */ }

  if (!res.ok || !json || json.errors || json.error_message) {
    const detail = json?.errors?.[0]?.message || json?.error_message || `HTTP ${res.status}`;
    const err = new Error(`add_file_to_column failed: ${detail}`);
    logger.error('fileUpload', 'העלאת הקובץ לעמודה נכשלה', { detail, status: res.status });
    throw err;
  }
  return json?.data?.add_file_to_column || null;
}
