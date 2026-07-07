import { describe, it, expect } from 'vitest';
import { sanitizeSummaryHtml, isSummaryHtmlEmpty, toMondayHtml, toEditorHtml } from '../summaryHtml.js';

describe('sanitizeSummaryHtml', () => {
  it('keeps the allowed tag subset as-is', () => {
    const html = '<h1>כותרת</h1><p>פסקה <b>מודגש</b> <i>נטוי</i> <u>קו</u></p><ul><li>א</li></ul><ol><li>1</li></ol>';
    expect(sanitizeSummaryHtml(html)).toBe(html);
  });

  it('unwraps a disallowed element but keeps its text', () => {
    expect(sanitizeSummaryHtml('<p>a <span>b</span> c</p>')).toBe('<p>a b c</p>');
    expect(sanitizeSummaryHtml('<div><p>hi</p></div>')).toBe('<p>hi</p>');
  });

  it('drops <script>/<style> entirely (content included)', () => {
    const out = sanitizeSummaryHtml('<p>ok</p><script>alert(1)</script><style>.x{}</style>');
    expect(out).toBe('<p>ok</p>');
    expect(out).not.toContain('alert');
    expect(out).not.toContain('{');
  });

  it('strips all attributes (styles/classes/handlers)', () => {
    expect(sanitizeSummaryHtml('<h2 class="x" style="color:red" onclick="evil()">T</h2>')).toBe('<h2>T</h2>');
  });

  it('is defensive against empty/garbage input', () => {
    expect(sanitizeSummaryHtml('')).toBe('');
    expect(sanitizeSummaryHtml(null)).toBe('');
    expect(sanitizeSummaryHtml(undefined)).toBe('');
  });
});

describe('sanitizeSummaryHtml — monday-compatible rich formats', () => {
  it('keeps strikethrough and color spans', () => {
    expect(sanitizeSummaryHtml('<p><s>חוצה</s></p>')).toBe('<p><s>חוצה</s></p>');
    expect(sanitizeSummaryHtml('<p><span style="color: #e44258">אדום</span></p>'))
      .toBe('<p><span style="color: #e44258">אדום</span></p>');
  });

  it('keeps font-size spans (the size picker)', () => {
    expect(sanitizeSummaryHtml('<p><span style="font-size: 24px">גדול</span></p>'))
      .toBe('<p><span style="font-size: 24px">גדול</span></p>');
  });

  it('keeps text-align on a block but drops color there', () => {
    expect(sanitizeSummaryHtml('<p style="text-align: center; color: red">מרכז</p>'))
      .toBe('<p style="text-align: center">מרכז</p>');
  });

  it('keeps a safe link (adds target/rel) and drops a javascript: link', () => {
    expect(sanitizeSummaryHtml('<a href="https://x.co">x</a>'))
      .toBe('<a href="https://x.co" target="_blank" rel="noopener noreferrer">x</a>');
    expect(sanitizeSummaryHtml('<a href="javascript:alert(1)">x</a>')).toBe('x');
  });

  it('keeps the checklist class tokens but no others', () => {
    expect(sanitizeSummaryHtml('<ul class="checklist foo"><li class="checklist_task is_checked bar">a</li></ul>'))
      .toBe('<ul class="checklist"><li class="checklist_task is_checked">a</li></ul>');
  });
});

describe('checklist translation', () => {
  const TIPTAP =
    '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox"></label><div><p>בוצע</p></div></li>'
    + '<li data-type="taskItem" data-checked="false"><label><input type="checkbox"></label><div><p>פתוח</p></div></li></ul>';
  const MONDAY =
    '<ul class="checklist"><li class="checklist_task is_checked">בוצע</li><li class="checklist_task">פתוח</li></ul>';

  it('toMondayHtml converts a TipTap task list to monday checklist markup', () => {
    expect(toMondayHtml(TIPTAP)).toBe(MONDAY);
  });

  it('toEditorHtml converts monday checklist markup back to a TipTap task list', () => {
    const out = toEditorHtml(MONDAY);
    expect(out).toContain('<ul data-type="taskList">');
    expect(out).toContain('data-type="taskItem"');
    expect(out).toContain('data-checked="true"');
    expect(out).toContain('data-checked="false"');
    expect(out).toContain('<p>בוצע</p>');
  });

  it('round-trips checked state through save -> load', () => {
    const back = toEditorHtml(toMondayHtml(TIPTAP));
    expect(back).toContain('data-checked="true"');
    expect(back).toContain('data-checked="false"');
    expect(back).toContain('בוצע');
    expect(back).toContain('פתוח');
  });
});

describe('isSummaryHtmlEmpty', () => {
  it('treats empty paragraph / blank / null as empty', () => {
    expect(isSummaryHtmlEmpty('<p></p>')).toBe(true);
    expect(isSummaryHtmlEmpty('<p>   </p>')).toBe(true);
    expect(isSummaryHtmlEmpty('')).toBe(true);
    expect(isSummaryHtmlEmpty(null)).toBe(true);
  });

  it('treats text or structural content as non-empty', () => {
    expect(isSummaryHtmlEmpty('<p>hi</p>')).toBe(false);
    expect(isSummaryHtmlEmpty('<ul><li></li></ul>')).toBe(false);
    expect(isSummaryHtmlEmpty('<p><br></p>')).toBe(false);
  });
});
