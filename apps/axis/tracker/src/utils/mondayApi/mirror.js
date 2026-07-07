// מודול mirror — פתרון עמודות mirror אל מקור הסטטוס שלהן.
//
// יוצא מ-client.js במסגרת Wave 4.1.2.
// תלות פנימית: parseStatusLabels — מיובא ישירות מ-./columns כדי למנוע מעגליות בבארל.

import logger from '../logger';
import { safeApi } from './client.js';
import { parseStatusLabels } from './columns.js';

/**
 * פתרון עמודת mirror אל לוח/עמודת המקור שלה, וטעינת ה-labels.
 * משמש כשמחוברים לעמודת mirror — צריך לדעת מאיפה הסטטוס מגיע באמת.
 */
export const resolveMirrorSourceColumn = async (monday, boardId, mirrorColumnId) => {
    if (!boardId || !mirrorColumnId) return null;
    logger.functionStart('resolveMirrorSourceColumn', { boardId, mirrorColumnId });

    try {
        // שלב 1: שליפת settings של עמודת mirror
        const query = `query {
            boards(ids: [${boardId}]) {
                columns(ids: ["${mirrorColumnId}"]) {
                    settings
                }
            }
        }`;

        const response = await safeApi(monday, 'resolveMirrorSourceColumn', query);
        const rawSettings = response.data?.boards?.[0]?.columns?.[0]?.settings;
        if (!rawSettings) {
            logger.warn('resolveMirrorSourceColumn', 'No settings found for mirror column');
            return null;
        }

        const settings = typeof rawSettings === 'string' ? JSON.parse(rawSettings) : rawSettings;
        logger.debug('resolveMirrorSourceColumn', 'Mirror column settings', { settings });

        // חילוץ לוח מקור ועמודת מקור מ-displayed_linked_columns
        const linkedCol = settings.displayed_linked_columns?.[0];
        if (!linkedCol) {
            logger.warn('resolveMirrorSourceColumn', 'No displayed_linked_columns found in mirror settings', { settings });
            return null;
        }

        const sourceBoardId = String(linkedCol.board_id);
        const sourceColumnId = linkedCol.column_ids?.[0];
        if (!sourceBoardId || !sourceColumnId) {
            logger.warn('resolveMirrorSourceColumn', 'Missing board_id or column_ids in mirror settings', { linkedCol });
            return null;
        }

        // שלב 2: שליפת פרטי עמודת המקור (שימוש ב-settings)
        const sourceQuery = `query {
            boards(ids: [${sourceBoardId}]) {
                columns(ids: ["${sourceColumnId}"]) {
                    title
                    type
                    settings
                }
            }
        }`;

        const sourceResponse = await safeApi(monday, 'resolveMirrorSourceColumn:source', sourceQuery);
        const sourceCol = sourceResponse.data?.boards?.[0]?.columns?.[0];
        if (!sourceCol || sourceCol.type !== 'status') {
            logger.warn('resolveMirrorSourceColumn', 'Source column is not a status column', { type: sourceCol?.type });
            return null;
        }

        const labels = parseStatusLabels(sourceCol.settings);
        logger.functionEnd('resolveMirrorSourceColumn', { sourceBoardId, sourceColumnId, labelsCount: labels.length });

        return { sourceBoardId, sourceColumnId, labels };
    } catch (error) {
        logger.error('resolveMirrorSourceColumn', 'Error resolving mirror source', error);
        return null;
    }
};
