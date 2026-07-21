import { useState, useEffect, useCallback, useRef } from 'react';
import { createUpdate, editUpdate, getItemUpdate } from '@api/updates.js';
import {
  loadBackgroundUpdateId,
  saveBackgroundUpdateId,
  clearBackgroundUpdateId,
} from '../utils/backgroundStore.js';
import { toMondayHtml, toEditorHtml } from '../utils/summaryHtml.js';
import logger from '../utils/logger.js';

/*
 * round204 — loads/saves a discussion's "רקע" (preparation background) box as a
 * SINGLE editable monday Update on the discussion item, mirroring useReferences
 * byte-for-byte except for its own storage key (backgroundStore). Each box
 * tracks a DIFFERENT update id, so the three boxes can never collide.
 *
 * API failures already surface as a toast from inside api()/safeApi (the
 * logger funnel), so we only re-log errors that weren't logged there (guarding
 * on __loggedId) to avoid a double toast.
 */
export function useBackground(discussionId) {
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveErrorCode, setSaveErrorCode] = useState(null);
  const [meta, setMeta] = useState({ author: null, updatedAt: null });
  const updateIdRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!discussionId) {
        setHtml('');
        setMeta({ author: null, updatedAt: null });
        setLoading(false);
        return;
      }
      setLoading(true);
      updateIdRef.current = null;
      try {
        const storedId = await loadBackgroundUpdateId(discussionId);
        if (cancelled) return;

        if (!storedId) {
          setHtml('');
          setMeta({ author: null, updatedAt: null });
          return;
        }

        const update = await getItemUpdate(discussionId, storedId);
        if (cancelled) return;

        if (update) {
          updateIdRef.current = String(update.id);
          setHtml(toEditorHtml(update.body || ''));
          setMeta({
            author: update.creator?.name || null,
            updatedAt: update.updated_at || update.created_at || null,
          });
        } else {
          // The stored update no longer exists (deleted) — start fresh.
          await clearBackgroundUpdateId(discussionId);
          setHtml('');
          setMeta({ author: null, updatedAt: null });
        }
      } catch (err) {
        if (!err?.__loggedId) logger.error('useBackground', 'טעינת הרקע נכשלה', err);
        if (!cancelled) {
          setHtml('');
          setMeta({ author: null, updatedAt: null });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [discussionId]);

  /** Save the editor HTML. Returns true on success, false on failure. */
  const save = useCallback(async (rawHtml) => {
    if (!discussionId) return false;
    const body = toMondayHtml(rawHtml);
    setSaving(true);
    setSaveErrorCode(null);
    try {
      let update;
      if (updateIdRef.current) {
        update = await editUpdate(updateIdRef.current, body);
        if (!update) {
          // edit returned null (e.g. the update was deleted) — recreate it.
          update = await createUpdate(discussionId, body);
        }
      } else {
        update = await createUpdate(discussionId, body);
      }

      if (!update) {
        logger.error('useBackground', 'שמירת הרקע נכשלה — לא התקבל עדכון מהשרת');
        return false;
      }

      updateIdRef.current = String(update.id);
      await saveBackgroundUpdateId(discussionId, update.id);
      setHtml(toEditorHtml(update.body ?? body));
      setMeta({
        author: update.creator?.name || null,
        updatedAt: update.updated_at || update.created_at || null,
      });
      setSaveErrorCode(null);
      return true;
    } catch (err) {
      const code =
        err?.errorCode ||
        err?.response?.errors?.[0]?.extensions?.code ||
        null;
      setSaveErrorCode(code);
      if (!err?.__loggedId) logger.error('useBackground', 'שמירת הרקע נכשלה', err);
      return false;
    } finally {
      setSaving(false);
    }
  }, [discussionId]);

  return {
    html,
    loading,
    saving,
    saveErrorCode,
    author: meta.author,
    updatedAt: meta.updatedAt,
    save,
  };
}

export default useBackground;
