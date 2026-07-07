import React, { createContext, useContext, ReactNode } from 'react';
import { useMondayContextInternal } from '../hooks/useMondayContext';
import type { MondayContext, UserPermissions } from '../hooks/useMondayContext';

interface MondayContextValue {
  context: MondayContext | null;
  permissions: UserPermissions | null;
  isBoardOwner: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const MondayCtx = createContext<MondayContextValue | undefined>(undefined);

export const MondayContextProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const value = useMondayContextInternal();
  return <MondayCtx.Provider value={value}>{children}</MondayCtx.Provider>;
};

export const useMondayContext = (): MondayContextValue => {
  const ctx = useContext(MondayCtx);
  if (!ctx) {
    throw new Error('useMondayContext must be used within MondayContextProvider');
  }
  return ctx;
};
