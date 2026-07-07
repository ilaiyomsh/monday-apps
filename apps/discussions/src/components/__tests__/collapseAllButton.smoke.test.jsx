import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CollapseAllButton } from '@generated/components/CollapseAllButton';

describe('CollapseAllButton', () => {
  it('shows the collapse label as aria-label when not collapsed', () => {
    render(<CollapseAllButton collapsed={false} onClick={() => {}} />);
    expect(screen.getByLabelText('קפל הכל')).toBeTruthy();
  });

  it('shows the expand label as aria-label when collapsed', () => {
    render(<CollapseAllButton collapsed={true} onClick={() => {}} />);
    expect(screen.getByLabelText('פתח הכל')).toBeTruthy();
  });

  it('honors custom labels', () => {
    render(
      <CollapseAllButton
        collapsed={false}
        onClick={() => {}}
        collapseLabel="קפל"
        expandLabel="פתח"
      />,
    );
    expect(screen.getByLabelText('קפל')).toBeTruthy();
  });

  it('fires onClick when pressed', () => {
    const onClick = vi.fn();
    render(<CollapseAllButton collapsed={false} onClick={onClick} />);
    fireEvent.click(screen.getByLabelText('קפל הכל'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
