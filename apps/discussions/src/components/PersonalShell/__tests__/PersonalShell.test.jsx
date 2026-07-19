import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PersonalShell } from '../PersonalShell';

describe('PersonalShell', () => {
  it('renders the three mode tabs and marks the active one selected', () => {
    render(
      <PersonalShell activeMode="myDecisions" onSelectMode={() => {}} onBack={() => {}}>
        <div>content</div>
      </PersonalShell>
    );
    const tasks = screen.getByRole('tab', { name: 'המשימות שלי' });
    const decisions = screen.getByRole('tab', { name: 'ההחלטות שלי' });
    const dashboard = screen.getByRole('tab', { name: 'דשבורד' });
    // Exactly the active mode reports aria-selected="true".
    expect(decisions.getAttribute('aria-selected')).toBe('true');
    expect(tasks.getAttribute('aria-selected')).toBe('false');
    expect(dashboard.getAttribute('aria-selected')).toBe('false');
  });

  it('calls onSelectMode with the clicked mode id', () => {
    const onSelectMode = vi.fn();
    render(
      <PersonalShell activeMode="myTasks" onSelectMode={onSelectMode} onBack={() => {}}>
        <div>content</div>
      </PersonalShell>
    );
    fireEvent.click(screen.getByRole('tab', { name: 'דשבורד' }));
    expect(onSelectMode).toHaveBeenCalledWith('dashboard');
  });

  it('calls onBack when the back button is clicked', () => {
    const onBack = vi.fn();
    render(
      <PersonalShell activeMode="myTasks" onSelectMode={() => {}} onBack={onBack}>
        <div>content</div>
      </PersonalShell>
    );
    fireEvent.click(screen.getByRole('button', { name: 'חזרה לאזור הדיונים' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('renders the embedded child content', () => {
    render(
      <PersonalShell activeMode="myTasks" onSelectMode={() => {}} onBack={() => {}}>
        <div>my-embedded-view</div>
      </PersonalShell>
    );
    expect(screen.getByText('my-embedded-view')).toBeInTheDocument();
  });
});
