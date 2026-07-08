import logger from './logger';

const STORAGE_KEY_PREFIX = 'projectColors_';
const ATTEMPT_TIMEOUT_MS = 5000;

const buildKey = (instanceId) => `${STORAGE_KEY_PREFIX}${instanceId || 'default'}`;

const withTimeout = (promise, ms, label) => {
    const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`${label} timeout`)), ms)
    );
    return Promise.race([promise, timeout]);
};

/**
 * טוען מיפוי צבעי פרויקטים מ-monday.storage הגלובלי (מפתח projectColors_{instanceId})
 * @returns {Promise<Object<string,string>>} מפה projectId → hex
 */
export const loadProjectColors = async (monday, instanceId) => {
    const key = buildKey(instanceId);
    try {
        const result = await withTimeout(monday.storage.getItem(key), ATTEMPT_TIMEOUT_MS, 'projectColors.getItem');
        if (result?.data?.success === false) {
            logger.warn('projectColorsStorage', 'getItem returned success:false', { key, error: result.data.error });
            return {};
        }
        const raw = result?.data?.value;
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
        logger.warn('projectColorsStorage', 'Failed to load project colors', { key, error: error?.message });
        return {};
    }
};

/**
 * שומר מיפוי צבעי פרויקטים ב-monday.storage הגלובלי (מפתח projectColors_{instanceId})
 */
export const saveProjectColors = async (monday, instanceId, map) => {
    const key = buildKey(instanceId);
    try {
        const payload = JSON.stringify(map || {});
        logger.debug('projectColorsStorage', 'Saving project colors', { key, count: Object.keys(map || {}).length });
        const result = await withTimeout(monday.storage.setItem(key, payload), ATTEMPT_TIMEOUT_MS, 'projectColors.setItem');
        if (result?.data?.success === false) {
            const setErr = new Error(`projectColors.setItem returned success:false: ${result.data.error || 'unknown'}`);
            setErr.details = { key, error: result.data.error };
            logger.error('projectColorsStorage', 'setItem returned success:false', setErr);
            return false;
        }
        logger.debug('projectColorsStorage', 'Saved project colors successfully', { key });
        return true;
    } catch (error) {
        logger.error('projectColorsStorage', `Failed to save project colors (key: ${key})`, error);
        return false;
    }
};
