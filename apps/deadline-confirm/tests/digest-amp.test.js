// TDD (V6 T15 / D9) — amp4email digest: one multi-button table, one global submit.
//
// Wire format unchanged: hidden a/p/m/s/sig; selections as item_<itemId>=btnId.
// Layout: one form for the whole message; one column per button; one submit.

import { describe, it, expect } from 'vitest';
import { renderDigestAmp } from '../src/helpers/digest-amp.js';
import { buildManifest, signManifest, currentSlot } from '../src/services/manifest-signature.js';

const BASE = 'https://app.example';
const SECRET = 'wJalrXUtnFEMIK7MDENGbPxRfiCY_EXAMPLEKEY-43x';
const ACCOUNT = '777';
const PERSON_ID = '48274917';
const SEND_HOUR = 8;
const NOW = new Date('2026-07-28T09:00:00Z'); // 12:00 Asia/Jerusalem (IDT)
const SLOT = currentSlot({ sendHour: SEND_HOUR, now: NOW });

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
  personId: PERSON_ID,
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

const MANIFEST = buildManifest([
  { itemId: '9001', btnId: BTN_START.id },
  { itemId: '9002', btnId: BTN_START.id },
  { itemId: '9004', btnId: BTN_DONE.id },
]);
const SIG = signManifest({
  secret: SECRET,
  accountId: ACCOUNT,
  personId: PERSON_ID,
  slot: SLOT,
  manifest: MANIFEST,
});

const render = (recipient = RECIPIENT) =>
  renderDigestAmp({
    baseUrl: BASE,
    secret: SECRET,
    accountId: ACCOUNT,
    recipient,
    sendHour: SEND_HOUR,
    now: NOW,
  });

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

