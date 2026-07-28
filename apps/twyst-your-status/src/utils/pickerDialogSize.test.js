import { describe, expect, it } from 'vitest';
import {
  PICKER_VISIBLE_LABELS,
  pickerDialogHeightPx,
} from './pickerDialogSize.js';

describe('pickerDialogHeightPx', () => {
  it('fits exactly 6 label pills without scroll (Dev Center height)', () => {
    // 8+8 padding + 6×34 pills + 5×6 gaps = 250
    expect(pickerDialogHeightPx(6)).toBe(250);
    expect(pickerDialogHeightPx()).toBe(250);
    expect(PICKER_VISIBLE_LABELS).toBe(6);
  });

  it('scales with label count and falls back to 6 for invalid input', () => {
    expect(pickerDialogHeightPx(1)).toBe(50);
    expect(pickerDialogHeightPx(2)).toBe(90);
    expect(pickerDialogHeightPx(0)).toBe(250);
    expect(pickerDialogHeightPx(-3)).toBe(250);
    expect(pickerDialogHeightPx(2.5)).toBe(250);
  });
});
