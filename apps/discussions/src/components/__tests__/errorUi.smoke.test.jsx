import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import logger from '../../utils/logger';
import { ErrorBoundary } from '../ErrorBoundary';
import { ErrorDetailsModal } from '../ErrorDetailsModal';
import { ToastContainer } from '../Toast';

describe('observability smoke', () => {
  it('logger.error fans out to a registered sink with an ERROR record', () => {
    const sink = vi.fn();
    const unsub = logger.addSink(sink);
    logger.error('SmokeTest', 'boom', new Error('boom'));
    unsub();
    expect(sink).toHaveBeenCalled();
    const record = sink.mock.calls.at(-1)[0];
    expect(record.level).toBe('ERROR');
    expect(record.module).toBe('SmokeTest');
  });

  it('ErrorBoundary renders the @vibe/core fallback when a child throws', () => {
    const Boom = () => {
      throw new Error('child exploded');
    };
    // jsdom prints the React error; silence it for a clean run
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
    spy.mockRestore();
    expect(screen.getByText('משהו השתבש')).toBeInTheDocument();
  });

  it('ErrorDetailsModal renders title + tabs when open', () => {
    render(
      <ErrorDetailsModal
        isOpen
        onClose={() => {}}
        errorDetails={{
          userMessage: 'אירעה שגיאה',
          errorCode: 'TEST_CODE',
          fullDetails: { errorMessage: 'detail' },
          apiRequest: { query: 'query Q {}', variables: { a: 1 } },
        }}
      />
    );
    expect(screen.getByText('פרטי שגיאה')).toBeInTheDocument();
    expect(screen.getByText('אירעה שגיאה')).toBeInTheDocument();
  });

  it('ToastContainer renders a @vibe/core toast for a queued message', () => {
    render(
      <ToastContainer
        toasts={[{ id: 1, message: 'הודעת בדיקה', type: 'error', duration: 6000 }]}
        onRemove={() => {}}
        onShowErrorDetails={() => {}}
      />
    );
    expect(screen.getByText('הודעת בדיקה')).toBeInTheDocument();
  });
});
