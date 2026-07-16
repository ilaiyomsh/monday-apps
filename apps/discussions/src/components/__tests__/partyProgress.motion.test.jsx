import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { PartyProgress } from '../PartyProgress/PartyProgress.jsx';

afterEach(() => {
  vi.useRealTimers();
});

const fillWidth = () => {
  const bar = screen.getByRole('progressbar');
  return parseFloat(bar.firstChild.style.width);
};

describe('PartyProgress round127 — perceived motion from the first paint', () => {
  it('renders a visible sliver (>=4%) immediately at value=0', () => {
    render(<PartyProgress value={0} label="בודק" />);
    expect(fillWidth()).toBeGreaterThanOrEqual(4);
  });

  it('creeps forward over time while the real value is stuck', () => {
    vi.useFakeTimers();
    render(<PartyProgress value={0} label="בודק" />);
    const before = fillWidth();
    act(() => { vi.advanceTimersByTime(3000); });
    const after = fillWidth();
    expect(after).toBeGreaterThan(before);
    // never past the ceiling (0.97 => 97%)
    expect(after).toBeLessThanOrEqual(97);
  });

  it('a real tick snaps the bar at least to the real value', () => {
    vi.useFakeTimers();
    const { rerender } = render(<PartyProgress value={0} label="בודק" />);
    rerender(<PartyProgress value={0.5} label="בודק" />);
    expect(fillWidth()).toBeGreaterThanOrEqual(50);
  });

  it('completion renders exactly 100%', () => {
    const { rerender } = render(<PartyProgress value={0.5} label="בודק" />);
    rerender(<PartyProgress value={1} label="בודק" />);
    expect(fillWidth()).toBe(100);
  });
});
