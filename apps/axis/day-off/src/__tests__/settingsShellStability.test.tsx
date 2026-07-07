import { describe, it, expect, vi } from 'vitest';
import { useEffect, useRef } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { SettingsDialogShell, type SettingsTabRenderCtx } from '@axis/app-core';

/**
 * Regression for the 2026-06-10 production flicker loop (change #74):
 * SettingsDialogShell recreated `setField` on every render, so any consumer
 * effect listing it as a dependency re-ran after each draft update — in the
 * Day-off SettingsDialog that meant an endless status-snapshot refetch loop
 * (load → setField → re-render → new setField → load …).
 *
 * This locks the contract: `setField` keeps a stable identity across draft
 * updates, so a dependent effect runs once per (real) input change.
 */

type S = { value: string };

function Probe({ ctx, onEffectRun }: { ctx: SettingsTabRenderCtx<S>; onEffectRun: () => void }) {
  const { draft, setField } = ctx;
  const synced = useRef(false);
  useEffect(() => {
    onEffectRun();
    if (!synced.current) {
      synced.current = true;
      // Simulates the snapshot-sync pattern: the effect itself updates the draft.
      setField('value', 'synced');
    }
  }, [setField, onEffectRun]);
  return (
    <div>
      <span data-testid="value">{draft.value}</span>
      <button type="button" onClick={() => setField('value', `${draft.value}+`)}>
        bump
      </button>
    </div>
  );
}

describe('SettingsDialogShell setField stability (change #74 regression)', () => {
  it('keeps setField identity stable across draft updates — dependent effect runs once', async () => {
    const onEffectRun = vi.fn();
    render(
      <SettingsDialogShell<S>
        isOpen
        onClose={() => undefined}
        settings={{ value: 'initial' }}
        onSave={() => true}
        tabs={[{ id: 'tab', label: 'Tab', render: (ctx) => <Probe ctx={ctx} onEffectRun={onEffectRun} /> }]}
      />,
    );

    // The effect's own setField re-rendered the shell (and the shell's
    // open-reset effect then re-rendered it again); a fresh setField identity
    // on either re-render would re-run the effect — and loop in production.
    expect(onEffectRun).toHaveBeenCalledTimes(1);

    // Further draft updates must not re-trigger the effect either.
    await act(async () => {
      fireEvent.click(screen.getByText('bump'));
    });
    await act(async () => {
      fireEvent.click(screen.getByText('bump'));
    });
    expect(screen.getByTestId('value').textContent).toBe('initial++');
    expect(onEffectRun).toHaveBeenCalledTimes(1);
  });
});
