import { describe, it, expect } from 'vitest';
import { computeCardDrop } from '../cardDnd.js';

// round215 — the mobile card drag-drop decision logic.
const t = (id) => ({ id });
const GROUPED = [
  { key: 'g1', status: 's1', items: [t('1'), t('2'), t('3')] },
  { key: 'g2', status: 's2', items: [t('4'), t('5')] },
  { key: 'g3', status: null, items: [t('6')] },
];

describe('computeCardDrop', () => {
  it('same-group drop → reorder with the moved id at the target position', () => {
    const out = computeCardDrop({ grouped: GROUPED, groupCol: 'status', activeId: '1', overId: '3' });
    expect(out).toEqual({ type: 'reorder', groupKey: 'g1', ids: ['2', '3', '1'] });
  });

  it('cross-group drop → move with the TARGET group label id and the full new flat order', () => {
    const out = computeCardDrop({ grouped: GROUPED, groupCol: 'status', activeId: '1', overId: '5' });
    expect(out.type).toBe('move');
    expect(out.taskId).toBe('1');
    expect(out.value).toBe('s2');
    // g1 loses '1'; g2 gains it BEFORE '5'; g3 unchanged.
    expect(out.flat).toEqual(['2', '3', '4', '1', '5', '6']);
  });

  it('dropping into the "ללא" bucket clears the value (null)', () => {
    const out = computeCardDrop({ grouped: GROUPED, groupCol: 'priority', activeId: '2', overId: '6' });
    expect(out.type).toBe('move');
    expect(out.value).toBeNull();
  });

  it('cross-group is ignored for non-writable groupings; bad ids/no-op return null', () => {
    expect(computeCardDrop({ grouped: GROUPED, groupCol: 'discussion', activeId: '1', overId: '5' })).toBeNull();
    expect(computeCardDrop({ grouped: GROUPED, groupCol: 'status', activeId: '1', overId: '1' })).toBeNull();
    expect(computeCardDrop({ grouped: GROUPED, groupCol: 'status', activeId: '1', overId: 'missing' })).toBeNull();
    expect(computeCardDrop({ grouped: GROUPED, groupCol: 'status', activeId: null, overId: '5' })).toBeNull();
  });
});
