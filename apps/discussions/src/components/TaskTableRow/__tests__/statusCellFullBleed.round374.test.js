import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * round374 — regression guard for the white frame that appeared around EVERY
 * status fill in 2.23.0.
 *
 * The mechanism, and why a rendering test cannot catch it: `.taskCell`
 * (TaskTable.module.css) sets `padding: 0 8px`; `.statusCell`
 * (TaskTableRow.module.css) overrides it with `padding: 0` so the coloured fill
 * bleeds to the cell edges. Both selectors are a SINGLE class, so the cascade
 * fell through to source order — and the moment StatusCell.jsx began importing
 * TaskTableRow.module.css, the bundler's emission order flipped, `.taskCell`
 * landed last, and its side padding won. jsdom does not reproduce cross-file
 * stylesheet ordering, so the only honest guard is on the selector itself:
 * the override must not DEPEND on order.
 */

const CSS = readFileSync(
  join(process.cwd(), 'src/components/TaskTableRow/TaskTableRow.module.css'),
  'utf-8'
);

describe('status cell full-bleed override is order-proof', () => {
  it('raises specificity by doubling the class instead of relying on source order', () => {
    expect(CSS).toContain('.statusCell.statusCell {');
    expect(CSS).toContain('.statusCell.statusCell > * {');
  });

  it('never ships a single-class .statusCell padding rule that .taskCell could outrank', () => {
    // A bare `.statusCell {` block is (0,1,0) — the exact tie that regressed.
    expect(/^\.statusCell\s*\{/m.test(CSS)).toBe(false);
  });

  it('still zeroes the padding — the whole point of the override', () => {
    const block = CSS.slice(CSS.indexOf('.statusCell.statusCell {'));
    expect(block.slice(0, 60)).toContain('padding: 0');
  });
});
