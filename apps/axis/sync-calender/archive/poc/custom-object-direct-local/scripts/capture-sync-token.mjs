// Capture an initial Google Calendar syncToken for an existing config without
// writing any historical events to monday. Use this once after OAuth completes
// to "arm" the config — subsequent Force Syncs will only return events
// created or modified after this point.
//
// Run from project root:
//   node poc/custom-object-direct-local/scripts/capture-sync-token.mjs <configId>

import dotenv from 'dotenv';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { listGoogleEvents, refreshGoogleAccessToken } from '../server/google-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POC_ROOT = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(POC_ROOT, '.env') });

const STORAGE = path.resolve(process.cwd(), process.env.POC_STORAGE_FILE || '.dev/poc-storage.json');
const CONFIG_ID = process.argv[2];
if (!CONFIG_ID) {
  console.error('usage: node capture-sync-token.mjs <configId>');
  process.exit(1);
}

const db = JSON.parse(await fs.readFile(STORAGE, 'utf8'));
const cfg = db.configs[CONFIG_ID];
if (!cfg) throw new Error(`config ${CONFIG_ID} not found in ${STORAGE}`);

console.log('refreshing Google access token…');
const refreshed = await refreshGoogleAccessToken({
  refreshToken: cfg.googleRefreshToken,
  clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
  clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
});
const accessToken = refreshed.access_token;
console.log('  ok');

console.log('capturing initial syncToken via paginated events.list(timeMin=now)…');
console.log('  (pulling pages but discarding events — only keeping nextSyncToken)');
const { items, nextSyncToken } = await listGoogleEvents({ accessToken, syncToken: null });
console.log(`  pages done. items seen = ${items.length}, syncToken = ${nextSyncToken ? nextSyncToken.slice(0, 40) + '…' : 'NULL'}`);

if (!nextSyncToken) {
  throw new Error('no nextSyncToken returned — calendar may have been modified mid-scan');
}

cfg.googleAccessToken = accessToken;
cfg.googleAccessTokenExpiresAt = Date.now() + Number(refreshed.expires_in || 3600) * 1000;
cfg.googleSyncToken = nextSyncToken;
cfg.status = 'active';
cfg.lastError = null;
cfg.updatedAt = Date.now();

await fs.writeFile(STORAGE, JSON.stringify(db, null, 2));
console.log('\nconfig armed. googleSyncToken stored.');
console.log('next Force Sync will only return events created/modified after this moment.');
