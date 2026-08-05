// TDD — one form per ROW (owner decision 2026-08-04). Replaces the single bulk
// form + one global submit button: picking a status now writes that item
// immediately, with a loader and a confirmation mark on that row alone.
//
// Why the structure is what it is — each claim below is load-bearing:
//
//  1. amp-form's `submitting` / `submit-success` / `submit-error` blocks must be
//     CHILDREN OF THE FORM. One form per message can therefore only ever show
//     ONE loader. Per-row feedback REQUIRES per-row forms — that, not aesthetics,
//     is why the table became a card per row (a form cannot span two <td>s).
//  2. The chosen button rides a RADIO, not an amp-bind-bound hidden input.
//     `AMP.setState(...)` then `form.submit` in one action chain is a race:
//     amp-bind applies DOM mutations on the next vsync frame, so the submit
//     would carry the PREVIOUS value. A checked radio is serialized by the form
//     itself, with no binding and no frame to wait for.
//  3. `change` on the radio submits; `tap` only repaints and closes the menu.
//     `change` is the supported AMP-for-Email pattern for a form control
//     (owner-confirmed 2026-08-04) and fires after the radio is checked. The two
//     must stay split: both fire on a first pick, so submitting from each would
//     double-post every selection. The cost is that re-tapping the SAME option
//     fires no change and does not resubmit.
//  4. Each form carries its OWN manifest + signature, covering that row only.
//     Least privilege (a leaked form authorizes one item) and smaller than
//     repeating the message-wide manifest N times.

import { describe, it, expect } from 'vitest';
import { renderDigestAmp } from '../src/helpers/digest-amp.js';
import { verifyManifest, currentSlot, parseManifest } from '../src/services/manifest-signature.js';

const BASE = 'https://app.example';
const SECRET = 'wJalrXUtnFEMIK7MDENGbPxRfiCY_EXAMPLEKEY-43x';
const ACCOUNT = '777';
const PERSON = '48274917';
const SEND_HOUR = 8;
const NOW = new Date('2026-07-28T09:00:00Z');
const SLOT = currentSlot({ sendHour: SEND_HOUR, now: NOW });

const BTN_START = {
  id: 'b_start001',
  name: 'התחלתי',
  statusColumnId: 'color_x',
  targetIndex: 0,
  targetLabel: 'בעבודה',
  style: { color: '#fdab3d' },
};
const BTN_STUCK = {
  id: 'b_stuck001',
  name: 'תקוע',
  statusColumnId: 'color_x',
  targetIndex: 2,
  targetLabel: 'תקוע',
  style: { color: '#e2445c' },
};
const BTN_DONE = {
  id: 'b_done0002',
  name: 'בוצע',
  statusColumnId: 'color_x',
  targetIndex: 1,
  targetLabel: 'בוצע',
  style: { color: '#00854d' },
};

const task = (itemId, name, over = {}) => ({
  itemId,
  name,
  date: '2026-03-01',
  statusText: 'טרם החל',
  ...over,
});

const startSection = (over = {}) => ({
  title: 'להתחיל:',
  dateColumnTitle: 'תאריך התחלה',
  buttonId: BTN_START.id,
  buttonIds: [BTN_START.id, BTN_STUCK.id],
  button: BTN_START,
  buttons: [BTN_START, BTN_STUCK],
  tasks: [task('9001', 'גיבוש תכנית'), task('9002', 'הקמת פורום')],
  ...over,
});

const doneSection = (over = {}) => ({
  title: 'לסיים:',
  dateColumnTitle: 'תאריך סיום',
  buttonId: BTN_DONE.id,
  buttonIds: [BTN_DONE.id],
  button: BTN_DONE,
  buttons: [BTN_DONE],
  tasks: [task('9004', 'דוח רבעוני', { statusText: 'בעבודה' })],
  ...over,
});

const render = (sections, over = {}) =>
  renderDigestAmp({
    baseUrl: BASE,
    secret: SECRET,
    accountId: ACCOUNT,
    recipient: { name: 'דנה', personId: PERSON, sections, ...over },
    sendHour: SEND_HOUR,
    now: NOW,
  });

/** Every `<form …>…</form>` block in document order. */
const forms = (html) =>
  html.split('<form ').slice(1).map((chunk) => `<form ${chunk.split('</form>')[0]}</form>`);

/** One named hidden field's value out of a form block. */
const hiddenValue = (form, name) =>
  form.match(new RegExp(`name="${name}" value="([^"]*)"`))?.[1] ?? null;

const countOf = (haystack, needle) => haystack.split(needle).length - 1;

