// TDD red phase (0.14.0) — the block-list operations behind the body editor.
//
// They live in a module rather than inside the component because they carry the
// rules that matter: reordering is what sets CLUSTER PRIORITY (so an off-by-one
// silently re-prioritizes a tenant's tasks), and the caps must match the server's
// or the operator meets an opaque 400 on save. This app has no component render
// harness (vitest runs in `node`), so keeping them here is what makes them
// testable at all.

import { describe, it, expect } from 'vitest';
import {
  addBlock,
  canAddCluster,
  canAddText,
  moveBlock,
  patchBlock,
  removeBlock,
} from './digest-block-ops';
import { newDigestCluster, newDigestTextBlock, type DigestBlockDraft } from './draft';

const text = (id: string, body = 'טקסט'): DigestBlockDraft => ({
  ...newDigestTextBlock(body),
  id,
});
const cluster = (id: string): DigestBlockDraft => ({ ...newDigestCluster('מקבץ'), id });

const ids = (blocks: DigestBlockDraft[]) => blocks.map((b) => b.id);

describe('moveBlock', () => {
  const blocks = [text('x_1'), cluster('s_1'), text('x_2')];

  it('swaps a block with the one above it', () => {
    expect(ids(moveBlock(blocks, 1, -1))).toEqual(['s_1', 'x_1', 'x_2']);
  });

  it('swaps a block with the one below it', () => {
    expect(ids(moveBlock(blocks, 1, 1))).toEqual(['x_1', 'x_2', 's_1']);
  });

  it('is a no-op at the top edge', () => {
    expect(ids(moveBlock(blocks, 0, -1))).toEqual(['x_1', 's_1', 'x_2']);
  });

  it('is a no-op at the bottom edge', () => {
    expect(ids(moveBlock(blocks, 2, 1))).toEqual(['x_1', 's_1', 'x_2']);
  });

  it('never mutates the input array', () => {
    const input = [text('x_1'), text('x_2')];
    moveBlock(input, 0, 1);
    expect(ids(input)).toEqual(['x_1', 'x_2']);
  });
});

describe('removeBlock', () => {
  it('removes exactly the block at that index', () => {
    expect(ids(removeBlock([text('x_1'), cluster('s_1'), text('x_2')], 1))).toEqual(['x_1', 'x_2']);
  });

  it('leaves the list alone for an out-of-range index', () => {
    const blocks = [text('x_1')];
    expect(ids(removeBlock(blocks, 5))).toEqual(['x_1']);
  });
});

describe('patchBlock', () => {
  it('replaces one block and touches no other', () => {
    const out = patchBlock([text('x_1', 'א'), text('x_2', 'ב')], 0, text('x_1', 'חדש'));
    expect(out[0]).toMatchObject({ id: 'x_1', text: 'חדש' });
    expect(out[1]).toMatchObject({ id: 'x_2', text: 'ב' });
  });
});

describe('addBlock and the caps', () => {
  it('appends to the end — a new block goes last, never first', () => {
    expect(ids(addBlock([text('x_1')], cluster('s_1')))).toEqual(['x_1', 's_1']);
  });

  it('refuses to exceed the 20-block cap (the server would 400)', () => {
    const full = Array.from({ length: 20 }, (_, i) => text(`x_${i}`));
    expect(addBlock(full, text('x_over'))).toHaveLength(20);
    expect(canAddText(full)).toBe(false);
    expect(canAddCluster(full)).toBe(false);
  });

  it('refuses a fifth cluster while still allowing text blocks', () => {
    const four = [cluster('s_1'), cluster('s_2'), cluster('s_3'), cluster('s_4')];
    expect(canAddCluster(four)).toBe(false);
    expect(canAddText(four)).toBe(true);
    expect(addBlock(four, cluster('s_5'))).toHaveLength(4);
    expect(addBlock(four, text('x_1'))).toHaveLength(5);
  });

  it('allows both while there is room', () => {
    expect(canAddText([text('x_1')])).toBe(true);
    expect(canAddCluster([text('x_1')])).toBe(true);
  });
});
