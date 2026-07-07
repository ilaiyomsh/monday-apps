import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const storageFile = path.resolve(process.env.POC_STORAGE_FILE || '.dev/poc-storage.json');

let lock = Promise.resolve();

function withLock(fn) {
  const next = lock.then(fn, fn);
  lock = next.catch(() => {});
  return next;
}

async function loadDb() {
  try {
    const raw = await fs.readFile(storageFile, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return {
        policies: {},
        configs: {},
        instanceConfigs: {},
        oauthStates: {},
      };
    }
    throw err;
  }
}

async function saveDb(db) {
  await fs.mkdir(path.dirname(storageFile), { recursive: true });
  await fs.writeFile(storageFile, JSON.stringify(db, null, 2), 'utf8');
}

export async function getPolicy(objectId) {
  return withLock(async () => {
    const db = await loadDb();
    return db.policies[objectId] || null;
  });
}

export async function upsertPolicy(policy) {
  return withLock(async () => {
    const db = await loadDb();
    db.policies[policy.objectId] = policy;
    await saveDb(db);
    return policy;
  });
}

export async function getConfig(configId) {
  return withLock(async () => {
    const db = await loadDb();
    return db.configs[configId] || null;
  });
}

export async function getConfigsByObject(objectId) {
  return withLock(async () => {
    const db = await loadDb();
    const ids = db.instanceConfigs[objectId] || [];
    return ids.map((id) => db.configs[id]).filter(Boolean);
  });
}

export async function getOrCreateConfig({ accountId, objectId, userId }) {
  return withLock(async () => {
    const db = await loadDb();
    const ids = db.instanceConfigs[objectId] || [];
    const existing = ids
      .map((id) => db.configs[id])
      .find((c) => c && c.accountId === accountId && c.userId === userId);

    if (existing) return existing;

    const now = Date.now();
    const configId = uuidv4();
    const config = {
      configId,
      accountId,
      objectId,
      userId,
      mondayUserId: userId,
      googleRefreshToken: null,
      googleAccessToken: null,
      googleAccessTokenExpiresAt: null,
      googleUserEmail: null,
      googleSyncToken: null,
      mondayAccessToken: process.env.MONDAY_FALLBACK_ACCESS_TOKEN || null,
      status: 'pending_connections',
      lastSyncAt: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };

    db.configs[configId] = config;
    db.instanceConfigs[objectId] = [...ids, configId];
    await saveDb(db);
    return config;
  });
}

export async function updateConfig(configId, patch) {
  return withLock(async () => {
    const db = await loadDb();
    const current = db.configs[configId];
    if (!current) return null;
    const next = { ...current, ...patch, updatedAt: Date.now() };
    db.configs[configId] = next;
    await saveDb(db);
    return next;
  });
}

export async function storeOauthState(state, value) {
  return withLock(async () => {
    const db = await loadDb();
    db.oauthStates[state] = value;
    await saveDb(db);
  });
}

export async function consumeOauthState(state) {
  return withLock(async () => {
    const db = await loadDb();
    const value = db.oauthStates[state] || null;
    delete db.oauthStates[state];
    await saveDb(db);
    return value;
  });
}
