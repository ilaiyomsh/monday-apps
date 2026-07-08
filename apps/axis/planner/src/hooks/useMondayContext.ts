import { useState, useEffect, useCallback } from 'react';
import mondaySdk from 'monday-sdk-js';
import { mondayService } from '../services/mondayService';
import { logger } from '../utils/Logger';
import { withTimeout } from '../utils/sdkUtils';

const monday = mondaySdk();

export interface MondayContext {
  boardId?: number;
  instanceId: number;
  user: {
    id: string;
    name: string;
    isAdmin: boolean;
    isViewOnly: boolean;
    isGuest: boolean;
    currentLanguage: string;
  };
  theme: 'light' | 'dark' | 'black';
}

export interface UserPermissions {
  canEditSettings: boolean;
  canViewData: boolean;
  canModifyAllocations: boolean;
  isBoardOwner: boolean;
}

export const useMondayContextInternal = () => {
  const [context, setContext] = useState<MondayContext | null>(null);
  const [permissions, setPermissions] = useState<UserPermissions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const calculatePermissions = useCallback(async (ctx: MondayContext): Promise<UserPermissions> => {
    const { user, boardId } = ctx;

    // Admins always have full permissions — skip ownership check
    if (user.isAdmin) {
      logger.info('[LOAD_FLOW] [2/5] User is admin — skipping getBoardOwners');
      return {
        canEditSettings: !user.isViewOnly,
        canViewData: !user.isGuest,
        canModifyAllocations: !user.isViewOnly && !user.isGuest,
        isBoardOwner: false,
      };
    }

    let isBoardOwner = false;
    if (boardId) {
      if (boardId === 123456 && window.location.hostname === 'localhost') {
        isBoardOwner = true;
      } else {
        try {
          logger.info('[LOAD_FLOW] [2/5] Non-admin user — calling getBoardOwners (5s timeout)...');
          const t0 = performance.now();
          const owners = await withTimeout(
            mondayService.getBoardOwners(boardId.toString()),
            5_000,
            'getBoardOwners'
          );
          logger.info(`[LOAD_FLOW] [2/5] getBoardOwners resolved in ${Math.round(performance.now() - t0)}ms, owners: ${owners.length}`);
          isBoardOwner = owners.some((owner: any) => owner.id === user.id);
        } catch (err) {
          logger.error('[LOAD_FLOW] [2/5] getBoardOwners FAILED:', err);
          logger.error('[MondayContext] Failed to check board ownership:', err);
        }
      }
    }

    const perms = {
      canEditSettings: (user.isAdmin || isBoardOwner) && !user.isViewOnly,
      canViewData: !user.isGuest,
      canModifyAllocations: !user.isViewOnly && !user.isGuest,
      isBoardOwner,
    };
    logger.info('[LOAD_FLOW] [2/5] Permissions calculated:', JSON.stringify(perms));
    return perms;
  }, []);

  const fetchContext = useCallback(async () => {
    const t0 = performance.now();
    try {
      setLoading(true);
      setError(null);
      const isDevelopment = window.location.hostname === 'localhost';

      logger.info('[LOAD_FLOW] [1/5] Fetching monday context (10s timeout)...');
      let ctx: MondayContext;
      try {
        const response = await withTimeout(
          monday.get('context'),
          10_000,
          'monday.get(context)'
        );
        ctx = response.data as any as MondayContext;
        logger.info(`[LOAD_FLOW] [1/5] Context received in ${Math.round(performance.now() - t0)}ms — user: ${ctx?.user?.id}, board: ${ctx?.boardId}, admin: ${ctx?.user?.isAdmin}`);
      } catch (err) {
        if (isDevelopment) {
          logger.info('[LOAD_FLOW] [1/5] Dev mode — using fallback context');
          ctx = {
            boardId: 123456,
            instanceId: 789,
            user: {
              id: 'dev-user',
              name: 'Developer',
              isAdmin: true,
              isViewOnly: false,
              isGuest: false,
              currentLanguage: 'en',
            },
            theme: 'light',
          };
        } else {
          logger.error(`[LOAD_FLOW] [1/5] Context FAILED after ${Math.round(performance.now() - t0)}ms:`, err);
          throw err;
        }
      }

      // Validate context has required user data
      if (!ctx?.user) {
        logger.error('[LOAD_FLOW] [1/5] Invalid context — missing user data:', JSON.stringify(ctx));
        throw new Error('Invalid context: missing user data');
      }

      logger.info('[LOAD_FLOW] [2/5] Calculating permissions...');
      const perms = await calculatePermissions(ctx);

      setContext(ctx);
      setPermissions(perms);
      logger.info(`[LOAD_FLOW] [2/5] Context phase DONE in ${Math.round(performance.now() - t0)}ms`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch context';
      logger.error(`[LOAD_FLOW] Context phase FAILED after ${Math.round(performance.now() - t0)}ms:`, msg);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [calculatePermissions]);

  useEffect(() => {
    logger.info('[LOAD_FLOW] ========== APP LOAD START ==========');
    fetchContext();
  }, [fetchContext]);

  return {
    context,
    permissions,
    isBoardOwner: permissions?.isBoardOwner ?? false,
    loading,
    error,
    refresh: fetchContext,
  };
};
