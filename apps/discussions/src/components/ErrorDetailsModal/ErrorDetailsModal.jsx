import React, { useState } from 'react';
import {
  Modal,
  ModalHeader,
  ModalContent,
  TabsContext,
  TabList,
  Tab,
  TabPanels,
  TabPanel,
  Button,
  Flex,
} from '@vibe/core';
import { useTranslation } from 'react-i18next';
import styles from './ErrorDetailsModal.module.css';

const copy = (text) => {
  try {
    navigator.clipboard?.writeText(String(text ?? ''));
  } catch {
    /* clipboard may be unavailable; non-critical */
  }
};

/**
 * Error details modal — 3 tabs (Error / API / JSON). Fed the structured
 * errorDetails object produced by useUiErrorSink (parseMondayError +
 * createFullErrorObject).
 */
export function ErrorDetailsModal({ isOpen, onClose, errorDetails }) {
  const { t } = useTranslation();
  const [active, setActive] = useState(0);

  if (!errorDetails) return null;

  const fd = errorDetails.fullDetails || {};
  const req = errorDetails.apiRequest || {};

  return (
    <Modal id="error-details-modal" show={!!isOpen} onClose={onClose} size="medium">
      <ModalHeader title={t('errorDetailsModal.title')} />
      <ModalContent>
        <TabsContext activeTabId={active}>
          <TabList activeTabId={active} onTabChange={setActive}>
            <Tab>{t('errorDetailsModal.tabError')}</Tab>
            <Tab>{t('errorDetailsModal.tabApi')}</Tab>
            <Tab>{t('errorDetailsModal.tabJson')}</Tab>
          </TabList>
          <TabPanels activeTabId={active}>
            <TabPanel>
              <div className={styles.section}>
                <div className={styles.userMessage}>{errorDetails.userMessage}</div>
                {errorDetails.errorCode ? (
                  <div className={styles.meta}>code: {errorDetails.errorCode}</div>
                ) : null}
                {errorDetails.actionRequired ? (
                  <div className={styles.meta}>{errorDetails.actionRequired}</div>
                ) : null}
                {fd.stackTrace || fd.errorMessage ? (
                  <pre className={styles.pre}>{fd.stackTrace || fd.errorMessage}</pre>
                ) : null}
              </div>
            </TabPanel>
            <TabPanel>
              <Flex direction="column" gap={8} align="stretch">
                <pre className={styles.pre}>{req.query || '—'}</pre>
                <pre className={styles.pre}>{JSON.stringify(req.variables ?? null, null, 2)}</pre>
                <div>
                  <Button
                    size="small"
                    kind={"tertiary"}
                    onClick={() => copy(`${req.query || ''}\n${JSON.stringify(req.variables ?? null, null, 2)}`)}
                  >
                    {t('errorDetailsModal.copyQuery')}
                  </Button>
                </div>
              </Flex>
            </TabPanel>
            <TabPanel>
              <Flex direction="column" gap={8} align="stretch">
                <pre className={styles.pre}>{JSON.stringify(errorDetails, null, 2)}</pre>
                <div>
                  <Button
                    size="small"
                    kind={"tertiary"}
                    onClick={() => copy(JSON.stringify(errorDetails, null, 2))}
                  >
                    {t('errorDetailsModal.copyAll')}
                  </Button>
                </div>
              </Flex>
            </TabPanel>
          </TabPanels>
        </TabsContext>
      </ModalContent>
    </Modal>
  );
}

export default ErrorDetailsModal;
