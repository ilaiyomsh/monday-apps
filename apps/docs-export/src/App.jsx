/**
 * App — the shell. Owns the toast queue + the UI error sink and picks the surface.
 *
 * Composition order is deliberate and load-bearing:
 *
 *   SettingsProvider          loads the per-instance blob (needs MondayContext above it)
 *     └─ SettingsGate         blocks render until the blob is KNOWN and usable
 *          └─ ReportSurface   reads the loaded settings, renders <ReportView />
 *     ToastContainer          OUTSIDE the gate on purpose (see below)
 *     ErrorDetailsModal       likewise
 *
 * The two display components sit outside `SettingsGate` because the gate can itself
 * be the thing that fails: a storage read that throws, or a missing provider, logs an
 * ERROR while the gate is still showing its spinner. If the toast host lived inside
 * the gate, that error would have nowhere to render and the user would watch a
 * spinner forever with no explanation. Outside it, every logged error reaches a toast
 * no matter which phase of boot produced it.
 *
 * There is deliberately NO local "waiting for monday context" spinner here anymore:
 * `SettingsProvider` holds `isLoading: true` until the context resolves (or the
 * MondayContext watchdog installs `{}`), and `SettingsGate` renders the spinner for
 * exactly that state. Two components racing to own one loading state is how you get a
 * flash of the wrong surface.
 */
import React from 'react';
import { Text } from '@vibe/core';
import { SettingsProvider, SettingsGate, useSettings } from './contexts/SettingsContext';
import { useToast } from './hooks/useToast';
import { useUiErrorSink } from './hooks/useUiErrorSink';
import { ToastContainer } from './components/Toast';
import { ErrorDetailsModal } from './components/ErrorDetailsModal';
import { ReportView } from './components/ReportView';
import { getVersionLabel } from './utils/versionLabel';

/**
 * The everyday surface, one level down so it can read the settings the gate just
 * finished loading (`useSettings` has to be called under the provider).
 *
 * NOTE on the settings affordance: `SettingsGate` already renders its own owner-only
 * "הגדרות" button and owns the panel's open/close state, so `isOwner`/`onOpenSettings`
 * are intentionally NOT passed to ReportView here — doing so would put two identical
 * settings controls on screen for an owner. ReportView still supports and tests that
 * gear; which of the two affordances survives is a one-line call for whoever
 * reconciles the two slices.
 *
 * @param {Object} props
 * @param {Object} props.toast the queue from useToast, owned by the shell
 */
function ReportSurface({ toast }) {
  const { settings } = useSettings();
  return <ReportView settings={settings} toast={toast} />;
}

export default function App() {
  const toast = useToast();
  const {
    toasts,
    errorDetailsModal,
    showToast,
    removeToast,
    openErrorDetailsModal,
    closeErrorDetailsModal,
  } = toast;

  // The single display path for logged ERROR records. Mounted exactly once.
  useUiErrorSink({ showToast });

  return (
    <SettingsProvider>
      <SettingsGate>
        <ReportSurface toast={toast} />
        {/* Kept from the boot shell: when a user reports a problem, the first useful
            question is which build they are on. Small, quiet, always available. */}
        <Text
          type="text3"
          color="secondary"
          style={{ display: 'block', padding: '0 var(--content-gutter, 16px) 12px' }}
        >
          {getVersionLabel()}
        </Text>
      </SettingsGate>

      <ToastContainer
        toasts={toasts}
        onRemove={removeToast}
        onShowErrorDetails={openErrorDetailsModal}
      />
      <ErrorDetailsModal
        isOpen={!!errorDetailsModal}
        onClose={closeErrorDetailsModal}
        errorDetails={errorDetailsModal}
      />
    </SettingsProvider>
  );
}
