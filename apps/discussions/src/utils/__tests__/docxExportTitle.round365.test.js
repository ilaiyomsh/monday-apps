process.env.TZ = 'Asia/Jerusalem';

import { describe, it, expect } from 'vitest';
import { Packer } from 'docx';
import { unzipSync, strFromU8 } from 'fflate';
import { buildDiscussionModel, __testHooks } from '../docxExport.js';
import { DEFAULT_EXPORT_TEMPLATE } from '../mondayApi/boards.config.js';

/*
 * round365 — the exported document's TITLE is composed from the template's
 * title config instead of the old hardcoded `סיכום דיון: <שם>`. These pack a
 * real .docx and assert on word/document.xml, like the rest of this suite.
 */

const model = () => buildDiscussionModel({
  discussion: {
    name: 'ישיבת צוות שבועית',
    discussionDateID: new Date('2026-08-06T00:00:00Z'),
    participantsID: [{ id: '1', name: 'דנה' }],
  },
  // the model's typesText comes from the CALLER-resolved label (assembleDiscussionModel)
  typeLabel: 'דיון כללי',
  topics: [{ name: 'נושא', _subitems: [{ name: 'נקודה' }] }],
  tasks: [],
});

const xmlOf = async (template) => {
  const { doc } = await __testHooks.buildExportDoc(model(), template);
  return strFromU8(unzipSync(new Uint8Array(await Packer.toBuffer(doc)))['word/document.xml']);
};

describe('round365 — the docx title follows the template title config', () => {
  it('DEFAULT template: free "סיכום דיון" - name date(DD.MM.YYYY), centered — not the old colon form', async () => {
    const xml = await xmlOf(DEFAULT_EXPORT_TEMPLATE);
    expect(xml).toContain('סיכום דיון - ישיבת צוות שבועית 06.08.2026');
    expect(xml).not.toContain('סיכום דיון: ישיבת צוות שבועית');
  });

  it('a LEGACY template with no title key composes the same shipped default', async () => {
    const { title, ...legacy } = DEFAULT_EXPORT_TEMPLATE;
    const xml = await xmlOf(legacy);
    expect(xml).toContain('סיכום דיון - ישיבת צוות שבועית 06.08.2026');
  });

  it('a custom config drives text, order, separators AND alignment (right → w:jc start, never "right")', async () => {
    const template = {
      ...DEFAULT_EXPORT_TEMPLATE,
      title: {
        free: 'פרוטוקול', field2: 'discussionType', field3: 'none',
        order: ['field2', 'free', 'field3'], sep12: 'colon', sep23: 'space', align: 'right',
      },
    };
    const xml = await xmlOf(template);
    expect(xml).toContain('דיון כללי: פרוטוקול');
    // the title heading paragraph aligns START (RTL-safe right), not CENTER
    const titleIdx = xml.indexOf('דיון כללי: פרוטוקול');
    const before = xml.slice(Math.max(0, titleIdx - 600), titleIdx);
    expect(before).toContain('w:jc w:val="start"');
  });
});
