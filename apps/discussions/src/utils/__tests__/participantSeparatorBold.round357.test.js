import { describe, it, expect } from 'vitest';
import { Packer } from 'docx';
import { unzipSync, strFromU8 } from 'fflate';
import { buildDiscussionModel, __testHooks } from '../docxExport.js';
import { DEFAULT_EXPORT_TEMPLATE } from '../mondayApi/boards.config.js';

/*
 * round357 (owner spec) + the Codex P2 on the release PR — the separator between a
 * person's name and their title is SHORT and BOLD. Bold is a property of a .docx RUN,
 * so the assertion has to read the runs of the real rendered document, not its text:
 * a test on the text alone passed while the dash rendered thin.
 *
 * The regression this pins: the per-line branch mapped the separator to a bold run,
 * but the SINGLE-ROW branch (perLine off — the DEFAULT, where most documents live)
 * flattened the same segments back into one plain string. Both branches must build
 * from the segments.
 */

// The runs of every paragraph, with their bold flag, in document order.
const runsOf = async (model, template) => {
  const { doc } = await __testHooks.buildExportDoc(model, template);
  const xml = strFromU8(unzipSync(new Uint8Array(await Packer.toBuffer(doc)))['word/document.xml']);
  return (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []).map((p) =>
    (p.match(/<w:r>[\s\S]*?<\/w:r>/g) || [])
      .map((r) => ({
        text: (r.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [])
          .map((t) => t.replace(/<[^>]+>/g, ''))
          .join(''),
        bold: /<w:b\s*\/>/.test(r),
      }))
      .filter((r) => r.text)
  );
};

const DASH = ' – ';
const PARTS = [{ key: 'name', sep: ', ' }, { key: 'title', sep: DASH }];

const tplWith = (perLine) => ({
  ...DEFAULT_EXPORT_TEMPLATE,
  people: { ...DEFAULT_EXPORT_TEMPLATE.people, perLine, parts: PARTS },
});

const MODEL = buildDiscussionModel({
  discussion: {
    name: 'דיון בדיקה',
    participantsID: [
      { id: '1', name: 'עידו פיוטרקובסקי' },
      { id: '2', name: 'ליז עובדיה' },
    ],
  },
  participantProfiles: {
    1: { title: 'מנהל מחלקת מכירות', customFields: {} },
    2: { title: 'מנכ״לית העירייה', customFields: {} },
  },
});

// The paragraph that carries the participants, whichever form it took.
const dashRuns = (paras) =>
  paras.flat().filter((r) => r.text === DASH);

describe('round357 — the name/title separator renders BOLD', () => {
  it('line-per-person: every dash is its own bold run', async () => {
    const paras = await runsOf(MODEL, tplWith(true));
    const dashes = dashRuns(paras);
    expect(dashes.length).toBe(2);           // one per participant
    expect(dashes.every((r) => r.bold)).toBe(true);
  });

  it('SINGLE ROW (the default): the dash is bold there too', async () => {
    const paras = await runsOf(MODEL, tplWith(false));
    const dashes = dashRuns(paras);
    expect(dashes.length).toBe(2);
    expect(dashes.every((r) => r.bold)).toBe(true);
  });

  it('single row: the comma BETWEEN people is not bold — it separates records, not parts', async () => {
    const paras = await runsOf(MODEL, tplWith(false));
    const commas = paras.flat().filter((r) => r.text === ', ');
    expect(commas.length).toBeGreaterThan(0);
    expect(commas.some((r) => r.bold)).toBe(false);
  });

  it('the people text itself stays normal weight in both forms', async () => {
    for (const perLine of [true, false]) {
      const names = (await runsOf(MODEL, tplWith(perLine)))
        .flat()
        .filter((r) => r.text.includes('עידו פיוטרקובסקי') || r.text.includes('מנהל מחלקת מכירות'));
      expect(names.length).toBeGreaterThan(0);
      expect(names.some((r) => r.bold)).toBe(false);
    }
  });
});