describe('renderDigestAmp — one form per row', () => {
  it('emits one form per populated task and none for an empty cluster', () => {
    const html = render([startSection(), doneSection(), doneSection({ tasks: [] })]);
    expect(forms(html)).toHaveLength(3);
  });

  it('gives every form a unique id and the same action-xhr', () => {
    const html = render([startSection(), doneSection()]);
    const ids = forms(html).map((f) => f.match(/id="([^"]+)"/)?.[1]);
    expect(ids).toEqual(['f0_9001', 'f0_9002', 'f1_9004']);
    expect(new Set(ids).size).toBe(ids.length);
    for (const form of forms(html)) {
      expect(form).toContain(`action-xhr="${BASE}/amp/confirm"`);
      expect(form).toContain('method="post"');
      expect(form).toContain('enctype="application/x-www-form-urlencoded"');
    }
  });

  it('drops the bulk submit button entirely — no single send control remains', () => {
    const html = render([startSection(), doneSection()]);
    expect(html).not.toContain('type="submit"');
    expect(html).not.toContain('אשר את המסומנות');
    expect(html).not.toContain('class="send"');
  });

  // Two clusters on purpose: the submit target must carry the CLUSTER INDEX as
  // well as the item id, or a task listed twice would submit its twin's form.
  it('submits the row from the option\u2019s change, not from a submit control', () => {
    const html = render([startSection(), doneSection()]);
    expect(html).toContain(
      `on="tap:AMP.setState({dd:{o:'', l9004:'בוצע', c9004:'bg_00854d'}});change:f1_9004.submit"`
    );
  });

  // Both events fire on a first pick. Submitting from each would post twice, and
  // the second POST would answer already_done — overwriting the row's own ✓ with
  // "היה מעודכן כבר" on a write that had just succeeded.
  it('never submits from tap as well — one pick must not post twice', () => {
    const html = render([startSection()]);
    // Scoped to the tap: segment only — `[^;"]*` stops at the ;change: handler,
    // which legitimately does carry .submit.
    expect(html).not.toMatch(/on="tap:[^;"]*\.submit/);
    expect((html.match(/change:f0_9001\.submit/g) ?? []).length).toBe(2); // two options
  });

  // The official validator REFUSES the document without these (CI run 766, all
  // 5 samples): "The attribute 'role' in tag 'input' is missing or incorrect,
  // but required by attribute 'on'" — same for tabindex. amp-form demands both
  // on any element carrying `on`; <button> is exempt, <input> is not, which is
  // why the trigger never needed them and the overlay always had them. They also
  // earn their keep: the radio is visually hidden, so tabindex is what keeps the
  // options reachable by keyboard.
  it('gives every radio the role and tabindex amp-form requires with `on`', () => {
    const html = render([startSection(), doneSection()]);
    const radios = html.match(/<input type="radio"[^>]*>/g) ?? [];
    expect(radios).toHaveLength(5); // 2 buttons × 2 tasks + 1 button × 1 task
    for (const radio of radios) {
      expect(radio).toContain('role="radio"');
      expect(radio).toContain('tabindex="0"');
    }
  });

  it('carries the chosen button on a radio the form serializes itself', () => {
    const html = render([startSection()]);
    const [first] = forms(html);
    expect(first).toContain(`<input type="radio" class="pick" name="item_9001" value="${BTN_START.id}"`);
    expect(first).toContain(`<input type="radio" class="pick" name="item_9001" value="${BTN_STUCK.id}"`);
    // The bound hidden input and its state key are the race that made this
    // change necessary; neither may come back.
    expect(html).not.toContain('[value]="dd.v9001"');
    expect(html).not.toContain('dd.v9001');
    expect(html).not.toContain('"v9001"');
  });

  it('keeps every radio inside its own row form — no cross-row selection', () => {
    const html = render([startSection(), doneSection()]);
    const [f9001, f9002, f9004] = forms(html);
    expect(countOf(f9001, 'name="item_9001"')).toBe(2); // two buttons in that cluster
    expect(f9001).not.toContain('name="item_9002"');
    expect(f9002).not.toContain('name="item_9001"');
    expect(f9004).toContain(`name="item_9004" value="${BTN_DONE.id}"`);
    expect(f9004).not.toContain('name="item_9001"');
  });

  it('still opens as a closed dropdown — the radios live inside the hidden menu', () => {
    const html = render([startSection()]);
    const [first] = forms(html);
    expect(first).toContain('class="dd-trig');
    expect(first).toContain(`<div class="dd-menu" hidden [hidden]="dd.o != '0_9001'">`);
    expect(first.indexOf('class="dd-menu"')).toBeLessThan(first.indexOf('type="radio"'));
    expect(html).not.toContain('<select');
  });

  it('hides the native radio so the colored label is the whole control', () => {
    const html = render([startSection()]);
    expect(html).toMatch(/\.pick \{[^}]*opacity:0/);
    expect(html).toContain('<label class="dd-opt" style="background:#fdab3d">');
  });

  it('signs each row over its OWN pairs, and the signature verifies', () => {
    const html = render([startSection(), doneSection()]);
    const expected = ['9001:b_start001,b_stuck001', '9002:b_start001,b_stuck001', '9004:b_done0002'];
    forms(html).forEach((form, i) => {
      const manifest = hiddenValue(form, 'm');
      expect(manifest).toBe(expected[i]);
      expect(parseManifest(manifest).ok).toBe(true);
      expect(
        verifyManifest({
          secret: SECRET,
          accountId: ACCOUNT,
          personId: PERSON,
          slot: SLOT,
          manifest,
          signature: hiddenValue(form, 'sig'),
        })
      ).toBe(true);
      expect(hiddenValue(form, 'a')).toBe(ACCOUNT);
      expect(hiddenValue(form, 'p')).toBe(PERSON);
      expect(hiddenValue(form, 's')).toBe(SLOT);
    });
  });

  it('does not let one row\'s signature authorize another row', () => {
    const html = render([startSection()]);
    const [first, second] = forms(html);
    expect(
      verifyManifest({
        secret: SECRET,
        accountId: ACCOUNT,
        personId: PERSON,
        slot: SLOT,
        manifest: hiddenValue(second, 'm'),
        signature: hiddenValue(first, 'sig'),
      })
    ).toBe(false);
  });

  it('never leaks the link secret into a form', () => {
    const html = render([startSection()]);
    expect(html).not.toContain(SECRET);
    expect(html).not.toContain('name="k"');
  });
});

