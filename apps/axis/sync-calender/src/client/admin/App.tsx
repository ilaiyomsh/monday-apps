import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { AttentionBox, Button, ThemeProvider } from '@vibe/core';
import { PersonRound, Settings, Filter } from '@vibe/icons';
import { ToastProvider, useToast } from './components/feedback/ToastProvider';
import { SetupTab } from './components/tabs/SetupTab';
import { UsersTab } from './components/tabs/UsersTab';
import { ConditionsTab } from './components/tabs/ConditionsTab';
import { useSessionToken } from './hooks/useSessionToken';
import { useMondayContext } from './hooks/useMondayContext';
import { usePolicy } from './hooks/usePolicy';
import { useConfigs } from './hooks/useConfigs';
import { useOAuthPopup } from './hooks/useOAuthPopup';
import { useUsersByIds } from './hooks/useUsersByIds';
import { useObjectOwners } from './hooks/useObjectOwners';
import { StatusIdMigrationDialog } from './components/feedback/StatusIdMigrationDialog';
import { versionLabel } from './lib/versionLabel';

export default function App() {
  return (
    <ThemeProvider systemTheme="light">
      <ToastProvider>
        <AppInner />
      </ToastProvider>
    </ThemeProvider>
  );
}

type TabKey = 'users' | 'setup' | 'conditions';
type IconCmp = ComponentType<{ size?: string | number }>;
interface TabDef {
  key: TabKey;
  label: string;
  icon: IconCmp;
  count?: number;
}

