import { describe, it, expect } from 'vitest';
import { extensionOf, fileKind, fileKindColor } from '../fileKind.js';

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

describe('fileKind — color', () => {
  it('gives each kind its distinct color, and "other" grey', () => {
    expect(fileKindColor('a.xlsx')).toBe('#1d6f42'); // excel green
    expect(fileKindColor('b.pdf')).toBe('#d83a52');  // pdf red
    expect(fileKindColor('c.docx')).toBe('#2b579a'); // word blue
    expect(fileKindColor('d.png')).toBe('#8a56d6');  // image purple
    expect(fileKindColor('e.zip')).toBe('#5b6474');  // other grey
  });
});
