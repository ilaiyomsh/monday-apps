/*
 * userProfiles — the monday USER PROFILE data the export needs beyond a name
 * (round315): the profile's Title and its account custom fields.
 *
 * Two different things, deliberately separate:
 *   • fetchUserCustomFieldMetas() — the ACCOUNT's custom-field definitions
 *     ({ id, title }). Same list for every user, so the Settings editor fetches it
 *     once per session to offer the owner a choice. Verified live: the metas come
 *     off `me`, and `field_type` is informational only (we always render the text).
 *   • fetchUserProfiles(ids)      — the PER-USER values ({ title, customFields }),
 *     keyed by user id. `custom_field_values` only contains fields the user
 *     actually filled, so a missing entry is normal, not an error.
 *
 * Both are BEST-EFFORT: a failure logs and resolves to empty, because losing a
 * title must degrade the export to plain names, never break the download.
 */
import { api } from './monday-client.js';
import logger from '../logger.js';

let metasPromise = null;

/**
 * The account's user-profile custom fields, as [{ id, title }].
 * Cached for the session (definitions change in the monday admin, not mid-edit).
 */
export function fetchUserCustomFieldMetas() {
  if (!metasPromise) {
    metasPromise = (async () => {
      try {
        const data = await api(
          'query { me { custom_field_metas { id title } } }',
          {},
          'userProfiles.fetchUserCustomFieldMetas'
        );
        return (data?.me?.custom_field_metas || [])
          .filter((m) => m && m.id != null)
          .map((m) => ({ id: String(m.id), title: typeof m.title === 'string' ? m.title : '' }));
      } catch (err) {
        // Logged (never silent) and degraded: the editor then offers Title only.
        logger.warn('userProfiles', 'טעינת שדות הפרופיל המותאמים נכשלה — יוצעו רק שם ותפקיד', err);
        return [];
      }
    })();
  }
  return metasPromise;
}

/** Test seam / admin-change escape hatch: forget the cached metas. */
export function resetUserCustomFieldMetasCache() {
  metasPromise = null;
}

/**
 * Profiles for the given user ids → { [id]: { title, customFields: { [metaId]: value } } }.
 * Returns {} for an empty id list without touching the network.
 */
export async function fetchUserProfiles(ids) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map((id) => String(id ?? '')).filter(Boolean))];
  if (!list.length) return {};
  try {
    const data = await api(
      `query ($ids: [ID!]) {
        users(ids: $ids) {
          id
          title
          custom_field_values { custom_field_meta_id value }
        }
      }`,
      { ids: list },
      'userProfiles.fetchUserProfiles'
    );
    const out = {};
    (data?.users || []).forEach((u) => {
      if (!u || u.id == null) return;
      const customFields = {};
      (u.custom_field_values || []).forEach((cf) => {
        if (!cf || cf.custom_field_meta_id == null) return;
        customFields[String(cf.custom_field_meta_id)] = typeof cf.value === 'string' ? cf.value : '';
      });
      out[String(u.id)] = { title: typeof u.title === 'string' ? u.title : '', customFields };
    });
    return out;
  } catch (err) {
    // Logged and degraded to plain names — the export must still download.
    logger.warn('userProfiles', 'טעינת פרופילי המשתתפים נכשלה — הייצוא ייכתב בשמות בלבד', err);
    return {};
  }
}
