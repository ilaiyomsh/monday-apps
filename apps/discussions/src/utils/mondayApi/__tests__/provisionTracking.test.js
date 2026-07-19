import { describe, it, expect } from 'vitest';
import { PROVISION_SPEC } from '../provisionBoards.js';

// round153 — a freshly-provisioned decisions board must include the "מעקב החלטה"
// tracking status column, with "התקבלה" as the first label (the default a new
// decision gets). Labels are read from the live column at runtime, but this
// default shapes a brand-new board.

describe('PROVISION_SPEC — decision tracking column', () => {
  const spec = PROVISION_SPEC.decisions.columns.find((c) => c.alias === 'decisionTrackingID');

  it('exists as a status column titled "מעקב החלטה"', () => {
    expect(spec).toBeTruthy();
    expect(spec.type).toBe('status');
    expect(spec.title).toBe('מעקב החלטה');
  });

  it('defaults carry the five labels with "התקבלה" at display position 0', () => {
    const defaults = JSON.parse(spec.defaults);
    const labelTexts = Object.values(defaults.labels);
    expect(labelTexts).toContain('התקבלה');
    expect(labelTexts).toHaveLength(5);
    // the label whose position is 0 (first, = default) is "התקבלה"
    const firstIndex = Object.entries(defaults.labels_positions_v2).find(([, pos]) => pos === 0)?.[0];
    expect(defaults.labels[firstIndex]).toBe('התקבלה');
  });
});
