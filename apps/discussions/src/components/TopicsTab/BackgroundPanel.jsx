import React, { lazy, Suspense, useRef, useState, useCallback, useEffect } from 'react';
import { Check, Loader2, AlertCircle, ChevronDown, Plus, X, FileText, Link2 } from 'lucide-react';
import { useBackground } from '@generated/hooks/useBackground.js';
import { loadBackgroundLinks, saveBackgroundLinks } from '@generated/utils/backgroundStore.js';
import { getItemFiles } from '@api/itemFiles.js';
import { getBoardId, getColumns } from '@api/board-config-store.js';
import { monday } from '@api/monday-client.js';
import lazyRetry from '@generated/utils/lazyRetry.js';
import logger from '@generated/utils/logger.js';
import { BrandLoader } from '@components/BrandLoader';
import styles from './TopicsTab.module.css';

// Same lazy TipTap editor the Summary/References boxes use (shared chunk).
const RichTextEditor = lazy(lazyRetry(() => import('@components/RichTextEditor'), 'RichTextEditor'));

const PLACEHOLDER = 'כתבו כאן רקע והכנה לדיון…';
const AUTOSAVE_DELAY = 1500;

function formatWhen(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
}

/*
 * round204 — the "רקע" panel (approved mockup): the TOP collapsible box in the
 * ניהול-דיון tab's side column. Preparation rich text saved as its own monday
 * Update (useBackground), plus preparation FILES (a mapped files column on the
 * discussions board, uploaded via monday's native dialog) and LINKS
 * (app-local storage chips). Collapsed by default; the header hints at the
 * content. Editing follows the same fixed rule as the summary/references
 * boxes (coordinator/creator/lead + board owner) via `canEdit`.
 */