function AppInner() {
  const toast = useToast();
  const { token } = useSessionToken();
  const { context, objectId, me, loading: ctxLoading, error: ctxError } = useMondayContext();
  const tokenReady = Boolean(token && objectId);

  const { policy, setupComplete, microsoftEnabled, patch, refetch: refetchPolicy } = usePolicy(objectId, tokenReady);
  const { ownerIds } = useObjectOwners(objectId, tokenReady);
  const myUserIdEarly = String(context?.user?.id || me?.id || '');
  const isOwner = ownerIds ? ownerIds.includes(myUserIdEarly) : false;
  const {
    rows,
    loading: configsLoading,
    refetch: refetchConfigs,
    forceSync,
    remove,
    disconnectConnection,
    patchConditionals,
    enable,
    pause,
    backfill,
    cancelBackfill,
  } = useConfigs(objectId, tokenReady);

  const myUserId = myUserIdEarly;
  const { byId: usersById } = useUsersByIds(
    rows.map((r) => String(r.userId)),
    tokenReady
  );

  const [activeTab, setActiveTab] = useState<TabKey>('users');
  const didInitActiveTab = useRef(false);
  useEffect(() => {
    if (didInitActiveTab.current) return;
    if (!policy) return;
    didInitActiveTab.current = true;
    if (isOwner && !setupComplete) setActiveTab('setup');
  }, [policy, isOwner, setupComplete]);

  const myConfig = useMemo(
    () => rows.find((r) => String(r.userId) === String(myUserId)) ?? null,
    [rows, myUserId]
  );
  const hasEligibleColumns = (policy?.conditionalEligibleColumns ?? []).length > 0;
  const conditionsEnabled = Boolean(myConfig) && hasEligibleColumns;

  const tabs = useMemo<TabDef[]>(() => {
    const t: TabDef[] = [
      { key: 'users', label: 'Users', icon: PersonRound as IconCmp, count: isOwner ? rows.length : undefined },
    ];
    if (isOwner) t.push({ key: 'setup', label: 'Setup', icon: Settings as IconCmp });
    if (conditionsEnabled) {
      t.push({
        key: 'conditions',
        label: 'Conditions',
        icon: Filter as IconCmp,
        count: (myConfig?.conditionals ?? []).length,
      });
    }
    return t;
  }, [isOwner, conditionsEnabled, rows.length, myConfig]);

  // If the tabs list shrinks (e.g. conditions tab hides when myConfig clears)
  // and the active tab is no longer in the list, fall back to the first tab.
  useEffect(() => {
    if (!tabs.some((t) => t.key === activeTab)) {
      setActiveTab(tabs[0]?.key || 'users');
    }
  }, [tabs, activeTab]);

  const openGooglePopup = useOAuthPopup('google');
  const openMicrosoftPopup = useOAuthPopup('microsoft');
  const openMondayPopup = useOAuthPopup('monday');

  const connectGoogle = useCallback(async (configId: string) => {
    const result = await openGooglePopup(configId);
    if (result.ok) {
      toast.success('Google connected');
      refetchConfigs();
    } else if (result.error === 'popup_blocked_redirecting') {
      toast.notify('Popup blocked — redirecting in this window.');
    } else {
      throw new Error(result.error || 'google_auth_failed');
    }
  }, [openGooglePopup, toast, refetchConfigs]);

  const connectMicrosoft = useCallback(async (configId: string) => {
    const result = await openMicrosoftPopup(configId);
    if (result.ok) {
      toast.success('Outlook connected');
      refetchConfigs();
    } else if (result.error === 'popup_blocked_redirecting') {
      toast.notify('Popup blocked — redirecting in this window.');
    } else {
      throw new Error(result.error || 'microsoft_auth_failed');
    }
  }, [openMicrosoftPopup, toast, refetchConfigs]);

  const connectMonday = useCallback(async (configId: string) => {
    const result = await openMondayPopup(configId);
    if (result.ok) {
      toast.success('monday authorized');
      refetchConfigs();
    } else if (result.error === 'popup_blocked_redirecting') {
      toast.notify('Popup blocked — redirecting in this window.');
    } else {
      throw new Error(result.error || 'monday_auth_failed');
    }
  }, [openMondayPopup, toast, refetchConfigs]);

  if (ctxLoading) return <Shell><p>Loading monday context…</p></Shell>;
  if (ctxError) return <Shell><p style={{ color: 'var(--negative-color)' }}>Failed to load monday context: {ctxError}</p></Shell>;
  if (!token) return <Shell><p>Waiting for session token…</p></Shell>;

  const activeTabDef = tabs.find((t) => t.key === activeTab) ?? tabs[0];

  return (
    <Shell>
      {policy && (
        <StatusIdMigrationDialog
          objectId={objectId}
          tokenReady={tokenReady}
          isOwner={isOwner}
          onMigrated={() => { refetchPolicy(); refetchConfigs(); }}
        />
      )}
      {isOwner && !setupComplete && policy && activeTab !== 'setup' && (
        <div style={{ marginBottom: 12 }}>
          <AttentionBox
            type="primary"
            title="Finish setup to start syncing"
            text="Pick a board, event link column, and map fields so the team's calendars sync."
          >
            <Button size="small" kind="secondary" onClick={() => setActiveTab('setup')}>
              Go to Setup
            </Button>
          </AttentionBox>
        </div>
      )}

      <nav className="tabs" role="tablist">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = t.key === activeTabDef.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              className={`tab${active ? ' active' : ''}`}
              onClick={() => setActiveTab(t.key)}
            >
              <Icon size={14} />
              <span>{t.label}</span>
              {typeof t.count === 'number' && <span className="tab-count">{t.count}</span>}
            </button>
          );
        })}
      </nav>

      {activeTab === 'users' && (
        <UsersTab
          rows={rows}
          myUserId={myUserId}
          isOwner={isOwner}
          policyBoardId={policy?.boardId ?? null}
          loading={configsLoading}
          usersById={usersById}
          microsoftEnabled={Boolean(microsoftEnabled)}
          onConnectGoogle={connectGoogle}
          onConnectMicrosoft={connectMicrosoft}
          onConnectMonday={connectMonday}
          onForceSync={forceSync}
          onDisconnectCalendar={disconnectConnection}
          onDisconnect={remove}
          onEnable={enable}
          onPause={pause}
          onBackfill={backfill}
          onCancelBackfill={cancelBackfill}
          refetch={refetchConfigs}
        />
      )}
      {activeTab === 'setup' && (
        <SetupTab policy={policy} isOwner={isOwner} tokenReady={tokenReady} configs={rows} onPatch={patch} />
      )}
      {activeTab === 'conditions' && (
        <ConditionsTab
          policy={policy}
          myConfig={myConfig}
          userName={me?.name ?? null}
          onSaveConditionals={patchConditionals}
        />
      )}
    </Shell>
  );
}

function Shell({ children, identity }: { children: React.ReactNode; identity?: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '20px 28px 60px' }}>
      {identity && <div className="page-head">{identity}</div>}
      {children}
      <p style={{ textAlign: 'center', marginTop: 24, fontSize: 11, color: 'var(--secondary-text-color, #676879)' }}>
        {versionLabel}
      </p>
    </div>
  );
}
