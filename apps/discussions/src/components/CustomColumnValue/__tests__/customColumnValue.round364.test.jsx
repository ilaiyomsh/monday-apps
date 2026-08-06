import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * round364 — the shared READ-ONLY renderer for custom-column values. Each
 * mapped type renders its parseValue shape; anything empty renders the muted
 * em-dash so a blank cell reads as intentionally empty.
 */

const { executeMock } = vi.hoisted(() => ({ executeMock: vi.fn() }));
vi.mock('@api/monday-client.js', () => ({ monday: { execute: executeMock } }));
vi.mock('@generated/components/PersonAvatar', () => ({
  PersonList: ({ people, max }) => (
    <span data-testid="person-list">{(people || []).slice(0, max).map((p) => p.name).join(',')}</span>
  ),
}));

import { CustomColumnValue } from '../CustomColumnValue.jsx';

beforeEach(() => {
  executeMock.mockReset();
});

describe('round364 — CustomColumnValue per type', () => {
  it('people → PersonList with the names; empty array → em-dash', () => {
    render(<CustomColumnValue type="people" value={[{ id: '1', name: 'דנה' }, { id: '2', name: 'יוסי' }]} />);
    expect(screen.getByTestId('person-list').textContent).toBe('דנה,יוסי');
    render(<CustomColumnValue type="people" value={[]} />);
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('date → DD/MM/YYYY, with the time suffix ONLY when the value carries hasTime', () => {
    const d = new Date(2026, 7, 6, 14, 30);
    d.hasTime = true;
    render(<CustomColumnValue type="date" value={d} />);
    expect(screen.getByText('06/08/2026 · 14:30')).toBeTruthy();
    const dateOnly = new Date(2026, 7, 6, 0, 0);
    render(<CustomColumnValue type="date" value={dateOnly} />);
    expect(screen.getByText('06/08/2026')).toBeTruthy();
  });

  it('board_relation → clickable chips (openItemCard) capped at 3 with a +N overflow', () => {
    const linked = [1, 2, 3, 4, 5].map((n) => ({ id: String(n), name: `פריט ${n}` }));
    render(<CustomColumnValue type="board_relation" value={{ linkedItems: linked, ids: [], text: null }} />);
    expect(screen.getByText('פריט 1')).toBeTruthy();
    expect(screen.queryByText('פריט 4')).toBe(null);
    expect(screen.getByText('+2')).toBeTruthy();
    fireEvent.click(screen.getByText('פריט 2'));
    expect(executeMock).toHaveBeenCalledWith('openItemCard', { itemId: 2, kind: 'updates' });
  });

  it('file → a link per URL, named by the decoded path tail', () => {
    render(<CustomColumnValue type="file" value="https://cdn.monday.com/files/1/%D7%A1%D7%99%D7%9B%D7%95%D7%9D.docx" />);
    const link = screen.getByText('סיכום.docx');
    expect(link.getAttribute('href')).toBe('https://cdn.monday.com/files/1/%D7%A1%D7%99%D7%9B%D7%95%D7%9D.docx');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('file text that is not a URL falls back to plain text', () => {
    render(<CustomColumnValue type="file" value="קובץ פנימי.pdf" />);
    expect(screen.getByText('קובץ פנימי.pdf').tagName).toBe('SPAN');
  });

  it('dropdown/text render the string; null and whitespace render the em-dash', () => {
    render(<CustomColumnValue type="dropdown" value="כספים" />);
    expect(screen.getByText('כספים')).toBeTruthy();
    const { container: c1 } = render(<CustomColumnValue type="text" value={null} />);
    expect(c1.textContent).toBe('—');
    const { container: c2 } = render(<CustomColumnValue type="long_text" value="   " />);
    expect(c2.textContent).toBe('—');
  });
});
