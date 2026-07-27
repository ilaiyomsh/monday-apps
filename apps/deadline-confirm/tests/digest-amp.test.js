// TDD — AMP digest: discussions-style monday table + inlined LabelPicker options.
// Visual port of apps/discussions TaskTable statusFill + LabelPickerCell menu
// (AMP cannot host React Dialog — options are colored radios in the cell).
// Wire: a/p/m/s/sig + item_<id>=btnId; one global submit; all digest date columns.

import { describe, it, expect } from 'vitest';
import { renderDigestAmp } from '../src/helpers/digest-amp.js';
import { buildManifest, signManifest, currentSlot } from '../src/services/manifest-signature.js';

const BASE = 'https://app.example';
const SECRET = 'wJalrXUtnFEMIK7MDENGbPxRfiCY_EXAMPLEKEY-43x';
const ACCOUNT = '777';
const PERSON_ID = '48274917';
const SEND_HOUR = 8;
const NOW = new Date('2026-07-28T09:00:00Z');
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

const DATE_COLUMNS = [
  { id: 'date_start', title: 'תאריך התחלה מתוכנן' },
  { id: 'date_due', title: 'דדליין' },
];

const RECIPIENT = {
  email: 'dana@example.com',
  name: 'דנה',
  personId: PERSON_ID,
  taskCount: 3,
  dateColumns: DATE_COLUMNS,
  sections: [
    {
      title: 'משימות שנדרש להתחיל',
      buttonId: BTN_START.id,
      button: BTN_START,
      dateColumnTitle: 'תאריך התחלה מתוכנן',
      tasks: [
        {
          itemId: '9001',
          name: 'גיבוש תכנית עבודה',
          date: '2026-03-01',
          dates: { date_start: '2026-03-01', date_due: '2026-03-20' },
          statusText: 'טרם החל',
        },
        {
          itemId: '9002',
          name: 'הקמת פורום <נציגים>',
          date: '2026-03-15',
          dates: { date_start: '2026-03-15', date_due: null },
          statusText: '',
        },
      ],
    },
    {
      title: 'משימות שנדרש לסיים',
      buttonId: BTN_DONE.id,
      button: BTN_DONE,
      dateColumnTitle: 'דדליין',
      tasks: [
        {
          itemId: '9004',
          name: 'דוח רבעוני',
          date: '2026-02-28',
          dates: { date_start: null, date_due: '2026-02-28' },
          statusText: 'בעבודה',
        },
      ],
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
    expect(render()).toMatch(/<head>\s*<meta charset="utf-8">/);
  });

  it('carries the amp4email boilerplate style and CDN scripts only', () => {
    const doc = render();
    expect(doc).toContain('<style amp4email-boilerplate>body{visibility:hidden}</style>');
    expect(doc).toContain('custom-element="amp-form"');
    expect(doc).toContain('custom-template="amp-mustache"');
    for (const tag of doc.match(/<script[^>]*>/g) ?? []) {
      expect(tag).toContain('src="https://cdn.ampproject.org/');
    }
  });

  it('stays well under the 200,000-byte AMP part limit', () => {
    expect(Buffer.byteLength(render(), 'utf8')).toBeLessThan(200_000);
  });
});

