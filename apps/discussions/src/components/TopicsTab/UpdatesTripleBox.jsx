import React, { lazy, Suspense, useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { Check, Loader2, AlertCircle, Paperclip, X, Download } from 'lucide-react';
import { fileKindColor, fileKindLabel } from '@generated/utils/fileKind.js';
import { useBackground } from '@generated/hooks/useBackground.js';
import { useReferences } from '@generated/hooks/useReferences.js';
import { useSummary } from '@generated/hooks/useSummary.js';
import { getUpdateFiles } from '@api/updates.js';
import { uploadFileToUpdateSeamless } from '@api/fileUpload.js';
import lazyRetry from '@generated/utils/lazyRetry.js';
import logger from '@generated/utils/logger.js';
import { BrandLoader } from '@components/BrandLoader';
import { useSettings } from '@generated/contexts/SettingsContext.jsx';
import { resolveBoxLabels } from '@api/boards.config.js';
import styles from './TopicsTab.module.css';

// Same lazy TipTap editor everywhere (shared chunk).
const RichTextEditor = lazy(lazyRetry(() => import('@components/RichTextEditor'), 'RichTextEditor'));

const AUTOSAVE_DELAY = 1500;

// round225 — the toolbar meta shows ONLY the last-update date + time (owner
// spec), compact numeric form. round227 (owner request): DROP the year — just
// DD/MM HH:MM.
function formatWhen(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const date = d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' });
  const time = d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  return `${date} ${time}`;
}

// Initials circle for the last editor (creator { id name } carries no photo —
// same colored-initials treatment as the external-participant avatars).
function editorInitials(name) {
  return String(name || '').split(' ').map((w) => w[0]).filter(Boolean).slice(0, 2).join('');
}

/*
 * One pane of the triple box: a rich-text editor over ONE monday-update hook
 * (useBackground / useReferences / useSummary — all share the same API), with
 * the serialised autosave discipline the boxes have used since round200, a 📎
 * attach-file toolbar action, the pane's DOCUMENTS bar, and — for the רקע pane —
 * the preparation links. Mounted HIDDEN when inactive so a mid-typing draft
 * survives switching headers.
 *
 * round270 — documents live ON the pane's own monday UPDATE (owner model B):
 * `uploadFileToUpdateSeamless` attaches the File through the seamless monday.api
 * (no token — the parent window performs the multipart upload), and
 * `getUpdateFiles` reads `update.assets` back. monday exposes NO per-file delete
 * on an update, so the bar is add + preview + download only (no per-file remove).
 */
function UpdatePane({ discussionId, hook, placeholder, canEdit, canAttach = false, active, mentionPeople = [] }) {
  const { html, loading, author, updatedAt, save, saveErrorCode, updateId, ensureUpdate, clearDocuments } = hook;

  const draftRef = useRef(null);
  const savedRef = useRef(null);
  const timerRef = useRef(null);
  const savingRef = useRef(false);
  const [status, setStatus] = useState('idle'); // 'idle'|'dirty'|'saving'|'saved'|'error'
  const [editorReady, setEditorReady] = useState(false);
  useEffect(() => { setEditorReady(false); }, [discussionId]);

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

  const handleReady = useCallback((h) => { draftRef.current = h; savedRef.current = h; setEditorReady(true); }, []);
  const handleChange = useCallback((h) => {
    draftRef.current = h;
    if (h === savedRef.current) return;
    setStatus('dirty');
    scheduleSave();
  }, [scheduleSave]);

  // Flush a pending edit on unmount — don't lose work.
  useEffect(() => () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    const target = draftRef.current;
    if (target != null && target !== savedRef.current && !savingRef.current) save(target);
  }, [save]);

  // ---- pane DOCUMENTS (attached to THIS pane's update; seamless, no token) ----
  const [files, setFiles] = useState([]);
  const [preview, setPreview] = useState(null); // { name, url } | null — open document preview
  const [uploading, setUploading] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false); // round271 — >1-file delete warning
  const [clearing, setClearing] = useState(false);
  const fileInputRef = useRef(null);
  const refreshFiles = useCallback(async (idOverride) => {
    const uid = idOverride || updateId;
    if (!discussionId || !uid) { setFiles([]); return; }
    try {
      setFiles(await getUpdateFiles(discussionId, uid));
    } catch (err) {
      if (!err?.__loggedId) logger.warn('UpdatesTripleBox', 'טעינת מסמכי התיבה נכשלה', err);
      setFiles([]);
    }
  }, [discussionId, updateId]);
  useEffect(() => { refreshFiles(); }, [refreshFiles]);

  const onPickFiles = () => fileInputRef.current?.click();
  const onFilesChosen = async (e) => {
    const chosen = Array.from(e.target.files || []);
    e.target.value = ''; // let the same file be picked again later
    if (!chosen.length) return;
    setUploading(true);
    try {
      // The box's update must exist before a file can attach to it; create it
      // on demand (empty boxes have no update yet) via the hook.
      const uid = updateId || (ensureUpdate ? await ensureUpdate() : null);
      if (!uid) {
        logger.error('UpdatesTripleBox', 'לא נוצר עדכון לצירוף המסמך');
        return;
      }
      for (const f of chosen) {
        await uploadFileToUpdateSeamless({ updateId: uid, file: f });
      }
      await refreshFiles(uid);
    } catch (err) {
      if (!err?.__loggedId) logger.error('UpdatesTripleBox', 'העלאת המסמך לעדכון נכשלה', err);
    } finally {
      setUploading(false);
    }
  };

  // round271 — delete. monday has no per-file delete on an update, so removing a
  // document clears ALL of the box's documents at once (the text is kept). When
  // there is MORE THAN ONE file we warn first; a single file deletes immediately.
  const requestDeleteFiles = () => {
    if (files.length > 1) { setConfirmClear(true); return; }
    doClearDocuments();
  };
  const doClearDocuments = async () => {
    setConfirmClear(false);
    if (!clearDocuments) return;
    setClearing(true);
    try {
      const ok = await clearDocuments();
      if (ok) setFiles([]);
    } catch (err) {
      if (!err?.__loggedId) logger.error('UpdatesTripleBox', 'מחיקת מסמכי התיבה נכשלה', err);
    } finally {
      setClearing(false);
    }
  };

  // round290 (owner request) — the bottom "add link" feature was removed; links
  // are added inline via the editor (select text → add link). No links state here.

  const when = formatWhen(updatedAt);
  const showLoader = loading || !editorReady;

  // round270 — 📎 is a MINIMALIST icon-only button at the toolbar's far end that
  // opens a native file picker; the chosen file(s) attach to THIS pane's update
  // (seamless, no token). Shown only to creator/coordinator/lead/owner
  // (canAttach); everyone else still sees the bar and can preview + download.
  // monday has no per-file delete on an update, so there is no remove control.
  const attachAction = canAttach ? (
    <>
      <button
        type="button"
        className={styles.attachToolbarBtn}
        onClick={onPickFiles}
        disabled={uploading}
        title="צירוף מסמך"
        aria-label="צירוף מסמך"
      >
        {uploading ? <Loader2 size={16} className={styles.refSpin} /> : <Paperclip size={16} />}
      </button>
      <input ref={fileInputRef} type="file" multiple hidden onChange={onFilesChosen} />
    </>
  ) : null;

  // round268 — the DOCUMENTS bar: a text-less, LEFT-pinned row of type-colored
  // square icons, rendered directly under the toolbar and above the text (via
  // RichTextEditor's belowToolbar slot). Hover shows the filename; a single click
  // opens the preview (from which the file downloads). Renders only when the box
  // has documents, so an empty box keeps the text flush under the toolbar.
  const documentsBar = files.length > 0 ? (
    <div className={styles.docBar} dir="rtl">
      {files.map((f) => {
        // round284 fix — monday returns the asset `name` WITHOUT the extension
        // (it lives in the separate `extension` field), so keying the type off
        // `name` alone yielded a blank glyph for Word/Excel/PPT. Prefer the
        // explicit extension; fall back to the name (which may carry a dotted ext).
        const kindKey = f.extension || f.name;
        return (
        <span key={f.assetId || f.name} className={styles.docItem}>
          <button
            type="button"
            className={styles.docIcon}
            style={{ background: fileKindColor(kindKey) }}
            title={f.name}
            aria-label={`מסמך: ${f.name}`}
            onClick={() => setPreview({ name: f.name, url: f.url, extension: f.extension })}
          >
            {/* round283 — the type glyph (W/X/PDF/P) on the colored square. */}
            <span className={styles.docIconLabel}>{fileKindLabel(kindKey)}</span>
          </button>
          {canAttach && (
            <button
              type="button"
              className={styles.docDel}
              disabled={clearing}
              onClick={requestDeleteFiles}
              title="מחיקת מסמך"
              aria-label={`מחיקת מסמך: ${f.name}`}
            >
              <X size={10} />
            </button>
          )}
        </span>
        );
      })}
    </div>
  ) : null;

  // round225 (owner spec) — the last-edit meta lives in the WHITE area at the
  // toolbar's right end: last editor's initials avatar + date & time only + the
  // green "נשמר" (and the other save states, which need the same home).
  const toolbarMeta = (
    <span className={styles.paneToolbarMeta} dir="rtl">
      {author ? (
        <span className={styles.paneMetaAvatar} title={author} aria-label={author}>{editorInitials(author)}</span>
      ) : null}
      {when ? <span className={styles.paneMetaWhen}>{when}</span> : null}
      {status === 'saved' && (<span className={styles.refSaved}><Check size={13} /> נשמר</span>)}
      {status === 'dirty' && <span className={styles.paneMetaState}>שינויים לא נשמרו</span>}
      {status === 'saving' && (<span className={styles.paneMetaState}><Loader2 size={13} className={styles.refSpin} /> שומר…</span>)}
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
  );

  return (
    // round234 — the active pane fills the card's FIXED frame (flex column);
    // attachments/footer live inside it, so every pane has the exact same
    // size and switching headers can never move or resize the box.
    <div className={styles.paneWrap} style={active ? undefined : { display: 'none' }}>
      <div className={styles.paneEditor}>
        {!loading && (
          <Suspense fallback={null}>
            <RichTextEditor
              key={discussionId}
              initialValue={html}
              onReady={handleReady}
              onChange={handleChange}
              placeholder={canEdit ? placeholder : ''}
              editable={canEdit}
              variant="flush"
              extraToolbarActions={<>{attachAction}{toolbarMeta}</>}
              belowToolbar={documentsBar}
              mentionPeople={mentionPeople}
            />
          </Suspense>
        )}
        {showLoader && (
          <div className={styles.refLoader} aria-busy="true" aria-label="טוען">
            <BrandLoader />
          </div>
        )}
      </div>


      {/* round225 — for EDITORS the meta/save-state moved into the toolbar's
          white right end (toolbarMeta above); read-only viewers have no toolbar,
          so they keep a slim footer with the last-edit info. */}
      {!showLoader && !canEdit && when && (
        <div className={styles.paneFooter}>
          <span className={styles.refMeta}>
            {author ? `נערך לאחרונה ע״י ${author} · ${when}` : `נערך לאחרונה · ${when}`}
          </span>
        </div>
      )}

      {/* round285 (owner request) — clicking a document no longer renders an
          inline preview (the empty preview area for xlsx/word looked bad). It
          opens a COMPACT popup: the file-type glyph + name + a single download
          button. */}
      {preview && (
        <div
          className={styles.docPreviewOverlay}
          dir="rtl"
          onClick={(e) => { if (e.target === e.currentTarget) setPreview(null); }}
        >
          <div className={styles.docDownloadCard} role="dialog" aria-modal="true" aria-label={`הורדת מסמך: ${preview.name}`}>
            <button type="button" className={styles.docPreviewClose} onClick={() => setPreview(null)} aria-label="סגירה">×</button>
            <span
              className={styles.docDownloadIcon}
              style={{ background: fileKindColor(preview.extension || preview.name) }}
              aria-hidden="true"
            >
              {fileKindLabel(preview.extension || preview.name)}
            </span>
            <span className={styles.docDownloadName} title={preview.name}>{preview.name}</span>
            {preview.url ? (
              <a className={styles.docDownloadBtn} href={preview.url} target="_blank" rel="noreferrer" download>
                <Download size={16} /> הורדת הקובץ
              </a>
            ) : (
              <span className={styles.docPreviewNote}>הקובץ אינו זמין להורדה.</span>
            )}
          </div>
        </div>
      )}

      {/* round271 — delete confirmation, shown ONLY when the box holds more than
          one document (monday clears them all at once; a single file skips this). */}
      {confirmClear && (
        <div
          className={styles.docPreviewOverlay}
          dir="rtl"
          onClick={(e) => { if (e.target === e.currentTarget) setConfirmClear(false); }}
        >
          <div className={styles.docConfirm} role="alertdialog" aria-modal="true" aria-label="מחיקת מסמכים">
            <div className={styles.docConfirmTitle}>מחיקת מסמכים</div>
            <div className={styles.docConfirmBody}>
              בתיבה זו יש <b>{files.length}</b> מסמכים. ל-monday אין אפשרות למחוק מסמך בודד מעדכון,
              ולכן המחיקה תסיר את <b>כל</b> המסמכים בתיבה (הטקסט יישמר). להמשיך?
            </div>
            <div className={styles.docConfirmActions}>
              <button type="button" className={styles.docConfirmCancel} onClick={() => setConfirmClear(false)}>ביטול</button>
              <button type="button" className={styles.docConfirmDanger} onClick={doClearDocuments} disabled={clearing}>מחק הכל</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/*
 * round206 (approved mockup) — the TRIPLE BOX: ONE card with three header
 * titles (רקע rightmost → התייחסויות → סיכום leftmost, no sub-hints), feeling
 * like one box with switchable headers while actually editing THREE separate
 * monday Updates (each with its own tracked id). The formatting toolbar sits
 * flush at the box top (inside the editor, variant='flush') with the 📎
 * attach action; a selection bubble handles inline formatting. Panes hidden by
 * the owner's component visibility drop their header.
 */
export function UpdatesTripleBox({
  discussionId, canEdit = false,
  // round270 — who may ADD documents (the 📎). A fixed rule: discussion creator /
  // coordinator / lead / owner (computed in DiscussionCard). Everyone else still
  // sees the documents bar and can preview + download. (No per-file remove — the
  // monday API has no per-asset delete on an update.)
  canAttach = false,
  // round212 — PER-PANE write gates (matrix capabilities); null falls back to
  // the legacy single canEdit so old call sites/tests keep working.
  canEditBackground = null, canEditReferences = null, canEditSummary = null,
  showBackground = true, showReferences = true, showSummary = true,
  // round220 — participants offered by the @-mention popup (lead→coordinator→
  // participants, deduped; built by the caller). Empty ⇒ no mention affordance.
  mentionPeople = [],
  // round230 — bumps on a produced-link activation: jump to the רקע (background)
  // pane so the link always lands with the background box open.
  resetPaneNonce = 0,
  // round241 — owner-only layout edit-tools (pencil + 6-dot grip) rendered in
  // the tab band so the triple box carries the same edit affordance as the
  // agenda box (owner request: a pencil on each box). Null for non-owners.
  headerTools = null,
}) {
  const { settings } = useSettings();
  const background = useBackground(showBackground ? discussionId : null);
  const references = useReferences(showReferences ? discussionId : null);
  const summary = useSummary(showSummary ? discussionId : null);

  const editBackground = canEditBackground ?? canEdit;
  const editReferences = canEditReferences ?? canEdit;
  const editSummaryPane = canEditSummary ?? canEdit;

  /*
   * round314 — the titles are OWNER-SET (Settings → העדפות), resolved through
   * resolveBoxLabels so a blank entry falls back to the shipped name instead of
   * rendering a nameless tab. The PLACEHOLDERS keep their original wording on
   * purpose: they explain what to write in the pane, which a rename does not change.
   */
  const labels = useMemo(() => resolveBoxLabels(settings?.preferences), [settings?.preferences]);

  const panes = useMemo(() => [
    showBackground && { key: 'background', title: labels.background, hook: background, canEdit: editBackground, placeholder: 'כתבו כאן רקע והכנה לדיון…' },
    showReferences && { key: 'references', title: labels.references, hook: references, canEdit: editReferences, placeholder: 'כתבו כאן התייחסויות של משתתפי הדיון…' },
    showSummary && { key: 'summary', title: labels.summary, hook: summary, canEdit: editSummaryPane, placeholder: 'כתבו כאן את סיכום הדיון…' },
  ].filter(Boolean), [showBackground, showReferences, showSummary, background, references, summary, editBackground, editReferences, editSummaryPane, labels]);

  /*
   * round314 (PR review on #541) — the tablist's accessible name is DERIVED from the
   * panes that are actually rendered. It used to be the hardcoded "רקע, התייחסויות
   * וסיכום", which a rename made simply wrong for a screen reader (the group was
   * announced by names none of its tabs carried) and which was already stale for an
   * instance that hid a pane. Hebrew list form: comma-separated, "ו" glued to the
   * last item; one pane gets its name alone, with no dangling conjunction.
   */
  const tabsLabel = useMemo(() => {
    const titles = panes.map((p) => p.title);
    if (titles.length < 2) return titles[0] || '';
    return `${titles.slice(0, -1).join(', ')} ו${titles[titles.length - 1]}`;
  }, [panes]);

  const [activeKey, setActiveKey] = useState(panes[0]?.key || 'background');
  useEffect(() => { setActiveKey(panes[0]?.key || 'background'); }, [discussionId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (panes.length && !panes.some((p) => p.key === activeKey)) setActiveKey(panes[0].key);
  }, [panes, activeKey]);

  // round230 — a produced-link activation jumps to the רקע (background) pane so
  // the link lands with the background box open (falls back to the first visible
  // pane if the owner hid רקע). Guarded on >0 so it never fires on a normal open.
  useEffect(() => {
    if (resetPaneNonce <= 0) return;
    setActiveKey(panes.some((p) => p.key === 'background') ? 'background' : (panes[0]?.key || 'background'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetPaneNonce]);

  if (!panes.length) return null;

  return (
    <div className={styles.tripleBox} dir="rtl">
      <div className={styles.tripleTabs} role="tablist" aria-label={tabsLabel}>
        {panes.map((p) => (
          <button
            key={p.key}
            type="button"
            role="tab"
            aria-selected={activeKey === p.key}
            className={`${styles.tripleTab} ${activeKey === p.key ? styles.tripleTabActive : ''}`}
            onClick={() => setActiveKey(p.key)}
          >
            {p.title}
          </button>
        ))}
        {headerTools && <span className={styles.tripleHeaderTools}>{headerTools}</span>}
      </div>
      {panes.map((p) => (
        <UpdatePane
          key={p.key}
          discussionId={discussionId}
          hook={p.hook}
          placeholder={p.placeholder}
          canEdit={p.canEdit}
          canAttach={canAttach}
          active={activeKey === p.key}
          mentionPeople={mentionPeople}
        />
      ))}
    </div>
  );
}

export default UpdatesTripleBox;
