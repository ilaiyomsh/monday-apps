/*
 * round295 — topic accent-colour assignment for the agenda ribbon/cards.
 *
 * The palette --topic-color-1..20 (theme-tokens.css) is arranged in HUE order
 * (green→yellow→orange→red→pink→purple→blue→aqua), so NEIGHBOURING indices are
 * look-alike hues. To give adjacent topics strong visual separation (owner
 * request), colours are walked around the wheel by a STRIDE that is coprime to
 * 20 (COLOR_STRIDE=9 ≈ 162° per step): topic i targets `seed + i*STRIDE`, so
 * consecutive topics land on opposite sides of the wheel. Collisions also step
 * by STRIDE (stay spread). Because 9 and 20 are coprime, the first 20 topics
 * each get a DISTINCT colour before any repeat.
 *
 * Pure + exported so it can be unit-tested (the component just persists the
 * returned map in a ref so a topic keeps its colour across re-renders).
 */
export const TOPIC_COLOR_COUNT = 20;
export const COLOR_STRIDE = 9;

/** Stable hash of an id → a palette index in [0, TOPIC_COLOR_COUNT). */
export function topicColorStartIndex(id, seed = 0) {
  const s = String(id);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
  return (h + seed) % TOPIC_COLOR_COUNT;
}

/**
 * Assign a `--topic-color-N` CSS var to each topic, spreading adjacent topics
 * far apart on the hue wheel. `prevMap` (id → colorVar) is reused so an already
 * coloured topic keeps its colour; stale ids drop out. Returns a NEW map.
 */
export function assignTopicAccents(topics, seed = 0, prevMap = {}) {
  const map = { ...prevMap };
  const liveIds = new Set((topics || []).map((t) => String(t.id)));
  Object.keys(map).forEach((id) => { if (!liveIds.has(id)) delete map[id]; });
  const used = new Set(
    Object.values(map).map((colorVar) => Number(String(colorVar).replace('--topic-color-', '')) - 1),
  );
  (topics || []).forEach((topic, idx) => {
    const id = String(topic.id);
    if (map[id]) return;
    let colorIndex = (seed + idx * COLOR_STRIDE) % TOPIC_COLOR_COUNT;
    let steps = 0;
    while (used.has(colorIndex) && steps < TOPIC_COLOR_COUNT) {
      colorIndex = (colorIndex + COLOR_STRIDE) % TOPIC_COLOR_COUNT;
      steps += 1;
    }
    if (used.has(colorIndex)) colorIndex = idx % TOPIC_COLOR_COUNT;
    used.add(colorIndex);
    map[id] = `--topic-color-${colorIndex + 1}`;
  });
  return map;
}
