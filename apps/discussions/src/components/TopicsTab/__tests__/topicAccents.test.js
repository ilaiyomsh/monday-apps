import { describe, it, expect } from 'vitest';
import { assignTopicAccents, topicColorStartIndex, TOPIC_COLOR_COUNT, COLOR_STRIDE } from '../topicAccents.js';

// round295 — adjacent agenda topics must get well-SEPARATED hues (owner request).
// The palette is hue-ordered, so "separation" = a large gap between the palette
// indices of consecutive topics. These assertions FAIL under the pre-round295
// logic (hash start + `+1` collision stepping), which clustered neighbours.

const idx = (colorVar) => Number(String(colorVar).replace('--topic-color-', '')) - 1;
// Circular distance on the 20-hue wheel (0..10). Adjacent hues → small distance.
const wheelDist = (a, b) => {
  const d = Math.abs(a - b) % TOPIC_COLOR_COUNT;
  return Math.min(d, TOPIC_COLOR_COUNT - d);
};

const topics = (n) => Array.from({ length: n }, (_, i) => ({ id: `t${i}` }));

describe('assignTopicAccents — variance between adjacent topics', () => {
  it('gives consecutive topics a large hue gap (>= 5 of 10 max), not look-alike neighbours', () => {
    const map = assignTopicAccents(topics(8), 0);
    for (let i = 1; i < 8; i++) {
      const gap = wheelDist(idx(map[`t${i - 1}`]), idx(map[`t${i}`]));
      expect(gap).toBeGreaterThanOrEqual(5); // COLOR_STRIDE=9 → gap 9 or 11 → dist 9 (>=5)
    }
  });

  it('assigns 20 DISTINCT colours before any repeat (stride coprime to 20)', () => {
    const map = assignTopicAccents(topics(TOPIC_COLOR_COUNT), 3);
    const colors = new Set(Object.values(map));
    expect(colors.size).toBe(TOPIC_COLOR_COUNT);
    expect(COLOR_STRIDE).toBe(9); // guards the coprime-with-20 choice
  });

  it('is STABLE: an already-assigned topic keeps its colour when others change', () => {
    const first = assignTopicAccents(topics(4), 2);
    const keep = first.t1;
    // add a topic at the front + drop t3; t1 must keep its colour.
    const next = assignTopicAccents([{ id: 'new' }, { id: 't0' }, { id: 't1' }, { id: 't2' }], 2, first);
    expect(next.t1).toBe(keep);
    expect(next.t3).toBeUndefined(); // stale id dropped
  });

  it('never assigns the same colour to two live topics', () => {
    const map = assignTopicAccents(topics(15), 7);
    const colors = Object.values(map);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('topicColorStartIndex is deterministic and in range', () => {
    expect(topicColorStartIndex('abc', 0)).toBe(topicColorStartIndex('abc', 0));
    for (const id of ['x', 'discussion:42', 'yy']) {
      const v = topicColorStartIndex(id, 5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(TOPIC_COLOR_COUNT);
    }
  });
});
