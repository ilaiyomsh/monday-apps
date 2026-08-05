/**
 * The uploaded .docx template — the only thing that supplies the page
 * header/footer/logo of the exported report.
 *
 * @module components/SettingsPanel/TemplateUpload
 *
 * Two decisions are load-bearing:
 *
 *  1. **Validated at UPLOAD time, not at generation time.** `readTemplateFile`
 *     unzips the bytes and insists on `word/document.xml` before anything is
 *     stored. The export path deliberately falls back to the generated body when a
 *     template will not splice (a broken template must never cost someone their
 *     report), so without a check HERE a wrong file would surface days later, to a
 *     different user, as a report that quietly lost its letterhead.
 *  2. **It is stored under its OWN storage key**, not in the settings blob: the blob
 *     is read on every boot and gates render, and a template runs to hundreds of KB.
 *     Hence this component talks to `utils/assetsStore` directly instead of routing
 *     through `updateSettings`.
 *
 * The storage BUDGET message from `assetsStore` (`err.code === 'quota'`) is shown
 * verbatim — it names the actual size and tells the owner what to shrink, which no
 * generic message could.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Button, Loader, Text } from '@vibe/core';
import { useMonday } from '../../contexts/MondayContext.jsx';
import { loadTemplate, saveTemplate } from '../../utils/assetsStore.js';
import { TEMPLATE_ACCEPT, readTemplateFile } from './templateFile.js';
import logger from '../../utils/logger.js';
import styles from './SettingsPanel.module.css';

/** base64 is 4 chars per 3 bytes — good enough for a human-facing size. */
const approxKb = (base64Length) => Math.max(1, Math.round((base64Length * 0.75) / 1024));

const GENERIC_FAILURE = 'שמירת התבנית נכשלה. נסו שוב, ואם זה חוזר פנו לתמיכה.';

export function TemplateUpload() {
  const { context } = useMonday();
  const inputRef = useRef(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [sizeKb, setSizeKb] = useState(0);
  const [hasTemplate, setHasTemplate] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // Wait for the context: the storage key is instance-scoped, and reading under
    // the 'default' key would report "no template" for a configured instance.
    if (!context) return undefined;

    let cancelled = false;
    setIsLoading(true);

    // `loadTemplate` never throws (a missing template must cost the report its
    // letterhead, not the whole export), so the catch is for the unexpected — and
    // it exists so this section cannot get stuck on its spinner.
    loadTemplate(context)
      .then((base64) => {
        if (cancelled) return;
        setHasTemplate(Boolean(base64));
        setSizeKb(base64 ? approxKb(base64.length) : 0);
        setIsLoading(false);
      })
      .catch((err) => {
        logger.error('TemplateUpload', 'טעינת תבנית הדוח נכשלה', err);
        if (cancelled) return;
        setError('לא ניתן לבדוק אם קיימת תבנית שמורה.');
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [context]);

  const handlePick = async (event) => {
    const file = event.target.files?.[0];
    // Reset the input NOW: picking the same file twice in a row fires no change
    // event otherwise, so a failed upload could not be retried with the same file.
    event.target.value = '';
    if (!file) return;

    setError('');
    setIsBusy(true);
    try {
      const base64 = await readTemplateFile(file);
      await saveTemplate(context, base64);
      setHasTemplate(true);
      setSizeKb(approxKb(base64.length));
    } catch (err) {
      // Everything `templateFile` and the quota check throw is already an
      // owner-readable Hebrew sentence naming the actual problem — show it verbatim
      // rather than flattening it into "upload failed".
      const readable = err?.code ? err.message : GENERIC_FAILURE;
      setError(readable);
      // WARN, not ERROR: "you picked a PDF" is a user event, and useUiErrorSink
      // would turn an ERROR into a toast on top of the message already on screen.
      // A real storage failure was logged at ERROR by assetsStore itself.
      logger.warn('TemplateUpload', 'העלאת תבנית הדוח נדחתה', err, {
        code: err?.code ?? null,
        fileName: file.name,
      });
    } finally {
      setIsBusy(false);
    }
  };

  const handleRemove = async () => {
    setError('');
    setIsBusy(true);
    try {
      await saveTemplate(context, null);
      setHasTemplate(false);
      setSizeKb(0);
    } catch (err) {
      setError(GENERIC_FAILURE);
      // assetsStore already logged this at ERROR with the storage key; warn here
      // just records which surface asked.
      logger.warn('TemplateUpload', 'הסרת תבנית הדוח נכשלה', err);
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>
        <Text type="text1" weight="bold" element="span">
          תבנית Word
        </Text>
        <Text type="text3" color="secondary" element="span">
          ממנה נלקחים הכותרת העליונה, התחתונה והלוגו
        </Text>
      </div>

      <input
        ref={inputRef}
        type="file"
        className={styles.fileInput}
        accept={TEMPLATE_ACCEPT}
        aria-label="בחרו קובץ תבנית Word"
        data-testid="template-input"
        onChange={handlePick}
      />

      {isLoading ? (
        <div className={styles.templateRow}>
          <Loader size="xs" />
          <Text type="text3" color="secondary">
            בודקים אם קיימת תבנית…
          </Text>
        </div>
      ) : (
        <div className={styles.templateRow}>
          <Button
            kind="secondary"
            size="small"
            loading={isBusy}
            onClick={() => inputRef.current?.click()}
            data-testid="template-pick"
          >
            {hasTemplate ? 'החליפו תבנית' : 'העלו תבנית'}
          </Button>

          {hasTemplate ? (
            <>
              <Text type="text3" color="secondary" data-testid="template-present">
                תבנית שמורה (כ-{sizeKb}KB)
              </Text>
              <Button
                kind="tertiary"
                size="small"
                color="negative"
                disabled={isBusy}
                onClick={handleRemove}
                data-testid="template-remove"
              >
                הסירו
              </Button>
            </>
          ) : (
            <Text type="text3" color="secondary" data-testid="template-absent">
              לא הועלתה תבנית — הדוח ייוצר בלי כותרת ולוגו.
            </Text>
          )}
        </div>
      )}

      {error ? (
        <Text type="text3" color="negative" data-testid="template-error">
          {error}
        </Text>
      ) : null}
    </div>
  );
}

export default TemplateUpload;
