import { describe, it, expect } from 'vitest';
import {
  parsePeople,
  formatPeople,
  parseStatusText,
  formatStatusLabel,
  parseTimeline,
  formatTimeline,
  parseDateText,
  formatDate,
  parseCheckbox,
  formatCheckbox,
  parseNumberText,
  parseFile,
} from '../services/columnMap';

describe('people column', () => {
  it('parses stored personsAndTeams → id strings, ignoring teams', () => {
    const stored = JSON.stringify({
      personsAndTeams: [
        { id: 111, kind: 'person' },
        { id: 222, kind: 'team' },
        { id: 333, kind: 'person' },
      ],
    });
    expect(parsePeople(stored)).toEqual(['111', '333']);
  });

  it('round-trips ids through format → parse', () => {
    const ids = ['111', '333'];
    const formatted = formatPeople(ids);
    // formatPeople emits numeric ids; parsePeople reads them back as strings.
    const stored = JSON.stringify(formatted);
    expect(parsePeople(stored)).toEqual(ids);
  });

  it('handles null / malformed', () => {
    expect(parsePeople(null)).toEqual([]);
    expect(parsePeople('')).toEqual([]);
    expect(parsePeople('not json')).toEqual([]);
  });
});

describe('status column', () => {
  it('parses label text (trimmed) and formats { label }', () => {
    expect(parseStatusText('  Approved  ')).toBe('Approved');
    expect(formatStatusLabel('Approved')).toEqual({ label: 'Approved' });
  });

  it('round-trips a label', () => {
    const label = 'Pending';
    const written = formatStatusLabel(label) as { label: string };
    expect(parseStatusText(written.label)).toBe(label);
  });

  it('empty/null → empty string', () => {
    expect(parseStatusText(null)).toBe('');
    expect(parseStatusText('')).toBe('');
  });
});

describe('timeline column', () => {
  it('round-trips from/to through format → parse', () => {
    const from = '2026-06-03';
    const to = '2026-06-07';
    const stored = JSON.stringify(formatTimeline(from, to));
    expect(parseTimeline(stored)).toEqual({ from, to });
  });

  it('parses a real monday timeline value with extra fields', () => {
    const stored = JSON.stringify({ from: '2026-06-03', to: '2026-06-07', visualization_type: 'label' });
    expect(parseTimeline(stored)).toEqual({ from: '2026-06-03', to: '2026-06-07' });
  });

  it('null on empty/malformed', () => {
    expect(parseTimeline(null)).toBeNull();
    expect(parseTimeline('')).toBeNull();
    expect(parseTimeline(JSON.stringify({ from: '', to: '' }))).toBeNull();
  });
});

describe('date column', () => {
  it('round-trips a day-key through format → parse', () => {
    const key = '2026-06-03';
    const written = formatDate(key) as { date: string };
    expect(parseDateText(written.date)).toBe(key);
  });

  it('null on empty', () => {
    expect(parseDateText(null)).toBeNull();
    expect(parseDateText('  ')).toBeNull();
  });
});

describe('checkbox column', () => {
  it('round-trips checked through format → parse', () => {
    const checkedStored = JSON.stringify(formatCheckbox(true));
    expect(parseCheckbox(checkedStored)).toBe(true);
    // unchecked formats to {} which parses back to false.
    const uncheckedStored = JSON.stringify(formatCheckbox(false));
    expect(parseCheckbox(uncheckedStored)).toBe(false);
  });

  it('parses { checked: true } boolean form', () => {
    expect(parseCheckbox(JSON.stringify({ checked: true }))).toBe(true);
  });

  it('false on null/empty', () => {
    expect(parseCheckbox(null)).toBe(false);
    expect(parseCheckbox('')).toBe(false);
  });
});

describe('number column', () => {
  it('parses numeric text', () => {
    expect(parseNumberText('20')).toBe(20);
    expect(parseNumberText(' 3.5 ')).toBe(3.5);
  });

  it('null on empty/non-numeric', () => {
    expect(parseNumberText(null)).toBeNull();
    expect(parseNumberText('')).toBeNull();
    expect(parseNumberText('abc')).toBeNull();
  });
});

describe('file column', () => {
  it('parses the first asset name', () => {
    const stored = JSON.stringify({ files: [{ name: 'sick-note.pdf', assetId: 99 }] });
    expect(parseFile(stored)).toEqual({ name: 'sick-note.pdf', url: undefined });
  });

  it('undefined when no files', () => {
    expect(parseFile(null)).toBeUndefined();
    expect(parseFile(JSON.stringify({ files: [] }))).toBeUndefined();
  });
});
