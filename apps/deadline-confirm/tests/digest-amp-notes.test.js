// TDD — the amp4email note column. Two things must hold in the rendered
// document, and they are different claims:
//
//  1. The reader can type a note per row, and that text reaches the wire as
//     note_<itemId> — one named field inside that row's OWN form (since
//     2026-08-04 every row is a form of its own).
//  2. A row cannot be marked while its note is empty. This used to be a
//     `[disabled]` gate on the bulk submit button; with the submit button gone
//     the gate moved earlier, onto the row's status trigger, so the empty-note
//     state is unreachable rather than merely un-submittable. `required` is
//     still the wrong tool: it would block a row the reader never touched.

import { describe, it, expect } from 'vitest';
import { renderDigestAmp } from '../src/helpers/digest-amp.js';

const BUTTON_DONE = {
  id: 'b_done0001',
  name: 'סיימתי',
  targetLabel: 'בוצע',
  style: { color: '#00854d', icon: '✓', size: 'sm' },
};
const BUTTON_START = {
  id: 'b_start001',
  name: 'התחלתי',
  targetLabel: 'בעבודה',
  style: { color: '#0073ea', icon: '▶', size: 'sm' },
};

const task = (itemId, name) => ({ itemId, name, date: '2026-08-01', statusText: 'לא התחיל' });

const noteSection = (over = {}) => ({
  sectionId: 's_done0001',
  title: 'לסיים:',
  dateColumnTitle: 'תאריך יעד',
  noteColumnId: 'text_note',
  noteColumnTitle: 'סיכום ביצוע',
  buttonId: BUTTON_DONE.id,
  buttonIds: [BUTTON_DONE.id],
  button: BUTTON_DONE,
  buttons: [BUTTON_DONE],
  tasks: [task('9001', 'גיבוש תכנית')],
  ...over,
});

const plainSection = (over = {}) => ({
  sectionId: 's_start001',
  title: 'להתחיל:',
  dateColumnTitle: 'תאריך התחלה',
  noteColumnId: null,
  noteColumnTitle: '',
  buttonId: BUTTON_START.id,
  buttonIds: [BUTTON_START.id],
  button: BUTTON_START,
  buttons: [BUTTON_START],
  tasks: [task('9002', 'תיאום ספק')],
  ...over,
});

const render = (sections) =>
  renderDigestAmp({
    baseUrl: 'https://app.example',
    secret: 'SECRET43',
    accountId: '777',
    recipient: { name: 'דנה', personId: '501', sections },
    sendHour: 8,
    now: new Date('2026-08-03T10:00:00+03:00'),
  });

/** Count non-overlapping occurrences of a literal. */
const countOf = (haystack, needle) => haystack.split(needle).length - 1;

describe('renderDigestAmp — per-task note column', () => {
  it('heads the note column with the mapped column title', () => {
    const html = render([noteSection()]);
    expect(html).toContain('סיכום ביצוע');
  });

  // The TYPED input carries the name itself (live 2026-08-04): the value used to
  // ride a bound hidden field fed by input-throttled → AMP.setState, and in Gmail
  // that state never updated, so every note reached the server EMPTY while the
  // status (fed by tap:) arrived fine. A named text input needs no binding to
  // submit — the transport no longer depends on an event firing at all.
  it('emits exactly one note_<itemId> field and it is the TYPED input', () => {
    const html = render([noteSection()]);
    expect(countOf(html, 'name="note_9001"')).toBe(1);
    expect(html).toMatch(/<input type="text"[^>]*name="note_9001"/);
  });

  it('does not fall back to a bound hidden field for the value', () => {
    const html = render([noteSection()]);
    // A hidden twin would submit the key twice, and its [value] binding is the
    // exact mechanism that silently dropped every note.
    expect(html).not.toContain('[value]="dd.n9001"');
    expect(html).not.toMatch(/<input type="hidden"[^>]*name="note_9001"/);
  });

  it('still mirrors the typed value into state — the trigger lock reads it', () => {
    const html = render([noteSection()]);
    expect(html).toContain('AMP.setState({dd:{n9001:event.value}})');
  });

  // The bulk submit — and with it the ORed "some row is marked but empty" gate
  // — was removed on 2026-08-04 when each row became its own form. The gate now
  // sits EARLIER: the row's status trigger cannot be opened at all until the
  // field holds text, so "marked but empty" is no longer a reachable state.
  it('has no bulk submit gate any more — the row trigger IS the gate', () => {
    const html = render([noteSection()]);
    expect(html).not.toContain(`(dd.v9001 != '' && dd.n9001 == '')`);
    expect(html).not.toContain('type="submit"');
    expect(html).toContain(`[disabled]="dd.n9001 == ''"`);
  });

  it('locks each row on its OWN note — no message-wide ORed expression', () => {
    const html = render([noteSection({ tasks: [task('9001', 'א'), task('9003', 'ב')] })]);
    expect(html).toContain(`[disabled]="dd.n9001 == ''"`);
    expect(html).toContain(`[disabled]="dd.n9003 == ''"`);
    expect(html).not.toContain("dd.n9001 == '' ||");
  });

  it('seeds an empty note state key per note-requiring item', () => {
    const html = render([noteSection()]);
    expect(html).toContain('"n9001":""');
  });

  it('never uses the `required` attribute — it would block rows the reader did not mark', () => {
    const html = render([noteSection(), plainSection()]);
    expect(html).not.toMatch(/<input[^>]*\srequired/);
  });

  it('leaves an unmapped cluster exactly as before — no field, no state, no gate', () => {
    const html = render([plainSection()]);
    expect(html).not.toContain('note_9002');
    expect(html).not.toContain('dd.n9002');
    expect(html).not.toContain('[disabled]');
  });

  it('gates ONLY the mapped cluster tasks when both kinds are present', () => {
    const html = render([noteSection(), plainSection()]);
    expect(html).toContain(`[disabled]="dd.n9001 == ''"`);
    expect(html).not.toContain('dd.n9002');
  });

  // Hand-built duplicate: buildDigest stopped producing one (section-priority
  // dedup, 2026-08-04). With one form per row the message-level de-dup is gone
  // and is no longer needed — each form submits alone, so each needs its own
  // named field. The two rows still SHARE the n<id> state key (one task, one
  // note), so typing in either unlocks both triggers.
  it('gives each form its own named note field when a task sits in two clusters', () => {
    const html = render([
      noteSection(),
      noteSection({
        sectionId: 's_done0002',
        title: 'גם כאן:',
        noteColumnId: 'text_other',
        noteColumnTitle: 'הערה נוספת',
      }),
    ]);
    expect(countOf(html, 'name="note_9001"')).toBe(2); // one per FORM
    expect(countOf(html, `[disabled]="dd.n9001 == ''"`)).toBe(2);
  });

  it('escapes a note column title so a quote in the board cannot break the markup', () => {
    const html = render([noteSection({ noteColumnTitle: 'סיכום "מיוחד" <b>' })]);
    expect(html).toContain('&quot;מיוחד&quot;');
    expect(html).not.toContain('<b>');
  });
});

