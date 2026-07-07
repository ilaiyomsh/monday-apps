import React, { lazy, Suspense, useRef, useState, useCallback, useEffect } from 'react';
import { Button } from '@vibe/core';
import { Check, Loader2, AlertCircle } from 'lucide-react';
import { useSummary } from '@generated/hooks/useSummary.js';
import lazyRetry from '@generated/utils/lazyRetry.js';
import styles from './SummaryTab.module.css';

// Lazy-load the editor so TipTap (~130KB gz) stays out of the initial board-view
// bundle; lazyRetry adds one guarded reload on a chunk-load failure.
const RichTextEditor = lazy(lazyRetry(() => import('@components/RichTextEditor'), 'RichTextEditor'));

const PLACEHOLDER = 'כתוב כאן סיכום לדיון…';
const AUTOSAVE_DELAY = 1500;

function formatWhen(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
}

/*
 * The discussion "Summary" tab: a minimal rich-text editor whose HTML is saved
 * as a single editable monday Update (see useSummary). Saves automatically
 * (debounced) after edits, with a small status indicator; the "שמור" button
 * forces an immediate save. Pending edits are flushed on unmount (tab switch).
 */
export function SummaryTab({ discussion, canEdit = true }) {
  const discussionId = discussion?.id;
  const { html, loading, author, updatedAt, save, saveErrorCode } = useSummary(discussionId);

  const draftRef = useRef(null);   // latest editor HTML (editor form)
  const savedRef = useRef(null);   // last successfully-saved editor HTML (baseline)
  const timerRef = useRef(null);
  const savingRef = useRef(false); // a save is in flight (serialise saves)
  // 'idle' | 'dirty' | 'saving' | 'saved' | 'error'
  const [status, setStatus] = useState('idle');

  // Persist the current draft. Saves are serialised: while one is in flight any
  // further request no-ops, and the running save re-runs from its tail if the
  // draft moved meanwhile — so the LATEST content always wins, no overlapping
  // writes and no self-rescheduling timer that could fire after unmount.
  const runSave = useCallback(async (manual = false) => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (savingRef.current) return;
    const target = draftRef.current;
    if (target == null || target === savedRef.current) return;

    savingRef.current = true;
    if (manual) setStatus('saving'); // loader only for a manual save — auto-save is silent
    let ok = false;
    try { ok = await save(target); } finally { savingRef.current = false; }

    if (ok) {
      savedRef.current = target;
      if (draftRef.current !== savedRef.current) runSave(); // newer edits arrived — persist now
      else setStatus('saved');
    } else {
      setStatus('error');
    }
  }, [save]);

  const scheduleSave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { runSave(); }, AUTOSAVE_DELAY);
  }, [runSave]);

  const handleReady = useCallback((h) => { draftRef.current = h; savedRef.current = h; }, []);

  const handleChange = useCallback((h) => {
    draftRef.current = h;
    if (h === savedRef.current) return;
    setStatus('dirty');
    scheduleSave();
  }, [scheduleSave]);

  // Flush a pending edit when the tab/discussion unmounts (don't lose work).
  // If a save is in flight, its tail re-runs with the latest draft (refs survive
  // unmount); otherwise persist the latest now. DiscussionCard keys the tab body
  // by discussion id, so this unmounts/remounts per discussion with fresh refs.
  useEffect(() => () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    const target = draftRef.current;
    if (target != null && target !== savedRef.current && !savingRef.current) {
      save(target); // fire-and-forget; UI is going away
    }
  }, [save]);

  // A skeleton shaped like the editor itself, for both load + lazy-chunk fallback.
  const skeleton = (
    <div className={styles.skeletonFrame} aria-busy="true" aria-label="טוען סיכום">
      <div className={styles.skeletonToolbar} />
      <div className={styles.skeletonBody} />
    </div>
  );

  if (loading) {
    return <div className={styles.root} dir="rtl">{skeleton}</div>;
  }

  const when = formatWhen(updatedAt);

  return (
    <div className={styles.root} dir="rtl">
      <Suspense fallback={skeleton}>
        <RichTextEditor
          key={discussionId}
          initialValue={html}
          onReady={handleReady}
          onChange={handleChange}
          placeholder={canEdit ? PLACEHOLDER : ''}
          editable={canEdit}
        />
      </Suspense>

      <div className={styles.footer}>
        {!canEdit ? null : (
        <div className={styles.actions}>
          <Button kind="primary" size="small" loading={status === 'saving'} onClick={() => runSave(true)}>
            שמור
          </Button>
          {status === 'saved' && (
            <span className={`${styles.status} ${styles.statusSaved}`}><Check size={14} /> נשמר</span>
          )}
          {status === 'dirty' && (
            <span className={styles.status}>שינויים לא נשמרו</span>
          )}
          {status === 'saving' && (
            <span className={styles.status}><Loader2 size={14} className={styles.spin} /> שומר…</span>
          )}
          {status === 'error' && (
            saveErrorCode === 'USER_UNAUTHORIZED' ? (
              <span className={`${styles.status} ${styles.statusErrorMessage}`}>
                <AlertCircle size={14} /> אינך מורשה לערוך סיכום זה
              </span>
            ) : (
              <button type="button" className={styles.statusError} onClick={() => runSave(true)}>
                <AlertCircle size={14} /> השמירה נכשלה — נסה שוב
              </button>
            )
          )}
        </div>
        )}
        <div className={styles.meta}>
          {when && (
            <span>{author ? `נערך לאחרונה ע״י ${author} · ${when}` : `נערך לאחרונה · ${when}`}</span>
          )}
        </div>
      </div>
    </div>
  );
}

export default SummaryTab;
