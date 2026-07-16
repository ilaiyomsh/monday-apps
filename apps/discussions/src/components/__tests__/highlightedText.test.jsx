import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { HighlightedText } from '../HighlightedText';

// HighlightedText wraps every case-insensitive occurrence of the search query
// with a highlighted <mark>, leaving the rest of the string as plain text —
// the visual "where did my search match" cue for server-side name searches.
describe('HighlightedText', () => {
  it('wraps the matched substring in a <mark>', () => {
    render(<span><HighlightedText text="למה זה קורה" query="למה" /></span>);
    const mark = screen.getByText('למה');
    expect(mark.tagName).toBe('MARK');
    // The rest of the text stays outside the mark
    expect(mark.parentElement).toHaveTextContent('למה זה קורה');
  });

  it('highlights ALL occurrences of the query', () => {
    const { container } = render(
      <span><HighlightedText text="למה למה למה" query="למה" /></span>
    );
    expect(container.querySelectorAll('mark')).toHaveLength(3);
  });

  it('matches case-insensitively for latin text', () => {
    const { container } = render(
      <span><HighlightedText text="Weekly Sync" query="week" /></span>
    );
    const marks = container.querySelectorAll('mark');
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe('Week');
  });

  it('renders plain text when the query is empty or has no match', () => {
    const { container: c1 } = render(
      <span><HighlightedText text="דיון שבועי" query="" /></span>
    );
    expect(c1.querySelectorAll('mark')).toHaveLength(0);
    expect(c1.textContent).toBe('דיון שבועי');

    const { container: c2 } = render(
      <span><HighlightedText text="דיון שבועי" query="חודשי" /></span>
    );
    expect(c2.querySelectorAll('mark')).toHaveLength(0);
    expect(c2.textContent).toBe('דיון שבועי');
  });

  it('tolerates null/undefined text', () => {
    const { container } = render(<span><HighlightedText text={null} query="x" /></span>);
    expect(container.textContent).toBe('');
  });
});
