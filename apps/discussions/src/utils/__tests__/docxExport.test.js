// Pin an east-of-UTC timezone (the app's real user base) so the date-formatting
// tests can actually catch UTC/local day-shift regressions (round195).
process.env.TZ = 'Asia/Jerusalem';

import { describe, it, expect } from 'vitest';
import { Packer } from 'docx';
import { unzipSync, strFromU8 } from 'fflate';
import {
  filterTopicsForExport,
  mergeTasksForExport,
  buildDiscussionModel,
  renderDocx,
  injectSectionRtlIntoZip,
  parseImageMeta,
  __testHooks,
} from '../docxExport.js';
import { spliceBodyIntoTemplate } from '../docxTemplateMerge.js';

// A 1x1 transparent PNG (base64) for image-parse + logo tests.
const PNG_1x1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('filterTopicsForExport', () => {
  it('drops a topic marked notForDiscussion entirely', () => {
    const topics = [
      { name: 'A', notForDiscussion: true, _subitems: [{ name: 'p1' }] },
      { name: 'B', notForDiscussion: false, _subitems: [{ name: 'p2' }] },
    ];
    const out = filterTopicsForExport(topics);
    expect(out).toEqual([{ name: 'B', points: [{ name: 'p2' }] }]);
  });

  it('drops individual points marked notForDiscussion', () => {
    const topics = [
      { name: 'A', _subitems: [
        { name: 'keep' },
        { name: 'drop', notForDiscussion: true },
      ] },
    ];
    expect(filterTopicsForExport(topics)).toEqual([{ name: 'A', points: [{ name: 'keep' }] }]);
  });

  it('drops a topic that becomes empty after filtering its points', () => {
    const topics = [
      { name: 'A', _subitems: [{ name: 'p', notForDiscussion: true }] },
      { name: 'B', _subitems: [{ name: 'q' }] },
    ];
    expect(filterTopicsForExport(topics)).toEqual([{ name: 'B', points: [{ name: 'q' }] }]);
  });

  it('drops a topic with no points at all', () => {
    expect(filterTopicsForExport([{ name: 'A', _subitems: [] }])).toEqual([]);
  });

  it('treats undefined notForDiscussion as included (for discussion by default)', () => {
    const topics = [{ name: 'A', _subitems: [{ name: 'p' }] }];
    expect(filterTopicsForExport(topics)).toEqual([{ name: 'A', points: [{ name: 'p' }] }]);
  });

  it('accepts a pre-shaped { points } list as well as _subitems', () => {
    const topics = [{ name: 'A', points: [{ name: 'p' }, { name: 'q', notForDiscussion: true }] }];
    expect(filterTopicsForExport(topics)).toEqual([{ name: 'A', points: [{ name: 'p' }] }]);
  });

  it('is safe on empty / undefined input', () => {
    expect(filterTopicsForExport()).toEqual([]);
    expect(filterTopicsForExport([])).toEqual([]);
  });
});

describe('mergeTasksForExport', () => {
  it('tags current tasks fromPrevious:false and previous tasks fromPrevious:true', () => {
    const current = [{ id: '1', name: 'now' }];
    const previous = [{ id: '2', name: 'before' }];
    const out = mergeTasksForExport(current, previous);
    expect(out).toEqual([
      { id: '1', name: 'now', fromPrevious: false },
      { id: '2', name: 'before', fromPrevious: true },
    ]);
  });

  it('de-duplicates a task present in both — current wins (fromPrevious:false)', () => {
    const current = [{ id: '1', name: 'shared' }];
    const previous = [{ id: '1', name: 'shared' }, { id: '2', name: 'old' }];
    const out = mergeTasksForExport(current, previous);
    expect(out).toEqual([
      { id: '1', name: 'shared', fromPrevious: false },
      { id: '2', name: 'old', fromPrevious: true },
    ]);
  });

  it('handles no previous discussion (only current tasks)', () => {
    expect(mergeTasksForExport([{ id: '1', name: 'a' }], [])).toEqual([
      { id: '1', name: 'a', fromPrevious: false },
    ]);
  });

  it('is safe on empty / undefined input', () => {
    expect(mergeTasksForExport()).toEqual([]);
  });
});

