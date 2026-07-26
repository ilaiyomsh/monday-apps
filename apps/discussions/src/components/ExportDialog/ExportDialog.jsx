import React, { useEffect, useRef, useState } from 'react';
import { Button, Heading, Text } from '@vibe/core';
import { BrandLoader } from '../BrandLoader';
import ExportTemplateTab from '../SettingsModal/ExportTemplateTab.jsx';
import { seedExportTemplate } from '../SettingsModal/SettingsModal.jsx';
import { assembleDiscussionModel, deliverDiscussionDocx } from '../../utils/docxExport.js';
import { loadExportAssets } from '../../utils/exportAssets.js';
import {
  loadDiscussionExportTemplate,
  saveDiscussionExportTemplate,
  loadDiscussionExportAssets,
  saveDiscussionExportAssets,
} from '../../utils/discussionExportStore.js';
import { resolveExportTemplate, typeExportTemplateFor } from '../../utils/exportTemplateResolve.js';
import { useTemplates } from '../../contexts/TemplatesContext.jsx';
import logger from '../../utils/logger.js';
import styles from './ExportDialog.module.css';

/*
 * round207 — the per-discussion export dialog (owner spec): clicking "ייצוא" in
 * the row kebab no longer downloads immediately. It opens this fullscreen box —
 * the SAME size and structure as the Settings "תבנית ייצוא" tab — but the live
 * preview renders THE REAL discussion (assembleDiscussionModel), and the
 * template/assets edits apply to THIS discussion only (persisted per discussion
 * via discussionExportStore; seeded from the instance defaults on first open).
 * "הפק מסמך" (bottom-left) persists the overrides and delivers the .docx.
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
  // The assets we seeded with (per-discussion override || instance globals). A
  // changed reference on produce means the user edited them in THIS dialog —
  // only then is a per-discussion assets override written (it may be large).
  const initialAssetsRef = useRef(null);

  useEffect(() => {
    if (!discussionId) return undefined;
    let cancelled = false;
    setLoadError(false);
    setModelState(null);
    (async () => {
      try {
        const [assembled, globalAssets, ownTemplate, ownAssets] = await Promise.all([
          assembleDiscussionModel(discussion),
          loadExportAssets(context),
          loadDiscussionExportTemplate(discussionId),
          loadDiscussionExportAssets(discussionId),
        ]);
        // round254 — resolve the discussion TYPE's own export template (config)
        // and, when it has one, its own assets. The type sits BETWEEN the
        // per-discussion override and the instance default.
        const typeName = discussion?.discussionTypeID || '';
        const typeTemplate = typeExportTemplateFor(typeTemplates, typeName);
        const typeAssets = typeTemplate ? await loadTypeExportAssets(typeName) : null;
        if (cancelled) return;
        const seededAssets = ownAssets || (typeTemplate ? typeAssets : null) || globalAssets || null;
        initialAssetsRef.current = seededAssets;
        setTemplate(seedExportTemplate(resolveExportTemplate(ownTemplate, typeTemplate, settings?.exportTemplate)));
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

  const handleProduce = async () => {
    if (!ready || producing) return;
    setProducing(true);
    try {
      // Persist this discussion's customization first, so the next open of the
      // dialog starts from what was actually produced.
      await saveDiscussionExportTemplate(discussionId, template);
      if (assets !== initialAssetsRef.current) {
        await saveDiscussionExportAssets(discussionId, assets);
      }
      const { uploadAttempted, uploaded } = await deliverDiscussionDocx(
        modelState.model, modelState.filename,
        { template, assets, discussionId },
      );
      if (uploadAttempted && uploaded) onNotify?.('הדיון יוצא ונשמר לעמודת הקובץ');
      else if (uploadAttempted) onNotify?.('הקובץ ירד למחשב, אך השמירה לעמודת הקובץ נכשלה', 'warning');
      else onNotify?.('הדיון יוצא ל-DOCS בהצלחה');
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