describe('renderDigestAmp — per-row loader, confirmation and error', () => {
  it('gives each form its own submitting / success / error blocks', () => {
    const html = render([startSection(), doneSection()]);
    expect(countOf(html, '<div submitting>')).toBe(3);
    expect(countOf(html, '<div submit-success>')).toBe(3);
    expect(countOf(html, '<div submit-error>')).toBe(3);
    for (const form of forms(html)) {
      expect(countOf(form, '<div submitting>')).toBe(1);
      expect(countOf(form, '<div submit-success>')).toBe(1);
      expect(countOf(form, '<div submit-error>')).toBe(1);
    }
  });

  it('renders the server message through amp-mustache in both outcomes', () => {
    const [form] = forms(render([doneSection()]));
    expect(form).toMatch(/<div submit-success><template type="amp-mustache">/);
    expect(form).toMatch(/<div submit-error><template type="amp-mustache">/);
    expect(countOf(form, '{{message}}')).toBe(2);
    expect(form).toContain('{{#detail}}');
  });

  it('marks the confirmed row with a check glyph', () => {
    const [form] = forms(render([doneSection()]));
    const success = form.slice(form.indexOf('<div submit-success>'));
    expect(success).toContain('&#10003;');
  });

  it('shows an in-row loader while that row is in flight', () => {
    const [form] = forms(render([doneSection()]));
    const submitting = form.slice(form.indexOf('<div submitting>'), form.indexOf('<div submit-success>'));
    expect(submitting).toContain('class="state wait"');
    expect(submitting).toContain('מעדכן');
  });

  it('dims only the submitting row — amp-form stamps the class on that form', () => {
    const html = render([startSection()]);
    expect(html).toMatch(
      /form\.amp-form-submitting \.dd-trig, form\.amp-form-submitting \.dd-opt \{ opacity:0\.75; \}/
    );
  });
});

describe('renderDigestAmp — the card carries what the table used to', () => {
  it('renders each task name and its cluster date inside that task\'s form', () => {
    const html = render([startSection(), doneSection()]);
    const [f9001, , f9004] = forms(html);
    expect(f9001).toContain('גיבוש תכנית');
    expect(f9001).toContain('01/03/2026');
    expect(f9004).toContain('דוח רבעוני');
    expect(f9004).toContain('תאריך סיום');
  });

  it('keeps the cluster titles outside the forms, one per populated cluster', () => {
    const html = render([startSection(), doneSection(), doneSection({ tasks: [] })]);
    expect(countOf(html, 'class="cluster-title"')).toBe(2);
    expect(html).toContain('להתחיל:');
    expect(html).toContain('לסיים:');
  });

  it('drops the table markup — the card IS the row now', () => {
    const html = render([startSection()]);
    expect(html).not.toContain('<table');
    expect(html).not.toContain('class="board"');
    expect(html).not.toContain('<th');
    expect(html).not.toContain('<td');
  });

  it('escapes a task name so board content cannot break the card', () => {
    const html = render([startSection({ tasks: [task('9001', 'הקמת פורום <נציגים>')] })]);
    expect(html).toContain('הקמת פורום &lt;נציגים&gt;');
  });

  it('keeps the note field, its lock and its state inside the row form', () => {
    const html = render([
      startSection({ noteColumnId: 'text_note', noteColumnTitle: 'סיכום', tasks: [task('9001', 'א')] }),
    ]);
    const [form] = forms(html);
    expect(form).toContain('name="note_9001"');
    expect(form).toMatch(/<button type="button" class="dd-trig[^>]*\sdisabled/);
    expect(form).toContain(`[disabled]="dd.n9001 == ''"`);
  });
});
