// TDD — AMP digest: one table per cluster (מקבץ), cluster date column,
// radio column per action button, one global submit.
// Wire unchanged: a/p/m/s/sig + item_<id>=btnId (radio; unchecked = no change).

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
const BTN_STUCK = {
  id: 'b_stuck001',
  name: 'תקוע',
  statusColumnId: 'color_x',
  targetIndex: 2,
  targetLabel: 'תקוע',
  style: { color: '#e2445c', icon: '', size: 'md' },
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
  dateColumns: [
    { id: 'date_start', title: 'תאריך התחלה' },
    { id: 'date_due', title: 'תאריך סיום' },
  ],
  sections: [
    {
      title: 'משימות שנדרש להתחיל וטרם התחילו:',
      buttonId: BTN_START.id,
      buttonIds: [BTN_START.id, BTN_STUCK.id],
      button: BTN_START,
      buttons: [BTN_START, BTN_STUCK],
      dateColumnTitle: 'תאריך התחלה',
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
      title: 'משימות שנדרש לסיים וטרם בוצעו:',
      buttonId: BTN_DONE.id,
      buttonIds: [BTN_DONE.id],
      button: BTN_DONE,
      buttons: [BTN_DONE],
      dateColumnTitle: 'תאריך סיום',
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
      buttonIds: [BTN_DONE.id],
      button: BTN_DONE,
      buttons: [BTN_DONE],
      dateColumnTitle: 'תאריך סיום',
      tasks: [],
    },
  ],
};

const MANIFEST = buildManifest([
  { itemId: '9001', btnId: BTN_START.id },
  { itemId: '9001', btnId: BTN_STUCK.id },
  { itemId: '9002', btnId: BTN_START.id },
  { itemId: '9002', btnId: BTN_STUCK.id },
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

describe('renderDigestAmp — one table per cluster', () => {
  it('renders exactly one form, one submit, and one board table per populated section', () => {
    const doc = render();
    expect((doc.match(/<form /g) ?? []).length).toBe(1);
    expect((doc.match(/type="submit"/g) ?? []).length).toBe(1);
    expect(doc).toMatch(/type="submit"[^>]*value="אשר את המסומנות"/);
    // two populated sections → two tables; empty section omitted
    expect((doc.match(/class="board"/g) ?? []).length).toBe(2);
    expect(doc).toContain('משימות שנדרש להתחיל וטרם התחילו:');
    expect(doc).toContain('משימות שנדרש לסיים וטרם בוצעו:');
    expect(doc).not.toContain('קבוצה ריקה');
  });

  it('does not use LabelPicker chrome, native select, or a status-fill column', () => {
    const doc = render();
    expect(doc).not.toContain('<select');
    expect(doc).not.toContain('class="picker"');
    expect(doc).not.toContain('class="opt-fill"');
    expect(doc).not.toContain('class="status-fill"');
    // No LabelPicker "סטטוס חדש" column header (lead copy may still say סטטוס חדש)
    expect(doc).not.toMatch(/<th[^>]*>[^<]*סטטוס חדש/);
  });

  it('shows only that cluster date column (not every digest date on every table)', () => {
    const doc = render();
    // Cluster 1 header uses start date; cluster 2 uses end date
    expect(doc).toContain('תאריך התחלה');
    expect(doc).toContain('תאריך סיום');
    // Task dates: start cluster shows 01/03 and 15/03; end cluster shows 28/02
    expect(doc).toContain('01/03/2026');
    expect(doc).toContain('15/03/2026');
    expect(doc).toContain('28/02/2026');
    // End date 20/03 belongs only to date_due of item 9001 — must NOT appear
    // in the start-date cluster table (cluster uses task.date = date_start).
    expect(doc).not.toContain('20/03/2026');
  });

  it('renders a colored radio column header per section button', () => {
    const doc = render();
    expect(doc).toContain(`background:${BTN_START.style.color}`);
    expect(doc).toContain(`background:${BTN_STUCK.style.color}`);
    expect(doc).toContain(`background:${BTN_DONE.style.color}`);
    expect(doc).toContain('בעבודה');
    expect(doc).toContain('תקוע');
    expect(doc).toContain('בוצע');
  });

  it('offers radios name=item_<id> for every button in the section (multi-button)', () => {
    const doc = render();
    // section1: 2 tasks × 2 buttons = 4; section2: 1 × 1 = 1 → 5 radios
    expect((doc.match(/type="radio"/g) ?? []).length).toBe(5);
    expect(doc).toContain(`name="item_9001" value="${BTN_START.id}"`);
    expect(doc).toContain(`name="item_9001" value="${BTN_STUCK.id}"`);
    expect(doc).toContain(`name="item_9002" value="${BTN_START.id}"`);
    expect(doc).toContain(`name="item_9004" value="${BTN_DONE.id}"`);
    expect(doc).not.toContain(`name="item_9004" value="${BTN_START.id}"`);
    expect(doc).not.toMatch(/\schecked(=|\s|>)/);
  });

  it('falls back to singular buttonId/button when buttonIds/buttons are absent', () => {
    const legacy = {
      ...RECIPIENT,
      sections: [
        {
          title: 'מקבץ ישן',
          buttonId: BTN_DONE.id,
          button: BTN_DONE,
          dateColumnTitle: 'דדליין',
          tasks: [
            {
              itemId: '9010',
              name: 'ישן',
              date: '2026-01-01',
              dates: { date_due: '2026-01-01' },
              statusText: '',
            },
          ],
        },
      ],
    };
    const doc = render(legacy);
    expect((doc.match(/class="board"/g) ?? []).length).toBe(1);
    expect(doc).toContain('מקבץ ישן');
    expect(doc).toContain(`name="item_9010" value="${BTN_DONE.id}"`);
    expect((doc.match(/type="radio"/g) ?? []).length).toBe(1);
  });

  it('shares the same radio name across clusters when the same item appears twice', () => {
    const dual = {
      ...RECIPIENT,
      sections: [
        {
          title: 'א',
          buttonId: BTN_START.id,
          buttonIds: [BTN_START.id],
          buttons: [BTN_START],
          dateColumnTitle: 'תאריך א',
          tasks: [{ itemId: '9001', name: 'כפולה', date: '2026-03-01', dates: {}, statusText: '' }],
        },
        {
          title: 'ב',
          buttonId: BTN_DONE.id,
          buttonIds: [BTN_DONE.id],
          buttons: [BTN_DONE],
          dateColumnTitle: 'תאריך ב',
          tasks: [{ itemId: '9001', name: 'כפולה', date: '2026-03-10', dates: {}, statusText: '' }],
        },
      ],
    };
    const doc = render(dual);
    expect((doc.match(/name="item_9001"/g) ?? []).length).toBe(2);
    expect(doc).toContain(`name="item_9001" value="${BTN_START.id}"`);
    expect(doc).toContain(`name="item_9001" value="${BTN_DONE.id}"`);
  });

  it('escapes HTML in task names', () => {
    expect(render()).toContain('הקמת פורום &lt;נציגים&gt;');
  });

  it('signs a manifest covering every (item × section button) pair', () => {
    const doc = render();
    expect((doc.match(new RegExp(`name="m" value="${MANIFEST}"`, 'g')) ?? []).length).toBe(1);
    expect((doc.match(new RegExp(`name="sig" value="${SIG}"`, 'g')) ?? []).length).toBe(1);
    expect(doc).not.toContain('name="k"');
    expect(doc).not.toContain(`value="${SECRET}"`);
    expect(doc).toContain(`action-xhr="${BASE}/amp/confirm"`);
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
