import React, { useEffect, useRef, useState } from 'react';
import { Button, Heading, Text } from '@vibe/core';
import { BrandLoader } from '../BrandLoader';
import ExportTemplateTab from '../SettingsModal/ExportTemplateTab.jsx';
import { seedExportTemplate } from '../SettingsModal/SettingsModal.jsx';
import { assembleDiscussionModel, deliverDiscussionDocx } from '../../utils/docxExport.js';
import { loadExportAssets } from '../../utils/exportAssets.js';
import {
  resolveExportTemplate,
  resolveExportAssets,
  typeExportTemplateFor,
} from '../../utils/exportTemplateResolve.js';
import { EXPORT_HEADER_MODES, DEFAULT_EXPORT_TEMPLATE } from '../../utils/mondayApi/boards.config.js';
import { useTemplates } from '../../contexts/TemplatesContext.jsx';
import logger from '../../utils/logger.js';
import styles from './ExportDialog.module.css';

/*
 * round207 — the per-discussion export dialog (owner spec): clicking "ייצוא" in
 * the row kebab no longer downloads immediately. It opens this fullscreen box —
 * the SAME size and structure as the Settings "תבנית ייצוא" tab — but the live
 * preview renders THE REAL discussion (assembleDiscussionModel).
 *
 * round356 (owner spec) — the cascade, and what is EPHEMERAL:
 *   · the system template is the default; a discussion TYPE's template overrides it
 *     for every discussion of that type (config merged per field, assets per field);
 *   · the edits made HERE override both — for THIS export only. Nothing is written
 *     back. The owner's words: "שההתאמות האלה לא ישמרו להמשך ושיחולו רק על פעולת
 *     הייצוא הספציפי הזאת". So there is no per-discussion override to read, write or
 *     reset any more: every open starts from the discussion's type again.
 *   · Pre-round356 installs may still hold a stored per-discussion override in monday
 *     storage. It is deliberately NOT read (reading it would contradict "the type's
 *     template is the default") and deliberately NOT deleted (that is the owner's
 *     data to drop, not ours).
 */
