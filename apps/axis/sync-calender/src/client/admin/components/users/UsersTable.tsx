import { useEffect, useLayoutEffect, useRef, useState, type ComponentType } from 'react';
import { createPortal } from 'react-dom';
import {
  Avatar,
  Flex,
  IconButton,
  Text,
  Toggle,
  Tooltip,
} from '@vibe/core';
import { Warning, Update, Connect, LogOut, Time, CloseSmall, DropdownChevronDown, Show, Download } from '@vibe/icons';
import { ConfirmDialog } from '../feedback/ConfirmDialog';
import { ViewConfigDialog } from './ViewConfigDialog';
import { useToast } from '../feedback/ToastProvider';
import { buildConditionsFileName, buildExportJson, downloadJson } from '../../lib/conditionalsExport';
import logger from '../../lib/logger';
import type { MondayUser, SyncConfig } from '../../types';

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (!parts.length || !name.trim()) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatRelative(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 30_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} hr ago`;
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)} d ago`;
  return new Date(ms).toLocaleDateString();
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  rows: SyncConfig[];
  myUserId: string;
  isOwner: boolean;
  policyBoardId: string | null;
  pending: Record<string, string | undefined>;
  usersById: Record<string, MondayUser>;
  microsoftEnabled: boolean;
  onConnectGoogle: (configId: string) => void;
  onConnectMicrosoft: (configId: string) => void;
  onConnectMonday: (configId: string) => void;
  onForceSync: (configId: string) => void;
  onDisconnectCalendar: (configId: string) => void;
  onDisconnect: (configId: string) => void;
  onEnable: (configId: string) => void;
  onPause: (configId: string) => void;
  onBackfill: (configId: string) => void;
  onCancelBackfill: (configId: string) => void;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ChipDot({ label, kind }: { label: string; kind: 'positive' | 'negative' | 'primary' | 'default' }) {
  return <span className={`chip-dot ${kind === 'default' ? '' : kind}`}>{label}</span>;
}

// Provider cell: collapses the old Google/Outlook columns into one. Shows
// which calendar provider the user picked (XOR — at most one). Email tooltip
// lets you confirm the connected account without taking up table width.
function ProviderCell({ row }: { row: SyncConfig }) {
  if (row.provider === 'google' && row.hasGoogleConnection) {
    return (
      <Tooltip content={row.googleUserEmail || 'Google Calendar'}>
        <span className="chip-dot positive">Google</span>
      </Tooltip>
    );
  }
  if (row.provider === 'microsoft' && row.hasMicrosoftConnection) {
    return (
      <Tooltip content={row.microsoftUserEmail || 'Microsoft Outlook'}>
        <span className="chip-dot positive">Outlook</span>
      </Tooltip>
    );
  }
  return <span className="chip-dot negative">Not connected</span>;
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  active:                  { label: 'Active',           cls: 's-active' },
  paused:                  { label: 'Paused',           cls: 's-paused' },
  google_disconnected:     { label: 'Google offline',   cls: 's-error' },
  microsoft_disconnected:  { label: 'Outlook offline',  cls: 's-error' },
  monday_disconnected:     { label: 'Monday offline',   cls: 's-error' },
  pending_policy:          { label: 'Setup needed',     cls: 's-pending' },
  pending_connections:     { label: 'Not connected',    cls: 's-pending' },
  error:                   { label: 'Error',            cls: 's-error' },
};

function StatusPill({ status }: { status: string }) {
  const m = STATUS_META[status] || { label: status || 'pending', cls: 's-paused' };
  return <span className={`status-pill ${m.cls}`}>{m.label}</span>;
}

function LastSyncCell({ lastSyncAt }: { lastSyncAt: number | null }) {
  if (lastSyncAt == null) return <Text type="text2" color="secondary">—</Text>;
  return (
    <Tooltip content={new Date(lastSyncAt).toISOString()}>
      <span>{formatRelative(lastSyncAt)}</span>
    </Tooltip>
  );
}

function LastErrorCell({ lastError }: { lastError: string | null }) {
  if (!lastError) return <Text type="text2" color="secondary">—</Text>;
  const snippet = lastError.length > 30 ? lastError.slice(0, 30) + '…' : lastError;
  return (
    <Flex gap="xs" align="center">
      <Tooltip content={lastError}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--negative-color)' }}>
          <Warning size={14} />
          <Text type="text2" color="onInverted" style={{ color: 'var(--negative-color)' }}>{snippet}</Text>
        </span>
      </Tooltip>
    </Flex>
  );
}

