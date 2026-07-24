import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import EmptyState from '../EmptyState.jsx';
import styles from '../EmptyState.module.css';

// CSS Modules run non-scoped here (classNameStrategy: 'non-scoped'), so the
// imported `styles.*` values are the literal class names emitted into the DOM.

describe('EmptyState — the shared view-level empty/not-found message', () => {
  it('renders its children as the centered message', () => {
    render(<EmptyState>לא נמצאו דיונים</EmptyState>);
    const text = screen.getByText('לא נמצאו דיונים');
    expect(text).toBeTruthy();
    // The message sits inside the dedicated big-text element.
    expect(text.className).toContain(styles.emptyStateText);
  });

  it('always applies the root class', () => {
    const { container } = render(<EmptyState>הודעה</EmptyState>);
    const root = container.querySelector(`.${styles.emptyStateRoot}`);
    expect(root).toBeTruthy();
  });

  it('does NOT apply the bleed modifier by default', () => {
    const { container } = render(<EmptyState>הודעה</EmptyState>);
    expect(container.querySelector(`.${styles.emptyStateBleedStart}`)).toBeNull();
  });

  it('applies the bleed modifier only when bleedStart is set', () => {
    const { container } = render(<EmptyState bleedStart>הודעה</EmptyState>);
    expect(container.querySelector(`.${styles.emptyStateBleedStart}`)).toBeTruthy();
  });

  it('appends a caller-supplied className without dropping the root class', () => {
    const { container } = render(<EmptyState className="parentTweak">הודעה</EmptyState>);
    const root = container.querySelector(`.${styles.emptyStateRoot}`);
    expect(root).toBeTruthy();
    expect(root.className).toContain('parentTweak');
  });

  it('renders an icon above the message only when provided', () => {
    const { container, rerender } = render(<EmptyState>הודעה</EmptyState>);
    expect(container.querySelector(`.${styles.emptyStateIcon}`)).toBeNull();
    rerender(<EmptyState icon={<svg data-testid="ic" />}>הודעה</EmptyState>);
    expect(container.querySelector(`.${styles.emptyStateIcon}`)).toBeTruthy();
    expect(screen.getByTestId('ic')).toBeTruthy();
  });
});
