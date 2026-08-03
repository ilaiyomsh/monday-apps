import React from 'react';
import { Flex, Loader, Heading, Text } from '@vibe/core';
import { useSettings } from '../../contexts/SettingsContext.jsx';
import { SettingsModal } from '../SettingsModal';
import { SetupWizard } from '../SetupWizard';
import { NetworkErrorScreen } from '../NetworkErrorScreen';

/*
 * Renders the app only after settings (boards/columns mapping) have been loaded
 * & published to the SDK store — so every SDK call has its mapping. Extracted
 * out of index.jsx in round337 so the branching below is testable (index.jsx
 * calls createRoot at import time, which no test can mount).
 *
 * The branch ORDER is the point (audit finding #1):
 *
 *   loading  →  spinner
 *   load FAILED  →  NetworkErrorScreen + retry     ← round337
 *   loaded, nothing stored  →  first-run SetupWizard
 *   configured  →  the app
 *
 * Before round337 the failure branch did not exist: a transient storage/network
 * failure at boot fell through to "nothing stored", which showed a fully
 * configured user the first-run wizard — one click away from provisioning
 * duplicate boards. The failure case must therefore stay ABOVE the wizard case.
 */
export function SettingsGate({ children }) {
  const { isLoading, isConfigured, loadError, retry } = useSettings();
  // First-run: offer the auto-provision wizard; "manual" falls back to the
  // existing forced SettingsModal (mapping existing boards/columns).
  const [manual, setManual] = React.useState(false);

  if (isLoading) {
    return (
      <Flex justify="center" align="center" style={{ height: '100svh' }}>
        <Loader size={32} />
      </Flex>
    );
  }

  if (loadError) {
    // retry() flips isLoading back on, so the spinner branch above takes over
    // for the duration of the re-read; isLoading is passed anyway so the button
    // itself also reflects the in-flight state.
    return <NetworkErrorScreen onRetry={retry} isLoading={isLoading} />;
  }

  if (!isConfigured) {
    if (!manual) {
      return <SetupWizard onManual={() => setManual(true)} />;
    }
    return (
      <div dir="rtl">
        <Flex direction="column" align="center" gap={12} style={{ padding: 24, textAlign: 'center' }}>
          <Heading type="h3">הגדרת האפליקציה</Heading>
          <Text type="text1" color="secondary">
            לפני השימוש יש למפות את הלוחות והעמודות
          </Text>
          <Text type="text2" color="secondary">
            בחרו את לוח הדיונים, לוח המשימות, לוח הנושאים ולוח ההחלטות, ואת העמודות התואמות בכל לוח, ולחצו שמור.
          </Text>
        </Flex>
        {/* Forced open: NO onClose AT ALL (not a no-op — audit finding #2: a no-op
            is truthy, so the modal used to render an X that silently did nothing,
            and attemptClose's !onClose guard never fired). With the prop absent
            the modal hides the X and the guard actually guards. */}
        <SettingsModal isOpen />
      </div>
    );
  }

  return children;
}

export default SettingsGate;
