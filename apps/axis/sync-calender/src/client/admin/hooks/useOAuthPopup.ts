import { useCallback, useRef } from 'react';
import { apiFetch } from '../services/api';
import type { OAuthProvider, OAuthStartResponse } from '../types';

interface PopupMessage {
  type: string;
  provider: OAuthProvider;
  configId: string | null;
  ok: boolean;
  error: string | null;
}

interface PopupResult {
  ok: boolean;
  configId: string | null;
  error?: string | null;
}

interface OAuthPopupOptions {
  /** Timeout in ms before rejecting. Default 120s. */
  timeoutMs?: number;
  /** Popup dimensions. */
  width?: number;
  height?: number;
}

export function useOAuthPopup(provider: OAuthProvider, options: OAuthPopupOptions = {}) {
  const { timeoutMs = 120_000, width = 500, height = 700 } = options;
  const inFlight = useRef<boolean>(false);

  return useCallback(async (configId: string): Promise<PopupResult> => {
    if (inFlight.current) {
      throw new Error('oauth_already_in_progress');
    }
    inFlight.current = true;

    const startEndpoint =
      provider === 'google' ? '/oauth/google/start'
      : provider === 'microsoft' ? '/oauth/microsoft/start'
      : '/oauth/monday/start';

    try {
      const start = await apiFetch<OAuthStartResponse>(startEndpoint, {
        method: 'POST',
        body: JSON.stringify({ configId }),
      });

      const features = `width=${width},height=${height},resizable=yes,scrollbars=yes`;
      const popup = window.open(start.authUrl, 'oauth_popup', features);

      if (!popup) {
        // Popup blocked — fall back to in-iframe redirect.
        window.location.href = start.authUrl;
        return { ok: false, configId, error: 'popup_blocked_redirecting' };
      }

      return await new Promise<PopupResult>((resolve, reject) => {
        const expectedType = `oauth:${provider}:complete`;
        let closePoller: number | null = null;
        let timeout: number | null = null;

        const cleanup = () => {
          window.removeEventListener('message', onMessage);
          if (closePoller !== null) window.clearInterval(closePoller);
          if (timeout !== null) window.clearTimeout(timeout);
        };

        const onMessage = (evt: MessageEvent) => {
          if (evt.origin !== window.location.origin) return;
          const data = evt.data as PopupMessage | undefined;
          if (!data || data.type !== expectedType) return;
          cleanup();
          try { popup.close(); } catch { /* noop */ }
          resolve({
            ok: Boolean(data.ok),
            configId: data.configId,
            error: data.error ?? null,
          });
        };

        window.addEventListener('message', onMessage);

        closePoller = window.setInterval(() => {
          if (popup.closed) {
            cleanup();
            reject(new Error('popup_closed_prematurely'));
          }
        }, 500);

        timeout = window.setTimeout(() => {
          cleanup();
          try { popup.close(); } catch { /* noop */ }
          reject(new Error('oauth_timeout'));
        }, timeoutMs);
      });
    } finally {
      inFlight.current = false;
    }
  }, [provider, timeoutMs, width, height]);
}