describe('buildDiscussionModel', () => {
  it('formats metadata, filters topics, and shapes tasks into plain strings', () => {
    const model = buildDiscussionModel({
      discussion: {
        name: 'דיון הנהלה',
        discussionDateID: new Date('2026-06-07T00:00:00Z'),
        participantsID: [{ id: '1', name: 'דנה' }, { id: '2', name: 'יוסי' }],
      },
      topics: [
        { name: 'תקציב', _subitems: [{ name: 'נקודה 1' }, { name: 'מוסתר', notForDiscussion: true }] },
        { name: 'מוסתר', notForDiscussion: true, _subitems: [{ name: 'x' }] },
      ],
      summaryHtml: '<p>סיכום הדיון</p>',
      tasks: [
        { id: '1', name: 'משימה א', assignees: [{ id: '1', name: 'דנה' }], deadline: new Date('2026-07-01T00:00:00Z'), status: 'בעבודה', fromPrevious: false },
        { id: '2', name: 'משימה ב', assignees: [], deadline: null, status: null, fromPrevious: true },
      ],
    });

    expect(model.title).toBe('דיון הנהלה');
    expect(model.participantsText).toBe('דנה, יוסי');
    expect(model.dateText).toBeTruthy();
    expect(model.topics).toEqual([{ name: 'תקציב', points: [{ name: 'נקודה 1' }] }]);
    expect(model.summaryHtml).toBe('<p>סיכום הדיון</p>');
    expect(model.tasks).toEqual([
      { name: 'משימה א', assigneesText: 'דנה', deadlineText: expect.any(String), status: 'בעבודה', fromPrevious: false },
      { name: 'משימה ב', assigneesText: '', deadlineText: '', status: '', fromPrevious: true },
    ]);
  });

  it('falls back to a default title and empty fields with no data', () => {
    const model = buildDiscussionModel({ discussion: {} });
    expect(model.title).toBe('דיון');
    expect(model.participantsText).toBe('');
    expect(model.dateText).toBe('');
    expect(model.topics).toEqual([]);
    expect(model.summaryHtml).toBe('');
    expect(model.tasks).toEqual([]);
  });

  it('formats a local-midnight Date to the SAME calendar day — no UTC day-shift (round195)', () => {
    // parseValue('date') returns LOCAL midnight for date-only monday values; with
    // the old getUTC* formatting this rendered 06.06.2026 in Asia/Jerusalem.
    const model = buildDiscussionModel({ discussion: { discussionDateID: new Date(2026, 5, 7) } });
    expect(model.dateText).toBe('07.06.2026');
  });

  it('shapes decisions into plain strings — decider names, date, status label (round192)', () => {
    const model = buildDiscussionModel({
      discussion: {},
      decisions: [
        { name: 'החלטה א', decider: [{ id: '1', name: 'דנה' }, { id: '2', name: 'יוסי' }], date: new Date('2026-07-03T00:00:00Z'), status: 'אושר' },
        { name: 'החלטה ב', decider: [], date: null, status: '' },
      ],
    });
    expect(model.decisions).toEqual([
      { name: 'החלטה א', deciderText: 'דנה, יוסי', dateText: expect.any(String), status: 'אושר' },
      { name: 'החלטה ב', deciderText: '', dateText: '', status: '' },
    ]);
  });

  it('defaults decisions to an empty array when none are given (round192)', () => {
    expect(buildDiscussionModel({ discussion: {} }).decisions).toEqual([]);
  });

  it('orders tasks by responsible, grouping each person together, empty-assignee last (round191)', () => {
    const model = buildDiscussionModel({
      discussion: {},
      tasks: [
        { id: '1', name: 'עילי-ראשונה', assignees: [{ id: 'a', name: 'עילי' }], status: 'x' },
        { id: '2', name: 'ללא-אחראי', assignees: [], status: 'x' },
        { id: '3', name: 'עידו-אחת', assignees: [{ id: 'b', name: 'עידו' }], status: 'x' },
        { id: '4', name: 'עילי-שנייה', assignees: [{ id: 'a', name: 'עילי' }], status: 'x' },
      ],
    });
    // 'עידו' < 'עילי' (ד before ל); the two 'עילי' keep their input order (stable
    // sort); the assignee-less task sorts last.
    expect(model.tasks.map((t) => t.name)).toEqual([
      'עידו-אחת', 'עילי-ראשונה', 'עילי-שנייה', 'ללא-אחראי',
    ]);
  });
});

