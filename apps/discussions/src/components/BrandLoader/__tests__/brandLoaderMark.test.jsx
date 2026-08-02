import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { BrandLoader, SPIN } from '../BrandLoader.jsx';
import { SettingsContext } from '../../../contexts/SettingsContext.jsx';

/*
 * round307 (owner spec, tuned on the interactive mockup) — three changes to the
 * loading splash, and this file is what keeps them from silently regressing.
 * It REPLACES brandLoaderSlices.test.jsx, which guarded the opposite design:
 * that the disc reads as 8 wedges. The owner asked for a solid disc, so the old
 * guard was pinning the very thing being removed.
 *
 *   1. the instance's logo, ABOVE the mark, from settings.preferences.logoUrl
 *   2. a SOLID disc — no white radial cuts
 *   3. one continuous roulette throw instead of six stepped hops
 */

// Mount inside a settings provider carrying `preferences`, the way the app does.
const withSettings = (preferences, ui) => render(
  <SettingsContext.Provider
    value={{ settings: { preferences }, permissions: {}, isConfigured: true, isLoading: false, updateSettings: async () => null }}
  >
    {ui}
  </SettingsContext.Provider>
);

const LOGO = 'data:image/png;base64,iVBORw0KGgo=';

describe('the disc is SOLID (round307 §2)', () => {
  it('draws no radial cut lines at all', () => {
    const { container } = render(<BrandLoader />);
    expect(container.querySelectorAll('line').length).toBe(0);
  });

  it('still draws the gradient disc and its outline ring', () => {
    const { container } = render(<BrandLoader />);
    const circles = [...container.querySelectorAll('circle')];
    // the filled disc…
    expect(circles.some((c) => c.getAttribute('fill') === 'url(#twystLoaderGrad)')).toBe(true);
    // …and the ring drawn on top of it
    expect(circles.some((c) => c.getAttribute('stroke') === 'url(#twystLoaderGrad)')).toBe(true);
  });
});

describe("the instance's logo sits ABOVE the mark (round307 §1)", () => {
  it('renders the logo from settings.preferences.logoUrl', () => {
    const { container } = withSettings({ logoUrl: LOGO }, <BrandLoader />);
    const img = container.querySelector('img');
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe(LOGO);
  });

  it('places it BEFORE the mark in the DOM (above it in the column)', () => {
    const { container } = withSettings({ logoUrl: LOGO }, <BrandLoader />);
    const kids = [...container.querySelector('.inner').children];
    expect(kids.findIndex((n) => n.tagName.toLowerCase() === 'img'))
      .toBeLessThan(kids.findIndex((n) => n.tagName.toLowerCase() === 'svg'));
  });

  it('renders NO image when the instance has no logo — unchanged from today', () => {
    const { container } = withSettings({ logoUrl: null }, <BrandLoader />);
    expect(container.querySelector('img')).toBeNull();
  });

  it('renders no image outside a settings provider, and does not throw', () => {
    const { container } = render(<BrandLoader />);
    expect(container.querySelector('img')).toBeNull();
  });

  it('lets an explicit prop override the stored logo (settings preview)', () => {
    const { container } = withSettings({ logoUrl: LOGO }, <BrandLoader logoUrl={null} />);
    expect(container.querySelector('img')).toBeNull();
  });

  it('is decorative: empty alt, because the status role already announces "טוען"', () => {
    const { container, getByRole } = withSettings({ logoUrl: LOGO }, <BrandLoader />);
    expect(container.querySelector('img').getAttribute('alt')).toBe('');
    expect(getByRole('status', { name: 'טוען' })).toBeTruthy();
  });
});

describe('the roulette spin (round307 §3)', () => {
  it('carries the owner-tuned numbers: 4200ms, 1200° of sweep', () => {
    // 1200° = 3⅓ turns AND a multiple of 120°, so a throw always lands a figure
    // back on a seat — the three sit 120° apart.
    expect(SPIN.cycleMs).toBe(4200);
    expect(SPIN.sweepDeg).toBe(1200);
    expect(SPIN.sweepDeg % 120).toBe(0);
  });

  it('decelerates: the easing keeps 18% of its speed at the end, and never stops dead', () => {
    // cubic-bezier(x1,y1,x2,y2): final slope = (1-y2)/(1-x2). 0.072/0.4 = 0.18,
    // i.e. the 82% deceleration depth the owner picked. A dead stop (slope 0)
    // would make the next throw start with a visible jump in speed.
    const m = SPIN.easing.match(/cubic-bezier\(([^)]+)\)/);
    expect(m).toBeTruthy();
    const [x1, y1, x2, y2] = m[1].split(',').map((n) => Number(n.trim()));
    const endSlope = (1 - y2) / (1 - x2);
    expect(endSlope).toBeCloseTo(0.18, 2);
    expect(endSlope).toBeGreaterThan(0);
    // …and it starts FAST: initial slope = y1/x1 must exceed the average (1).
    expect(y1 / x1).toBeGreaterThan(1);
  });

  it('publishes all three as custom properties the stylesheet consumes', () => {
    const { container } = render(<BrandLoader />);
    const svg = container.querySelector('svg');
    expect(svg.style.getPropertyValue('--bl-spin-cycle')).toBe('4200ms');
    expect(svg.style.getPropertyValue('--bl-spin-sweep')).toBe('1200deg');
    expect(svg.style.getPropertyValue('--bl-spin-ease')).toBe(SPIN.easing);
  });
});

describe('nothing else about the splash moved', () => {
  it('keeps the status role and the "Meetings" wordmark', () => {
    const { getByRole, getByText } = render(<BrandLoader />);
    expect(getByRole('status', { name: 'טוען' })).toBeTruthy();
    expect(getByText('Meetings')).toBeTruthy();
    expect(getByText('Powered by twyst')).toBeTruthy();
  });

  it('honours the fullscreen variant', () => {
    const { container } = render(<BrandLoader fullscreen />);
    expect(container.firstChild.className).toBe('brandLoaderFull');
  });
});
