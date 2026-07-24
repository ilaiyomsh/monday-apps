/*
 * fileKind — map a filename / extension to a document "kind" + a display color,
 * for the TEXT-LESS, type-colored icons in the triple-box "מסמכים" bar (round268).
 * Pure (no IO), so it's unit-tested directly.
 *
 *   excel → green · pdf → red · word → blue · ppt → orange · image → purple ·
 *   anything else → neutral grey.
 * The icon carries NO text; the filename is shown on hover (title attribute).
 */
const KIND_BY_EXT = {
  xlsx: 'excel', xls: 'excel', xlsm: 'excel', xlsb: 'excel', csv: 'excel',
  pdf: 'pdf',
  doc: 'word', docx: 'word', rtf: 'word', odt: 'word',
  ppt: 'ppt', pptx: 'ppt',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', bmp: 'image', heic: 'image',
};

const KIND_COLOR = {
  excel: '#1d6f42',
  pdf: '#d83a52',
  word: '#2b579a',
  ppt: '#c43e1c',
  image: '#8a56d6',
  other: '#5b6474',
};

/** Lower-cased extension (no dot) from a filename OR a bare extension. Pure. */
export function extensionOf(nameOrExt = '') {
  const s = String(nameOrExt || '').trim().toLowerCase();
  if (!s) return '';
  const dot = s.lastIndexOf('.');
  return dot >= 0 ? s.slice(dot + 1) : s;
}

/** The document kind ('excel'|'pdf'|'word'|'ppt'|'image'|'other'). Pure. */
export function fileKind(nameOrExt) {
  return KIND_BY_EXT[extensionOf(nameOrExt)] || 'other';
}

/** The display color for a file's kind. Pure. */
export function fileKindColor(nameOrExt) {
  return KIND_COLOR[fileKind(nameOrExt)];
}

// round283 (owner request) — short uppercase glyph shown ON the colored square so
// a Word file reads as "W", Excel as "X", etc. (the round268 squares were
// text-less and the owner couldn't tell the type apart). image/other stay blank —
// the color + hover filename carry them.
const KIND_LABEL = {
  excel: 'X',
  pdf: 'PDF',
  word: 'W',
  ppt: 'P',
  image: '',
  other: '',
};

/** Short uppercase label for a file's kind ('W'|'X'|'PDF'|'P'|''). Pure. */
export function fileKindLabel(nameOrExt) {
  return KIND_LABEL[fileKind(nameOrExt)] || '';
}
