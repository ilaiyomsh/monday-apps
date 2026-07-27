// TDD red phase (V6 T8) — src/helpers/digest-plain.js, the NON-ACTIONABLE
// text/plain part of the digest (spec V6 §5). The hard requirement is
// negative space: NO links, NO signatures, NO credential of any kind —
// leaving a /confirm-style link here would undo D2 and D3.

import { describe, it, expect } from 'vitest';
import { renderDigestPlain } from '../src/helpers/digest-plain.js';

const RECIPIENT = {
  email: 'dana@example.com',
  name: 'דנה כהן',
  personId: '501',
  taskCount: 3,
  sections: [
    {
      sectionId: 's_start001',
      title: 'משימות שנדרש להתחיל:',
      dateColumnTitle: 'תאריך התחלה',
      buttonId: 'b_start001',
      tasks: [
        { itemId: '9001', name: 'גיבוש תכנית עבודה', date: '2026-07-10', statusText: 'בעבודה' },
        { itemId: '9003', name: 'סקירת יעדים', date: '2026-07-12', statusText: '' },
      ],
    },
    {
      sectionId: 's_done0001',
      title: 'משימות שנדרש לסיים:',
      dateColumnTitle: 'תאריך סיום',
      buttonId: 'b_done0001',
      tasks: [{ itemId: '9002', name: 'הגשת דוח רבעוני', date: '2026-07-01', statusText: 'בעבודה' }],
    },
  ],
};

const render = (recipient = RECIPIENT) => renderDigestPlain({ recipient });

describe('renderDigestPlain — content', () => {
  it("greets the recipient by name: 'שלום דנה כהן'", () => {
    expect(render()).toContain('שלום דנה כהן');
  });

  it('renders every section title', () => {
    const text = render();
    expect(text).toContain('משימות שנדרש להתחיל:');
    expect(text).toContain('משימות שנדרש לסיים:');
  });

  it('renders every task name', () => {
    const text = render();
    expect(text).toContain('גיבוש תכנית עבודה');
    expect(text).toContain('סקירת יעדים');
    expect(text).toContain('הגשת דוח רבעוני');
  });

  it('renders each task date as DD/MM/YYYY under its section date-column header', () => {
    const text = render();
    expect(text).toContain('תאריך התחלה: 10/07/2026');
    expect(text).toContain('תאריך סיום: 01/07/2026');
  });

  it('renders the status text when present and omits the status part when empty', () => {
    const text = render();
    expect(text).toContain('סטטוס: בעבודה');
    const noStatusLine = text.split('\n').find((l) => l.includes('סקירת יעדים'));
    expect(noStatusLine).toBeDefined();
    expect(noStatusLine).not.toContain('סטטוס:');
  });

  it("ends with the ONE pointer line: update in monday.com ('לעדכון המשימות היכנסו ל‑monday.com')", () => {
    expect(render()).toContain('לעדכון המשימות היכנסו ל‑monday.com');
  });

  it('renders a task with an unset date without a date value (no "null"/"undefined" text)', () => {
    const text = render({
      ...RECIPIENT,
      sections: [
        {
          ...RECIPIENT.sections[0],
          tasks: [{ itemId: '9009', name: 'בלי תאריך', date: null, statusText: '' }],
        },
      ],
    });
    expect(text).toContain('בלי תאריך');
    expect(text).not.toContain('null');
    expect(text).not.toContain('undefined');
  });
});

describe('renderDigestPlain — the negative-space contract (no credential of any kind)', () => {
  it('contains NO http/https URL anywhere', () => {
    const text = render();
    expect(text).not.toContain('http://');
    expect(text).not.toContain('https://');
  });

  it('contains NO /confirm path and NO query-parameter shapes (k=, sig=, btn=, itemId=)', () => {
    const text = render();
    expect(text).not.toContain('/confirm');
    expect(text).not.toContain('k=');
    expect(text).not.toContain('sig=');
    expect(text).not.toContain('btn=');
    expect(text).not.toContain('itemId=');
  });

  it('contains NO HTML tags (it is a text/plain part)', () => {
    expect(render()).not.toMatch(/<[a-z!/]/i);
  });

  it('does not leak internal ids: no item ids, no button ids, no person id', () => {
    const text = render();
    expect(text).not.toContain('9001');
    expect(text).not.toContain('b_start001');
    expect(text).not.toContain('501');
  });
});
