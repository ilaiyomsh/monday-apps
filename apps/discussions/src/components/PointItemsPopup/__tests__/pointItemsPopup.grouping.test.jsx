import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { PointItemsPopup } from '../PointItemsPopup.jsx';

const POINT = { id: 'p1', name: 'מעבר על הנחיות קודמות' };

function renderOutputs(items) {
  return render(
    <PointItemsPopup open kind="outputs" point={POINT} items={items} onClose={() => {}} />
  );
}

describe('PointItemsPopup — grouped תוצרים (round262)', () => {
  it('groups by kind: a משימות heading + tasks, then a החלטות heading + decisions, in that order', () => {
    renderOutputs([
      { id: 't1', name: 'משימה א', _outKind: 'task' },
      { id: 'd1', name: 'החלטה א', _outKind: 'decision' },
      { id: 't2', name: 'משימה ב', _outKind: 'task' },
      { id: 'd2', name: 'החלטה ב', _outKind: 'decision' },
    ]);
    const heads = [...document.querySelectorAll('.groupHead')].map((el) => el.textContent);
    expect(heads).toEqual(['משימות', 'החלטות']);

    // tasks live under the first group, decisions under the second.
    const groups = document.querySelectorAll('.group');
    expect(groups).toHaveLength(2);
    const textsOf = (g) => [...g.querySelectorAll('.text')].map((el) => el.textContent);
    expect(textsOf(groups[0])).toEqual(['משימה א', 'משימה ב']);
    expect(textsOf(groups[1])).toEqual(['החלטה א', 'החלטה ב']);

    // the whole משימות section precedes the whole החלטות section in the DOM.
    const before = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(before(groups[0], groups[1])).toBe(true);
  });

  it('omits a section heading when that kind has no items', () => {
    renderOutputs([
      { id: 't1', name: 'משימה יחידה', _outKind: 'task' },
    ]);
    const heads = [...document.querySelectorAll('.groupHead')].map((el) => el.textContent);
    expect(heads).toEqual(['משימות']); // no "החלטות" heading when there are no decisions
  });

  it('shows the empty note when there are no outputs at all', () => {
    renderOutputs([]);
    expect(document.querySelector('.groupHead')).toBeNull();
    expect(document.querySelector('.empty')).toBeTruthy();
  });
});
