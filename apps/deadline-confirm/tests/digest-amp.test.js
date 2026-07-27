// AMP digest: one table per cluster (מקבץ), cluster date column,
// amp-bind dropdown (closed colored trigger → popup options), one global submit.
// Wire: a/p/m/s/sig + hidden name=item_<id> [value]=btnId ("" = no change).

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

  it('carries amp4email boilerplate, amp-form, amp-bind, and CDN scripts', () => {
    const doc = render();
    expect(doc).toContain('<style amp4email-boilerplate>body{visibility:hidden}</style>');
    expect(doc).toContain('custom-element="amp-form"');
    expect(doc).toContain('custom-element="amp-bind"');
    expect(doc).toContain('custom-template="amp-mustache"');
    expect(doc).toContain('<amp-state id="dd">');
    for (const tag of doc.match(/<script[^>]*>/g) ?? []) {
      const isCdn = tag.includes('src="https://cdn.ampproject.org/');
      const isStateJson = tag.includes('type="application/json"');
      expect(isCdn || isStateJson).toBe(true);
    }
  });

  it('stays well under the 200,000-byte AMP part limit', () => {
    expect(Buffer.byteLength(render(), 'utf8')).toBeLessThan(200_000);
  });
});

describe('renderDigestAmp — cluster tables with amp-bind dropdown', () => {
  it('renders exactly one form, one submit, and one board table per populated section', () => {
    const doc = render();
    expect((doc.match(/<form /g) ?? []).length).toBe(1);
    expect((doc.match(/type="submit"/g) ?? []).length).toBe(1);
    expect(doc).toMatch(/type="submit"[^>]*value="אשר את המסומנות"/);
    expect((doc.match(/class="board"/g) ?? []).length).toBe(2);
    expect(doc).toContain('משימות שנדרש להתחיל וטרם התחילו:');
    expect(doc).toContain('משימות שנדרש לסיים וטרם בוצעו:');
    expect(doc).not.toContain('קבוצה ריקה');
  });

  it('uses closed amp-bind dropdown (dd-trig + dd-menu) — not native <select> or always-open radios', () => {
    const doc = render();
    expect(doc).toContain('class="dd-trig');
    expect(doc).toContain('class="dd-menu"');
    expect(doc).toContain('class="dd-opt"');
    expect(doc).toContain('AMP.setState');
    expect(doc).toContain("[class]=\"'dd-trig ' + dd.c");
    expect(doc).not.toContain('[style]');
    expect(doc).toMatch(/<th class="status-h">[^<]*סטטוס/);
    expect(doc).not.toContain('סטטוס חדש');
    expect(doc).not.toContain('בחרו סטטוס');
    expect(doc).toContain('טרם החל'); // current status on item 9001
    expect(doc).toContain('"l9001":"טרם החל"');
    expect(doc).toContain('"ol9001":"טרם החל"');
    expect(doc).toContain('"l9002":"—"'); // empty statusText → em dash
    expect(doc).toContain('"l9004":"בעבודה"');
    expect(doc).toContain('l9001: dd.ol9001'); // ללא שינוי restores current
    expect(doc).toContain('c9001: dd.oc9001');
    expect(doc).toMatch(/AMP\.setState\(\{dd:\{o:'', v9001:'', l9001: dd\.ol9001, c9001: dd\.oc9001\}\}\)/);
    expect(doc).not.toContain('<select');
    expect(doc).not.toContain('label-dd');
    expect(doc).not.toContain('type="radio"');
    expect(doc).not.toContain('class="picker"');
    expect(doc).not.toContain('amp-accordion');
  });

  it('binds trigger color via CSS class (AMP4EMAIL forbids [style] on button)', () => {
    const doc = render();
    expect(doc).toContain('.dd-trig.bg_fdab3d { background:#fdab3d; }');
    expect(doc).toContain('.dd-trig.bg_e2445c { background:#e2445c; }');
    expect(doc).toContain('.dd-trig.bg_00854d { background:#00854d; }');
    expect(doc).toContain('.dd-trig.bg_c4c4c4 { background:#c4c4c4; }');
    // 9001 current "טרם החל" has no matching button color → neutral class
    expect(doc).toContain('"c9001":"bg_c4c4c4"');
    expect(doc).toContain('"c9004":"bg_fdab3d"'); // current "בעבודה" matches BTN_START color
    expect(doc).toContain("c9001:'bg_fdab3d'");
    expect(doc).toContain("c9001:'bg_e2445c'");
    expect(doc).toContain("c9004:'bg_00854d'");
  });

  it('hides menus by default and toggles via dd.o state', () => {
    const doc = render();
    expect(doc).toContain('hidden [hidden]="dd.o != \'9001\'"');
    expect(doc).toContain("dd.o == '9001' ? '' : '9001'");
    expect(doc).toContain('class="dd-overlay"');
  });

  it('shows only that cluster date column (not every digest date on every table)', () => {
    const doc = render();
    expect(doc).toContain('תאריך התחלה');
    expect(doc).toContain('תאריך סיום');
    expect(doc).toContain('01/03/2026');
    expect(doc).toContain('15/03/2026');
    expect(doc).toContain('28/02/2026');
    expect(doc).not.toContain('20/03/2026');
  });

  it('colors each dropdown option with the button style color and labels', () => {
    const doc = render();
    expect(doc).toContain(`background:${BTN_START.style.color}`);
    expect(doc).toContain(`background:${BTN_STUCK.style.color}`);
    expect(doc).toContain(`background:${BTN_DONE.style.color}`);
    expect(doc).toContain('בעבודה');
    expect(doc).toContain('תקוע');
    expect(doc).toContain('בוצע');
    expect(doc).toContain('ללא שינוי');
  });

  it('wires one hidden item_<id> per task bound to dd.v<id> (multi-button options in setState)', () => {
    const doc = render();
    expect((doc.match(/name="item_9001"/g) ?? []).length).toBe(1);
    expect((doc.match(/name="item_9002"/g) ?? []).length).toBe(1);
    expect((doc.match(/name="item_9004"/g) ?? []).length).toBe(1);
    expect(doc).toContain('name="item_9001" value="" [value]="dd.v9001"');
    expect(doc).toContain('name="item_9002" value="" [value]="dd.v9002"');
    expect(doc).toContain('name="item_9004" value="" [value]="dd.v9004"');
    expect(doc).toContain(`v9001:'${BTN_START.id}'`);
    expect(doc).toContain(`v9001:'${BTN_STUCK.id}'`);
    expect(doc).toContain(`v9004:'${BTN_DONE.id}'`);
    expect(doc).not.toContain(`v9004:'${BTN_START.id}'`);
    expect((doc.match(/class="dd-trig /g) ?? []).length).toBe(3);
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
    expect(doc).toContain('name="item_9010" value="" [value]="dd.v9010"');
    expect(doc).toContain(`v9010:'${BTN_DONE.id}'`);
    expect((doc.match(/class="dd-trig /g) ?? []).length).toBe(1);
  });

  it('shares one hidden wire field when the same item appears in two clusters', () => {
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
    expect((doc.match(/name="item_9001"/g) ?? []).length).toBe(1);
    expect((doc.match(/class="dd-trig /g) ?? []).length).toBe(2);
    expect(doc).toContain(`v9001:'${BTN_START.id}'`);
    expect(doc).toContain(`v9001:'${BTN_DONE.id}'`);
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
