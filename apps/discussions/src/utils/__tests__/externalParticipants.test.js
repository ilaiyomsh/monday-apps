import { describe, it, expect } from 'vitest';
import {
  parseExternalParticipants,
  formatExternalParticipants,
  externalInitials,
} from '../externalParticipants.js';

// round211 — external (text-only) participants: the stored-string round-trip.
describe('externalParticipants', () => {
  it('parses a comma/newline-separated string into clean names', () => {
    expect(parseExternalParticipants('יוסי כהן, דנה לוי')).toEqual(['יוסי כהן', 'דנה לוי']);
    expect(parseExternalParticipants(' א ,\n ב ,, ')).toEqual(['א', 'ב']);
    expect(parseExternalParticipants('')).toEqual([]);
    expect(parseExternalParticipants(null)).toEqual([]);
    // parsed long_text may arrive as {text}
    expect(parseExternalParticipants({ text: 'רוני שגב' })).toEqual(['רוני שגב']);
  });

  it('formats a names array back to the comma-separated column value', () => {
    expect(formatExternalParticipants(['יוסי כהן', ' דנה לוי '])).toBe('יוסי כהן, דנה לוי');
    expect(formatExternalParticipants(['', null, 'א'])).toBe('א');
    expect(formatExternalParticipants([])).toBe('');
    expect(formatExternalParticipants(null)).toBe('');
  });

  it('round-trips: parse(format(names)) === names', () => {
    const names = ['יוסי כהן', 'דנה לוי', 'ג\'ון סמית'];
    expect(parseExternalParticipants(formatExternalParticipants(names))).toEqual(names);
  });

  it('derives first+last initials for the avatar circle', () => {
    expect(externalInitials('יוסי כהן')).toBe('יכ');
    expect(externalInitials('דנה')).toBe('ד');
    expect(externalInitials('א ב ג')).toBe('אב');
    expect(externalInitials('')).toBe('?');
  });
});
