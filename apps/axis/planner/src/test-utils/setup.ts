import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  // Mirror current production state: Hebrew RTL.
  // Increment 10 will start to flip this dynamically; tests opt in explicitly.
  document.documentElement.dir = 'rtl';
  document.documentElement.lang = 'he';
});

// Silence the in-app logger in tests; individual tests can override via vi.spyOn.
type AppLoggerStub = {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
  setLevel: ReturnType<typeof vi.fn>;
  getLevel: ReturnType<typeof vi.fn>;
  createLabeled: (label: string) => AppLoggerStub;
};

const makeAppLogger = (): AppLoggerStub => {
  const stub: AppLoggerStub = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    setLevel: vi.fn(),
    getLevel: vi.fn(() => 'silent'),
    createLabeled: () => makeAppLogger(),
  };
  return stub;
};

// `as unknown as` because the project's real Logger has a richer API; tests don't need it.
(globalThis as unknown as { AppLogger: AppLoggerStub }).AppLogger = makeAppLogger();