describe('renderDocx', () => {
  it('produces a non-empty .docx Blob from a model (RTL paragraphs + table)', async () => {
    const model = buildDiscussionModel({
      discussion: { name: 'בדיקה', participantsID: [{ id: '1', name: 'דנה' }] },
      topics: [{ name: 'נושא', _subitems: [{ name: 'נקודה' }] }],
      summaryHtml: '<h3>כותרת</h3><p>טקסט <b>מודגש</b> ו<i>נטוי</i></p><ul><li>פריט א</li><li>פריט ב</li></ul><ol><li>ממוספר</li></ol>',
      tasks: [{ id: '1', name: 'משימה', assignees: [], deadline: null, status: 'בעבודה', fromPrevious: true }],
    });
    const blob = await renderDocx(model);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders an empty discussion without throwing', async () => {
    const blob = await renderDocx(buildDiscussionModel({ discussion: {} }));
    expect(blob.size).toBeGreaterThan(0);
  });
});

describe('data-driven template (buildExportDoc)', () => {
  const baseModel = () => buildDiscussionModel({
    discussion: { name: 'דיון', discussionDateID: new Date('2026-07-05T00:00:00Z'), participantsID: [{ id: '1', name: 'דנה' }] },
    topics: [{ name: 'נושא', _subitems: [{ name: 'נקודה' }] }],
    summaryHtml: '<p>סיכום</p>',
    tasks: [{ id: '1', name: 'משימה', assignees: [], deadline: null, status: 'בעבודה', fromPrevious: false }],
  });
  const xmlOf = async (model, template) => {
    const { doc } = await __testHooks.buildExportDoc(model, template);
    return strFromU8(unzipSync(new Uint8Array(await Packer.toBuffer(doc)))['word/document.xml']);
  };

  it('omits a section that is disabled', async () => {
    const template = {
      sections: [
        { key: 'topics', enabled: true, label: 'נושאים לדיון' },
        { key: 'tasks', enabled: false, label: 'משימות' },
      ],
    };
    const xml = await xmlOf(baseModel(), template);
    expect(xml).toContain('נושאים לדיון');
    expect(xml).not.toContain('משימות');
  });

  it('honors section order (summary before topics)', async () => {
    const template = {
      sections: [
        { key: 'summary', enabled: true, label: 'סיכום' },
        { key: 'topics', enabled: true, label: 'נושאים לדיון' },
      ],
    };
    const xml = await xmlOf(baseModel(), template);
    expect(xml.indexOf('סיכום')).toBeLessThan(xml.indexOf('נושאים לדיון'));
  });

  it('uses a custom metadata label and skips disabled fields', async () => {
    const template = {
      sections: [
        { key: 'meta', enabled: true, fields: [
          { key: 'dateText', enabled: true, label: 'מועד' },
          { key: 'participantsText', enabled: false, label: 'משתתפים' },
        ] },
      ],
    };
    const xml = await xmlOf(baseModel(), template);
    expect(xml).toContain('מועד');       // renamed label present
    expect(xml).not.toContain('משתתפים'); // disabled field absent
  });

  // round203 — the freeText ("פתיחה") section was retired: a stale stored
  // template that still carries it must render NOTHING for it.
  it('ignores a retired freeText section left in a stored template', async () => {
    const template = {
      sections: [
        { key: 'freeText', enabled: true, title: 'הערות', body: 'שורה א' },
        { key: 'summary', enabled: true },
      ],
    };
    const xml = await xmlOf(baseModel(), template);
    expect(xml).not.toContain('הערות');
    expect(xml).not.toContain('שורה א');
    expect(xml).toContain('סיכום'); // the rest of the template still renders
  });

  it('tasks table has the 5 columns and NO "מדיון קודם" column (round191)', async () => {
    const template = { sections: [{ key: 'tasks', enabled: true, label: 'משימות' }] };
    const xml = await xmlOf(baseModel(), template);
    expect(xml).toContain('אחראי');   // assignee header kept
    expect(xml).toContain('סטטוס');    // status header kept
    expect(xml).not.toContain('מדיון קודם'); // the removed column header
  });

  it('renders the references section through the HTML converter (round200)', async () => {
    const model = buildDiscussionModel({
      discussion: { name: 'ד' },
      referencesHtml: '<p><strong>דנה כהן:</strong> הערת-בדיקה-מיוחדת</p><ul><li>סעיף-ראשון-לבדיקה</li></ul>',
    });
    const template = { sections: [{ key: 'references', enabled: true, label: 'התייחסויות' }] };
    const xml = await xmlOf(model, template);
    expect(xml).toContain('התייחסויות');          // section heading
    expect(xml).toContain('הערת-בדיקה-מיוחדת');   // rich body survived
    expect(xml).toContain('סעיף-ראשון-לבדיקה');   // list item survived
  });

  it('renders "אין התייחסויות." when the references box is empty (round200)', async () => {
    const template = { sections: [{ key: 'references', enabled: true, label: 'התייחסויות' }] };
    const xml = await xmlOf(baseModel(), template);
    expect(xml).toContain('אין התייחסויות.');
  });

  it('renders a decisions table with only מס׳/החלטה/מחליט — no date/status columns (round193)', async () => {
    const model = buildDiscussionModel({
      discussion: { name: 'ד' },
      decisions: [{ name: 'החלטה חשובה', decider: [{ id: '1', name: 'דנה' }], date: new Date('2026-07-03T00:00:00Z'), status: 'אושר' }],
    });
    const template = { sections: [{ key: 'decisions', enabled: true, label: 'החלטות' }] };
    const xml = await xmlOf(model, template);
    expect(xml).toContain('מחליט');        // decider column header kept
    expect(xml).toContain('החלטה חשובה');  // the decision text
    expect(xml).toContain('דנה');          // decider name
    // round193 — date + status columns were removed from the decisions table
    expect(xml).not.toContain('תאריך');    // no date column header
    expect(xml).not.toContain('סטאטוס');   // no status column header
    expect(xml).not.toContain('אושר');     // status value no longer rendered
  });
});

