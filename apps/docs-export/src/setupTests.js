// Vitest global test setup.
//
// Register jest-dom matchers on THIS app's vitest expect explicitly. The
// '@testing-library/jest-dom/vitest' entry imports 'vitest' from the package's
// own resolution context; in the pnpm monorepo that resolves to a hoisted
// vitest 4.x while these tests run this app's vitest 3.x, so the matchers land
// on the wrong expect instance ("Invalid Chai property: toBeInTheDocument").
// Same fix as apps/discussions/src/setupTests.js and apps/team-people-column's.
import * as jestDomMatchers from '@testing-library/jest-dom/matchers';
import { expect, vi } from 'vitest';

expect.extend(jestDomMatchers);

// Build-time constants that vite `define`s. vitest does not run the define
// pass, so the modules that read them (utils/versionLabel.js, index.jsx) would
// throw a ReferenceError under test without these.
vi.stubGlobal('__APP_VERSION__', '0.0.0-test');
vi.stubGlobal('__BUILD_SHA__', 'testsha');
vi.stubGlobal('__IS_RELEASE__', false);

// jsdom lacks these; @vibe/core Modal/Dropdown observe them on mount.
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
