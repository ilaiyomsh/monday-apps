// AMP digest: one table per cluster (מקבץ), cluster date column,
// amp-bind dropdown (closed colored trigger → popup options), one global submit.
// Wire: a/p/m/s/sig + hidden name=item_<id> [value]=btnId ("" = no change).

import { describe, it, expect } from 'vitest';
import { renderDigestAmp } from '../src/helpers/digest-amp.js';
import { buildManifest, signManifest, currentSlot } from '../src/services/manifest-signature.js';
import settingsFixture from './fixtures/board-columns-settings.probe.json';

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
  it('opens with the doctype and the strict-CSS amp4email html tag', () => {
    const doc = render();
    expect(doc.startsWith('<!doctype html>')).toBe(true);
    // data-css-strict is load-bearing: without it the validator hides the
    // strict-CSS rules that Gmail enforces regardless (findings doc §7).
    expect(doc).toContain('<html amp4email data-css-strict lang="he">');
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
    expect(doc).toContain('"l9002":"—"'); // empty statusText → em dash
    expect(doc).toContain('"l9004":"בעבודה"');
    expect(doc).not.toContain('ללא שינוי');
    expect(doc).not.toContain('"ol9001"');
    expect(doc).not.toContain('dd.ol9001');
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

  // The open/closed key is per CELL (`<clusterIndex>_<itemId>`), not per item:
  // an item can appear in two clusters and keying by itemId alone opened both
  // menus on one tap. Selection keys (v/l/c) stay per item deliberately.
  it('hides menus by default and toggles via a per-CELL dd.o key', () => {
    const doc = render();
    expect(doc).toContain('hidden [hidden]="dd.o != \'0_9001\'"');
    expect(doc).toContain("dd.o == '0_9001' ? '' : '0_9001'");
    // 9001 sits in cluster 0 only here; the point is the key carries the cluster.
    expect(doc).not.toContain("dd.o != '9001'");
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
    expect(doc).not.toContain('ללא שינוי');
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

  // Real monday status label colors (owner decision 2026-08-04): buildDigest
  // threads recipient.statusColumnColors (columnId → labelId → hex, sourced from
  // the board's status column settings) and task.statusColor. Hex values below
  // come from tests/fixtures/board-columns-settings.probe.json — a real capture.
  describe('real board label colors', () => {
    const fixtureLabels = settingsFixture.data.boards[0].columns.find(
      (c) => c.type === 'status'
    ).settings.labels;
    // The digest-amp buttons point at status column 'color_x'; key the probe's
    // real label→hex pairs under it (labels: 0 → #fdab3d, 1 → #00c875).
    const BOARD_COLORS = {
      color_x: Object.fromEntries(fixtureLabels.map((l) => [l.id, l.hex])),
    };

    it('prefers the real board color over button.style.color for option pills', () => {
      const doc = render({ ...RECIPIENT, statusColumnColors: BOARD_COLORS });
      // BTN_DONE targets label 1 on color_x: board says #00c875, config guessed #00854d.
      expect(doc).toContain('background:#00c875');
      expect(doc).not.toContain('background:#00854d');
      expect(doc).toContain("c9004:'bg_00c875'");
      expect(doc).toContain('.dd-trig.bg_00c875 { background:#00c875; }');
      // BTN_STUCK targets label 2 — NOT in the board settings → config color kept.
      expect(doc).toContain(`background:${BTN_STUCK.style.color}`);
    });

    it('uses task.statusColor for the current-status chip when set', () => {
      const withColor = {
        ...RECIPIENT,
        statusColumnColors: BOARD_COLORS,
        sections: [
          {
            ...RECIPIENT.sections[0],
            // 9001 current status "טרם החל" matches no button label — today that
            // guessed neutral; the board's real color wins now.
            tasks: [{ ...RECIPIENT.sections[0].tasks[0], statusColor: '#00c875' }],
          },
        ],
      };
      const doc = render(withColor);
      expect(doc).toContain('"c9001":"bg_00c875"');
      expect(doc).toContain('class="dd-trig bg_00c875"');
    });

    it('unknown label (no statusColor) still falls back to config-color match / neutral', () => {
      const doc = render({ ...RECIPIENT, statusColumnColors: BOARD_COLORS });
      // 9001: statusText "טרם החל", no statusColor, no button label match → neutral.
      expect(doc).toContain('"c9001":"bg_c4c4c4"');
      // 9004: statusText "בעבודה" matches BTN_START whose pill color is the
      // board's real #fdab3d for label 0 (same hex the config carried).
      expect(doc).toContain('"c9004":"bg_fdab3d"');
    });
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

// Strict amp4email CSS (docs/amp-email-verified-findings.md §7): Gmail enforces
// the strict property set whether or not the document declares it, so the
// document declares data-css-strict and every rule stays inside the set.
// dir=rtl is fixed in this document, so physical properties are safe stand-ins
// for the logical ones (inline-start = right, inline-end = left).
describe('renderDigestAmp — strict amp4email CSS (data-css-strict)', () => {
  it('declares data-css-strict on the html tag', () => {
    expect(render()).toContain('<html amp4email data-css-strict');
  });

  it('emits no property outside the strict set (logical props, filter, pointer-events, fixed, cursor:progress)', () => {
    const doc = render();
    expect(doc).not.toMatch(/border-inline|padding-inline|inset-inline/);
    expect(doc).not.toMatch(/filter\s*:/);
    expect(doc).not.toContain('pointer-events');
    expect(doc).not.toContain('position:fixed');
    expect(doc).not.toContain('cursor:progress');
    expect(doc).not.toContain('cursor:not-allowed');
  });

  it('pins the physical replacements for the old logical properties', () => {
    const doc = render();
    // th/td cell separators: inline-end under dir=rtl is the LEFT edge.
    expect(doc).toContain('border-left:1px solid #D0D4E4');
    expect(doc).toMatch(/th:last-child \{ border-left:none; \}/);
    expect(doc).toMatch(/td:last-child \{ border-left:none; \}/);
    // td.name padding-inline-start under dir=rtl is padding-RIGHT.
    expect(doc).toMatch(/td\.name \{[^}]*padding-right:12px/);
    // .dd-menu inset-inline-end under dir=rtl is left:0.
    expect(doc).toMatch(/\.dd-menu \{[^}]*left:0/);
    // transition may only animate none|offset-distance|opacity|transform|
    // visibility (official value regex) — box-shadow is out too, so the
    // document carries NO transition at all.
    expect(doc).not.toMatch(/transition\s*:/);
    // cursor is restricted to a tiny value set; pointer is the only value
    // that is inside every published revision of it, so it is the only
    // cursor this document uses.
    expect(doc).not.toMatch(/cursor:(?!pointer)/);
  });

  it('anchors the tap-away overlay to the relatively-positioned card, not the viewport', () => {
    const doc = render();
    expect(doc).toMatch(/\.wrap \{[^}]*position:relative/);
    expect(doc).toMatch(/\.dd-overlay \{[^}]*position:absolute/);
    // absolute positioning only covers the card if the overlay sits INSIDE it.
    expect(doc.indexOf('class="wrap"')).toBeLessThan(doc.indexOf('class="dd-overlay"'));
  });

  it('keeps the in-flight and disabled affordances inside the strict set', () => {
    const doc = render();
    expect(doc).toMatch(/form\.amp-form-submitting \.send \{ opacity:0\.55; box-shadow:none; \}/);
    // The dropdown freeze (pointer-events) is gone by decision; the dim stays.
    expect(doc).toMatch(
      /form\.amp-form-submitting \.dd-trig, form\.amp-form-submitting \.dd-opt \{ opacity:0\.75; \}/
    );
    // Disabled submit (note gate): opacity greys the inline background — a bg
    // class cannot beat an inline style without !important, which AMP forbids.
    const noted = {
      ...RECIPIENT,
      sections: [
        { ...RECIPIENT.sections[0], noteColumnId: 'text_note', noteColumnTitle: 'הערה' },
      ],
    };
    const withNotes = render(noted);
    expect(withNotes).toMatch(/\.send\[disabled\] \{ opacity:0\.45; box-shadow:none; \}/);
    expect(withNotes).not.toContain('grayscale');
  });
});

describe('renderDigestAmp — response + validation', () => {
  it('provides success/error mustache templates once and greets by name', () => {
    const doc = render();
    expect((doc.match(/<div submit-success>/g) ?? []).length).toBe(1);
    expect((doc.match(/<div submit-error>/g) ?? []).length).toBe(1);
    expect(doc).toContain('{{message}}');
    expect(doc).toContain('{{#detail}}');
    expect(doc).toContain('{{detail}}');
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
