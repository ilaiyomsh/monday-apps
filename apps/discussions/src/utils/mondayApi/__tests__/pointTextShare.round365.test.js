import { describe, it, expect } from 'vitest';
import { DEFAULT_PREFERENCES, POINT_TEXT_SHARE_RANGE, pointNameGrow, resolvePreference } from '../boards.config.js';

/*
 * round365 (owner spec, approved mockup) — the point-row text share. The row is
 * [name flex:G][actions cluster][spacer flex:1]; G = share/(100-share). The
 * shipped default is 60% — 20% more text room than the historical mid-row 50%.
 */

describe('round365 — pointTextShare preference', () => {
  it('ships a 60% default (the +20% the owner asked for; 50 = the old middle)', () => {
    expect(DEFAULT_PREFERENCES.pointTextShare).toBe(60);
    expect(resolvePreference({}, 'pointTextShare')).toBe(60);
    expect(resolvePreference({ pointTextShare: 75 }, 'pointTextShare')).toBe(75);
  });

  it('converts share% to the name flex-grow against the spacer flex:1', () => {
    expect(pointNameGrow(50)).toBe(1);        // old behavior: cluster mid-row
    expect(pointNameGrow(60)).toBe(1.5);      // new default
    expect(pointNameGrow(75)).toBe(3);
    expect(pointNameGrow(80)).toBe(4);
  });

  it('clamps out-of-range and garbage input to the slider range, defaulting bad input to the shipped default', () => {
    expect(POINT_TEXT_SHARE_RANGE).toEqual({ min: 40, max: 92 });
    expect(pointNameGrow(10)).toBe(pointNameGrow(40));   // below min
    expect(pointNameGrow(99)).toBe(pointNameGrow(92));   // above max — never pushes the cluster off the row
    expect(pointNameGrow(undefined)).toBe(1.5);          // missing → default 60
    expect(pointNameGrow('abc')).toBe(1.5);              // NaN → default 60
    expect(pointNameGrow(null)).toBe(1.5);
  });
});
