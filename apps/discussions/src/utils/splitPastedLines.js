/*
 * round367 §1 — pure splitter for multi-line paste into a point input.
 * One pasted block → one clean point name per line: split on newlines, trim,
 * drop empties, strip common list markers (bullet or numbering) so a list
 * copied out of a document lands as plain names.
 *
 * A marker counts ONLY when followed by whitespace ("- סעיף"), so "-5 מעלות"
 * or "א-ב" keep their leading characters.
 */
const LIST_MARKER = /^(?:[•·▪‣*–—-]|\d{1,3}[.)])\s+/;

export function splitPastedLines(text) {
  if (typeof text !== 'string' || !text) return [];
  return text
    .split(/\r?\n/)
    .map((line) => line.trim().replace(LIST_MARKER, '').trim())
    .filter(Boolean);
}
