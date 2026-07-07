import React, { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocale } from '../../hooks/useLocale';

interface SettingsSectionProps {
  id: string;
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
  isComplete?: boolean;
  hasErrors?: boolean;
  description?: string;
}

export const SettingsSection: React.FC<SettingsSectionProps> = ({
  title,
  isOpen,
  onToggle,
  children,
  isComplete = false,
  hasErrors = false,
  description
}) => {
  const { t } = useTranslation();
  const locale = useLocale();
  return (
    <div className="border border-border-subtle rounded-lg mb-4 overflow-hidden" dir={locale.dir}>
      <div
        className="px-4 py-3 bg-bg-section hover:bg-bg-hover cursor-pointer transition-colors flex items-center justify-between"
        onClick={onToggle}
      >
        <div className="flex items-center gap-2">
          <span className="text-text-muted text-xs">
            {isOpen ? '▼' : '▶'}
          </span>
          <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
          {isComplete ? (
            <span className="text-success text-xs" title={t('settings.tabStatus.complete')}>
              ✓
            </span>
          ) : hasErrors ? (
            <span className="w-2.5 h-2.5 bg-danger rounded-full" title={t('settings.tabStatus.missing')} />
          ) : null}
        </div>
      </div>
      {isOpen && (
        <>
          {description && (
            <p className="px-4 pt-2 text-xs text-text-muted">{description}</p>
          )}
          <div className="px-4 py-4 space-y-4">{children}</div>
        </>
      )}
    </div>
  );
};
