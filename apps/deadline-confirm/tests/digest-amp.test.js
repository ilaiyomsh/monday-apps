// TDD red phase (V5) — the amp4email digest renderer.
//
// This is the `text/x-amp-html` MIME part of the digest: Gmail renders it as
// dynamic email and the reader ticks checkboxes and submits ONE form per
// section, straight from the message. The static `text/html` part
// (helpers/digest-email.js) stays the universal fallback and is unchanged.
//
// Format rules pinned here come from the AMP for Email spec (amp-email-format /
// amp-email-components / amp-form):
//   - doctype + <html amp4email> + <meta charset> first in head + boilerplate
//   - only cdn.ampproject.org scripts (custom JS is invalid AMP → email is
//     dropped to the HTML fallback, silently)
//   - POST forms use action-xhr; `target`/`action` are website-only
//   - responses render through <template type="amp-mustache">
// Security: the link secret rides in hidden inputs only — the AMP part never
// contains a clickable URL carrying it (a forwarded screenshot/link cannot leak
// it, and Gmail strips this part on forward anyway).

import { describe, it, expect } from 'vitest';
import { renderDigestAmp } from '../src/helpers/digest-amp.js';

const BASE = 'https://app.example';
const SECRET = 'wJalrXUtnFEMIK7MDENGbPxRfiCY_EXAMPLEKEY-43x';
const ACCOUNT = '777';

const BTN_START = {
  id: 'b_start001',
  name: 'התחלתי',
  statusColumnId: 'color_x',
  targetIndex: 0,
  targetLabel: 'בעבודה',
  style: { color: '#fdab3d', icon: '▶', size: 'md' },
};
const BTN_DONE = {
  id: 'b_done0002',
  name: 'בוצע',
  statusColumnId: 'color_x',
  targetIndex: 1,
  targetLabel: 'בוצע',
  style: { color: '#00854d', icon: '✓', size: 'md' },
};

const RECIPIENT = {
  email: 'dana@example.com',
  name: 'דנה',
  taskCount: 3,
  sections: [
    {
      title: 'משימות שנדרש להתחיל',
      buttonId: BTN_START.id,
      button: BTN_START,
      dateColumnTitle: 'תאריך התחלה מתוכנן',
      tasks: [
        { itemId: '9001', name: 'גיבוש תכנית עבודה', date: '2026-03-01', statusText: 'טרם החל' },
        { itemId: '9002', name: 'הקמת פורום <נציגים>', date: '2026-03-15', statusText: '' },
      ],
    },
    {
      title: 'משימות שנדרש לסיים',
      buttonId: BTN_DONE.id,
      button: BTN_DONE,
      dateColumnTitle: 'דדליין',
      tasks: [{ itemId: '9004', name: 'דוח רבעוני', date: '2026-02-28', statusText: 'בעבודה' }],
    },
    {
      title: 'קבוצה ריקה',
      buttonId: BTN_DONE.id,
      button: BTN_DONE,
      dateColumnTitle: 'דדליין',
      tasks: [],
    },
  ],
};

const render = (recipient = RECIPIENT) =>
  renderDigestAmp({ baseUrl: BASE, secret: SECRET, accountId: ACCOUNT, recipient });

describe('renderDigestAmp — amp4email document validity', () => {
  it('opens with the doctype and the amp4email html tag', () => {
    const doc = render();
    expect(doc.startsWith('<!doctype html>')).toBe(true);
    expect(doc).toContain('<html amp4email');
  });

  it('puts <meta charset="utf-8"> as the first child of <head>', () => {
    const doc = render();
    expect(doc).toMatch(/<head>\s*<meta charset="utf-8">/);
  });

  it('carries the amp4email boilerplate style', () => {
    expect(render()).toContain('<style amp4email-boilerplate>body{visibility:hidden}</style>');
  });

  it('loads the AMP runtime plus the amp-form and amp-mustache extensions', () => {
    const doc = render();
    expect(doc).toContain('<script async src="https://cdn.ampproject.org/v0.js"></script>');
    expect(doc).toContain('custom-element="amp-form"');
    expect(doc).toContain('custom-template="amp-mustache"');
  });

  it('contains no script that is not served from the AMP CDN', () => {
    const doc = render();
    const scripts = doc.match(/<script[^>]*>/g) ?? [];
    expect(scripts.length).toBeGreaterThan(0);
    for (const tag of scripts) {
      expect(tag).toContain('src="https://cdn.ampproject.org/');
    }
  });

  it('declares exactly one amp-custom style block', () => {
    const doc = render();
    expect((doc.match(/<style amp-custom>/g) ?? []).length).toBe(1);
  });

  it('stays well under the 200,000-byte AMP part limit', () => {
    expect(Buffer.byteLength(render(), 'utf8')).toBeLessThan(200_000);
  });
});

