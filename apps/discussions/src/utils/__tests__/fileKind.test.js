import { describe, it, expect } from 'vitest';
import { extensionOf, fileKind, fileKindColor, fileKindLabel } from '../fileKind.js';

describe('fileKind — extensionOf', () => {
  it('lower-cases and strips to the last extension', () => {
    expect(extensionOf('תקציב-2026.XLSX')).toBe('xlsx');
    expect(extensionOf('archive.tar.gz')).toBe('gz');
  });
  it('accepts a bare extension (no dot) and handles empty', () => {
    expect(extensionOf('pdf')).toBe('pdf');
    expect(extensionOf('')).toBe('');
    expect(extensionOf(null)).toBe('');
  });
});

describe('fileKind — kind mapping', () => {
  it('maps known extensions to their kind (case-insensitive)', () => {
    expect(fileKind('a.xlsx')).toBe('excel');
    expect(fileKind('b.csv')).toBe('excel');
    expect(fileKind('c.PDF')).toBe('pdf');
    expect(fileKind('d.docx')).toBe('word');
    expect(fileKind('e.pptx')).toBe('ppt');
    expect(fileKind('f.png')).toBe('image');
    expect(fileKind('g.jpeg')).toBe('image');
  });
  it('falls back to "other" for unknown / missing extensions', () => {
    expect(fileKind('h.zip')).toBe('other');
    expect(fileKind('noext')).toBe('other');
    expect(fileKind('')).toBe('other');
  });
});

describe('fileKind — glyph label', () => {
  // round284 — the triple-box glyph keys off monday's `extension` field, which is
  // a BARE extension (no dot, no filename). Prove the label resolves from that
  // bare form, not only from a dotted filename.
  it('maps a BARE extension (monday `extension` field) to its glyph', () => {
    expect(fileKindLabel('docx')).toBe('W');
    expect(fileKindLabel('xlsx')).toBe('X');
    expect(fileKindLabel('pdf')).toBe('PDF');
    expect(fileKindLabel('pptx')).toBe('P');
  });
  it('maps a dotted filename to its glyph too', () => {
    expect(fileKindLabel('report.docx')).toBe('W');
    expect(fileKindLabel('budget.XLSX')).toBe('X');
  });
  it('is blank for image / other / unknown (color + hover carry them)', () => {
    expect(fileKindLabel('png')).toBe('');
    expect(fileKindLabel('zip')).toBe('');
    expect(fileKindLabel('noext')).toBe('');
    expect(fileKindLabel('')).toBe('');
  });
});

describe('fileKind — color', () => {
  it('gives each kind its distinct color, and "other" grey', () => {
    expect(fileKindColor('a.xlsx')).toBe('#1d6f42'); // excel green
    expect(fileKindColor('b.pdf')).toBe('#d83a52');  // pdf red
    expect(fileKindColor('c.docx')).toBe('#2b579a'); // word blue
    expect(fileKindColor('d.png')).toBe('#8a56d6');  // image purple
    expect(fileKindColor('e.zip')).toBe('#5b6474');  // other grey
  });
});
