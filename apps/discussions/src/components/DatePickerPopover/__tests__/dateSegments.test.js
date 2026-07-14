import { describe, it, expect } from 'vitest';
import {
  sanitizeSegment,
  acceptSegmentInput,
  segmentsToTyped,
  dateToSegments,
} from '../dateSegments.js';

describe('sanitizeSegment', () => {
  it('strips non-digits and caps at two characters', () => {
    expect(sanitizeSegment('1a2b3')).toBe('12');
    expect(sanitizeSegment('//')).toBe('');
    expect(sanitizeSegment('0512')).toBe('05');
  });
  it('tolerates null/undefined as empty', () => {
    expect(sanitizeSegment(null)).toBe('');
    expect(sanitizeSegment(undefined)).toBe('');
  });
});

describe('acceptSegmentInput', () => {
  it('advances when a segment is filled with two digits', () => {
    expect(acceptSegmentInput('dd', '15')).toEqual({ value: '15', advance: true });
    expect(acceptSegmentInput('mm', '03')).toEqual({ value: '03', advance: true });
    expect(acceptSegmentInput('yy', '26')).toEqual({ value: '26', advance: true });
  });
  it('keeps a single ambiguous first digit without advancing', () => {
    // day 1,2,3 can still be the first digit of 10-31; month 0,1 of 01-12
    expect(acceptSegmentInput('dd', '3')).toEqual({ value: '3', advance: false });
    expect(acceptSegmentInput('mm', '1')).toEqual({ value: '1', advance: false });
    expect(acceptSegmentInput('yy', '2')).toEqual({ value: '2', advance: false });
  });
  it('zero-pads and advances a first digit that cannot start a valid value', () => {
    // day: 4-9 → 04-09; month: 2-9 → 02-09
    expect(acceptSegmentInput('dd', '4')).toEqual({ value: '04', advance: true });
    expect(acceptSegmentInput('dd', '9')).toEqual({ value: '09', advance: true });
    expect(acceptSegmentInput('mm', '2')).toEqual({ value: '02', advance: true });
    expect(acceptSegmentInput('mm', '9')).toEqual({ value: '09', advance: true });
  });
  it('never zero-pads the year (any first digit stays put)', () => {
    expect(acceptSegmentInput('yy', '9')).toEqual({ value: '9', advance: false });
  });
  it('drops junk input to empty without advancing', () => {
    expect(acceptSegmentInput('dd', 'ab')).toEqual({ value: '', advance: false });
    expect(acceptSegmentInput('dd', '')).toEqual({ value: '', advance: false });
  });
  it('caps pasted overlong input at two digits and advances', () => {
    expect(acceptSegmentInput('dd', '1234')).toEqual({ value: '12', advance: true });
  });
});

describe('segmentsToTyped', () => {
  it('joins full segments with slashes', () => {
    expect(segmentsToTyped({ dd: '05', mm: '03', yy: '26' })).toBe('05/03/26');
  });
  it('omits a missing year (parse defaults it to the current year)', () => {
    expect(segmentsToTyped({ dd: '05', mm: '03', yy: '' })).toBe('05/03');
  });
  it('returns empty when day or month is missing', () => {
    expect(segmentsToTyped({ dd: '', mm: '03', yy: '26' })).toBe('');
    expect(segmentsToTyped({ dd: '05', mm: '', yy: '26' })).toBe('');
    expect(segmentsToTyped({ dd: '', mm: '', yy: '' })).toBe('');
  });
});

describe('dateToSegments', () => {
  it('splits a Date into two-digit segments with a 2-digit year', () => {
    expect(dateToSegments(new Date(2026, 2, 5))).toEqual({ dd: '05', mm: '03', yy: '26' });
    expect(dateToSegments(new Date(2031, 11, 25))).toEqual({ dd: '25', mm: '12', yy: '31' });
  });
  it('returns empty segments for null/invalid input', () => {
    expect(dateToSegments(null)).toEqual({ dd: '', mm: '', yy: '' });
    expect(dateToSegments(new Date('nope'))).toEqual({ dd: '', mm: '', yy: '' });
    expect(dateToSegments('2026-03-05')).toEqual({ dd: '', mm: '', yy: '' });
  });
});
