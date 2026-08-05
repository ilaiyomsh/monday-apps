// Pure list operations behind the summary email's body editor (0.14.0).
//
// They are here, not inside DigestBlocksSection, because they carry the rules
// that matter and this app runs vitest in `node` — a component has no render
// harness, a module has tests. Two rules in particular:
//
//   * REORDERING IS PRIORITY. The cluster order in this list is what the server
//     stores as section order, and section order is what lets the first matching
//     cluster claim a task. An off-by-one here silently re-prioritizes a tenant's
//     mail, which no type checks.
//   * THE CAPS MIRROR THE SERVER. PUT /api/config rejects a 21st block or a 5th
//     cluster with an opaque `400 invalid_config, field: digest.blocks`. Blocking
//     the button is how the operator learns the limit instead of meeting it on
//     save. (tests/digest-blocks-client-drift.test.js pins the numbers together.)

import type { DigestBlockDraft } from './draft';
import { MAX_DIGEST_BLOCKS, MAX_DIGEST_CLUSTERS } from './digest-blocks';

/** Move the block at `index` one place up (-1) or down (+1). Edges are no-ops. */
export function moveBlock(
  blocks: DigestBlockDraft[],
  index: number,
  delta: -1 | 1
): DigestBlockDraft[] {
  const target = index + delta;
  if (index < 0 || index >= blocks.length) return blocks;
  if (target < 0 || target >= blocks.length) return blocks;
  const next = [...blocks];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Drop the block at `index`. An out-of-range index changes nothing. */
export function removeBlock(blocks: DigestBlockDraft[], index: number): DigestBlockDraft[] {
  if (index < 0 || index >= blocks.length) return blocks;
  return blocks.filter((_, i) => i !== index);
}

/** Replace the block at `index`. */
export function patchBlock(
  blocks: DigestBlockDraft[],
  index: number,
  next: DigestBlockDraft
): DigestBlockDraft[] {
  return blocks.map((b, i) => (i === index ? next : b));
}

const clusterCount = (blocks: DigestBlockDraft[]) =>
  blocks.filter((b) => b.type === 'cluster').length;

/** Room for another text block? */
export function canAddText(blocks: DigestBlockDraft[]): boolean {
  return blocks.length < MAX_DIGEST_BLOCKS;
}

/** Room for another cluster? Two ceilings apply — total blocks and clusters. */
export function canAddCluster(blocks: DigestBlockDraft[]): boolean {
  return blocks.length < MAX_DIGEST_BLOCKS && clusterCount(blocks) < MAX_DIGEST_CLUSTERS;
}

/**
 * Append a block, at the END — a new block never jumps ahead of existing ones,
 * so adding a cluster cannot silently outrank the ones already there. Returns the
 * list unchanged when the relevant cap is reached.
 */
export function addBlock(blocks: DigestBlockDraft[], block: DigestBlockDraft): DigestBlockDraft[] {
  const allowed = block.type === 'cluster' ? canAddCluster(blocks) : canAddText(blocks);
  if (!allowed) return blocks;
  return [...blocks, block];
}