describe('renderDigestAmp — monday table + inlined LabelPicker', () => {
  it('renders exactly one form, one board table, and one submit', () => {
    const doc = render();
    expect((doc.match(/<form /g) ?? []).length).toBe(1);
    expect((doc.match(/class="board"/g) ?? []).length).toBe(1);
    expect((doc.match(/type="submit"/g) ?? []).length).toBe(1);
    expect(doc).toMatch(/type="submit"[^>]*value="אשר את המסומנות"/);
  });

  it('does not use native <select> or per-section group boxes', () => {
    const doc = render();
    expect(doc).not.toContain('<select');
    expect(doc).not.toContain('class="grp"');
    expect(doc).not.toContain('קבוצה ריקה');
  });

  it('shows current status as a monday statusFill chip', () => {
    const doc = render();
    expect(doc).toContain('class="status-fill"');
    expect(doc).toContain('טרם החל');
    // "בעבודה" current status on 9004 picks up BTN_START color via label match
    expect(doc).toContain(`style="background:${BTN_START.style.color}"`);
  });

  it('inlines LabelPicker options as colored radios (discussions menu style)', () => {
    const doc = render();
    expect((doc.match(/type="radio"/g) ?? []).length).toBe(3);
    expect(doc).toContain('class="opt-fill"');
    expect(doc).toContain(`name="item_9001" value="${BTN_START.id}"`);
    expect(doc).toContain(`name="item_9004" value="${BTN_DONE.id}"`);
    expect(doc).toContain(`background:${BTN_START.style.color}`);
    expect(doc).toContain(`background:${BTN_DONE.style.color}`);
    expect(doc).not.toMatch(/\schecked(=|\s|>)/);
  });

  it('offers only authorized buttons per task and unions when a task spans sections', () => {
    const doc = render();
    expect(doc).not.toContain(`name="item_9001" value="${BTN_DONE.id}"`);
    expect(doc).not.toContain(`name="item_9004" value="${BTN_START.id}"`);

    const dual = {
      ...RECIPIENT,
      sections: [
        {
          title: 'א',
          buttonId: BTN_START.id,
          button: BTN_START,
          dateColumnTitle: 'תאריך',
          tasks: [
            {
              itemId: '9001',
              name: 'כפולה',
              date: '2026-03-01',
              dates: { date_start: '2026-03-01', date_due: '2026-03-10' },
              statusText: 'טרם החל',
            },
          ],
        },
        {
          title: 'ב',
          buttonId: BTN_DONE.id,
          button: BTN_DONE,
          dateColumnTitle: 'תאריך',
          tasks: [
            {
              itemId: '9001',
              name: 'כפולה',
              date: '2026-03-10',
              dates: { date_start: '2026-03-01', date_due: '2026-03-10' },
              statusText: 'טרם החל',
            },
          ],
        },
      ],
    };
    const dualDoc = render(dual);
    expect((dualDoc.match(/type="radio"/g) ?? []).length).toBe(2);
    expect(dualDoc).toContain(`name="item_9001" value="${BTN_START.id}"`);
    expect(dualDoc).toContain(`name="item_9001" value="${BTN_DONE.id}"`);
  });

  it('carries signed-manifest fields once and never exposes the secret', () => {
    const doc = render();
    expect((doc.match(new RegExp(`name="m" value="${MANIFEST}"`, 'g')) ?? []).length).toBe(1);
    expect((doc.match(new RegExp(`name="sig" value="${SIG}"`, 'g')) ?? []).length).toBe(1);
    expect(doc).not.toContain('name="k"');
    expect(doc).not.toContain(`value="${SECRET}"`);
    expect(doc).toContain(`action-xhr="${BASE}/amp/confirm"`);
  });
});

describe('renderDigestAmp — all digest date columns', () => {
  it('renders one column header per dateColumns entry from digest settings', () => {
    const doc = render();
    expect(doc).toContain('תאריך התחלה מתוכנן');
    expect(doc).toContain('דדליין');
    expect(doc).toContain('שם הפעולה');
    expect(doc).toContain('סטטוס חדש');
  });

  it('fills date cells from task.dates and escapes HTML in names', () => {
    const doc = render();
    expect(doc).toContain('01/03/2026');
    expect(doc).toContain('20/03/2026');
    expect(doc).toContain('28/02/2026');
    expect(doc).toContain('הקמת פורום &lt;נציגים&gt;');
  });
});

describe('renderDigestAmp — response + validation', () => {
  it('provides success/error mustache templates once and greets by name', () => {
    const doc = render();
    expect((doc.match(/<div submit-success>/g) ?? []).length).toBe(1);
    expect((doc.match(/<div submit-error>/g) ?? []).length).toBe(1);
    expect(doc).toContain('{{message}}');
    expect(doc).toContain('דנה');
  });

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
