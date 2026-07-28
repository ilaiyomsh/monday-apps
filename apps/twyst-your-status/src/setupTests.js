// Vitest global test setup.
//
// Register jest-dom matchers on THIS app's vitest expect explicitly.
// The '@testing-library/jest-dom/vitest' entry does `import { expect } from
// 'vitest'` resolved from the PACKAGE's own context. Under pnpm jest-dom has no
// vitest of its own, so that bare specifier walks up to a hoisted vitest rather
// than the vitest 2.x these tests run on — expect.extend() then lands on a
// foreign expect and every matcher dies with "Invalid Chai property:
// toBeInTheDocument". Importing the matchers directly and extending the runner's
// own expect is the fix. Same as apps/discussions and apps/team-people-column.
// Tripwire: src/test-utils/jestDomMatchers.test.jsx.
import * as jestDomMatchers from '@testing-library/jest-dom/matchers';
import { expect } from 'vitest';

expect.extend(jestDomMatchers);
