import { describe, it, expect } from 'vitest';
import { Packer } from 'docx';
import { unzipSync, strFromU8 } from 'fflate';
import { buildDiscussionModel, __testHooks } from '../docxExport.js';
import { DEFAULT_EXPORT_TEMPLATE } from '../mondayApi/boards.config.js';

/*
 * round315 (owner request) — the participants block of "פרטי הדיון":
 *   • every participant on its own line (or the classic single row), and
 *   • each participant composed from the profile parts the owner ordered.
 * Asserted on the REAL rendered word/document.xml, read back as paragraph lines,
 * because the whole point of the feature is where the text lands on the page.
 */

// Paragraph texts of the rendered document, in order.
const linesOf = async (model, template) => {
  const { doc } = await __testHooks.buildExportDoc(model, template);
  const xml = strFromU8(unzipSync(new Uint8Array(await Packer.toBuffer(doc)))['word/document.xml']);
  return (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || [])
    .map((p) => (p.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [])
      .map((t) => t.replace(/<[^>]+>/g, ''))
      .join(''))
    .map((s) => s.trim())
    .filter(Boolean);
};

/*
 * A template with the participants block configured by `patch`.
 *
 * round319 — `perLine`/`parts` moved OFF the participants row onto the template's
 * one `people` setting (label/enabled are still the row's own), so the helper routes
 * each key to where it now lives and every case below still reads as before.
 */
const tplWith = ({ perLine, parts, includeExternal, ...fieldPatch }) => ({
  ...DEFAULT_EXPORT_TEMPLATE,
  people: {
    ...DEFAULT_EXPORT_TEMPLATE.people,
    ...(perLine === undefined ? {} : { perLine }),
    ...(parts === undefined ? {} : { parts }),
    ...(includeExternal === undefined ? {} : { includeExternal }),
  },
  sections: DEFAULT_EXPORT_TEMPLATE.sections.map((s) => (
    s.key === 'meta'
      ? { ...s, fields: s.fields.map((f) => (f.key === 'participantsText' ? { ...f, ...fieldPatch } : f)) }
      : s
  )),
});

const DISC = {
  name: 'דיון בדיקה',
  participantsID: [{ id: '1', name: 'עידו פיוטרקובסקי' }, { id: '2', name: 'דנה כהן' }],
};
const PROFILES = {
  1: { title: 'מנהל מחלקת מכירות', customFields: { 750658: 'מר' } },
  2: { title: '', customFields: {} },
};
const modelOf = (extra = {}) => buildDiscussionModel({ discussion: { ...DISC, ...extra }, participantProfiles: PROFILES });

const EXAMPLE_PARTS = [
  { key: 'cf:750658', sep: ', ' },
  { key: 'name', sep: ' ' },
  { key: 'title', sep: ', ' },
];

describe('buildDiscussionModel — participants as profiles', () => {
  it('exposes the participants as objects carrying Title and custom fields', () => {
    const model = modelOf();
    expect(model.participants).toEqual([
      { id: '1', name: 'עידו פיוטרקובסקי', title: 'מנהל מחלקת מכירות', customFields: { 750658: 'מר' } },
      { id: '2', name: 'דנה כהן', title: '', customFields: {} },
    ]);
  });

  it('keeps participantsText as the plain comma-joined names (older readers unaffected)', () => {
    expect(modelOf().participantsText).toBe('עידו פיוטרקובסקי, דנה כהן');
  });

  it('leaves the profile fields empty when no profiles were fetched (the degraded path)', () => {
    const model = buildDiscussionModel({ discussion: DISC });
    expect(model.participants.map((p) => p.title)).toEqual(['', '']);
    expect(model.participants.map((p) => p.name)).toEqual(['עידו פיוטרקובסקי', 'דנה כהן']);
  });

  it('exposes the external guests unjoined as well as joined', () => {
    const model = modelOf({ externalParticipantsID: 'רוני שגב, גיל אדם' });
    expect(model.externalParticipants).toEqual(['רוני שגב', 'גיל אדם']);
    expect(model.externalParticipantsText).toBe('רוני שגב, גיל אדם');
  });
});