// Compact inline progress meter (unchanged logic).
function BackfillInlineProgress({
  backfill,
  busy,
  onCancel,
}: {
  backfill: NonNullable<SyncConfig['backfill']>;
  busy?: boolean;
  onCancel: () => void;
}) {
  const { status, processed, total, errors } = backfill;
  const pct = total && total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : null;
  const active = status === 'running' || status === 'cancelling';

  if (active) {
    const barColor = status === 'cancelling' ? 'var(--secondary-text-color)' : 'var(--primary-color)';
    return (
      <Flex gap="xs" align="center" style={{ minWidth: 0 }}>
        <div
          style={{
            width: 72,
            height: 4,
            background: 'var(--allgrey-background-color)',
            borderRadius: 2,
            overflow: 'hidden',
            flexShrink: 0,
          }}
          aria-label={`Backfill progress: ${processed}${total ? ` of ${total}` : ''}`}
        >
          <div
            style={{
              width: pct !== null ? `${pct}%` : '35%',
              height: '100%',
              background: barColor,
              transition: 'width 400ms ease',
              opacity: pct === null ? 0.35 : 1,
            }}
          />
        </div>
        <Text type="text2" color="secondary">
          {status === 'cancelling' ? 'Cancelling…' : (total ? `${processed}/${total}` : `${processed}`)}
        </Text>
        {status === 'running' && (
          <IconButton
            icon={CloseSmall}
            size="xs"
            kind="tertiary"
            disabled={!!busy}
            onClick={onCancel}
            ariaLabel="Cancel backfill"
          />
        )}
      </Flex>
    );
  }

  const label =
    status === 'done' ? `Done · ${processed}` :
    status === 'cancelled' ? `Cancelled · ${processed}` :
    `Failed · ${processed}`;
  const kind: 'positive' | 'negative' | 'primary' =
    status === 'done' ? 'positive' : status === 'error' ? 'negative' : 'primary';

  return (
    <Tooltip content={errors > 0 ? `${label} · ${errors} errors` : label}>
      <span><ChipDot label={label} kind={kind} /></span>
    </Tooltip>
  );
}

function StatusCell({
  row,
  mine,
  busy,
  onEnable,
  onPause,
}: {
  row: SyncConfig;
  mine: boolean;
  busy: string | undefined;
  onEnable: () => void;
  onPause: () => void;
}) {
  const hasCalendar = row.hasGoogleConnection || row.hasMicrosoftConnection;
  const bothConnected = hasCalendar && row.hasMondayConnection;
  // Only `active`/`paused` are real toggle states. Disconnected/error/pending
  // statuses must surface their pill even on the owner's own row — the
  // connection booleans only check that a token EXISTS, not that it's valid,
  // so a dead token would otherwise render a misleading "Paused" toggle.
  const isToggleableStatus = row.status === 'active' || row.status === 'paused';
  const canToggle = mine && bothConnected && isToggleableStatus;
  const isActive = row.status === 'active';
  const isBusy = busy === 'enable' || busy === 'pause';

  if (!canToggle) return <StatusPill status={row.status} />;

  return (
    <span className="u-toggle-cell">
      <Toggle
        size="small"
        isSelected={isActive}
        disabled={isBusy}
        onChange={(next: boolean) => (next ? onEnable() : onPause())}
        ariaLabel={isActive ? 'Pause sync' : 'Enable sync'}
      />
      <span className={`u-toggle-label${isActive ? ' active' : ''}`}>
        {isActive ? 'Active' : 'Paused'}
      </span>
    </span>
  );
}

// Portal-based action menu (unchanged — load-bearing positioning logic).
interface ActionMenuItem {
  label: string;
  icon?: ComponentType<{ size?: number }>;
  disabled?: boolean;
  danger?: boolean;
  divider?: boolean;
  onClick?: () => void;
}

