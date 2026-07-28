/**
 * Guards the jest-dom wiring in src/setupTests.js.
 *
 * This exists because the failure mode is SILENT-ish and easy to reintroduce:
 * `import '@testing-library/jest-dom/vitest'` looks correct and throws nothing,
 * but that entry does `import { expect } from 'vitest'` resolved from the
 * PACKAGE's own context. Under pnpm, jest-dom has no vitest of its own, so the
 * bare specifier walks up to a hoisted vitest that is not the one running these
 * tests — and expect.extend() lands on a foreign instance. Every matcher then
 * dies with "Invalid Chai property: toBeInTheDocument", one assertion at a time,
 * in whatever test happens to reach for one first.
 *
 * The app shipped that way and nobody noticed, because no test had used a
 * jest-dom matcher yet. This test is the tripwire.
 */

import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

describe('jest-dom matchers (src/setupTests.js wiring)', () => {
  it('registers on the SAME vitest expect these tests run on', () => {
    render(<div>קיים בעץ</div>);

    // Would throw "Invalid Chai property" if the matchers landed on another
    // vitest instance — which is the whole bug this guards.
    expect(screen.getByText('קיים בעץ')).toBeInTheDocument();
  });

  it('registers the wider matcher set, not just one', () => {
    render(<button type="button" disabled>שמור</button>);

    const button = screen.getByRole('button', { name: 'שמור' });
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('שמור');
  });

  it('the matchers still FAIL when they should — a registered no-op is worse than none', () => {
    const detached = document.createElement('div');

    expect(() => expect(detached).toBeInTheDocument()).toThrow();
  });
});
