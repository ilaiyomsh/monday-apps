import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SettingsDialogShell, type SettingsTabRenderCtx } from '@axis/app-core';

/**
 * error-guard retrofit: app-core's SettingsDialogShell.handleSave was try/finally
 * with NO catch — an onSave rejection (anything the app didn't already catch and
 * turn into a `return false`, e.g. day-off's SettingsDialog.tsx:261
 * MissingStatusColumnRevisionError) reached the user as NOTHING: no inline error,
 * dialog stayed open only by accident (nothing ever called onClose), and the only
 * trace was the global unhandledrejection net.
 *
 * This locks the fixed contract: a thrown/rejected onSave (a) logs exactly once via
 * the shell's `logger` prop (or is silently absorbed by the default no-op logger
 * when the consumer doesn't wire one — never throws), (b) shows an inline banner,
 * (c) keeps the dialog open (onClose is never called).
 */

type S = { value: string };

function Probe({ ctx }: { ctx: SettingsTabRenderCtx<S> }) {
  return <div data-testid="value">{ctx.draft.value}</div>;
}

describe('SettingsDialogShell — save failure (error-guard retrofit)', () => {
  it('logs ERROR exactly once, shows an inline banner, and keeps the dialog open', async () => {
    const boom = new Error('boom: could not persist settings');
    const onSave = vi.fn().mockRejectedValue(boom);
    const onClose = vi.fn();
    const logger = { error: vi.fn() };

    render(
      <SettingsDialogShell<S>
        isOpen
        onClose={onClose}
        settings={{ value: 'initial' }}
        onSave={onSave}
        logger={logger}
        labels={{ saveError: 'Could not save. Try again.' }}
        tabs={[{ id: 'tab', label: 'Tab', render: (ctx) => <Probe ctx={ctx} /> }]}
      />,
    );

    fireEvent.click(screen.getByText('Save'));

    // Inline banner appears with the configured message.
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Could not save. Try again.');
    });

    // Logged exactly once (the log-once contract lives in the logger itself;
    // the shell's job is to call it exactly once per failed save attempt).
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith('SettingsDialogShell', 'save failed', boom);

    // Dialog stays open: onClose was never invoked, the modal is still rendered.
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('value')).toHaveTextContent('initial');
  });

  it('falls back to a no-op logger and a default message when the consumer wires neither', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('boom'));
    const onClose = vi.fn();

    render(
      <SettingsDialogShell<S>
        isOpen
        onClose={onClose}
        settings={{ value: 'initial' }}
        onSave={onSave}
        tabs={[{ id: 'tab', label: 'Tab', render: (ctx) => <Probe ctx={ctx} /> }]}
      />,
    );

    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Failed to save. Please try again.');
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('clears a stale save-error banner when the dialog is reopened', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('boom'));
    const onClose = vi.fn();
    const logger = { error: vi.fn() };

    const { rerender } = render(
      <SettingsDialogShell<S>
        isOpen
        onClose={onClose}
        settings={{ value: 'initial' }}
        onSave={onSave}
        logger={logger}
        tabs={[{ id: 'tab', label: 'Tab', render: (ctx) => <Probe ctx={ctx} /> }]}
      />,
    );

    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

    // Close then reopen — the shell resets its own draft/error state on isOpen.
    rerender(
      <SettingsDialogShell<S>
        isOpen={false}
        onClose={onClose}
        settings={{ value: 'initial' }}
        onSave={onSave}
        logger={logger}
        tabs={[{ id: 'tab', label: 'Tab', render: (ctx) => <Probe ctx={ctx} /> }]}
      />,
    );
    rerender(
      <SettingsDialogShell<S>
        isOpen
        onClose={onClose}
        settings={{ value: 'initial' }}
        onSave={onSave}
        logger={logger}
        tabs={[{ id: 'tab', label: 'Tab', render: (ctx) => <Probe ctx={ctx} /> }]}
      />,
    );

    expect(screen.queryByRole('alert')).toBeNull();
  });
});