function ActionsMenu({
  label,
  items,
  disabled,
}: {
  label: string;
  items: ActionMenuItem[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; minWidth: number; placement: 'below' | 'above' } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Compute coords from the trigger rect plus the menu's actual size when
  // available. Called synchronously on click (rough guess for menu height) and
  // again in useLayoutEffect after mount (true height) to avoid the "first
  // click does nothing" race.
  const place = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const menuHeight = menuRef.current?.offsetHeight ?? 200;
    const roomBelow = window.innerHeight - rect.bottom;
    const placement: 'below' | 'above' = roomBelow > menuHeight + 8 || rect.top < menuHeight + 8 ? 'below' : 'above';
    const top = placement === 'below' ? rect.bottom + 4 : rect.top - menuHeight - 4;
    const menuWidth = menuRef.current?.offsetWidth ?? 200;
    const left = Math.max(8, rect.right - Math.max(menuWidth, rect.width));
    setCoords({ top, left, minWidth: rect.width, placement });
  };

  const toggle = () => {
    if (open) { setOpen(false); return; }
    place();
    setOpen(true);
  };

  // Re-measure once the menu is mounted (we have a real height now). Layout
  // effect runs before the browser paints, so users never see a one-frame jump.
  useLayoutEffect(() => {
    if (open) place();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = () => place();
    window.addEventListener('scroll', handler, true);
    window.addEventListener('resize', handler);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('scroll', handler, true);
      window.removeEventListener('resize', handler);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={toggle}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          height: 28,
          padding: '0 10px',
          fontSize: 13,
          fontWeight: 500,
          background: 'var(--primary-background-color)',
          border: '1px solid #c5c5c5',
          borderRadius: 9999,
          cursor: disabled ? 'not-allowed' : 'pointer',
          color: disabled ? 'var(--secondary-text-color)' : 'var(--primary-text-color)',
          whiteSpace: 'nowrap',
          fontFamily: 'inherit',
        }}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {label}
        <DropdownChevronDown size={14} />
      </button>
      {open && coords && createPortal(
        <div
          ref={menuRef}
          role="menu"
          style={{
            position: 'fixed',
            top: coords.top,
            left: coords.left,
            minWidth: Math.max(200, coords.minWidth),
            background: 'var(--primary-background-color)',
            borderRadius: 6,
            boxShadow: 'var(--shadow-large)',
            border: '1px solid var(--layout-border-color)',
            padding: '6px 0',
            zIndex: 10000,
          }}
        >
          {items.map((item, i) => {
            if (item.divider) {
              return <div key={i} style={{ height: 1, background: 'var(--layout-border-color)', margin: '4px 0' }} />;
            }
            const Icon = item.icon;
            return (
              <button
                key={i}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => { item.onClick?.(); setOpen(false); }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  padding: '8px 14px',
                  background: 'transparent',
                  border: 0,
                  fontSize: 13,
                  textAlign: 'left',
                  cursor: item.disabled ? 'not-allowed' : 'pointer',
                  color: item.disabled
                    ? 'var(--disabled-text-color)'
                    : item.danger ? 'var(--negative-color)' : 'var(--primary-text-color)',
                  opacity: item.disabled ? 0.6 : 1,
                  fontFamily: 'inherit',
                }}
                onMouseEnter={(e) => {
                  if (!item.disabled) (e.currentTarget as HTMLButtonElement).style.background = 'var(--grey-background-color)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                }}
              >
                {Icon && <Icon size={16} />}
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </>
  );
}

function ActionsCell({
  row,
  busy,
  microsoftEnabled,
  onConnectGoogle,
  onConnectMicrosoft,
  onConnectMonday,
  onForceSync,
  onDisconnectCalendar,
  onDisconnect,
  onBackfill,
  onCancelBackfill,
}: {
  row: SyncConfig;
  busy: string | undefined;
  microsoftEnabled: boolean;
  onConnectGoogle: () => void;
  onConnectMicrosoft: () => void;
  onConnectMonday: () => void;
  onForceSync: () => void;
  onDisconnectCalendar: () => void;
  onDisconnect: () => void;
  onBackfill: () => void;
  onCancelBackfill: () => void;
}) {
  // XOR — a row connects to Google OR Microsoft, never both. The "calendar
  // provider connected" predicate replaces the old hasGoogleConnection check.
  const hasCalendarConnection = row.hasGoogleConnection || row.hasMicrosoftConnection;
  const bothConnected = hasCalendarConnection && row.hasMondayConnection;
  const showConnectGoogle = !hasCalendarConnection;
  const showConnectMicrosoft = !hasCalendarConnection && microsoftEnabled;
  const showConnectMonday = true;
  const backfillRunning = row.backfill?.status === 'running' || row.backfill?.status === 'cancelling';

  const [confirmOpen, setConfirmOpen] = useState(false);

  const items: ActionMenuItem[] = [];
  if (showConnectGoogle) {
    items.push({
      label: busy === 'google' ? 'Connecting…' : 'Connect Google',
      icon: Connect, disabled: !!busy, onClick: onConnectGoogle,
    });
  }
  if (showConnectMicrosoft) {
    items.push({
      label: busy === 'microsoft' ? 'Connecting…' : 'Connect Outlook',
      icon: Connect, disabled: !!busy, onClick: onConnectMicrosoft,
    });
  }
  if (showConnectMonday) {
    const baseLabel = row.hasMondayConnection ? 'Re-authorize monday' : 'Authorize monday';
    items.push({
      label: busy === 'monday' ? 'Connecting…' : baseLabel,
      icon: Connect, disabled: !!busy, onClick: onConnectMonday,
    });
  }
  if (showConnectGoogle || showConnectMicrosoft || showConnectMonday) items.push({ label: '', divider: true });
  items.push({
    label: backfillRunning ? 'Backfill running…' : 'Sync next 6 months',
    icon: Time,
    disabled: !!busy || !bothConnected || backfillRunning,
    onClick: () => setConfirmOpen(true),
  });
  items.push({
    label: busy === 'sync' ? 'Syncing…' : 'Sync now (delta)',
    icon: Update,
    disabled: !!busy || !bothConnected,
    onClick: onForceSync,
  });
  items.push({ label: '', divider: true });
  if (hasCalendarConnection) {
    const providerLabel = row.provider === 'microsoft' ? 'Outlook' : 'Google';
    items.push({
      label: busy === 'disconnect_calendar' ? 'Disconnecting…' : `Disconnect ${providerLabel}`,
      icon: LogOut, disabled: !!busy, onClick: onDisconnectCalendar,
    });
  }
  items.push({
    label: 'Remove row', icon: LogOut, danger: true, onClick: onDisconnect,
  });

  return (
    <div className="actions-cell">
      {row.backfill && (
        <BackfillInlineProgress
          backfill={row.backfill}
          busy={busy === 'cancel_backfill'}
          onCancel={onCancelBackfill}
        />
      )}

      <ActionsMenu
        label={busy ? 'Working…' : 'Actions'}
        items={items}
        disabled={!!busy}
      />

      <ConfirmDialog
        open={confirmOpen}
        title="Sync the next 6 months?"
        body={
          'This will pull every calendar event from now through the next 6 months ' +
          'into your monday board. Before continuing, verify your column mapping ' +
          '(Setup tab) and conditional mappings (Conditions tab) are correct. ' +
          'Items are upserted by event link — re-running is safe but may overwrite ' +
          'manual edits on previously-synced items.'
        }
        confirmLabel="Start backfill"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => { setConfirmOpen(false); onBackfill(); }}
      />
    </div>
  );
}

// Pick one of N avatar color variants deterministically from the user id.
const AVATAR_BGS = [
  '#579bfc', '#a25ddc', '#00c875', '#fdab3d', '#e2445c', '#9cd326', '#0086c0',
];
function avatarBg(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_BGS[Math.abs(hash) % AVATAR_BGS.length];
}

// ---------------------------------------------------------------------------
// Main component — plain HTML table
// ---------------------------------------------------------------------------

export function UsersTable({
  rows,
  myUserId,
  isOwner,
  policyBoardId,
  pending,
  usersById,
  microsoftEnabled,
  onConnectGoogle,
  onConnectMicrosoft,
  onConnectMonday,
  onForceSync,
  onDisconnectCalendar,
  onDisconnect,
  onEnable,
  onPause,
  onBackfill,
  onCancelBackfill,
}: Props) {
  const visible = isOwner ? rows : rows.filter((r) => String(r.userId) === myUserId);

  // Owner-only: read-only sync-config drawer for any row that isn't yours.
  const [viewing, setViewing] = useState<SyncConfig | null>(null);

  if (!visible.length) return null;

  return (
    <div className="u-card">
      <table className="u-table">
        <thead>
          <tr>
            <th>User</th>
            <th>Calendar</th>
            <th>Monday</th>
            <th>Status</th>
            <th>Last sync</th>
            <th>Last error</th>
            <th className="th-actions">&nbsp;</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => {
            const mine = String(r.userId) === myUserId;
            const user = usersById[String(r.userId)];
            const name: string = user?.name || (mine ? 'You' : 'Unknown user');
            const email: string | null =
              user?.email ||
              (r.provider === 'microsoft' ? r.microsoftUserEmail : r.googleUserEmail) ||
              r.googleUserEmail ||
              r.microsoftUserEmail ||
              null;
            const busy = pending[r.configId];
            const bg = avatarBg(String(r.userId || r.configId));

            return (
              <tr key={r.configId} className={mine ? 'is-me' : ''}>
                <td>
                  <div className="u-user">
                    <Avatar
                      size="small"
                      type="img"
                      src={user?.photo_thumb_small || undefined}
                      text={getInitials(name)}
                      ariaLabel={name}
                      backgroundColor={bg as never}
                      withoutTooltip
                    />
                    <div>
                      <div className="u-name">
                        {name}
                        {mine && <span className="you-tag">(you)</span>}
                      </div>
                      {email && <div className="u-email">{email}</div>}
                    </div>
                  </div>
                </td>
                <td>
                  <ProviderCell row={r} />
                </td>
                <td>
                  <ChipDot
                    label={r.hasMondayConnection ? 'Authorized' : 'Pending'}
                    kind={r.hasMondayConnection ? 'positive' : 'negative'}
                  />
                </td>
                <td>
                  <StatusCell
                    row={r}
                    mine={mine}
                    busy={busy}
                    onEnable={() => onEnable(r.configId)}
                    onPause={() => onPause(r.configId)}
                  />
                </td>
                <td><LastSyncCell lastSyncAt={r.lastSyncAt} /></td>
                <td><LastErrorCell lastError={r.lastError} /></td>
                <td className="td-actions">
                  {mine ? (
                    <ActionsCell
                      row={r}
                      busy={busy}
                      microsoftEnabled={microsoftEnabled}
                      onConnectGoogle={() => onConnectGoogle(r.configId)}
                      onConnectMicrosoft={() => onConnectMicrosoft(r.configId)}
                      onConnectMonday={() => onConnectMonday(r.configId)}
                      onForceSync={() => onForceSync(r.configId)}
                      onDisconnectCalendar={() => onDisconnectCalendar(r.configId)}
                      onDisconnect={() => onDisconnect(r.configId)}
                      onBackfill={() => onBackfill(r.configId)}
                      onCancelBackfill={() => onCancelBackfill(r.configId)}
                    />
                  ) : isOwner ? (
                    <OwnerActionsCell
                      row={r}
                      userName={user?.name ?? null}
                      policyBoardId={policyBoardId}
                      busy={busy}
                      onViewConfig={() => setViewing(r)}
                      onForceSync={() => onForceSync(r.configId)}
                      onBackfill={() => onBackfill(r.configId)}
                      onCancelBackfill={() => onCancelBackfill(r.configId)}
                      onEnable={() => onEnable(r.configId)}
                      onPause={() => onPause(r.configId)}
                      onDisconnectCalendar={() => onDisconnectCalendar(r.configId)}
                      onRemove={() => onDisconnect(r.configId)}
                    />
                  ) : (
                    <Text type="text2" color="secondary">—</Text>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <ViewConfigDialog
        open={viewing !== null}
        row={viewing}
        user={viewing ? usersById[String(viewing.userId)] ?? null : null}
        onClose={() => setViewing(null)}
      />
    </div>
  );
}

// Owner actions on another user's row. Read-only actions (View config, Export
// conditions) live alongside operational ones (force sync, backfill, pause,
// disconnect, remove). The destructive options route through a confirm dialog
// — the rest fire immediately. We deliberately don't expose Connect actions:
// OAuth has to originate from the target user's browser.
function OwnerActionsCell({
  row,
  userName,
  policyBoardId,
  busy,
  onViewConfig,
  onForceSync,
  onBackfill,
  onCancelBackfill,
  onEnable,
  onPause,
  onDisconnectCalendar,
  onRemove,
}: {
  row: SyncConfig;
  userName: string | null;
  policyBoardId: string | null;
  busy: string | undefined;
  onViewConfig: () => void;
  onForceSync: () => void;
  onBackfill: () => void;
  onCancelBackfill: () => void;
  onEnable: () => void;
  onPause: () => void;
  onDisconnectCalendar: () => void;
  onRemove: () => void;
}) {
  // Remove flow routes to UsersTab's own confirm dialog (setPendingDelete) —
  // don't add a second confirm here. Backfill + Disconnect get a confirm
  // because the parent fires those immediately and the blast radius on
  // another user's row warrants the extra step.
  const [confirm, setConfirm] = useState<null | 'backfill' | 'disconnect'>(null);
  const toast = useToast();

  const conditionalsCount = row.conditionals?.length ?? 0;
  const hasCalendar = row.hasGoogleConnection || row.hasMicrosoftConnection;
  const bothConnected = hasCalendar && row.hasMondayConnection;
  const backfillRunning = row.backfill?.status === 'running' || row.backfill?.status === 'cancelling';
  const isActive = row.status === 'active';
  const providerLabel = row.provider === 'microsoft' ? 'Outlook' : 'Google';

  const items: ActionMenuItem[] = [
    { label: 'View config', icon: Show, onClick: onViewConfig },
    {
      label: conditionalsCount > 0
        ? `Export conditions (${conditionalsCount})`
        : 'Export conditions',
      icon: Download,
      disabled: conditionalsCount === 0,
      onClick: () => {
        try {
          const json = buildExportJson(row.conditionals ?? [], policyBoardId);
          downloadJson(json, buildConditionsFileName(userName));
        } catch (err) {
          logger.error('users', 'export_conditions_failed', err);
          toast.error(`Export failed: ${(err as Error).message}`);
        }
      },
    },
    { label: '', divider: true },
    {
      label: busy === 'sync' ? 'Syncing…' : 'Sync now (delta)',
      icon: Update,
      disabled: !!busy || !bothConnected,
      onClick: onForceSync,
    },
    {
      label: backfillRunning ? 'Backfill running…' : 'Sync next 6 months',
      icon: Time,
      disabled: !!busy || !bothConnected || backfillRunning,
      onClick: () => setConfirm('backfill'),
    },
    ...(backfillRunning ? [{
      label: busy === 'cancel_backfill' ? 'Cancelling…' : 'Cancel backfill',
      icon: CloseSmall,
      disabled: !!busy,
      onClick: onCancelBackfill,
    }] : []),
    {
      label: isActive
        ? (busy === 'pause' ? 'Pausing…' : 'Pause sync')
        : (busy === 'enable' ? 'Enabling…' : 'Enable sync'),
      icon: isActive ? CloseSmall : Update,
      disabled: !!busy || !bothConnected,
      onClick: isActive ? onPause : onEnable,
    },
    { label: '', divider: true },
    ...(hasCalendar ? [{
      label: busy === 'disconnect_calendar' ? 'Disconnecting…' : `Disconnect ${providerLabel}`,
      icon: LogOut,
      disabled: !!busy,
      onClick: () => setConfirm('disconnect'),
    }] : []),
    {
      label: 'Remove row',
      icon: LogOut,
      danger: true,
      disabled: !!busy,
      onClick: onRemove,
    },
  ];

  return (
    <div className="actions-cell">
      {row.backfill && (
        <BackfillInlineProgress
          backfill={row.backfill}
          busy={busy === 'cancel_backfill'}
          onCancel={onCancelBackfill}
        />
      )}

      <ActionsMenu
        label={busy ? 'Working…' : 'Actions'}
        items={items}
        disabled={!!busy}
      />

      <ConfirmDialog
        open={confirm === 'backfill'}
        title="Sync the next 6 months?"
        body={
          `This will pull every calendar event for ${userName || 'this user'} from now ` +
          'through the next 6 months into the monday board. Items are upserted by event ' +
          'link — re-running is safe but may overwrite manual edits on previously-synced items.'
        }
        confirmLabel="Start backfill"
        onCancel={() => setConfirm(null)}
        onConfirm={() => { setConfirm(null); onBackfill(); }}
      />

      <ConfirmDialog
        open={confirm === 'disconnect'}
        title={`Disconnect ${providerLabel} for ${userName || 'this user'}?`}
        body={`The ${providerLabel} calendar connection will be cleared. The user will need to re-authorize from their own browser to resume syncing. Items already on the board are not affected.`}
        confirmLabel={`Disconnect ${providerLabel}`}
        destructive
        onCancel={() => setConfirm(null)}
        onConfirm={() => { setConfirm(null); onDisconnectCalendar(); }}
      />

    </div>
  );
}
