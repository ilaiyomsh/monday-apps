import { useState, useEffect, useCallback, useRef } from 'react';
import { createUpdate, editUpdate, getItemUpdate } from '@api/updates.js';
import {
  loadReferencesUpdateId,
  saveReferencesUpdateId,
  clearReferencesUpdateId,
} from '../utils/referencesStore.js';
import { toMondayHtml, toEditorHtml } from '../utils/summaryHtml.js';
import logger from '../utils/logger.js';

/*
 * round200 — loads/saves a discussion's "התייחסויות" (participant references)
 * box as a SINGLE editable monday Update on the discussion item, mirroring
 * useSummary byte-for-byte except for its own storage key (referencesStore).
 * The two boxes track DIFFERENT update ids, so they can never collide.
 *
 * API failures already surface as a toast from inside api()/safeApi (the
 * logger funnel), so we only re-log errors that weren't logged there (guarding
 * on __loggedId) to avoid a double toast.
 */
export function useReferences(discussionId) {
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveErrorCode, setSaveErrorCode] = useState(null);
  const [meta, setMeta] = useState({ author: null, updatedAt: null });
  const updateIdRef = useRef(null);
  // round270 — the box's update id, mirrored into state so the documents bar
  // (which attaches files to THIS update) re-renders when it resolves/creates.
  const [updateId, setUpdateId] = useState(null);

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
      setUpdateId(null);
      try {
        const storedId = await loadReferencesUpdateId(discussionId);
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
          setUpdateId(String(update.id));
          setHtml(toEditorHtml(update.body || ''));
          setMeta({
            author: update.creator?.name || null,
            updatedAt: update.updated_at || update.created_at || null,
          });
        } else {
          // The stored update no longer exists (deleted) — start fresh.
          await clearReferencesUpdateId(discussionId);
          setHtml('');
          setMeta({ author: null, updatedAt: null });
        }
      } catch (err) {
        if (!err?.__loggedId) logger.error('useReferences', 'טעינת ההתייחסויות נכשלה', err);
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
        logger.error('useReferences', 'שמירת ההתייחסויות נכשלה — לא התקבל עדכון מהשרת');
        return false;
      }

      updateIdRef.current = String(update.id);
      setUpdateId(String(update.id));
      await saveReferencesUpdateId(discussionId, update.id);
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
      if (!err?.__loggedId) logger.error('useReferences', 'שמירת ההתייחסויות נכשלה', err);
      return false;
    } finally {
      setSaving(false);
    }
  }, [discussionId]);

  // round270 — create the box's update on demand so a document can attach even
  // before any text was saved. A single space keeps the body non-empty (monday
  // requires one); the next text save overwrites it in place. Returns the update
  // id (existing or freshly created), or null on failure.
  const ensureUpdate = useCallback(async () => {
    if (updateIdRef.current) return updateIdRef.current;
    if (!discussionId) return null;
    try {
      const update = await createUpdate(discussionId, ' ');
      if (!update) return null;
      updateIdRef.current = String(update.id);
      setUpdateId(String(update.id));
      await saveReferencesUpdateId(discussionId, update.id);
      return updateIdRef.current;
    } catch (err) {
      if (!err?.__loggedId) logger.error('useReferences', 'יצירת עדכון ההתייחסויות לצירוף מסמך נכשלה', err);
      return null;
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
    updateId,
    ensureUpdate,
  };
}

export default useReferences;
