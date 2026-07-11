import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Dir, Language, MondaySdk, MondaySdkContext, UserPermissions } from '../types';
import type { Logger } from '../logger';
import { setAxiomContext } from '../errors/axiomSink';

const LANGUAGE_TO_LOCALE: Record<Language, string> = { he: 'he-IL', en: 'en-US' };
const SUPPORTED: Language[] = ['he', 'en'];
const resolveLanguage = (raw?: string | null): Language => (SUPPORTED.includes(raw as Language) ? (raw as Language) : 'he');

export interface MondayContextValue {
  context: MondaySdkContext | null;
  currentUser: { id?: string; name?: string };
  language: Language;
  dir: Dir;
  locale: string;
  isMobile: boolean;
  permissions: UserPermissions;
  loading: boolean;
}

export interface MondayProviderProps {
  monday: MondaySdk;
  logger: Logger;
  children: ReactNode;
  /** Watchdog before rendering without a context (default 5000ms). */
  contextTimeoutMs?: number;
  /** Optional: resolve board owners for permission calc (non-admins). Planner-style. */
  getBoardOwners?: (boardId: string) => Promise<{ id: string }[]>;
  /** languageOverride from settings, if the app wants settings to win over monday's. */
  languageOverride?: Language | null;
}

const Ctx = createContext<MondayContextValue | null>(null);

const DEFAULT_PERMISSIONS: UserPermissions = { canEditSettings: false, canViewData: true, isBoardOwner: false, isAdmin: false };

export function MondayProvider(props: MondayProviderProps) {
  const { monday, logger, getBoardOwners, contextTimeoutMs = 5000, languageOverride, children } = props;
  const [context, setContext] = useState<MondaySdkContext | null>(null);
  const [permissions, setPermissions] = useState<UserPermissions>(DEFAULT_PERMISSIONS);
  const [loading, setLoading] = useState(true);
  const realLoaded = useRef(false);

  useEffect(() => {
    const apply = (ctx: MondaySdkContext) => {
      realLoaded.current = true;
      setContext(ctx);
      // Enrich every Axiom envelope with iframe identity (no-op when the sink is inert).
      setAxiomContext({ userId: ctx.user?.id, boardId: ctx.boardId, instanceId: ctx.instanceId });
      logger.info('MondayContext', 'context received', { instanceId: ctx.instanceId, boardId: ctx.boardId });
    };
    monday.get('context').then((res) => apply(res.data ?? {})).catch((e) => logger.error('MondayContext', 'get(context) failed', e));
    const unlisten = monday.listen('context', (res) => apply(res.data ?? {}));

    const watchdog = window.setTimeout(() => {
      if (!realLoaded.current) {
        logger.warn('MondayContext', `context watchdog fired (${contextTimeoutMs}ms) — rendering empty`);
        setContext((prev) => prev ?? {});
      }
    }, contextTimeoutMs);

    return () => {
      window.clearTimeout(watchdog);
      if (typeof unlisten === 'function') unlisten();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // permission calculation once context is known
  useEffect(() => {
    if (!context) return;
    let cancelled = false;
    const user = context.user ?? {};
    const isAdmin = Boolean(user.isAdmin);
    const base: UserPermissions = {
      isAdmin,
      isBoardOwner: false,
      canViewData: !user.isGuest,
      canEditSettings: isAdmin && !user.isViewOnly,
    };
    if (isAdmin || !getBoardOwners || !context.boardId) {
      setPermissions(base);
      setLoading(false);
      return;
    }
    getBoardOwners(String(context.boardId))
      .then((owners) => {
        if (cancelled) return;
        const isBoardOwner = owners.some((o) => o.id === user.id);
        setPermissions({ ...base, isBoardOwner, canEditSettings: isBoardOwner && !user.isViewOnly });
      })
      .catch((e) => { logger.warn('MondayContext', 'getBoardOwners failed', e); if (!cancelled) setPermissions(base); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [context, getBoardOwners, logger]);

  const value = useMemo<MondayContextValue>(() => {
    const language = resolveLanguage(languageOverride ?? context?.user?.currentLanguage);
    const dir: Dir = language === 'he' ? 'rtl' : 'ltr';
    return {
      context,
      currentUser: { id: context?.user?.id, name: context?.user?.name },
      language,
      dir,
      locale: LANGUAGE_TO_LOCALE[language],
      isMobile: context?.mode === 'mobile',
      permissions,
      loading,
    };
  }, [context, permissions, loading, languageOverride]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMondayContext(): MondayContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useMondayContext must be used within MondayProvider');
  return ctx;
}