describe('parseImageMeta', () => {
  it('reads PNG dimensions from the data URI', () => {
    const meta = parseImageMeta(PNG_1x1);
    expect(meta).toMatchObject({ type: 'png', width: 1, height: 1 });
    expect(meta.data).toBeInstanceOf(Uint8Array);
  });
  it('returns null for non-image / malformed input', () => {
    expect(parseImageMeta('')).toBeNull();
    expect(parseImageMeta('data:text/plain;base64,QQ==')).toBeNull();
    expect(parseImageMeta(undefined)).toBeNull();
  });
});

describe('config header/footer', () => {
  const model = () => buildDiscussionModel({
    discussion: { name: 'דיון', discussionDateID: new Date('2026-07-05T00:00:00Z'), participantsID: [] },
    topics: [], summaryHtml: '', tasks: [],
  });
  const filesOf = async (template, assets) => {
    const { doc } = await __testHooks.buildExportDoc(model(), template, assets);
    return unzipSync(new Uint8Array(await Packer.toBuffer(doc)));
  };

  it('adds a header part with logo + text when configured', async () => {
    const template = {
      sections: [{ key: 'meta', enabled: true, fields: [] }],
      headerMode: 'config',
      header: { hasLogo: true, logoPos: 'center', text: 'חברת אקמה', textAlign: 'center', meta: { name: true, date: false } },
      footer: { hasLogo: false, text: '', meta: {} },
    };
    const files = await filesOf(template, { headerLogo: PNG_1x1 });
    const names = Object.keys(files);
    expect(names.some((n) => /word\/header\d*\.xml/.test(n))).toBe(true);
    const headerXml = strFromU8(files[names.find((n) => /word\/header\d*\.xml/.test(n))]);
    expect(headerXml).toContain('חברת אקמה');
    expect(names.some((n) => /word\/media\//.test(n))).toBe(true); // logo embedded
  });

  it('adds a footer part with a page number when configured', async () => {
    const template = {
      sections: [{ key: 'meta', enabled: true, fields: [] }],
      headerMode: 'config',
      header: { hasLogo: false, text: '', meta: {} },
      footer: { hasLogo: false, text: 'חסוי', textAlign: 'center', meta: { date: false, page: true } },
    };
    const files = await filesOf(template);
    const names = Object.keys(files);
    const footerName = names.find((n) => /word\/footer\d*\.xml/.test(n));
    expect(footerName).toBeTruthy();
    const footerXml = strFromU8(files[footerName]);
    expect(footerXml).toContain('חסוי');
    expect(footerXml).toContain('PAGE'); // page-number field
  });

  it('produces NO header/footer part for the default (empty) template', async () => {
    const files = await filesOf(undefined);
    const names = Object.keys(files);
    expect(names.some((n) => /word\/header\d*\.xml/.test(n))).toBe(false);
    expect(names.some((n) => /word\/footer\d*\.xml/.test(n))).toBe(false);
  });
});

describe('spliceBodyIntoTemplate (upload mode)', () => {
  const bytesOf = async (model, template, assets) => {
    const { doc } = await __testHooks.buildExportDoc(model, template, assets);
    return new Uint8Array(await Packer.toBuffer(doc));
  };

  it('keeps the template header/footer and replaces its body with the generated content', async () => {
    // "Uploaded template" = a docx built with a config header carrying a brand mark
    // and its own (to-be-discarded) body title.
    const tplBytes = await bytesOf(
      buildDiscussionModel({ discussion: { name: 'תבנית-ישנה', participantsID: [] }, topics: [], summaryHtml: '', tasks: [] }),
      {
        sections: [{ key: 'meta', enabled: true, fields: [] }],
        headerMode: 'config',
        header: { hasLogo: false, text: 'מותג-אקמה', textAlign: 'center', meta: {} },
        footer: { hasLogo: false, text: 'כותרת-תחתונה-מהתבנית', textAlign: 'center', meta: {} },
      }
    );
    // Generated body-only doc (upload mode ⇒ no header/footer of its own).
    const bodyBytes = await bytesOf(
      buildDiscussionModel({ discussion: { name: 'x', participantsID: [] }, topics: [{ name: 'נושא-חדש-מיוחד', _subitems: [{ name: 'נק' }] }], summaryHtml: '', tasks: [] }),
      { sections: [{ key: 'topics', enabled: true, label: 'נושאים לדיון' }], headerMode: 'upload' }
    );

    const merged = spliceBodyIntoTemplate(tplBytes, bodyBytes);
    const files = unzipSync(merged);
    const names = Object.keys(files);
    // header + footer parts from the template survive
    const headerName = names.find((n) => /word\/header\d*\.xml/.test(n));
    const footerName = names.find((n) => /word\/footer\d*\.xml/.test(n));
    expect(headerName).toBeTruthy();
    expect(footerName).toBeTruthy();
    expect(strFromU8(files[headerName])).toContain('מותג-אקמה');
    expect(strFromU8(files[footerName])).toContain('כותרת-תחתונה-מהתבנית');
    // body replaced: generated content in, template's old title out
    const docXml = strFromU8(files['word/document.xml']);
    expect(docXml).toContain('נושא-חדש-מיוחד');
    expect(docXml).not.toContain('תבנית-ישנה');
  });

  it('throws on a zip without document.xml (caller falls back)', () => {
    expect(() => spliceBodyIntoTemplate(new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6]))).toThrow();
  });
});

