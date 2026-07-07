import React, { createContext, useContext, ReactNode, useMemo } from 'react';
import { useMondaySettings, type SettingsErrorKind } from '../hooks/useMondaySettings';
import type { PlannerSettings } from '../types/settings.types';

interface SettingsContextType {
  settings: PlannerSettings | null;
  updateSettings: (updates: Partial<PlannerSettings>) => Promise<boolean>;
  loading: boolean;
  isConfigured: boolean;
  error: string | null;
  errorKind: SettingsErrorKind | null;
  refresh: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const SettingsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { settings, saveSettings, loading, isConfigured, error, errorKind, refresh } = useMondaySettings();

  const updateSettings = async (updates: Partial<PlannerSettings>) => {
    if (!settings) return false;
    const updated = { ...settings, ...updates };
    return await saveSettings(updated);
  };

  const value = useMemo(() => ({
    settings,
    updateSettings,
    loading,
    isConfigured,
    error,
    errorKind,
    refresh
  }), [settings, loading, isConfigured, error, errorKind, saveSettings, refresh]);

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within SettingsProvider');
  }
  return context;
};
