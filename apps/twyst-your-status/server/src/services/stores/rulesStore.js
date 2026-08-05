import { columnConfigStorageKey } from '../../../../src/domain/columnConfigKey.js';
import { unwrapStoredValue } from './unwrapStoredValue.js';

/**
 * @param {{ storageFactory: (token: string) => { get(k): Promise<any> }, logger?: object }} deps
 */
export function createRulesStore({ storageFactory, logger }) {
  return {
    async getRules(token, boardId, columnId) {
      const key = columnConfigStorageKey(boardId, columnId);
      const stored = unwrapStoredValue(await storageFactory(token).get(key));
      if (stored == null || stored === '') return null;
      if (typeof stored === 'object') return stored;
      try {
        return JSON.parse(stored);
      } catch (err) {
        logger?.error?.('corrupted rules blob — column treated as unguarded', 'rules-store', {
          key,
          error: String(err?.message ?? err),
        });
        return null;
      }
    },
  };
}
