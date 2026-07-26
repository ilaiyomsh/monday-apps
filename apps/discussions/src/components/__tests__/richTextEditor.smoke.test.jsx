import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import RichTextEditor from '../RichTextEditor';

// Mounts the REAL TipTap editor (StarterKit + TextDirection) to catch
// extension/config errors that compile but throw at runtime.
describe('RichTextEditor (real TipTap)', () => {
  it('mounts with initial content and renders the toolbar', async () => {
    render(<RichTextEditor initialValue="<p>שלום עולם</p>" placeholder="כתוב…" />);
    expect(await screen.findByText('שלום עולם')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'מודגש' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'קו תחתון' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'קו חוצה' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'רשימת תבליטים' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'רשימה ממוספרת' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'צ׳קליסט' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'צבע טקסט' })).toBeInTheDocument();
    // round253 — link moved OFF the toolbar into the selection bubble (which is
    // not mounted without a selection), so the static toolbar no longer has it.
    expect(screen.queryByRole('button', { name: 'קישור' })).toBeNull();
  });

  it('reports its initial HTML through onReady', async () => {
    let ready = null;
    render(<RichTextEditor initialValue="<p>טקסט</p>" onReady={(h) => { ready = h; }} />);
    await screen.findByText('טקסט');
    expect(ready).toContain('טקסט');
  });
});
