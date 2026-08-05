import { useCallback, useMemo, useState } from 'react';
import { Button, Chips, EmptyState } from '@vibe/core';
import { Update } from '@vibe/icons';
import { Section } from '../layout/Section';
import { UsersTable } from '../users/UsersTable';
import { ConfirmDialog } from '../feedback/ConfirmDialog';
import { Skeleton } from '../feedback/Skeleton';
import { useToast } from '../feedback/ToastProvider';
import logger from '../../lib/logger';
import { useViewTracking } from '../../lib/viewTracking';
import type { MondayUser, SyncConfig } from '../../types';

interface Props {
  rows: SyncConfig[];
  myUserId: string;
  isOwner: boolean;
  policyBoardId: string | null;
  loading: boolean;
  usersById: Record<string, MondayUser>;
  microsoftEnabled: boolean;
  onForceSync: (configId: string) => Promise<{ ok: boolean; result?: unknown }>;
  onDisconnect: (configId: string) => Promise<{ ok: boolean }>;
  onDisconnectCalendar: (configId: string) => Promise<unknown>;
  onConnectGoogle: (configId: string) => Promise<void>;
  onConnectMicrosoft: (configId: string) => Promise<void>;
  onConnectMonday: (configId: string) => Promise<void>;
  onEnable: (configId: string) => Promise<unknown>;
  onPause: (configId: string) => Promise<unknown>;
  onBackfill: (configId: string) => Promise<unknown>;
  onCancelBackfill: (configId: string) => Promise<unknown>;
  refetch: () => void;
}

export function UsersTab({
  rows, myUserId, isOwner, policyBoardId, loading, usersById, microsoftEnabled,
  onForceSync, onDisconnect, onDisconnectCalendar,
  onConnectGoogle, onConnectMicrosoft, onConnectMonday,
  onEnable, onPause, onBackfill, onCancelBackfill, refetch,
}: Props) {
  useViewTracking(logger, 'users');
  const toast = useToast();
  const [pending, setPending] = useState<Record<string, string | undefined>>({});
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const run = useCallback(<T,>(
    configId: string, kind: string, fn: () => Promise<T>, successMsg?: string
  ) => async () => {
    setPending((p) => ({ ...p, [configId]: kind }));
    try {
      await fn();
      if (successMsg) toast.success(successMsg);
      refetch();
    } catch (err) {
      toast.error(`${kind} failed: ${(err as Error).message}`);
    } finally {
      setPending((p) => ({ ...p, [configId]: undefined }));
    }
  }, [toast, refetch]);

  const confirmDisconnect = useCallback(() => {
    if (!pendingDelete) return;
    const configId = pendingDelete;
    setPendingDelete(null);
    run(configId, 'delete', () => onDisconnect(configId), 'Disconnected')();
  }, [pendingDelete, onDisconnect, run]);

  const visible = isOwner ? rows : rows.filter((r) => String(r.userId) === myUserId);

  const counts = useMemo(() => {
    const active = visible.filter((r) => r.status === 'active').length;
    const issue = visible.filter(
      (r) => r.status === 'google_disconnected' || r.status === 'monday_disconnected' || r.status === 'error'
    ).length;
    return { active, issue, total: visible.length };
  }, [visible]);

  const emptyTitle = isOwner ? 'No connections yet' : 'Connect your Google Calendar';
  const emptyDescription = isOwner
    ? 'Share this Custom Object with your team — each member connects their own Google Calendar from their workspace.'
    : 'This app syncs your accepted calendar events into the monday board configured by your admin.';

  return (
    <Section
      title="Users & Connections"
      hint="Each user connects their own Google Calendar. The owner of the Custom Object configures the shared policy under Setup."
    >
      {loading && !rows.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Skeleton height={22} />
          <Skeleton height={22} />
          <Skeleton height={22} />
        </div>
      ) : !visible.length ? (
        <EmptyState
          title={emptyTitle}
          description={emptyDescription}
          layout="compact"
        />
      ) : (
        <>
          <div className="users-summary">
            <Chips label={`${counts.active} active`} color="positive" readOnly noAnimation />
            {counts.issue > 0 && (
              <Chips label={`${counts.issue} need attention`} color="negative" readOnly noAnimation />
            )}
            <Chips label={`${counts.total} total`} readOnly noAnimation />
            <span className="grow" />
            <Button size="small" kind="tertiary" leftIcon={Update} onClick={refetch}>
              Refresh
            </Button>
          </div>
          <UsersTable
          rows={rows}
          myUserId={myUserId}
          isOwner={isOwner}
          policyBoardId={policyBoardId}
          pending={pending}
          usersById={usersById}
          microsoftEnabled={microsoftEnabled}
          onConnectGoogle={(cid) => run(cid, 'google', () => onConnectGoogle(cid))()}
          onConnectMicrosoft={(cid) => run(cid, 'microsoft', () => onConnectMicrosoft(cid))()}
          onConnectMonday={(cid) => run(cid, 'monday', () => onConnectMonday(cid))()}
          onForceSync={(cid) => run(cid, 'sync', () => onForceSync(cid), 'Sync complete')()}
          onDisconnectCalendar={(cid) => run(cid, 'disconnect_calendar', () => onDisconnectCalendar(cid), 'Calendar disconnected')()}
          onDisconnect={(cid) => setPendingDelete(cid)}
          onEnable={(cid) => run(cid, 'enable', () => onEnable(cid), 'Sync enabled')()}
          onPause={(cid) => run(cid, 'pause', () => onPause(cid), 'Sync paused')()}
          onBackfill={(cid) => run(cid, 'backfill', () => onBackfill(cid), 'Backfill started')()}
          onCancelBackfill={(cid) => run(cid, 'cancel_backfill', () => onCancelBackfill(cid))()}
        />
        </>
      )}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Remove this row?"
        body="The push subscription will be stopped and the row deleted. Items already synced to the monday board are not removed; only this connection record goes away."
        confirmLabel="Remove row"
        destructive
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDisconnect}
      />
    </Section>
  );
}
