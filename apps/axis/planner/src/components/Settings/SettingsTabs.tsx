import React, { useState, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocale } from '../../hooks/useLocale';

interface TabStatus {
  hasErrors: boolean;
}

interface SettingsTabsProps {
  children: ReactNode;
  defaultTab?: string;
  tabStatus?: Record<string, TabStatus>;
}

export const SettingsTabs: React.FC<SettingsTabsProps> = ({
  children,
  defaultTab = 'allocations',
  tabStatus = {}
}) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const [activeTab, setActiveTab] = useState(defaultTab);

  const tabs = [
    { id: 'allocations', label: t('settings.tabs.allocations') },
    { id: 'employees', label: t('settings.tabs.employees') },
    { id: 'projects', label: t('settings.tabs.projects') },
    { id: 'availability', label: t('settings.tabs.availability') },
    { id: 'general', label: t('settings.tabs.general') }
  ];

  return (
    <div dir={locale.dir}>
      <div className="flex border-b border-border-subtle mb-4">
        {tabs.map(tab => {
          const hasErrors = tabStatus[tab.id]?.hasErrors ?? false;
          return (
            <button
              key={tab.id}
              className={`px-4 py-2 text-sm font-medium transition-colors relative ${
                activeTab === tab.id
                  ? 'text-accent border-b-2 border-accent'
                  : 'text-text-muted hover:text-text-primary'
              }`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
              {hasErrors && (
                <span
                  className="absolute -top-0.5 -start-0.5 w-2.5 h-2.5 bg-danger rounded-full"
                  title={t('settings.tabStatus.missing')}
                />
              )}
            </button>
          );
        })}
      </div>

      <div>
        {React.Children.map(children, (child) => {
          if (React.isValidElement(child)) {
            const tabId = (child.props as any)['data-tab-id'];
            if (tabId === activeTab) {
              return child;
            }
          }
          return null;
        })}
      </div>
    </div>
  );
};
