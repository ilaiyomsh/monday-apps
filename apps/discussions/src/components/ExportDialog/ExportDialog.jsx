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
import {
  resolveExportTemplate,
  typeExportTemplateFor,
  effectiveOwnTemplate,
  shouldPersistOwnTemplate,
  hasAssetContent,
} from '../../utils/exportTemplateResolve.js';
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
  // round304 — does THIS discussion carry a stored per-discussion override? Drives
  // the "חזרה לברירת המחדל" action, which clears it so the discussion follows its
  // type's export template again.
  const [hasOwnOverride, setHasOwnOverride] = useState(false);
  const [resetting, setResetting] = useState(false);
  // The assets we seeded with (per-discussion override || the type's || instance
  // globals). A changed reference on produce means the user edited them in THIS
  // dialog — only then is a per-discussion assets override written (it may be large).
  const initialAssetsRef = useRef(null);
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
        const [assembled, globalAssets, ownTemplate, ownAssets] = await Promise.all([
          assembleDiscussionModel(discussion),
          loadExportAssets(context),
          loadDiscussionExportTemplate(discussionId),
          loadDiscussionExportAssets(discussionId),
        ]);
        // round254 — resolve the discussion TYPE's own export template (config) and
        // its own assets. The type sits BETWEEN the per-discussion override and the
        // instance default. round304: the type's ASSETS are read whenever the
        // discussion has a type — a type may carry brand binaries (notably the
        // uploaded header/footer .docx) without its config having been touched, and
        // gating the read on the config left that file unused.
        const typeName = discussion?.discussionTypeID || '';
        const typeTemplate = typeExportTemplateFor(typeTemplates, typeName);
        const typeAssets = typeName ? await loadTypeExportAssets(typeName) : null;
        if (cancelled) return;
        // Compare the tiers in their SEEDED form — they are written by different
        // screens at different times, so only a normalized shape compares meaningfully.
        const seededInstance = settings?.exportTemplate ? seedExportTemplate(settings.exportTemplate) : null;
        const seededType = typeTemplate ? seedExportTemplate(typeTemplate) : null;
        const seededOwn = ownTemplate ? seedExportTemplate(ownTemplate) : null;
        // An own copy that merely echoes the tier it was seeded from is not a real
        // customization — drop it so the type's template applies by default.
        const realOwn = effectiveOwnTemplate(seededOwn, seededType, seededInstance);
        const resolved = seedExportTemplate(resolveExportTemplate(realOwn, seededType, seededInstance));
        const seededAssets = ownAssets || (hasAssetContent(typeAssets) ? typeAssets : null) || globalAssets || null;
        initialAssetsRef.current = seededAssets;
        initialTemplateRef.current = resolved;
        setHasOwnOverride(Boolean(realOwn || ownAssets));
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

  const handleProduce = async () => {
    if (!ready || producing) return;
    setProducing(true);
    try {
      // Persist this discussion's customization first, so the next open of the
      // dialog starts from what was actually produced — but ONLY what the user
      // really changed here (round304). Writing the resolved template back on every
      // produce turned "I exported this once" into a permanent per-discussion
      // override that shadowed the discussion type's export template.
      if (shouldPersistOwnTemplate(initialTemplateRef.current, template)) {
        await saveDiscussionExportTemplate(discussionId, template);
      }
      if (assets !== initialAssetsRef.current) {
        await saveDiscussionExportAssets(discussionId, assets);
      }
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

  /*
   * round304 — drop this discussion's own override and re-seed from its type (or
   * the system default). The escape hatch for a discussion that was customized —
   * or frozen by an older export — and should follow its type's template again.
   */
  const handleResetToDefault = async () => {
    if (resetting || producing) return;
    setResetting(true);
    try {
      await saveDiscussionExportTemplate(discussionId, null);
      await saveDiscussionExportAssets(discussionId, null);
      setHasOwnOverride(false);
      setModelState(null); // show the loader while the tiers are re-read
      setLoadKey((k) => k + 1);
      onNotify?.('תבנית הייצוא של הדיון אופסה לברירת המחדל של סוג הדיון');
    } catch (err) {
      if (!err?.__loggedId) logger.error('ExportDialog', 'איפוס תבנית הייצוא של הדיון נכשל', err);
    } finally {
      setResetting(false);
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

        <div className={styles.exFooter}>
          <Button kind="tertiary" onClick={onClose} disabled={producing}>ביטול</Button>
          {hasOwnOverride && (
            <Button
              kind="tertiary"
              onClick={handleResetToDefault}
              disabled={producing || resetting}
              loading={resetting}
            >
              חזרה לברירת המחדל
            </Button>
          )}
          <Button kind="primary" onClick={handleProduce} disabled={!ready} loading={producing}>
            הפק מסמך
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ExportDialog;
