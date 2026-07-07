import React from 'react';
import { Flex, Heading, Text, Button } from '@vibe/core';
import logger from '../../utils/logger';
import { isChunkLoadError } from '../../utils/lazyRetry';
import { parseMondayError, createFullErrorObject } from '../../utils/errorHandler';
import { t } from '../../i18n';
import styles from './ErrorBoundary.module.css';

/**
 * Root render-crash boundary (Layer 1). Two fallbacks:
 *  - chunk-load failure → "refresh page" (a remount can't fetch a missing chunk)
 *  - render crash → "try again" (remount) + optional "details"
 *
 * Logs via logger.error('ErrorBoundary', ...); the UI error sink skips the
 * 'ErrorBoundary' module so a crash shows this screen, not also a toast.
 */
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, isChunk: false, error: null, fullError: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, isChunk: isChunkLoadError(error), error };
  }

  componentDidCatch(error) {
    try {
      const parsed = parseMondayError(error);
      const fullError = createFullErrorObject(parsed, 'ErrorBoundary');
      this.setState({ fullError });
      logger.error('ErrorBoundary', error?.message || 'Render error', error);
    } catch {
      // never let the boundary's own logging throw
    }
  }

  handleRetry = () => this.setState({ hasError: false, error: null, fullError: null });
  handleRefresh = () => window.location.reload();

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    const { isChunk, error, fullError } = this.state;
    return (
      <Flex className={styles.boundary} direction="column" gap={16} align="center" justify="center">
        <Heading type="h2">{t('errorBoundary.title')}</Heading>
        {error?.message ? <Text className={styles.message}>{error.message}</Text> : null}
        <Flex gap={8}>
          {isChunk ? (
            <Button kind={"primary"} onClick={this.handleRefresh}>
              {t('errorBoundary.refresh')}
            </Button>
          ) : (
            <Button kind={"primary"} onClick={this.handleRetry}>
              {t('errorBoundary.tryAgain')}
            </Button>
          )}
          {this.props.onError && fullError ? (
            <Button kind={"tertiary"} onClick={() => this.props.onError(fullError)}>
              {t('errorBoundary.details')}
            </Button>
          ) : null}
        </Flex>
      </Flex>
    );
  }
}

export default ErrorBoundary;
