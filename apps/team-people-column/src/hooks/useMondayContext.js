import { useState, useEffect } from 'react';
import mondayService from '../services/mondayService';
import logger from '../utils/logger';
import { setAxiomContext } from '@mapps/error-kit/browser';

// Languages rendered right-to-left. The scaffold ships <html dir="rtl"> as the
// default; this hook re-syncs direction + lang from the live monday context so
// LTR users get LTR without a rebuild.
const RTL_LANGUAGES = ['he', 'ar', 'fa', 'ur'];

function applyLocale(context) {
  const lang = context?.user?.currentLanguage;
  if (!lang) return;
  const dir = RTL_LANGUAGES.includes(lang) ? 'rtl' : 'ltr';
  document.documentElement.setAttribute('dir', dir);
  document.documentElement.setAttribute('lang', lang);
}

function applyTheme(context) {
  const theme = context?.theme;
  if (!theme) return;
  // monday themes: light | dark | night | black.
  document.body.classList.remove('light-app-theme', 'dark-app-theme', 'night-app-theme', 'black-app-theme');
  document.body.classList.add(`${theme}-app-theme`);
}

export function useMondayContext() {
  const [context, setContext] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const initContext = async () => {
      try {
        const ctx = await mondayService.getContext();
        setContext(ctx);
        applyLocale(ctx);
        applyTheme(ctx);
        // Enrich remote error records with iframe identity (no-op when the
        // Axiom sink is gated off — see @mapps/error-kit/browser's attachAxiomSink
        // wiring in index.jsx).
        setAxiomContext({
          accountId: ctx?.account?.id,
          userId: ctx?.user?.id,
          boardId: ctx?.boardId,
          instanceId: ctx?.instanceId,
        });
        // Boot health signal (D5): one-shot per init; ships as kind='health' (inert until the
        // Axiom sink is active). The transport dedups repeats (e.g. dev StrictMode double-mount).
        logger.health('boot', { placement: ctx?.placement });
        setLoading(false);
      } catch (err) {
        logger.error('useMondayContext', 'Failed to load context', err);
        setError(err.message || 'Failed to load context');
        setLoading(false);
      }
    };

    initContext();

    // Listen for context changes (theme switches, language changes).
    const unsubscribe = mondayService.listenToContext((newContext) => {
      setContext(newContext);
      applyLocale(newContext);
      applyTheme(newContext);
    });

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, []);

  return { context, loading, error };
}