describe('renderDigestAmp — one global form (D9)', () => {
  it('renders exactly one form for the whole message', () => {
    expect((render().match(/<form /g) ?? []).length).toBe(1);
  });

  it('renders exactly one submit control', () => {
    expect((render().match(/type="submit"/g) ?? []).length).toBe(1);
  });

  it('labels the single submit as אשר את המסומנות without a per-section status prefix', () => {
    const doc = render();
    expect(doc).toMatch(/type="submit"[^>]*value="אשר את המסומנות"/);
    expect(doc).not.toContain('התחלתי — אשר');
    expect(doc).not.toContain('בוצע — אשר');
  });

  it('drops empty sections and does not render per-section group boxes', () => {
    const doc = render();
    expect(doc).not.toContain('קבוצה ריקה');
    expect(doc).not.toContain('class="grp"');
    expect(doc).not.toContain('משימות שנדרש להתחיל');
    expect(doc).not.toContain('משימות שנדרש לסיים');
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

  it('carries the V6 signed-manifest hidden fields exactly once (a, p, m, s, sig)', () => {
    const doc = render();
    expect((doc.match(new RegExp(`name="a" value="${ACCOUNT}"`, 'g')) ?? []).length).toBe(1);
    expect((doc.match(new RegExp(`name="p" value="${PERSON_ID}"`, 'g')) ?? []).length).toBe(1);
    expect((doc.match(new RegExp(`name="m" value="${MANIFEST}"`, 'g')) ?? []).length).toBe(1);
    expect((doc.match(new RegExp(`name="s" value="${SLOT}"`, 'g')) ?? []).length).toBe(1);
    expect((doc.match(new RegExp(`name="sig" value="${SIG}"`, 'g')) ?? []).length).toBe(1);
  });

  it('never carries the V5 k or btn fields and never exposes the base secret', () => {
    const doc = render();
    expect(doc).not.toContain('name="k"');
    expect(doc).not.toContain('name="btn"');
    expect(doc).not.toContain(`value="${SECRET}"`);
  });

  it('never exposes credentials inside a URL', () => {
    const doc = render();
    expect(doc).not.toContain('?itemId=');
    expect(doc).not.toMatch(new RegExp(`href="[^"]*${SECRET}`));
  });

  it('tells the reader to mark tasks and use the single approve button', () => {
    const doc = render();
    expect(doc).toContain('סמנו');
    expect(doc).toContain('אישור');
    expect(doc).not.toContain('שמתחת לכל קבוצה');
  });
});

describe('renderDigestAmp — multi-button table rows', () => {
  it('renders one table with a column header per button targetLabel', () => {
    const doc = render();
    expect((doc.match(/<table>/g) ?? []).length).toBe(1);
    expect(doc).toContain(`<th class="pick">&#8207;${BTN_START.targetLabel}</th>`);
    expect(doc).toContain(`<th class="pick">&#8207;${BTN_DONE.targetLabel}</th>`);
    expect(doc).toContain('שם הפעולה');
    expect(doc).toContain('תאריך');
    expect(doc).toContain('סטטוס');
  });

  it('renders one unchecked radio per (task, offered button) with item_<itemId> name and btnId value', () => {
    const doc = render();
    expect((doc.match(/type="radio"/g) ?? []).length).toBe(3);
    expect(doc).toContain(`name="item_9001" value="${BTN_START.id}"`);
    expect(doc).toContain(`name="item_9002" value="${BTN_START.id}"`);
    expect(doc).toContain(`name="item_9004" value="${BTN_DONE.id}"`);
    expect(doc).not.toContain(`name="item_9001" value="${BTN_DONE.id}"`);
    expect(doc).not.toContain(`name="item_9004" value="${BTN_START.id}"`);
    expect(doc).not.toContain('checked');
  });

  it('offers both button radios on one row when the same task appears under two sections', () => {
    const dual = {
      ...RECIPIENT,
      sections: [
        {
          title: 'התחלה',
          buttonId: BTN_START.id,
          button: BTN_START,
          dateColumnTitle: 'תאריך',
          tasks: [{ itemId: '9001', name: 'משימה כפולה', date: '2026-03-01', statusText: 'טרם החל' }],
        },
        {
          title: 'סיום',
          buttonId: BTN_DONE.id,
          button: BTN_DONE,
          dateColumnTitle: 'תאריך',
          tasks: [{ itemId: '9001', name: 'משימה כפולה', date: '2026-03-01', statusText: 'טרם החל' }],
        },
      ],
    };
    const doc = render(dual);
    expect((doc.match(/type="radio"/g) ?? []).length).toBe(2);
    expect(doc).toContain(`name="item_9001" value="${BTN_START.id}"`);
    expect(doc).toContain(`name="item_9001" value="${BTN_DONE.id}"`);
    // One data row for the deduped task (header row + 1 body row).
    expect((doc.match(/<tr>/g) ?? []).length).toBe(2);
  });

  it('shows the task name, the formatted date and the current status', () => {
    const doc = render();
    expect(doc).toContain('גיבוש תכנית עבודה');
    expect(doc).toContain('01/03/2026');
    expect(doc).toContain('טרם החל');
  });

  it('escapes HTML in task names', () => {
    const doc = render();
    expect(doc).toContain('הקמת פורום &lt;נציגים&gt;');
    expect(doc).not.toContain('<נציגים>');
  });
});

describe('renderDigestAmp — response rendering', () => {
  it('provides amp-mustache templates for both success and error exactly once', () => {
    const doc = render();
    expect((doc.match(/<div submit-success>/g) ?? []).length).toBe(1);
    expect((doc.match(/<div submit-error>/g) ?? []).length).toBe(1);
    expect((doc.match(/<template type="amp-mustache">/g) ?? []).length).toBe(2);
  });

  it('renders the server message inside the templates', () => {
    expect(render()).toContain('{{message}}');
  });

  it('greets the recipient by name', () => {
    expect(render()).toContain('דנה');
  });
});

describe('renderDigestAmp — input validation', () => {
  it('throws when recipient.personId is missing', () => {
    expect(() =>
      renderDigestAmp({
        baseUrl: BASE,
        secret: SECRET,
        accountId: ACCOUNT,
        recipient: { ...RECIPIENT, personId: undefined },
        sendHour: SEND_HOUR,
        now: NOW,
      })
    ).toThrow(/personId/);
  });
});