export function BackgroundPanel({ discussionId, canEdit = false }) {
  const { html, loading, author, updatedAt, save, saveErrorCode } = useBackground(discussionId);

  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [discussionId]); // fresh discussion → collapsed

  const draftRef = useRef(null);
  const savedRef = useRef(null);
  const timerRef = useRef(null);
  const savingRef = useRef(false);
  // 'idle' | 'dirty' | 'saving' | 'saved' | 'error'
  const [status, setStatus] = useState('idle');
  const [editorReady, setEditorReady] = useState(false);
  useEffect(() => { setEditorReady(false); }, [discussionId]);

  // Serialised saves — identical discipline to the References panel.
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

  // ---- preparation LINKS (app-local storage, whole-list persistence) ----
  const [links, setLinks] = useState([]);
  const [addingLink, setAddingLink] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkLabel, setLinkLabel] = useState('');
  useEffect(() => {
    let cancelled = false;
    setLinks([]);
    if (!discussionId) return undefined;
    loadBackgroundLinks(discussionId)
      .then((l) => { if (!cancelled) setLinks(l); })
      .catch((err) => { if (!err?.__loggedId) logger.warn('BackgroundPanel', 'טעינת קישורי הרקע נכשלה', err); });
    return () => { cancelled = true; };
  }, [discussionId]);
  const persistLinks = (next) => {
    setLinks(next);
    saveBackgroundLinks(discussionId, next);
  };
  const addLink = () => {
    const url = linkUrl.trim();
    if (!url) return;
    const withProto = /^(https?:)?\/\//i.test(url) ? url : `https://${url}`;
    persistLinks([...links, { id: `${Date.now()}-${links.length}`, url: withProto, label: linkLabel.trim() || url }]);
    setLinkUrl(''); setLinkLabel(''); setAddingLink(false);
  };
  const removeLink = (id) => persistLinks(links.filter((l) => l.id !== id));

  // ---- preparation FILES (mapped files column, native monday upload) ----
  const filesColumnId = getColumns('discussions')?.backgroundFilesID?.id || null;
  const [files, setFiles] = useState([]);
  const refreshFiles = useCallback(async () => {
    if (!discussionId || !filesColumnId) { setFiles([]); return; }
    try {
      setFiles(await getItemFiles(discussionId, filesColumnId));
    } catch (err) {
      if (!err?.__loggedId) logger.warn('BackgroundPanel', 'טעינת קבצי הרקע נכשלה', err);
      setFiles([]);
    }
  }, [discussionId, filesColumnId]);
  useEffect(() => { refreshFiles(); }, [refreshFiles]);
  const uploadFile = async () => {
    try {
      const boardId = getBoardId('discussions');
      // monday's NATIVE files-column upload dialog (seamless, no token) —
      // resolves after the dialog closes; then re-read the column.
      await monday.execute('triggerFilesUpload', {
        boardId: Number(boardId),
        itemId: Number(discussionId),
        columnId: filesColumnId,
      });
      await refreshFiles();
    } catch (err) {
      if (!err?.__loggedId) logger.error('BackgroundPanel', 'העלאת קובץ הרקע נכשלה', err);
    }
  };

  const when = formatWhen(updatedAt);
  const showLoader = loading || !editorReady;
  const attachCount = files.length + links.length;
  const hint = attachCount > 0
    ? `${attachCount} קבצים וקישורים`
    : (when ? 'עודכן' : null);

  return (
    <div className={styles.sideBox} dir="rtl">
      <button
        type="button"
        className={styles.sideHead}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <ChevronDown size={16} className={`${styles.sideChev} ${open ? styles.sideChevOpen : ''}`} />
        <span className={styles.refTitle}>רקע</span>
        {!open && hint && <span className={styles.sideHint}>{hint}</span>}
      </button>

      {open && (
        <div className={styles.sideBody}>
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
              <div className={styles.refLoader} aria-busy="true" aria-label="טוען רקע">
                <BrandLoader />
              </div>
            )}
          </div>

          {/* preparation files + links */}
          {(files.length > 0 || links.length > 0 || canEdit) && (
            <div className={styles.attachBlock}>
              <div className={styles.attachHead}>קבצים וקישורים להכנה</div>
              <div className={styles.attachRow}>
                {files.map((f) => (
                  <span key={f.assetId || f.name} className={styles.attachChip}>
                    <FileText size={13} />
                    {f.url
                      ? <a href={f.url} target="_blank" rel="noreferrer">{f.name}</a>
                      : <span>{f.name}</span>}
                  </span>
                ))}
                {links.map((l) => (
                  <span key={l.id} className={styles.attachChip}>
                    <Link2 size={13} />
                    <a href={l.url} target="_blank" rel="noreferrer">{l.label}</a>
                    {canEdit && (
                      <button type="button" className={styles.attachX} onClick={() => removeLink(l.id)} aria-label="הסר קישור">
                        <X size={12} />
                      </button>
                    )}
                  </span>
                ))}
              </div>
              {canEdit && (
                addingLink ? (
                  <div className={styles.linkForm}>
                    <input
                      className={styles.linkInput}
                      autoFocus
                      placeholder="כתובת (URL)"
                      value={linkUrl}
                      onChange={(e) => setLinkUrl(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') addLink(); if (e.key === 'Escape') setAddingLink(false); }}
                    />
                    <input
                      className={styles.linkInput}
                      placeholder="שם (רשות)"
                      value={linkLabel}
                      onChange={(e) => setLinkLabel(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') addLink(); if (e.key === 'Escape') setAddingLink(false); }}
                    />
                    <button type="button" className={styles.attachAddBtn} onClick={addLink} disabled={!linkUrl.trim()}>הוסף</button>
                    <button type="button" className={styles.attachAddBtn} onClick={() => setAddingLink(false)}>ביטול</button>
                  </div>
                ) : (
                  <div className={styles.attachBtns}>
                    {filesColumnId && (
                      <button type="button" className={styles.attachAddBtn} onClick={uploadFile}>
                        <Plus size={13} /> הוסף קובץ
                      </button>
                    )}
                    <button type="button" className={styles.attachAddBtn} onClick={() => setAddingLink(true)}>
                      <Plus size={13} /> הוסף קישור
                    </button>
                  </div>
                )
              )}
            </div>
          )}

          <div className={styles.refFooterRow}>
            {!showLoader && when && (
              <div className={styles.refMeta}>
                {author ? `נערך לאחרונה ע״י ${author} · ${when}` : `נערך לאחרונה · ${when}`}
              </div>
            )}
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
        </div>
      )}
    </div>
  );
}

export default BackgroundPanel;