export function ExportDialog({ discussion, settings, context, onClose, onNotify }) {
  const discussionId = discussion?.id ? String(discussion.id) : null;
  // round254 — the discussion's TYPE may carry its own export template (and
  // assets) that override the system default. Read at seed time below.
  const { typeTemplates, loadTypeExportAssets } = useTemplates();
  const [template, setTemplate] = useState(null);
  const [assets, setAssets] = useState(null);
  const [modelState, setModelState] = useState(null); // { model, filename }
  const [loadError, setLoadError] = useState(false);
  const [producing, setProducing] = useState(false);
  const [loadKey, setLoadKey] = useState(0); // bump = retry the load

  // round304 — same rule for the template CONFIG: the seeded template, so produce
  // persists an override only when the user actually changed something here.
  // Persisting unconditionally is what froze discussions onto the default that was
  // in force at their first export and shadowed their type's template afterwards.
  const initialTemplateRef = useRef(null);

  useEffect(() => {
    if (!discussionId) return undefined;
    let cancelled = false;
    setLoadError(false);
    setModelState(null);
    (async () => {
      try {
        const [assembled, globalAssets] = await Promise.all([
          assembleDiscussionModel(discussion),
          loadExportAssets(context),
        ]);
        // round254/round356 — the discussion TYPE's own export template + assets. The
        // type's ASSETS are read whenever the discussion has a type: a type may carry
        // brand binaries (notably the uploaded header/footer .docx) without its config
        // having been touched, and gating the read on the config left that file unused.
        const typeName = discussion?.discussionTypeID || '';
        const typeTemplate = typeExportTemplateFor(typeTemplates, typeName);
        const typeAssets = typeName ? await loadTypeExportAssets(typeName) : null;
        if (cancelled) return;
        // Compare/merge the tiers in their SEEDED form — they are written by different
        // screens at different times, so only a normalized shape merges meaningfully.
        const seededInstance = settings?.exportTemplate ? seedExportTemplate(settings.exportTemplate) : null;
        const seededType = typeTemplate ? seedExportTemplate(typeTemplate) : null;
        // No per-discussion tier any more (round356): type over system, nothing above.
        const resolved = seedExportTemplate(resolveExportTemplate(null, seededType, seededInstance));
        /*
         * round356 — the ASSETS merge PER FIELD with the same precedence. Picking one
         * tier whole is the bug the owner hit: a header/footer .docx uploaded at the
         * system level was discarded because the type happened to carry a logo, and the
         * export then silently rendered with no headers at all.
         */
        const seededAssets = resolveExportAssets(typeAssets, globalAssets);
        initialTemplateRef.current = resolved;
        setTemplate(resolved);
        setAssets(seededAssets);
        setModelState(assembled);
      } catch (err) {
        if (cancelled) return;
        if (!err?.__loggedId) logger.error('ExportDialog', 'טעינת נתוני הדיון לייצוא נכשלה', err);
        setLoadError(true);
      }
    })();
    return () => { cancelled = true; };
    // discussion/context/settings ride on discussionId — a different object for
    // the same discussion must NOT re-assemble (the model fetch is expensive).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discussionId, loadKey]);

  const ready = Boolean(modelState && template);
  /*
   * round356 — the config can say "take the headers from the uploaded file" while the
   * merged assets carry no file: the two are set on different screens, and before the
   * per-field merge a tier without the .docx could win outright. deliverDiscussionDocx
   * then falls back to a header-less render SILENTLY, which is exactly how the owner's
   * uploaded header/footer went missing with no error to explain it. Say it out loud.
   */
  const headerMode = template?.headerMode || DEFAULT_EXPORT_TEMPLATE.headerMode;
  const missingTemplateDocx = headerMode === EXPORT_HEADER_MODES.UPLOAD && !assets?.templateDocx;

  const handleProduce = async () => {
    if (!ready || producing) return;
    setProducing(true);
    try {
      // round356 — nothing is persisted. What the owner adjusted here applies to THIS
      // document and is gone when the dialog closes; the next export starts from the
      // discussion's type again.
      const { uploadAttempted, uploaded } = await deliverDiscussionDocx(
        modelState.model, modelState.filename,
        { template, assets, discussionId },
      );
      // round297 — lead every success with "המסמך הופק בהצלחה" (owner request:
      // a green top notice after production), keeping the where-it-saved nuance.
      if (uploadAttempted && uploaded) onNotify?.('המסמך הופק בהצלחה ונשמר לעמודת הקובץ');
      else if (uploadAttempted) onNotify?.('המסמך הופק וירד למחשב, אך השמירה לעמודת הקובץ נכשלה', 'warning');
      else onNotify?.('המסמך הופק בהצלחה');
      onClose?.();
    } catch (err) {
      if (!err?.__loggedId) logger.error('ExportDialog', 'הפקת המסמך נכשלה', err);
    } finally {
      setProducing(false);
    }
  };

  if (!discussion) return null;

  return (
    <div
      className={styles.exOverlay}
      onClick={(e) => { if (e.target === e.currentTarget && !producing) onClose?.(); }}
    >
      <div className={styles.exModal} role="dialog" aria-modal="true" aria-label="ייצוא דיון">
        {/* round297 — indeterminate loading BAR across the top of the dialog while
            the document is being produced (owner request), from click until the
            .docx is delivered. */}
        {producing && (
          <div className={styles.produceBar} role="progressbar" aria-label="מפיק מסמך…" aria-busy="true">
            <span className={styles.produceBarFill} />
          </div>
        )}
        <div className={styles.exHeader}>
          <div className={styles.exHeaderTitles}>
            <Heading type="h4">ייצוא דיון</Heading>
            {discussion.name ? (
              <Text type="text2" color="secondary" className={styles.exHeaderSub}>{discussion.name}</Text>
            ) : null}
          </div>
          <button type="button" className={styles.exClose} onClick={onClose} aria-label="סגירה">×</button>
        </div>

        <div className={styles.exContent}>
          {loadError ? (
            <div className={styles.exStateBox}>
              <Text type="text1">טעינת נתוני הדיון לייצוא נכשלה.</Text>
              <Button size="small" kind="secondary" onClick={() => setLoadKey((k) => k + 1)}>נסה שוב</Button>
            </div>
          ) : !ready ? (
            <div className={styles.exStateBox}>
              <BrandLoader />
            </div>
          ) : (
            <ExportTemplateTab
              template={template}
              setTemplate={setTemplate}
              assets={assets}
              setAssets={setAssets}
              assetError={null}
              previewModel={modelState.model}
              previewModelKey={`${discussionId}:${loadKey}`}
            />
          )}
        </div>

        {ready && (
          <div className={styles.exNotes}>
            {missingTemplateDocx && (
              <Text type="text3" color="negative">
                מצב הכותרות הוא "קובץ תבנית", אבל לא נמצא קובץ DOCX בשום רמה — המסמך ייוצא ללא
                כותרת עליונה ותחתונה. העלו קובץ בהגדרות תבנית הייצוא, או החזירו את המצב ל"עיצוב כאן".
              </Text>
            )}
            <Text type="text3" color="secondary">
              התאמות שתעשו כאן חלות על המסמך הזה בלבד ואינן נשמרות — הייצוא הבא יתחיל שוב
              מתבנית סוג הדיון.
            </Text>
          </div>
        )}

        <div className={styles.exFooter}>
          <Button kind="tertiary" onClick={onClose} disabled={producing}>ביטול</Button>
          <Button kind="primary" onClick={handleProduce} disabled={!ready} loading={producing}>
            הפק מסמך
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ExportDialog;
