// Audit finding 9: the global toast rendered t('app.error.title'), whose copy is specific to
// a LOAD failure ("Failed to load the app" / "שגיאה בטעינת האפליקציה"). But that toast fires
// on EVERY ERROR record from any layer — so a failed settings save told the user the app had
// failed to load. Wrong, and actively misleading about what to do next.
//
// The toast needs its own generic copy. app.error.title stays as-is for the ErrorBoundary
// fallback, where "failed to load the app" is accurate.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import i18n from '../i18n';

// Capture the onError callback the component registers, so a record can be driven through it
// without standing up the logger pipeline.
let captured: (() => void) | null = null;
vi.mock('../hooks/useUiErrorSink', () => ({
  useUiErrorSink: ({ onError }: { onError: () => void }) => {
    captured = onError;
  },
}));

import { AppErrorToaster } from '../App';

/** The load-specific copy, in both shipped locales — the toast must never show these. */
const LOAD_COPY = {
  en: 'Failed to load the app',
  he: 'שגיאה בטעינת האפליקציה',
};

describe('AppErrorToaster — generic copy, not the load-failure copy', () => {
  beforeEach(() => {
    captured = null;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  for (const locale of ['en', 'he'] as const) {
    it(`shows a generic message in ${locale}, never the load-failure copy`, async () => {
      await i18n.changeLanguage(locale);
      render(<AppErrorToaster />);

      expect(captured).toBeTypeOf('function');
      act(() => captured!());

      // Something must be shown — an error the user caused must not be silent.
      const toast = await screen.findByRole('status');
      const text = toast.textContent ?? '';
      expect(text.trim().length).toBeGreaterThan(0);
      // ...and it must not claim a load failure for e.g. a failed settings save.
      expect(text).not.toContain(LOAD_COPY[locale]);
    });

    it(`resolves its copy key in ${locale} (no raw i18n key leaks to the user)`, async () => {
      await i18n.changeLanguage(locale);
      render(<AppErrorToaster />);
      act(() => captured!());

      const text = (await screen.findByRole('status')).textContent ?? '';
      // A missing translation renders the key itself — that must never reach a user.
      expect(text).not.toMatch(/app\.error/);
    });
  }

  it('renders nothing until an error arrives', () => {
    render(<AppErrorToaster />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('clears the toast after the timeout', async () => {
    vi.useFakeTimers();
    await i18n.changeLanguage('en');
    render(<AppErrorToaster />);
    act(() => captured!());
    expect(screen.queryByRole('status')).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByRole('status')).toBeNull();
  });
});
