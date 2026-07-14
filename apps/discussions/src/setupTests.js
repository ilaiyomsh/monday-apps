// Register jest-dom matchers on THIS app's vitest expect explicitly.
// The '@testing-library/jest-dom/vitest' entry imports 'vitest' from the
// package's own resolution context; in the pnpm monorepo that resolves to a
// hoisted vitest 4.x while these tests run vitest 3.x, so the matchers land
// on the wrong expect instance ("Invalid Chai property: toBeInTheDocument").
import * as jestDomMatchers from '@testing-library/jest-dom/matchers';
import { expect, vi } from 'vitest';

expect.extend(jestDomMatchers);
import './i18n'; // init i18next before components that use useTranslation render

// jsdom doesn't implement matchMedia; stub it for components that read it.
vi.stubGlobal(
  'matchMedia',
  vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
);

// @vibe/core components (Modal/Dialog/Dropdown…) use these observers, which
// jsdom doesn't implement.
class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
vi.stubGlobal('ResizeObserver', ObserverStub);
vi.stubGlobal('IntersectionObserver', ObserverStub);

// jsdom lacks elementFromPoint; TipTap's Placeholder viewport tracking calls it on mount.
if (typeof document !== 'undefined') {
  if (!document.elementFromPoint) document.elementFromPoint = () => null;
  if (!document.elementsFromPoint) document.elementsFromPoint = () => [];
}

// NOTE: a logger fan-out mock + renderWithProviders/mondayMock are added in
// later phases (Phase 3 brings the logger; Phase 6 brings the tests).
