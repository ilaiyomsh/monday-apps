import { describe, expect, it, vi } from 'vitest';
import { normalizeRenderedDocxRtl } from '../exportPreviewRtl.js';

describe('normalizeRenderedDocxRtl', () => {
  it('right-aligns Hebrew body text even when docx-preview supplied left/start alignment', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <section class="docx">
        <header><p data-testid="header" style="direction: rtl; text-align: left">כותרת</p></header>
        <article>
          <p data-testid="left" style="direction: rtl; text-align: left">טקסט רקע בעברית</p>
          <p data-testid="start" style="text-align: start">טקסט התייחסויות בעברית</p>
          <p data-testid="natural">טקסט סיכום בעברית</p>
          <p data-testid="center" style="text-align: center">כותרת ממורכזת</p>
          <p data-testid="english" style="direction: ltr; text-align: left">English body text</p>
        </article>
        <footer><p data-testid="footer" style="direction: rtl; text-align: left">כותרת תחתונה</p></footer>
      </section>
    `;

    normalizeRenderedDocxRtl(root);

    for (const id of ['left', 'start', 'natural']) {
      const el = root.querySelector(`[data-testid="${id}"]`);
      expect(el.style.direction).toBe('rtl');
      expect(el.style.textAlign).toBe('right');
    }

    expect(root.querySelector('[data-testid="center"]').style.textAlign).toBe('center');
    expect(root.querySelector('[data-testid="english"]').style.textAlign).toBe('left');
    expect(root.querySelector('[data-testid="header"]').style.textAlign).toBe('left');
    expect(root.querySelector('[data-testid="footer"]').style.textAlign).toBe('left');
  });

  it('writes RTL declarations with important priority so preview styles cannot override them', () => {
    const style = {
      textAlign: 'left',
      removeProperty: vi.fn(),
      setProperty: vi.fn(),
    };
    const root = {
      querySelectorAll: vi.fn(() => [{ textContent: 'סיכום בעברית', style }]),
    };

    normalizeRenderedDocxRtl(root);

    expect(style.setProperty).toHaveBeenNthCalledWith(1, 'direction', 'rtl', 'important');
    expect(style.setProperty).toHaveBeenNthCalledWith(2, 'text-align', 'right', 'important');
  });
});
