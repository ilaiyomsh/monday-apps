import { Button } from '@vibe/core';

interface Props {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open, title, body, confirmLabel = 'Confirm', destructive, onConfirm, onCancel,
}: Props) {
  if (!open) return null;
  return (
    <div style={backdropStyle} role="dialog" aria-modal="true">
      <div style={modalStyle}>
        <h3 style={{ margin: '0 0 8px 0', fontSize: 16 }}>{title}</h3>
        {body && <p style={{ color: '#676879', fontSize: 13, margin: '0 0 16px 0' }}>{body}</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button size="small" kind="tertiary" onClick={onCancel}>Cancel</Button>
          <Button size="small" color={destructive ? 'negative' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
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
  minWidth: 320,
  maxWidth: 480,
  boxShadow: '0 10px 30px rgba(32, 34, 44, 0.25)',
};
