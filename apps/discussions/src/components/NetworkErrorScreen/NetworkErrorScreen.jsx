import React from 'react';
import { Flex, Heading, Text, Button } from '@vibe/core';
import { useTranslation } from 'react-i18next';
import styles from './NetworkErrorScreen.module.css';

/**
 * Full-screen fallback shown when the app fails to load its settings at boot
 * (network / monday.storage failure). Offers a manual retry.
 */
export function NetworkErrorScreen({ onRetry, isLoading }) {
  const { t } = useTranslation();
  return (
    <Flex className={styles.screen} direction="column" gap={16} align="center" justify="center">
      <Heading type="h2">{t('network.title')}</Heading>
      <Text className={styles.message}>{t('network.message')}</Text>
      <Button kind={"primary"} loading={isLoading} onClick={onRetry}>
        {t('network.retry')}
      </Button>
    </Flex>
  );
}

export default NetworkErrorScreen;
