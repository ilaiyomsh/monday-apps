// Single entry point for the dev mock harness. Imported unconditionally from
// main.tsx — the install is guarded so production builds skip everything
// except the import statement itself.
import { initMockState } from './data';
import { installFetchMock } from './fetch-mock';

if (import.meta.env.VITE_MOCK === '1') {
  initMockState();
  installFetchMock();

  if (typeof document !== 'undefined') {
    const addBadge = () => {
      const badge = document.createElement('div');
      badge.textContent = 'MOCK';
      Object.assign(badge.style, {
        position: 'fixed',
        right: '8px',
        bottom: '8px',
        padding: '4px 10px',
        borderRadius: '12px',
        background: '#784bd1',
        color: 'white',
        fontSize: '11px',
        fontWeight: '700',
        letterSpacing: '0.5px',
        zIndex: '99999',
        fontFamily: 'monospace',
        pointerEvents: 'none',
      });
      document.body.appendChild(badge);
    };
    if (document.body) addBadge();
    else document.addEventListener('DOMContentLoaded', addBadge);
  }

  // eslint-disable-next-line no-console
  console.info('[mock] monday-sdk + /api fetch mocks installed. `window.__mock.reset()` to wipe state.');
}
