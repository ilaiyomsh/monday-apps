// v4 digest email renderer contract — email-client-safe HTML with REAL
// /confirm hrefs (v3 link mechanism). NO JS in email bodies, full RTL.

import { describe, it, expect } from 'vitest';
import { renderDigestEmail } from '../src/helpers/digest-email.js';

const BUTTON_DONE = {
  id: 'b_done0001',
  name: 'עדכן: בוצע',
  statusColumnId: 'status_b',
  targetIndex: 1,
  targetLabel: 'בוצע',
  style: { color: '#00854d', icon: '✓', size: 'sm' },
};

function recipient(overrides = {}) {
  return {
    email: 'dana@example.com',
    name: 'דנה כהן',
    personIds: ['501'],
    taskCount: 1,
    sections: [
      {
        sectionId: 's_done0001',
        title: 'משימות שנדרש לסיים וטרם בוצעו:',
        dateColumnTitle: 'תאריך יעד',
        buttonId: 'b_done0001',
        button: BUTTON_DONE,
        tasks: [{ itemId: '9002', name: 'הגשת דוח רבעוני', date: '2026-07-01', statusText: 'בעבודה' }],
      },
    ],
    ...overrides,
  };
}

function render(overrides = {}) {
  return renderDigestEmail({
    baseUrl: 'https://app.example',
    secret: 'SECRET43',
    accountId: '777',
    recipient: recipient(),
    ...overrides,
  });
}

describe('renderDigestEmail', () => {
  it('carries a REAL /confirm href per task: itemId + a + k + btn, &-escaped as &amp;', () => {
    const html = render();
    expect(html).toContain(
      'https://app.example/confirm?itemId=9002&amp;a=777&amp;k=SECRET43&amp;btn=b_done0001'
    );
  });

  it('renders greeting with the recipient name, the section title, task name, status text and a DD/MM/YYYY date', () => {
    const html = render();
    expect(html).toContain('דנה כהן');
    expect(html).toContain('משימות שנדרש לסיים וטרם בוצעו:');
    expect(html).toContain('הגשת דוח רבעוני');
    expect(html).toContain('בעבודה');
    expect(html).toContain('01/07/2026');
  });

  it('the date column header is the ORIGINAL board column title (dateColumnTitle), not a generic label', () => {
    const html = render();
    expect(html).toContain('תאריך יעד');
  });

  it('falls back to a generic "תאריך" header when dateColumnTitle is empty', () => {
    const r = recipient();
    r.sections[0].dateColumnTitle = '';
    const html = render({ recipient: r });
    expect(html).toContain('תאריך');
  });

  it('HTML-escapes the date column title (no raw injected markup)', () => {
    const r = recipient();
    r.sections[0].dateColumnTitle = '<b>x</b>';
    const html = render({ recipient: r });
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
  });

  it('is email-safe: rtl direction everywhere, button colored per style, and NO <script> tag', () => {
    const html = render();
    expect(html).toMatch(/dir="rtl"/);
    expect(html).toContain('#00854d');
    expect(html).not.toMatch(/<script\b/i);
  });

  it('HTML-escapes task and recipient names (no raw injected markup)', () => {
    const r = recipient();
    r.name = 'דנה <img src=x>';
    r.sections[0].tasks[0].name = '<script>alert(1)</script>';
    const html = render({ recipient: r });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<img src=x>');
  });

  it('skips a section that arrives with zero tasks (defensive)', () => {
    const r = recipient();
    r.sections.push({
      sectionId: 's_start001',
      title: 'ריקה',
      buttonId: 'b_start001',
      button: { ...BUTTON_DONE, id: 'b_start001', name: 'עדכן: התחלתי' },
      tasks: [],
    });
    const html = render({ recipient: r });
    expect(html).not.toContain('ריקה');
  });

  it('a task without a date renders an empty date cell, not "null"', () => {
    const r = recipient();
    r.sections[0].tasks[0].date = null;
    const html = render({ recipient: r });
    expect(html).not.toContain('null');
  });
});