describe('injectSectionRtlIntoZip', () => {
  it('adds section-level <w:bidi/> so the whole document is RTL', async () => {
    const { doc } = await __testHooks.buildExportDoc(buildDiscussionModel({
      discussion: { name: 'דיון', participantsID: [] },
      topics: [{ name: 'נושא', _subitems: [{ name: 'נקודה' }] }],
      summaryHtml: '<p>סיכום</p>',
      tasks: [{ id: '1', name: 'משימה', assignees: [], deadline: null, status: 'בעבודה', fromPrevious: false }],
    }));
    const raw = new Uint8Array(await Packer.toBuffer(doc));
    const beforeXml = strFromU8(unzipSync(raw)['word/document.xml']);
    expect(/<w:sectPr[\s\S]*?<w:bidi\/>[\s\S]*?<\/w:sectPr>/.test(beforeXml)).toBe(false);

    const injected = injectSectionRtlIntoZip(raw);
    const afterXml = strFromU8(unzipSync(injected)['word/document.xml']);
    expect(/<w:sectPr[\s\S]*?<w:bidi\/>[\s\S]*?<\/w:sectPr>/.test(afterXml)).toBe(true);
  });

  it('is idempotent and never throws on garbage input', () => {
    const garbage = new Uint8Array([1, 2, 3, 4]);
    expect(injectSectionRtlIntoZip(garbage)).toBe(garbage); // returns input on failure
  });
});
