// Vitest global test setup.
//
// Register jest-dom matchers on THIS app's vitest expect explicitly.
// The '@testing-library/jest-dom/vitest' entry imports 'vitest' from the
// package's own resolution context; in the pnpm monorepo that resolves to a
// hoisted vitest 4.x while these tests run this app's vitest 2.x, so the
// matchers land on the wrong expect instance ("Invalid Chai property:
// toBeInTheDocument"). Same fix as apps/discussions/src/setupTests.js.
import * as jestDomMatchers from '@testing-library/jest-dom/matchers';
import { expect } from 'vitest';

expect.extend(jestDomMatchers);
