/*
 * round303 — topic-name display rules for the agenda ribbon (owner spec):
 *
 *  - A line holds at most 3 WORDS or 16 CHARACTERS, whichever is hit first;
 *    anything beyond wraps to the next line automatically.
 *  - A topic name can never hold more than 6 words (so the two-line ribbon tile
 *    always fits the whole name).
 */

export const TOPIC_MAX_WORDS = 6;
export const LINE_MAX_WORDS = 3;
export const LINE_MAX_CHARS = 16;

const words = (name) => String(name ?? '').trim().split(/\s+/).filter(Boolean);

/**
 * Enforce the 6-word ceiling. Returns { name, clamped } — `clamped` is true when
 * words were dropped, so the caller can tell the user instead of losing text
 * silently.
 */
export function clampTopicWords(name, maxWords = TOPIC_MAX_WORDS) {
  const parts = words(name);
  if (parts.length <= maxWords) return { name: parts.join(' '), clamped: false };
  return { name: parts.slice(0, maxWords).join(' '), clamped: true };
}

/**
 * The full acceptance rule for a NEW/renamed topic name: at most 6 words AND at
 * most 2 display lines. The word cap alone is not enough — six 8-character words
 * split into six one-word lines, and the tile only shows two — so words are
 * dropped until the split fits, keeping the promise that an accepted name is
 * always fully visible.
 */
export function clampTopicName(name, {
  maxWords = TOPIC_MAX_WORDS, maxLines = 2, maxLineWords = LINE_MAX_WORDS, maxLineChars = LINE_MAX_CHARS,
} = {}) {
  let { name: current, clamped } = clampTopicWords(name, maxWords);
  let parts = current ? current.split(' ') : [];
  while (parts.length > 1
    && splitTopicNameLines(parts.join(' '), { maxWords: maxLineWords, maxChars: maxLineChars }).length > maxLines) {
    parts = parts.slice(0, -1);
    clamped = true;
  }
  return { name: parts.join(' '), clamped };
}

/**
 * Lines for DISPLAY: the computed split, folded to at most 2 rows. Names that
 * pre-date the rule (or arrive from templates) may split into more; everything
 * past row 1 is merged into row 2, whose CSS ellipsis then shows the cut — the
 * text is clipped visibly instead of silently vanishing below the tile.
 */
export function displayTopicNameLines(name, opts) {
  const lines = splitTopicNameLines(name, opts);
  if (lines.length <= 2) return lines;
  return [lines[0], lines.slice(1).join(' ')];
}

/**
 * Split a topic name into display lines: each line takes words while it holds at
 * most `maxWords` of them AND at most `maxChars` characters (a single word longer
 * than the budget still gets its own line — words are never cut mid-word).
 */
export function splitTopicNameLines(name, { maxWords = LINE_MAX_WORDS, maxChars = LINE_MAX_CHARS } = {}) {
  const parts = words(name);
  if (!parts.length) return [];
  const lines = [];
  let line = [];
  let lineChars = 0;
  for (const word of parts) {
    // +1 for the joining space when the line already has content
    const nextChars = lineChars + (line.length ? 1 : 0) + word.length;
    if (line.length && (line.length + 1 > maxWords || nextChars > maxChars)) {
      lines.push(line.join(' '));
      line = [word];
      lineChars = word.length;
    } else {
      line.push(word);
      lineChars = nextChars;
    }
  }
  if (line.length) lines.push(line.join(' '));
  return lines;
}
