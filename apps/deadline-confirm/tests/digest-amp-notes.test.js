// TDD — the amp4email note column. Two things must hold in the rendered
// document, and they are different claims:
//
//  1. The reader can type a note per row, and that text reaches the wire as
//     note_<itemId> — ONE hidden field per item even when the task appears in
//     two clusters, mirroring how the status selection already works.
//  2. The submit button is disabled while a MARKED row has an empty note.
//     `required` on the inputs (the obvious HTML answer) is wrong here: this is
//     one bulk form, so it would block submission over rows the reader never
//     marked. The gate has to be conditional, which means amp-bind.

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

  it('still mirrors the typed value into state — the submit gate reads it', () => {
    const html = render([noteSection()]);
    expect(html).toContain('AMP.setState({dd:{n9001:event.value}})');
  });

  it('disables submit while a MARKED row has an empty note', () => {
    const html = render([noteSection()]);
    expect(html).toContain(`[disabled]="(dd.v9001 != '' && dd.n9001 == '')"`);
  });

  it('ORs the condition across every note-requiring task', () => {
    const html = render([noteSection({ tasks: [task('9001', 'א'), task('9003', 'ב')] })]);
    expect(html).toContain(
      `[disabled]="(dd.v9001 != '' && dd.n9001 == '') || (dd.v9003 != '' && dd.n9003 == '')"`
    );
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
    expect(html).toContain(`[disabled]="(dd.v9001 != '' && dd.n9001 == '')"`);
    expect(html).not.toContain('dd.n9002');
  });

  // Hand-built duplicate: buildDigest stopped producing one (section-priority
  // dedup, 2026-08-04); the renderer's note de-dup stays as defence-in-depth.
  it('one hidden note field for a task that appears in TWO mapped clusters', () => {
    const html = render([
      noteSection(),
      noteSection({
        sectionId: 's_done0002',
        title: 'גם כאן:',
        noteColumnId: 'text_other',
        noteColumnTitle: 'הערה נוספת',
      }),
    ]);
    expect(countOf(html, 'name="note_9001"')).toBe(1);
    // ...and the gate is not duplicated for the same item either.
    expect(html).toContain(`[disabled]="(dd.v9001 != '' && dd.n9001 == '')"`);
  });

  it('escapes a note column title so a quote in the board cannot break the markup', () => {
    const html = render([noteSection({ noteColumnTitle: 'סיכום "מיוחד" <b>' })]);
    expect(html).toContain('&quot;מיוחד&quot;');
    expect(html).not.toContain('<b>');
  });
});