describe('renderDigestAmp — one form per populated section', () => {
  it('renders a form per section that has tasks and drops empty sections', () => {
    const doc = render();
    expect((doc.match(/<form /g) ?? []).length).toBe(2);
    expect(doc).not.toContain('קבוצה ריקה');
  });

  it('posts to the /amp/confirm endpoint via action-xhr', () => {
    expect(render()).toContain(`action-xhr="${BASE}/amp/confirm"`);
  });

  it('uses POST with urlencoded enctype so the server can parse the body', () => {
    const doc = render();
    expect(doc).toContain('method="post"');
    expect(doc).toContain('enctype="application/x-www-form-urlencoded"');
  });

  it('omits the website-only target and action attributes', () => {
    const doc = render();
    expect(doc).not.toContain('target=');
    expect(doc).not.toMatch(/\saction="/);
  });

  it('carries account, secret and button id as hidden inputs in every form', () => {
    const doc = render();
    expect((doc.match(/name="a" value="777"/g) ?? []).length).toBe(2);
    expect((doc.match(new RegExp(`name="k" value="${SECRET}"`, 'g')) ?? []).length).toBe(2);
    expect(doc).toContain(`name="btn" value="${BTN_START.id}"`);
    expect(doc).toContain(`name="btn" value="${BTN_DONE.id}"`);
  });

  it('never exposes the secret inside a URL', () => {
    const doc = render();
    expect(doc).not.toContain(`?itemId=`);
    expect(doc).not.toMatch(new RegExp(`href="[^"]*${SECRET}`));
  });
});

describe('renderDigestAmp — task rows', () => {
  it('renders one unchecked checkbox per task, valued by item id', () => {
    const doc = render();
    expect((doc.match(/type="checkbox"/g) ?? []).length).toBe(3);
    expect(doc).toContain('name="item" value="9001"');
    expect(doc).toContain('name="item" value="9002"');
    expect(doc).toContain('name="item" value="9004"');
    expect(doc).not.toContain('checked');
  });

  it('shows the task name, the formatted date and the current status', () => {
    const doc = render();
    expect(doc).toContain('גיבוש תכנית עבודה');
    expect(doc).toContain('01/03/2026');
    expect(doc).toContain('טרם החל');
  });

  it('uses the original board column title as the date header', () => {
    const doc = render();
    expect(doc).toContain('תאריך התחלה מתוכנן');
    expect(doc).toContain('דדליין');
  });

  it('escapes HTML in task and section titles', () => {
    const doc = render();
    expect(doc).toContain('הקמת פורום &lt;נציגים&gt;');
    expect(doc).not.toContain('<נציגים>');
  });

  it('labels the submit button with the section button name', () => {
    const doc = render();
    expect(doc).toContain(BTN_START.name);
    expect(doc).toContain(BTN_DONE.name);
  });
});

describe('renderDigestAmp — response rendering', () => {
  it('provides amp-mustache templates for both success and error', () => {
    const doc = render();
    expect((doc.match(/<div submit-success>/g) ?? []).length).toBe(2);
    expect((doc.match(/<div submit-error>/g) ?? []).length).toBe(2);
    expect((doc.match(/<template type="amp-mustache">/g) ?? []).length).toBe(4);
  });

  it('renders the server message inside the templates', () => {
    expect(render()).toContain('{{message}}');
  });

  it('greets the recipient by name', () => {
    expect(render()).toContain('דנה');
  });
});
