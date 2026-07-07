import { promises as fs } from 'fs';
import path from 'path';

// File-backed drop-in replacement for @mondaycom/apps-sdk SecureStorage used in
// local-mode tests (USE_LOCAL_STORAGE=true). The contract matches SecureStorage's
// public surface as consumed by subscription-storage.js:
//   - get(key)    → { value: <string> } | null
//   - set(key, v) → void   (v is already a JSON string from SubscriptionStorage)
//   - delete(key) → void
//
// Writes are serialized through an internal mutex to avoid races when multiple
// async handlers (webhook, subscribe) touch the file concurrently.
export default class LocalStorage {
  constructor(filePath = '.dev/storage.json') {
    this.file = path.resolve(filePath);
    this._lock = Promise.resolve();
  }

  async _load() {
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      if (err.code === 'ENOENT') return {};
      throw err;
    }
  }

  async _save(db) {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(db, null, 2));
  }

  _queue(fn) {
    const next = this._lock.then(fn, fn);
    this._lock = next.catch(() => {});
    return next;
  }

  async get(key) {
    return this._queue(async () => {
      const db = await this._load();
      return db[key] ?? null;
    });
  }

  async set(key, value) {
    return this._queue(async () => {
      const db = await this._load();
      db[key] = { value };
      await this._save(db);
    });
  }

  async delete(key) {
    return this._queue(async () => {
      const db = await this._load();
      delete db[key];
      await this._save(db);
    });
  }
}
