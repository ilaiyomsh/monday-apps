import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StatusBadge } from '../StatusBadge';

// Render-level smoke for converted components — catches @vibe/core API misuse
// that compiles but throws on render. Read-only props (no handlers) so no SDK /
// popover / monday-context dependency is hit.
// round135 — the TaskCard section was removed together with the TaskCard
// component itself: the perf/quality audit confirmed no app code imports it
// (this smoke test was its only consumer), so it was deleted as dead code.
describe('converted component render smoke', () => {
  it('StatusBadge renders the status label', () => {
    render(<StatusBadge label="בעבודה" color="#fdab3d" />);
    expect(screen.getByText('בעבודה')).toBeInTheDocument();
  });

  it('StatusBadge renders a fallback "ללא סטאטוס" for an empty label', () => {
    render(<StatusBadge label="" />);
    expect(screen.getByText('ללא סטאטוס')).toBeInTheDocument();
  });
});
