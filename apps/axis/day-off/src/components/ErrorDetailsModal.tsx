import { useTranslation } from 'react-i18next';
import type { AppError } from '../types';

/** Minimal error surface (standard #6). Replace styling with @vibe/core later. */
export function ErrorDetailsModal({ error, onDismiss }: { error: AppError | null; onDismiss: () => void }) {
  const { t } = useTranslation();
  if (!error) return null;
  return (
    <div
      role="alertdialog"
      style={{
        position: 'fixed', insetInlineEnd: 16, bottom: 16, maxWidth: 360,
        background: '#fff', border: '1px solid #e1e1e1', borderRadius: 8, padding: 16,
        boxShadow: '0 6px 20px rgba(0,0,0,.15)',
      }}
    >
      <strong>{t('errors.title')}</strong>
      <p style={{ margin: '8px 0', color: '#676879' }}>{error.message}</p>
      <button onClick={onDismiss}>{t('common.dismiss')}</button>
    </div>
  );
}