// The status dropdown is CLOSED until the note is typed (owner decision
// 2026-08-04). Before this, the menu opened unconditionally and the empty note
// was caught one step later — at the submit gate. Locking the trigger itself
// makes the order of operations impossible to get wrong: no text, no status.
//
// The lock is `[disabled]` on the trigger, and it has to carry the STATIC
// `disabled` too: amp-bind does not evaluate bindings on load, so a trigger
// that is only bound would be tappable until the first state change — exactly
// the window this change closes.
describe('renderDigestAmp — the status dropdown is gated on the note', () => {
  /** The trigger <button> tag of one item's dropdown (it binds dd.c<id>). */
  const triggerFor = (html, id) => {
    const m = html.match(new RegExp(`<button type="button" class="dd-trig[^>]*dd\\.c${id}[^>]*>`));
    return m ? m[0] : '';
  };

  it('binds the trigger disabled to an empty note', () => {
    const html = render([noteSection()]);
    expect(triggerFor(html, '9001')).toContain(`[disabled]="dd.n9001 == ''"`);
  });

  it('ships the trigger disabled from the start — bindings do not run on load', () => {
    const html = render([noteSection()]);
    expect(triggerFor(html, '9001')).toMatch(/\sdisabled[\s>]/);
  });

  it('leaves a cluster with no mapped text column fully interactive', () => {
    const html = render([plainSection()]);
    expect(triggerFor(html, '9002')).not.toContain('disabled');
  });

  it('gates only the mapped cluster when both kinds are in one message', () => {
    const html = render([noteSection(), plainSection()]);
    expect(triggerFor(html, '9001')).toContain(`[disabled]="dd.n9001 == ''"`);
    expect(triggerFor(html, '9002')).not.toContain('disabled');
  });

  // The gate reads dd.n<id>, and `input-throttled` was measured NOT firing in
  // Gmail (2026-08-04) — on that event alone the trigger would stay locked
  // forever. `change` fires when the field is left, so the state has a second,
  // independent chance to update.
  it('feeds the note state from `change` as well as input-throttled', () => {
    const html = render([noteSection()]);
    expect(html).toContain('change:AMP.setState({dd:{n9001:event.value}})');
    expect(html).toContain('input-throttled:AMP.setState({dd:{n9001:event.value}})');
  });

  it('greys the locked trigger so it reads as locked, not broken', () => {
    const html = render([noteSection()]);
    expect(html).toContain('.dd-trig[disabled]');
  });

  it('does not ship the locked-trigger rule to a message with no notes', () => {
    const html = render([plainSection()]);
    expect(html).not.toContain('.dd-trig[disabled]');
  });

  // 0.15.0 moved that sentence OUT of the renderer: the mail carries no
  // pre-written text, so the note hint is a text block. A tenant whose config
  // predates blocks still gets it — legacyBlocksFromSections re-creates it when
  // (and only when) some cluster maps a note column, asserted in
  // digest-blocks.test.js and end-to-end in digest-amp-blocks.test.js.
  it('does not bake the note instruction into the document itself', () => {
    const html = render([noteSection()]);
    expect(html).not.toContain('לא ניתן לבחור סטטוס');
  });
});
