import React from 'react';
import { Modal, ModalHeader, ModalContent, Button, Flex } from '@vibe/core';
import { useTranslation } from 'react-i18next';
import logger from '../../utils/logger';
import styles from './ErrorDetailsModal.module.css';

/**
 * Copy to clipboard. The clipboard API is unavailable on insecure origins and
 * can reject when the document is not focused — a copy failing is not worth
 * interrupting the user, but per error-guard it still gets recorded.
 */
const copy = (text) => {
  try {
    navigator.clipboard?.writeText(String(text ?? ''));
  } catch (err) {
    logger.warn('ErrorDetailsModal', 'clipboard_write_failed', err);
  }
};

/**
 * Error details modal.
 *
 * Fed the `details` object that useUiErrorSink builds, whose shape is:
 *   { module, message, timestamp, timestampISO, correlationId, context, error }
 * where `error` is either `{ name, message, stack }` or the raw payload.
 *
 * NOTE: this deliberately does NOT reuse apps/discussions' ErrorDetailsModal —
 * that one reads a different shape (`fullDetails` / `apiRequest` / `userMessage`
 * from its own parseMondayError), which this app has no producer for.
 */
export function ErrorDetailsModal({ isOpen, onClose, errorDetails }) {
  const { t } = useTranslation();

  if (!errorDetails) return null;

  const err = errorDetails.error;
  const stack = err && typeof err === 'object' ? err.stack : null;
  const errMessage = err && typeof err === 'object' ? err.message : err;

  return (
    <Modal id="error-details-modal" show={!!isOpen} onClose={onClose} size="medium">
      <ModalHeader title={t('errorDetailsModal.title')} />
      <ModalContent>
        <Flex direction="column" gap={12} align="stretch">
          <div className={styles.section}>
            <div className={styles.event}>
              {errorDetails.module} · {errorDetails.message}
            </div>
            {errMessage ? <div className={styles.meta}>{String(errMessage)}</div> : null}
            <div className={styles.meta}>
              {t('errorDetailsModal.time')}: {errorDetails.timestampISO ?? '—'}
              {errorDetails.correlationId
                ? ` · ${t('errorDetailsModal.correlationId')}: ${errorDetails.correlationId}`
                : ''}
            </div>
          </div>

          <pre className={styles.pre}>{stack || t('errorDetailsModal.noStack')}</pre>

          {errorDetails.context ? (
            <pre className={styles.pre}>{JSON.stringify(errorDetails.context, null, 2)}</pre>
          ) : null}

          <div>
            <Button
              size="small"
              kind="tertiary"
              onClick={() => copy(JSON.stringify(errorDetails, null, 2))}
            >
              {t('errorDetailsModal.copyAll')}
            </Button>
          </div>
        </Flex>
      </ModalContent>
    </Modal>
  );
}

export default ErrorDetailsModal;
