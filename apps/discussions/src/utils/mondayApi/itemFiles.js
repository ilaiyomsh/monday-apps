/*
 * round204 — read the files of an item's FILE column (the רקע box's
 * preparation files). A FileValue's `value` JSON carries the file list with
 * each entry's assetId; the item's `assets` carry the download url
 * (public_url). Matching the two yields renderable chips without any
 * unauthorized field (both `column_values.value` and `items.assets` are plain
 * seamless-scope reads).
 */
import { api } from './monday-client.js';
import logger from '../logger.js';

/**
 * List the files currently in `columnId` of `itemId`.
 * @returns {Promise<Array<{assetId:string,name:string,url:string|null,extension:string|null}>>}
 *          [] when the column is empty/unmapped or on parse failure (logged).
 */
export async function getItemFiles(itemId, columnId) {
  if (!itemId || !columnId) return [];
  const data = await api(
    `query ($itemId: ID!, $cols: [String!]) {
       items(ids: [$itemId]) {
         assets { id name public_url file_extension }
         column_values(ids: $cols) { id value }
       }
     }`,
    { itemId: String(itemId), cols: [columnId] },
    'getItemFiles'
  );
  const item = data?.items?.[0];
  if (!item) return [];
  const assetById = new Map((item.assets || []).map((a) => [String(a.id), a]));
  const raw = item.column_values?.[0]?.value;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return (parsed?.files || [])
      .filter((f) => f && (f.assetId != null || f.name))
      .map((f) => {
        const asset = f.assetId != null ? assetById.get(String(f.assetId)) : null;
        return {
          assetId: f.assetId != null ? String(f.assetId) : null,
          name: f.name || asset?.name || 'קובץ',
          url: asset?.public_url || null,
          extension: asset?.file_extension || null,
        };
      });
  } catch (err) {
    logger.warn('itemFiles', 'פענוח עמודת הקבצים נכשל — לא יוצגו קבצים', err);
    return [];
  }
}