describe('the participants block in the rendered document', () => {
  it('DEFAULT template — one row, names comma-joined (byte-for-byte the old output)', async () => {
    const lines = await linesOf(modelOf(), DEFAULT_EXPORT_TEMPLATE);
    expect(lines).toContain('משתתפים: עידו פיוטרקובסקי, דנה כהן');
  });

  it('a template stored BEFORE this round (no perLine key at all) keeps the single row', async () => {
    // The realistic upgrade path: seedExportTemplate keeps a stored meta section's
    // fields verbatim, so an existing instance's participants field has no perLine
    // key. Absent must read as OFF, or every existing export silently relayouts.
    const legacyTpl = tplWith({});
    const field = legacyTpl.sections.find((s) => s.key === 'meta').fields.find((f) => f.key === 'participantsText');
    delete field.perLine;
    delete field.parts;
    const lines = await linesOf(modelOf(), legacyTpl);
    expect(lines).toContain('משתתפים: עידו פיוטרקובסקי, דנה כהן');
    expect(lines).not.toContain('משתתפים:');
  });

  it('per-line — a "משתתפים:" label followed by one line per participant', async () => {
    const lines = await linesOf(modelOf(), tplWith({ perLine: true }));
    const at = lines.indexOf('משתתפים:');
    expect(at).toBeGreaterThanOrEqual(0);
    expect(lines[at + 1]).toBe('עידו פיוטרקובסקי');
    expect(lines[at + 2]).toBe('דנה כהן');
    // …and NOT the joined row.
    expect(lines).not.toContain('משתתפים: עידו פיוטרקובסקי, דנה כהן');
  });

  it('parts — each participant carries the chosen titles, in the chosen order', async () => {
    const lines = await linesOf(modelOf(), tplWith({ perLine: true, parts: EXAMPLE_PARTS }));
    const at = lines.indexOf('משתתפים:');
    expect(lines[at + 1]).toBe('מר עידו פיוטרקובסקי, מנהל מחלקת מכירות');
    // The participant with no Title keeps a clean name — no trailing comma.
    expect(lines[at + 2]).toBe('דנה כהן');
  });

  it('parts apply to the single-row form too', async () => {
    const lines = await linesOf(modelOf(), tplWith({ parts: EXAMPLE_PARTS }));
    expect(lines).toContain('משתתפים: מר עידו פיוטרקובסקי, מנהל מחלקת מכירות, דנה כהן');
  });

  it('honours a renamed label in per-line mode', async () => {
    const lines = await linesOf(modelOf(), tplWith({ perLine: true, label: 'נוכחים' }));
    expect(lines).toContain('נוכחים:');
  });

  it('per-line puts the EXTERNAL guests on their own lines under their own label', async () => {
    const model = modelOf({ externalParticipantsID: 'רוני שגב, גיל אדם' });
    const lines = await linesOf(model, tplWith({ perLine: true }));
    // Externals split the block, so the internal label gains its qualifier (round211).
    const at = lines.indexOf('משתתפים פנימיים:');
    expect(at).toBeGreaterThanOrEqual(0);
    const extAt = lines.indexOf('משתתפים חיצוניים:');
    expect(extAt).toBeGreaterThan(at);
    expect(lines[extAt + 1]).toBe('רוני שגב');
    expect(lines[extAt + 2]).toBe('גיל אדם');
  });

  it('externals in the classic form stay ONE row each (round211 behavior preserved)', async () => {
    const model = modelOf({ externalParticipantsID: 'רוני שגב, גיל אדם' });
    const lines = await linesOf(model, DEFAULT_EXPORT_TEMPLATE);
    expect(lines).toContain('משתתפים פנימיים: עידו פיוטרקובסקי, דנה כהן');
    expect(lines).toContain('משתתפים חיצוניים: רוני שגב, גיל אדם');
  });

  it('a model with NO participants list still renders its text row (legacy caller)', async () => {
    const legacy = { ...modelOf(), participants: undefined };
    const lines = await linesOf(legacy, tplWith({ parts: EXAMPLE_PARTS }));
    expect(lines).toContain('משתתפים: עידו פיוטרקובסקי, דנה כהן');
  });

  it('emits nothing at all when the discussion has no participants', async () => {
    const empty = buildDiscussionModel({ discussion: { name: 'ריק' } });
    const lines = await linesOf(empty, tplWith({ perLine: true }));
    expect(lines.some((l) => l.startsWith('משתתפים'))).toBe(false);
  });

  it('is dropped entirely when the owner disabled the participants field', async () => {
    const lines = await linesOf(modelOf(), tplWith({ enabled: false, perLine: true }));
    expect(lines.some((l) => l.startsWith('משתתפים'))).toBe(false);
  });
});
