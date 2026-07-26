import { describe, it, expect } from 'vitest';
import { Packer } from 'docx';
import { unzipSync, strFromU8 } from 'fflate';
import { buildDiscussionModel, __testHooks } from '../docxExport.js';

// round211 — external participants in the Word export: the participants meta
// row SPLITS into פנימיים/חיצוניים only when externals exist. (jsdom Blob has
// no arrayBuffer, so we go through __testHooks.buildExportDoc + Packer like
// the rest of the docx suite.)
const docXmlOf = async (model) => {
  const { doc } = await __testHooks.buildExportDoc(model);
  return strFromU8(unzipSync(new Uint8Array(await Packer.toBuffer(doc)))['word/document.xml']);
};

const DISC = {
  name: 'דיון בדיקה',
  participantsID: [{ id: '1', name: 'דנה לוי' }, { id: '2', name: 'יוסי כהן' }],
};

describe('external participants — model + docx meta split', () => {
  it('buildDiscussionModel exposes externalParticipantsText from the long_text column', () => {
    const model = buildDiscussionModel({ discussion: { ...DISC, externalParticipantsID: 'רוני שגב, גיל אדם' } });
    expect(model.externalParticipantsText).toBe('רוני שגב, גיל אדם');
    expect(buildDiscussionModel({ discussion: DISC }).externalParticipantsText).toBe('');
  });

  it('WITH externals: the docx meta shows משתתפים פנימיים + משתתפים חיצוניים', async () => {
    const model = buildDiscussionModel({ discussion: { ...DISC, externalParticipantsID: 'רוני שגב' } });
    const xml = await docXmlOf(model);
    expect(xml).toContain('משתתפים פנימיים');
    expect(xml).toContain('משתתפים חיצוניים');
    expect(xml).toContain('רוני שגב');
    expect(xml).toContain('דנה לוי');
  });

  it('WITHOUT externals: the participants row keeps its plain משתתפים label', async () => {
    const model = buildDiscussionModel({ discussion: DISC });
    const xml = await docXmlOf(model);
    expect(xml).toContain('משתתפים');
    expect(xml).not.toContain('משתתפים פנימיים');
    expect(xml).not.toContain('משתתפים חיצוניים');
  });
});
