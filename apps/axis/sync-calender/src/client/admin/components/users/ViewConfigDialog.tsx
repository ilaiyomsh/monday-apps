import { Fragment } from 'react';
import { Button, Text } from '@vibe/core';
import type { MondayUser, SyncConfig } from '../../types';

interface Props {
  open: boolean;
  row: SyncConfig | null;
  user: MondayUser | null;
  onClose: () => void;
}

function fmtTime(ms: number | null | undefined): string {
  if (!ms) return '—';
  try { return new Date(ms).toLocaleString(); } catch { return String(ms); }
}

function fmtBool(v: boolean | null | undefined): string {
  return v ? 'Yes' : 'No';
}

export function ViewConfigDialog({ open, row, user, onClose }: Props) {
  if (!open || !row) return null;

  const conditionalsCount = row.conditionals?.length ?? 0;
  const overrideCount = (row.conditionals ?? []).filter((c) => c.action !== 'skip').length;
  const skipCount = conditionalsCount - overrideCount;
  const backfill = row.backfill;

  const rows: Array<[string, React.ReactNode]> = [
    ['User name', user?.name ?? '—'],
    ['User email', user?.email ?? '—'],
    ['monday userId', row.userId],
    ['Provider', row.provider ?? '—'],
    ['Google email', row.googleUserEmail ?? '—'],
    ['Microsoft email', row.microsoftUserEmail ?? '—'],
    ['Google connected', fmtBool(row.hasGoogleConnection)],
    ['Microsoft connected', fmtBool(row.hasMicrosoftConnection)],
    ['Monday connected', fmtBool(row.hasMondayConnection)],
    ['Status', row.status],
    ['Last sync at', fmtTime(row.lastSyncAt)],
    ['Last error', row.lastError ?? '—'],
    ['Conditionals', `${conditionalsCount} (${overrideCount} override · ${skipCount} skip)`],
    ['Backfill', backfill ? `${backfill.status} · ${backfill.processed}${backfill.total ? '/' + backfill.total : ''}` : '—'],
    ['Created at', fmtTime(row.createdAt)],
    ['Updated at', fmtTime(row.updatedAt)],
    ['Config ID', <code style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }}>{row.configId}</code>],
    ['Object ID', row.objectId],
    ['Account ID', row.accountId],
    ['Workspace ID', row.workspaceId ?? '—'],
  ];

  return (
    <div style={backdropStyle} role="dialog" aria-modal="true" onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 4px 0', fontSize: 16 }}>Sync config</h3>
        <Text type="text2" color="secondary" element="p" style={{ margin: '0 0 14px 0' }}>
          Read-only view for {user?.name || 'this user'}.
        </Text>

        <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', rowGap: 6, columnGap: 12, fontSize: 13 }}>
          {rows.map(([label, value]) => (
            <Fragment key={label as string}>
              <div style={{ color: 'var(--secondary-text-color)' }}>{label}</div>
              <div style={{ wordBreak: 'break-word' }}>{value}</div>
            </Fragment>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <Button size="small" kind="primary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}

const backdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(32, 34, 44, 0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 10000,
};

const modalStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 8,
  padding: 20,
  minWidth: 520,
  maxWidth: 720,
  width: '70%',
  maxHeight: '80vh',
  overflow: 'auto',
  boxShadow: '0 10px 30px rgba(32, 34, 44, 0.25)',
};
