import React, { lazy, Suspense, useRef, useState, useCallback, useEffect } from 'react';
import { Check, Loader2, AlertCircle } from 'lucide-react';
import { useReferences } from '@generated/hooks/useReferences.js';
import lazyRetry from '@generated/utils/lazyRetry.js';
import { BrandLoader } from '@components/BrandLoader';
import styles from './TopicsTab.module.css';

// Same lazy TipTap editor the Summary tab uses — the chunk is shared, so opening
// either box loads it once.
const RichTextEditor = lazy(lazyRetry(() => import('@components/RichTextEditor'), 'RichTextEditor'));

const PLACEHOLDER = 'כתבו כאן התייחסויות של משתתפי הדיון…';
const AUTOSAVE_DELAY = 1500;

function formatWhen(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
}

/*
 * round200 — the "התייחסויות" panel on the RIGHT side of the Topics tab: a
 * rich-text box (bold / lists / numbering…) whose HTML is saved as a single
 * editable monday Update on the discussion item (useReferences — its own update
 * id, so it can never collide with the Summary's update). Auto-saves debounced,
 * flushes pending edits on unmount, mirrors SummaryTab's save discipline.
 * Editing is gated by `canEdit` (coordinator/creator/lead + board owner — the
 * fixed rule the owner set for both boxes); everyone else gets read-only.
 */
export function ReferencesPanel({ discussionId, canEdit = false }) {
  const { html, loading, author, updatedAt, save, saveErrorCode } = useReferences(discussionId);

  const draftRef = useRef(null);
  const savedRef = useRef(null);
  const timerRef = useRef(null);
  const savingRef = useRef(false);
  // 'idle' | 'dirty' | 'saving' | 'saved' | 'error'
  const [status, setStatus] = useState('idle');
  const [editorReady, setEditorReady] = useState(false);
  useEffect(() => { setEditorReady(false); }, [discussionId]);

  // Serialised saves — identical discipline to SummaryTab.runSave: one in-flight
  // save at a time; if the draft moved meanwhile, re-run from the tail so the
  // LATEST content always wins.
  const runSave = useCallback(async () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (savingRef.current) return;
    const target = draftRef.current;
    if (target == null || target === savedRef.current) return;

    savingRef.current = true;
    let ok = false;
    try { ok = await save(target); } finally { savingRef.current = false; }

    if (ok) {
      savedRef.current = target;
      if (draftRef.current !== savedRef.current) runSave();
      else setStatus('saved');
    } else {
      setStatus('error');
    }
  }, [save]);

  const scheduleSave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { runSave(); }, AUTOSAVE_DELAY);
  }, [runSave]);

  const handleReady = useCallback((h) => {
    draftRef.current = h;
    savedRef.current = h;
    setEditorReady(true);
  }, []);

  const handleChange = useCallback((h) => {
    draftRef.current = h;
    if (h === savedRef.current) return;
    setStatus('dirty');
    scheduleSave();
  }, [scheduleSave]);

  // Flush a pending edit on unmount (tab/discussion switch) — don't lose work.
  useEffect(() => () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    const target = draftRef.current;
    if (target != null && target !== savedRef.current && !savingRef.current) {
      save(target); // fire-and-forget; UI is going away
    }
  }, [save]);

  const when = formatWhen(updatedAt);
  const showLoader = loading || !editorReady;

  return (
    <div className={styles.refPanel} dir="rtl">
      {/* Title row — SAME typography as the topic group titles, and vertically
          parallel to the FIRST group's title (both columns start at the split
          row's top; see .refTitleRow margins). */}
      <div className={styles.refTitleRow}>
        <span className={styles.refTitle}>התייחסויות</span>
        {!showLoader && canEdit && (
          <span className={styles.refStatus}>
            {status === 'saved' && (<span className={styles.refSaved}><Check size={13} /> נשמר</span>)}
            {status === 'dirty' && <span>שינויים לא נשמרו</span>}
            {status === 'saving' && (<span><Loader2 size={13} className={styles.refSpin} /> שומר…</span>)}
            {status === 'error' && (
              saveErrorCode === 'USER_UNAUTHORIZED' ? (
                <span className={styles.refError}><AlertCircle size={13} /> אינך מורשה לערוך</span>
              ) : (
                <button type="button" className={styles.refErrorBtn} onClick={() => runSave()}>
                  <AlertCircle size={13} /> השמירה נכשלה — נסה שוב
                </button>
              )
            )}
          </span>
        )}
      </div>

      <div className={styles.refBox}>
        {!loading && (
          <Suspense fallback={null}>
            <RichTextEditor
              key={discussionId}
              initialValue={html}
              onReady={handleReady}
              onChange={handleChange}
              placeholder={canEdit ? PLACEHOLDER : ''}
              editable={canEdit}
            />
          </Suspense>
        )}
        {showLoader && (
          <div className={styles.refLoader} aria-busy="true" aria-label="טוען התייחסויות">
            <BrandLoader />
          </div>
        )}
      </div>

      {!showLoader && when && (
        <div className={styles.refMeta}>
          {author ? `נערך לאחרונה ע״י ${author} · ${when}` : `נערך לאחרונה · ${when}`}
        </div>
      )}
    </div>
  );
}

export default ReferencesPanel;
